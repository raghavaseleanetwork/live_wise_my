# Family Reminders on Home Dashboard — Backend Requirements

**Audience:** Backend team
**Date:** 2026-08-15
**Status:** Frontend is **built and shipping**. It renders today from a
**local, on-device projection** because the endpoint below does not exist yet.
That fallback works but has three real limits (§1.2) that only the server can fix.

**Client request this answers:**
> *"Family Reminders Section (Home Dashboard). Reminder Card Should Display:
> Member profile photo, Member name, Reminder type icon, Reminder title,
> Reminder time, Reminder Status. Navigation: Add a View All button, navigate 
> to the Reminders tab."*

---

## 0. TL;DR

| # | Work | Size | Blocking? |
|---|---|---|---|
| 1 | Implement `GET /api/reminders/family` (§2) | Medium | **No** — but without it the section can't show other-device data or push while closed |
| 2 | Include `memberAvatarUrl` on each row (§2.2) | Trivial | Only for the photo the client explicitly asked for |
| 3 | Server-side scheduling + push for these reminders (§4) | Medium | **Yes, for reliability** — local notifications can't fire dependably when the app is closed |

**Prerequisite:** §2 can only return meaningful data once Family Hub records
actually persist server-side. See
`FAMILY-HUB-PRD-COMPLIANCE-backend-requirements.md` — if those record kinds
aren't stored, this endpoint has nothing to project and must keep returning
`[]` (which the client correctly treats as "fall back to local", see §3).

---

## 1. What's already built on the frontend

### 1.1 Shipped in this change

- `components/FamilyRemindersSection.tsx` — the card the client specified:
  member photo (via `Avatar`, falls back to a coloured initial), member name,
  reminder-type icon, title, date + time, and a status pill
  (**Overdue / Today / Upcoming / Done**). Horizontal scroll, max 5 cards.
- **"View All"** in the section header → routes to `/(tabs)/bills` (the
  Reminders tab).
- Rendered in **both** Home layouts — normal and senior mode (senior gets
  larger type and cards).
- Tapping a card opens that member's Family Hub detail screen.
- `memberAvatarUrl` added to the `FamilyReminder` type and threaded through the
  local projection (`lib/family-reminders.ts`), so photos work today from the
  local path and will keep working when the server supplies them.
- i18n across all 7 locales.

### 1.2 Why the local fallback is not sufficient

`lib/use-family-reminders.ts` already prefers the server and falls back to
rebuilding reminders from on-device AsyncStorage records. That fallback:

1. **Only sees records created on this device.** A reminder added on the user's
   phone is invisible on their tablet, and invisible to a connected caregiver.
2. **Cannot reliably notify when the app is closed.** Local notifications are
   best-effort and get cleared by OS cleanup, force-quit, and reinstall.
3. **Cannot fan out to caregivers at all.** A caregiver's device has no copy of
   the owner's records, so it can project nothing for them.

Items 1 and 3 are the ones users will report as bugs.

---

## 2. `GET /api/reminders/family`

The client already calls this exact path
(`lib/family-reminders-api.ts:169`). It is **not** in `server/routes.ts` today —
confirmed by grep, returns 404.

```
GET /api/reminders/family
Auth: required (standard Bearer JWT)

200 → FamilyReminder[]      // a flat array, NOT wrapped in an object
```

### 2.1 What it must return

One row per **upcoming or recently-passed** reminder, projected from the
member's Family Hub records, for **every member the requester can see** — their
own members *and* members shared with them as an accepted connected caregiver.

Source records to project from (kind → `sourceKind` value):

| Record kind | `sourceKind` | Date field to project from |
|---|---|---|
| `appointments` | `appointment` | `date` |
| `medicationStock` (low stock) | `medicine-stock` | derived — when stock runs out |
| `familyBills` | `family-bill` | `dueDate` |
| `subscriptions` | `subscription` | `renewalDate` |
| `familyTasks` | `task` | `dueDate` |
| `routines` | `routine` | next occurrence from `time` + `days` |
| `checkins` | `checkin` | next occurrence from `time` + `days` |
| `travelItems` | `travel` | `date` |

### 2.2 Row shape

The client parses these into its existing `FamilyReminder` type. **Match this
field-for-field** — the local projection already produces exactly this shape,
and both paths feed the same components.

