# Family Reminders on Home Dashboard — Backend Status

**Audience:** Frontend team
**Received from backend team:** 2026-08-17
**Source doc:** `FAMILY-REMINDERS-HOME-backend-requirements.md` (2026-08-15)

Status against that doc's TL;DR table:

| # | Work | Status |
|---|---|---|
| 1 | `GET /api/reminders/family` | ✅ Already live (predates this update) |
| 2 | `memberAvatarUrl` on each row | ✅ Added in this update |
| 3 | Server-side scheduling + push (§4) | ❌ Not built |

> ### 🔴 FRONTEND ACTION TAKEN ON RECEIPT (2026-08-17) — read this first
>
> **The trap in §3 of the requirements doc had already sprung.** The backend
> is now returning non-empty rows while sending no push. On the shipped client
> that combination silently disables family reminders entirely:
>
> ```
> fetchFamilyReminders()
>   → non-empty array
>   → markServerSchedulingActive()
>       → cancelLocalFamilyNotifications()   // cancels every local schedule
>       → SERVER_SCHEDULING_KEY = 'true'     // permanent for the install
> ```
>
> Result: local notifications cancelled, server push never arrives, user gets
> **zero** Family Hub reminders — and nothing in the UI explains why. This is
> the same "I added an appointment and it never showed up" bug the code
> comments already describe from a previous occurrence.
>
> **Fix applied to `lib/family-reminders-api.ts`:**
> 1. Added a `SERVER_PUSH_CONFIRMED` flag, currently `false`. The scheduling
>    cutover is now gated on it, **not** on whether rows came back.
> 2. While it's `false`, a non-empty response calls
>    `clearStaleServerScheduling()` instead — which **undoes** the cutover for
>    anyone whose install already latched it, restoring local notifications on
>    the next fetch.
> 3. Rows are still used for display, so the avatar/recurrence work below
>    lands immediately. Only the scheduling handover waits.
>
> **When §4 ships: flip `SERVER_PUSH_CONFIRMED` to `true`** in
> `lib/family-reminders-api.ts`. Verify push actually fires on a device first —
> it cannot be detected from the response shape. `tsc` clean.

---

## ✅ Done

### §2: `GET /api/reminders/family`

Already implemented and live — `server/routes.ts`. Auth required, returns a
flat `FamilyReminder[]`, scoped to members the requester owns **or** is an
accepted connected caregiver on (§2.3's access rule — the caregiver-connected
system this depended on is in fact built, contrary to the requirements doc
calling it "still unbuilt").

**What changed today:** the projection (`server/family-reminders.ts`) was
missing two fields the spec requires. Both are fixed now:

- **`memberAvatarUrl`** — the one field §2.2 explicitly called out as new.
  Every row now carries the member's `avatarUrl` (same value already on the
  `family_members` document), or `null` if the member has no photo.
- **`recurrence`** — routine and check-in rows now include
  `{ hour, minute, weekdays }` derived from the record's `time` and `days`
  fields (0=Sun..6=Sat; empty `weekdays` = every day). Previously this field
  was silently omitted entirely for the two recurring kinds.

Everything else in §2.2's row shape (`id`, `name`, `amount`, `dueDate`,
`category`, `isPaid`, `icon`, `reminderType`, `repeatType`, `status`,
`reminderDaysBefore`, `source`, `memberId`, `memberName`, `sourceKind`,
`sourceId`) matched already — no other changes needed.

`id` stability (doc §5, verification step 3) is unaffected by this change —
it's still built only from `sourceKind:memberId:sourceId`, deterministic
across repeated GETs.

> **Frontend note:** `memberAvatarUrl` is exactly what the Home dashboard card
> needs — it flows straight through `fetchFamilyReminders` into
> `FamilyRemindersSection` with no client change, since server rows are passed
> through as-is. Member photos should now appear on Home for accounts fetching
> from this endpoint. Members without a photo render a coloured initial.
>
> On **`recurrence`**: good catch, and worth noting it was a real bug, not just
> a missing field. Without it, routine/check-in rows had only the derived
> `dueDate` ("next occurrence"), and scheduling off that value is what made a
> daily routine fire exactly once — documented in `lib/family-reminders.ts`.
> Our local projection has always sent it; the server's omission would have
> reproduced that same bug once server scheduling took over. Fixing it before
> §4 ships is the right order.