```ts
{
  // `fam:<kind>:<memberId>:<sourceId>` — MUST be deterministic and stable.
  // The client dedupes on it and uses it as a React key; a changing id
  // duplicates rows or drops them.
  id: string,

  name: string,          // "<title> · <memberName>" — the client strips the
                         // " · <memberName>" suffix for the Home card and
                         // keeps the full string for the flat Bills list
  amount: number,        // 0 when the kind has no amount
  dueDate: string,       // ISO — the next occurrence for recurring kinds
  category: string,      // a CategoryType, for icon/colour fallback
  isPaid: boolean,       // true = completed/done
  icon: string,          // Ionicons name for the reminder-type icon
  reminderType: 'subscription' | 'custom',
  repeatType: string,
  status: 'active' | 'paid' | 'snoozed' | 'cancelled',
  reminderDaysBefore: number[],
  source: 'family',      // literal — marks the row as Family Hub-originated

  memberId: string,
  memberName: string,
  memberAvatarUrl?: string | null,   // ← NEW, needed for the client's photo
  sourceKind: 'appointment'|'medicine-stock'|'family-bill'|'subscription'
            |'task'|'routine'|'checkin'|'travel',
  sourceId: string,      // the underlying record's id

  // Recurring kinds only (routine, checkin). `dueDate` on those is a DERIVED
  // "next occurrence" for sorting/display — this is the actual schedule.
  recurrence?: { hour: number, minute: number, weekdays: number[] },  // 0=Sun
}
```

**`memberAvatarUrl`** is the one genuinely new field this document asks for.
It's the same `avatarUrl` already stored on the `family_members` document —
just denormalised onto each projected row so the client doesn't have to fetch
the member list separately to render a photo. Null is fine; the client renders
a coloured initial.

### 2.3 Access scope

Return reminders for members where the requester is the **owner** OR an
**accepted connected caregiver** — the same rule as the Family Hub record
routes. This depends on
`CAREGIVER-CONNECTED-SYSTEM-backend-requirements.md`, which is still unbuilt;
until it is, owner-only is correct and sufficient.

---

## 3. Critical: what an empty array means to this client

**Returning `[]` is safe and correct while records aren't server-persisted.**

The client treats an empty array as *"the server has nothing useful"* and falls
back to the local projection, rather than rendering an empty list. This is
deliberate and load-bearing — a previous build trusted `[]`, blanked the
Reminders tab, and latched a flag that disabled local notification scheduling
for the life of the install. That was the "I added an appointment and it never
showed up" bug.

So:
- **404** → client clears any server-scheduling flag, uses local. Safe.
- **`[]`** → same. Safe.
- **Non-empty array** → client switches to the server as the source of truth
  **and cancels its own local notifications**, assuming the server now owns
  scheduling (§4).

⚠️ **That last point is the trap.** The first time this endpoint returns a
non-empty array, the client stops scheduling local notifications. If the server
is returning rows but **not** yet sending push, the user gets *no reminders at
all* — worse than before. **Do not ship a non-empty response until §4 is also
live.**

---

## 4. Server-side scheduling and push

Once §2 returns real rows, the server owns delivery. Each row needs a
notification at its `reminderDaysBefore` offsets from `dueDate`, and recurring
kinds need one per occurrence from `recurrence` (`hour`/`minute`/`weekdays`,
0=Sun; empty `weekdays` means every day).

Push payload the client already handles:

```json
{ "type": "family-reminder", "memberId": "<id>", "reminderId": "<fam:...>" }
```

Fan out to the member's **owner and every accepted connected caregiver**,
consistent with `CAREGIVER-CONNECTED-SYSTEM-backend-requirements.md` §4.3 and
`BUG-19-family-reminders-push-and-caregiver-fanout.md`.

---

## 5. How to verify

1. `GET /api/reminders/family` with a valid token, no family records →
   `200` with `[]`. Confirm the app still shows locally-projected reminders on
   Home (this proves the fallback path is intact).
2. Create an appointment for a member server-side, then `GET` → one row, with
   `sourceKind: 'appointment'`, a `fam:`-prefixed `id`, and `memberAvatarUrl`
   populated when the member has a photo.
3. `GET` twice → identical `id` values both times (stability check; a changing
   id breaks React keys and dedupe).
4. Create a daily routine → the row carries `recurrence` with the right
   `hour`/`minute`, and `dueDate` is the *next* occurrence, not the record's
   creation date.
5. As a **connected caregiver**, `GET` → the owner's members' reminders appear.
6. **Before enabling in production:** confirm push actually fires for a row
   returned by this endpoint (§3's trap — non-empty response disables the
   client's local scheduling).

---

## 6. Related documents

- `FAMILY-HUB-PRD-COMPLIANCE-backend-requirements.md` — the record kinds this
  endpoint projects from. **Prerequisite.**
- `BUG-19-family-reminders-push-and-caregiver-fanout.md` — push fan-out for
  these reminders.
- `CAREGIVER-CONNECTED-SYSTEM-backend-requirements.md` — the caregiver access
  rule in §2.3 and the fan-out in §4. Still unbuilt.
- `FAMILY-HUB-NOTIFICATIONS-backend-requirements.md` — earlier notification spec.
- Frontend: `lib/family-reminders.ts` (projection + shape),
  `lib/family-reminders-api.ts` (fetch + cutover logic),
  `lib/use-family-reminders.ts` (source selection),
  `components/FamilyRemindersSection.tsx` (the Home card).