### §3: The `[]` vs non-empty contract

Already correct, no change needed. The endpoint returns `[]` when a
requester has no family records (not a 404), and returns real rows once
records exist — matching the client's fallback-to-local behavior described in
the requirements doc.

**⚠️ The trap the requirements doc calls out still applies**: this endpoint
can now return non-empty rows with a populated `memberAvatarUrl` and
`recurrence`, but **no push is being sent for them yet** (see §4 below). If
the client is live and any user's account currently produces non-empty
reminders, they will see **zero notifications** for those Family Hub
reminders — worse than the local-only fallback. Do not treat this endpoint
going non-empty as a signal that push is also live; it isn't.

> **Frontend note:** thank you for flagging this explicitly rather than
> shipping it quietly — it's the difference between a caught issue and a
> support ticket. Handled client-side as described in the red box above:
> the cutover is now gated on `SERVER_PUSH_CONFIRMED`, and installs that
> already latched the flag self-heal on the next fetch. **No backend action
> needed for this**; just tell us when §4 is live so we can flip it.

---

## ❌ Not done

### §4: Server-side scheduling + push

Confirmed by code inspection: there is an existing reminder scheduler in
`server/routes.ts` (`startReminderScheduler`), but it only reads from the
`bills` collection — it does not consume `projectFamilyReminders` /
`projectMemberReminders` at all. No push notification is sent for any
Family Hub-derived reminder today. This is real, unstarted work, not a
partial implementation.

> **Frontend note — this is now the single highest-value backend item for
> Family Hub.** Everything else in the feature works; reminders that never
> notify are the one gap users will actually feel.
>
> Two dependencies worth scoping together:
> - `FAMILY-HUB-PRD-COMPLIANCE-backend-requirements.md` §4 (medicine
>   `frequency`/`daysOfWeek`) is a **prerequisite** for scheduling
>   alternate-day and weekly medicines correctly.
> - Fan-out must reach the owner **and** accepted caregivers — the
>   connected-caregiver system is confirmed live, so that's unblocked.
>
> Push payload the client already handles:
> `{ "type": "family-reminder", "memberId": "<id>", "reminderId": "<fam:...>" }`

---

## What this means for you right now

- The photo you asked for (§2.2) will render correctly for any account
  already fetching from this endpoint.
- Routine/check-in rows now carry a real `recurrence` schedule instead of a
  missing field — if the client was defensively coding around its absence,
  that workaround is no longer needed (but leaving it in place is harmless).
- Do **not** flip any client-side assumption that switches off local
  notification scheduling based on this endpoint alone — push isn't wired up
  yet, and doing so would silently disable reminders for affected users
  (exactly the failure mode §3 of the requirements doc warns about).
- We'll follow up separately once §4 (scheduling + push) lands.

---

## Frontend status after this update (2026-08-17)

| # | Item | Status |
|---|---|---|
| 1 | Guard the scheduling cutover behind `SERVER_PUSH_CONFIRMED` | ✅ Done — `lib/family-reminders-api.ts` |
| 2 | Self-heal installs that already latched the cutover | ✅ Done — non-empty response now calls `clearStaleServerScheduling()` while the flag is `false` |
| 3 | Member photos on the Home card | ✅ Works — server rows pass through unchanged |
| 4 | Flip `SERVER_PUSH_CONFIRMED` to `true` | ⏳ **Blocked on backend §4.** Verify push on a device before flipping. |
| 5 | Device check: family reminders still notify after this build | ⏳ Recommended before release |

---

## Related documents

- `FAMILY-REMINDERS-HOME-backend-requirements.md` — the original request this answers.
- `FAMILY-HUB-PRD-COMPLIANCE-backend-STATUS.md` — the sibling status update;
  its §4 (medicine fields) is a prerequisite for parts of §4 here.
- `BUG-19-family-reminders-push-and-caregiver-fanout.md` — earlier push fan-out spec.
- Frontend: `lib/family-reminders-api.ts` (the cutover gate),
  `components/FamilyRemindersSection.tsx` (the Home card).
