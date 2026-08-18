# Family Reminders — Delivery, Timing & Cross-User Sync

**Audience:** Backend team
**From:** Frontend team
**Date:** 2026-08-18
**Status:** Frontend **DONE**. Backend **§4 and §5 DONE** (backend reply 2026-08-18).
Remaining: device verification (§8) before flipping the cutover flag (§7), and per-user timezone (§9) — see the addendum at the end.

> ### 📌 2026-08-18 UPDATE — read this before §5
>
> The backend replied the same day. Two corrections to this document:
>
> - **§5 is NOT a gap — it was already done, and this doc was wrong.** Family
>   records have synced to the server since "Phase 5" (2026-08-01) via
>   `lib/family-records-sync.ts`; `addSynced`/`updateSynced`/`deleteSynced`
>   write through and `loadSynced` pulls. All 8 reminder kinds are covered.
>   **Cross-user Family Hub sync already works.** §5 below is retained only as
>   a record of the mistake — treat it as closed.
> - **§4 is shipped**, including the 09:00 rule, `leadMinutes`, weekday-aware
>   recurring kinds, and caregiver fan-out. The backend also added a
>   `hasExplicitTime` flag, which the client now consumes (see addendum).
>
> The backend also noted the client files this doc cites don't exist in their
> repo — expected, they're in the app repo, not the server repo. All four are
> present and were verified.

**Related, read alongside:**
- [`FAMILY-REMINDERS-HOME-backend-requirements.md`](./FAMILY-REMINDERS-HOME-backend-requirements.md) — the `GET /api/reminders/family` contract. **Still the authority on the row shape.**
- [`FAMILY-REMINDERS-HOME-backend-STATUS.md`](./FAMILY-REMINDERS-HOME-backend-STATUS.md) — your 2026-08-17 status. §4 there is what this doc expands.
- [`BUG-19-family-reminders-push-and-caregiver-fanout.md`](./BUG-19-family-reminders-push-and-caregiver-fanout.md) — push fan-out spec.
- [`FAMILY-HUB-PRD-COMPLIANCE-backend-requirements.md`](./FAMILY-HUB-PRD-COMPLIANCE-backend-requirements.md) — record persistence. ~~Hard prerequisite for §5~~ — already delivered.

---

## 0. TL;DR

The client reported: *"Family Hub notifications are not coming. Normal reminders work."*

Investigation found **five** defects. Three were frontend and are **fixed in this release**. Two are backend and are the ask here.

| # | Defect | Layer | Status |
|---|---|---|---|
| 1 | Server rows rendered but **never scheduled** — the main "no notification" bug | Frontend | ✅ Fixed, §2.1 |
| 2 | Date-only reminders fired at **00:00** (user asleep) | Frontend | ✅ Fixed, §2.2 |
| 3 | Per-record reminder settings (`3 hours before` etc.) **stored but ignored** | Frontend | ✅ Fixed, §2.3 |
| 4 | **No server push** for family reminders — nothing arrives when app is closed | **Backend** | ✅ Shipped 2026-08-18 |
| 5 | ~~Family records never leave the device~~ — **this claim was wrong** | — | ✅ Already done 2026-08-01 |

> ~~**The single most important thing to understand:** defect #5 means the client's core premise — *"if I add something in Family Hub, it appears in both users' reminders"* — is not true today...~~
>
> **Retracted 2026-08-18.** This was wrong. Records have synced since 2026-08-01;
> the premise holds. The real cause of "notifications not coming" was defects
> #1 and #4, not missing persistence.

---

## 1. Why "normal reminders work but Family Hub ones don't"

They travel completely different paths:

```
NORMAL REMINDER (works)
  add bill → POST /api/bills → server DB
                                  └─ startReminderScheduler reads `bills`
                                        └─ push ✅ (works with app closed)

FAMILY HUB REMINDER (broken, as of 2026-08-18 morning)
  add appointment → AsyncStorage → POST /api/family/.../appointments  ✅ (since 2026-08-01)
                        └─ projected into a reminder row
                              └─ rendered in the list ✅
                              └─ ✗ never scheduled  ← defect #1 (frontend)
                        └─ ✗ server scheduler emitted nothing  ← defect #4 (backend)
```

The record reached the server fine. What failed was **delivery on both sides at once**: the client rendered the row without arming a notification, and `startReminderScheduler` read only the `bills` collection. Both are now fixed.

---

## 2. What the frontend fixed in this release

No backend action needed for these — included so you understand the data shape you must now match.

### 2.1 Server rows are now scheduled locally (the main bug)

`lib/use-family-reminders.ts` fetched the server's rows, rendered them, and **returned early — skipping scheduling entirely**:

```ts
const serverReminders = await fetchFamilyReminders(token);
if (serverReminders) {
  setFamilyReminders(serverReminders);
  return;                                  // ← nothing was ever scheduled
}
```

So whenever `GET /api/reminders/family` answered with rows, family reminders **appeared in the list but no notification was ever armed**. Scheduling only ever ran in the offline-fallback branch. Now `scheduleFamilyReminderNotifications(serverReminders)` runs on the server path too.

> This does **not** double-fire. The call no-ops when `isServerSchedulingActive()`, which latches only once `SERVER_PUSH_CONFIRMED` is flipped (§7). Until you ship §4 the server schedules nothing, so the device is the only thing that can.

### 2.2 Date-only reminders now fire at 09:00, not midnight

Lead times were applied with `at.setDate(at.getDate() - daysBefore)`, which **preserves the time of day**. Date-only records (bills, subscriptions, tasks, medicine refills) are written at local midnight by the date picker, so *every* one of these fired at **00:00** — a "1 day before" bill reminder arrived at midnight the previous night, while the user was asleep.

Now: if the record has no real time of day, the reminder is moved to **09:00 local**. Records with a genuine time (an appointment at 14:30) keep it.

**You must match this in the server scheduler.** See §4.2.

### 2.3 Per-record reminder settings are now honoured

Three settings the user picks in the UI were written to storage and then **silently dropped** by the projection:

| Field | Record | UI options | Was |
|---|---|---|---|
| `Appointment.reminderLead` | appointments | `1_day`, `3_hours`, `1_hour`, `30_min` | ignored → always `[1, 0]` days |
| `TravelItem.reminderHoursBefore` | travel | hours-before chips | ignored → always `[1, 0]` days |
| `FamilyBill.reminderDaysBefore` + `dayOfReminderEnabled` | bills | days chip + due-date toggle | ignored → always `[3, 1, 0]` |

A user choosing **"30 min before"** for an appointment was still notified a **whole day** early and never at 30 minutes. Fixed — these now drive scheduling.

Because days can't express sub-day offsets, `FamilyReminder` gained a field:

```ts
/** Lead offsets in MINUTES. When present, REPLACES reminderDaysBefore. */
leadMinutes?: number[];
```

**You should emit this field too** — see §4.3.

---

## 3. What you already shipped (2026-08-17) — no action

Per your status doc, these are done and the client consumes them: `GET /api/reminders/family` live, `memberAvatarUrl` on every row, `recurrence` on routine/check-in rows. All good.

---

## 4. ✅ BACKEND ASK #1 — Send push for family reminders — **SHIPPED 2026-08-18**

*(Kept as written; this is the spec the backend implemented against.)*

This is §4 of the requirements doc and §3 of BUG-19. Extend `startReminderScheduler` (or add a sibling) to schedule from the family reminder projection, not just `bills`.

### 4.1 Non-recurring kinds

For each row with no `recurrence`, fire at each offset before `dueDate`:
- if `leadMinutes` is present → `dueDate − N minutes` for each entry
- else → `dueDate − N days` for each entry in `reminderDaysBefore`

### 4.2 The 09:00 rule — match the client exactly

When applying a **day-based** offset, if the source record has **no time of day** (stored at local midnight), set the notification to **09:00 in the user's local timezone**. If it has a real time, preserve it.

```
bill due 2026-09-01 (midnight), reminderDaysBefore [3, 0]
  → notify 2026-08-29 09:00   ✅   (not 00:00)
  → notify 2026-09-01 09:00   ✅

appointment 2026-09-01 14:30, leadMinutes [30]
  → notify 2026-09-01 14:00   ✅
```

> ⚠️ **Timezone.** These must fire at 09:00 *for the user*, not 09:00 UTC. If you don't store a per-user timezone, you need one — otherwise Indian users get 14:30 reminders. Flag this if it's a blocker and we'll send the device timezone on login.

### 4.3 Emit `leadMinutes` on rows that have it

Add to the row shape in `FAMILY-REMINDERS-HOME-backend-requirements.md` §2.2:

```ts
leadMinutes?: number[]   // minutes before dueDate; replaces reminderDaysBefore
```

Derive it the same way the client does:

| `sourceKind` | Source field | `leadMinutes` |
|---|---|---|
| `appointment` | `reminderLead: '1_day'` | `[1440]` |
| `appointment` | `reminderLead: '3_hours'` | `[180]` |
| `appointment` | `reminderLead: '1_hour'` | `[60]` |
| `appointment` | `reminderLead: '30_min'` | `[30]` |
| `travel` | `reminderHoursBefore: N` | `[N * 60]` |

Defaults when the field is absent: appointment → `1_day` (`[1440]`), travel → `24` hours (`[1440]`).

For **family bills**, don't use `leadMinutes` — emit the user's choice in the existing day-based field:
`reminderDaysBefore = [reminderDaysBefore] + (dayOfReminderEnabled ? [0] : [])`, deduped, descending. Fall back to `[3, 1, 0]` when unset.

### 4.4 Recurring kinds (routine, check-in)

Fire at `recurrence.hour`:`recurrence.minute` on each weekday in `recurrence.weekdays` (0=Sun..6=Sat; **empty array means every day**). Do **not** schedule these off `dueDate` — it is a derived "next occurrence" for sorting only. This is the bug BUG-19 §2.1 describes.

### 4.5 Push payload

The client already handles this shape — see `lib/notification-actions.ts`:

```json
{
  "type": "family-reminder",
  "memberId": "<member id>",
  "reminderId": "fam:<kind>:<memberId>:<sourceId>",
  "sourceKind": "appointment",
  "sourceId": "<record id>"
}
```

Title/body format the client uses locally, for consistency:
- title: `"<Kind label> · <memberName>"` → e.g. `"Appointment · Romil"`
- body, day-based: `"<title> is due today"` / `"<title> in 3 days"`
- body, minute-based: `"<title> in 30 minutes"` / `"<title> in 3 hours"` / `"<title> is tomorrow"`

### 4.6 Fan out to connected caregivers

Send to the member's **owner AND every accepted connected caregiver** — not just the record creator. This is BUG-19 §6 and the client's expectation that "connected people get the notification too". Your status doc confirms the caregiver-connected system is built, so the access rule already exists.

---

## 5. ~~BACKEND ASK #2 — Persist family records server-side~~ — **ALREADY DONE, CLAIM RETRACTED**

> **This entire section was wrong** and is kept only for the record. Family records
> have synced to the server since 2026-08-01. Skip to the addendum.

~~**This is the blocker for the client's actual request.**~~ Everything in §4 assumes the server can *see* the records. Today it cannot.

`lib/family-records.ts` writes every Family Hub record to on-device `AsyncStorage`, one key per member per feature (`@lifewise_family_appointments_<memberId>`, etc.). There is no write-through to the server for most kinds.

**Consequences today:**
1. Add an appointment on phone A → phone B never sees it. **Not fixable from the frontend.**
2. Reinstall or switch device → all Family Hub data is gone.
3. Caregivers can't be notified about records they have no copy of.
4. The server's projection can only ever return `[]` for these.

**Ask:** persist all eight reminder-producing record kinds server-side with full CRUD, scoped by the same owner-or-accepted-caregiver rule as the existing routes:

| Kind | `sourceKind` | Date field | Reminder-setting fields to store |
|---|---|---|---|
| appointments | `appointment` | `date` (date **+ time**) | `reminderLead` |
| medication stock | `medicine-stock` | derived (run-out date) | — |
| family bills | `family-bill` | `dueDate` | `reminderDaysBefore`, `dayOfReminderEnabled` |
| subscriptions | `subscription` | `renewalDate` | — |
| family tasks | `task` | `dueDate` (optional) | — |
| routines | `routine` | `time` + `days` | — (uses `recurrence`) |
| check-ins | `checkin` | `time` + `days` | — (uses `recurrence`) |
| travel | `travel` | `date` (date **+ time**) | `reminderHoursBefore` |

Field definitions are in [`lib/family-records.ts`](../lib/family-records.ts). This overlaps `FAMILY-HUB-PRD-COMPLIANCE-backend-requirements.md` — treat that as the schema authority and this as the reminder-specific requirement on top.

---

## 6. Suggested order

1. **§5 — persist records.** Nothing else works without it.
2. **§4 — scheduler + push + caregiver fan-out.** The actual "notifications not coming" fix.
3. **§7 — flip the cutover flag.** Must be the same release as #2.

---

## 7. ⚠️ The cutover flag — coordinate this with us

`lib/family-reminders-api.ts` has:

```ts
const SERVER_PUSH_CONFIRMED = false;
```

While `false`, the client schedules family notifications locally and **ignores** any implication that the server owns scheduling. When you ship §4, **tell us** and we flip it to `true` in the same release.

**Why it exists:** the client cannot detect from a response whether push is actually being sent. Getting this wrong in either direction is bad:

| | Server sends push | Server does NOT send push |
|---|---|---|
| **Flag `true`** | ✅ Correct | ❌ **Zero reminders** — local cancelled, nothing replaces them |
| **Flag `false`** | ⚠️ Duplicates | ✅ Correct (today) |

The bottom-right cell is where we are, deliberately. This already went wrong once: a build latched the cutover on *any* non-empty response, which cancelled local notifications while the backend sent nothing — users silently got **no** family reminders at all. Hence the flag.

**So: do not treat "the endpoint returns rows" as "the server owns scheduling."** Only a confirmed, device-verified push flips it.

---

## 8. How to verify

1. Create an appointment **on device A**, then `GET /api/reminders/family` **as device B's user (same account)** → the row appears. *(Proves §5.)*
2. Set an appointment for **30 minutes from now** with `reminderLead: '30_min'` → push arrives ~now, **not** a day early. *(Proves §4.3.)*
3. Create a family bill due **3 days from now**, no time → push arrives at **09:00** local, not 00:00. *(Proves §4.2.)*
4. Create a routine for **Mon/Wed at 12:30** → push at 12:30 on Monday **and again** on Wednesday. Fires with **the app force-closed**. *(Proves §4.4 — this is the client's original complaint.)*
5. As a **connected caregiver** on another account, confirm all of the above also arrive. *(Proves §4.6.)*
6. Confirm push arrives with the app **force-closed** — this is the whole point; local notifications can't be relied on here.
7. Only after 1–6 pass on a real device: tell frontend to flip `SERVER_PUSH_CONFIRMED`. Then re-test 2–5 and confirm **exactly one** notification per reminder, not two.

---

## 9. Open question for you

**Do you store a per-user timezone?** §4.2's 09:00 rule and §4.4's routine times are both local-time. If you don't have it, say so and we'll start sending the device timezone on login/refresh.

---

# ADDENDUM — 2026-08-18, after the backend reply

## A1. Accepted, with thanks

**§5 was our error.** Family records have synced since Phase 5 (2026-08-01)
via `lib/family-records-sync.ts` — `addSynced`/`updateSynced`/`deleteSynced`
write through to the server and `loadSynced` pulls from it, covering all 8
reminder kinds. We verified this in the app repo after your reply. The doc
above has been corrected; cross-user Family Hub sync is **not** a gap.

**On the missing files:** `lib/family-records.ts`,
`lib/family-reminders-api.ts`, `lib/use-family-reminders.ts` and
`lib/notification-actions.ts` all exist and were verified present. They're in
the **app** repo, not the server repo — that's the whole client codebase, so
nothing is out of sync. No action needed.

## A2. Client now consumes `hasExplicitTime` — this one mattered

Your `hasExplicitTime` flag closes a real bug we would otherwise have shipped.

Our client-side 9 AM rule inferred "date-only" by testing whether the
timestamp was local midnight. That works for locally-created records, but is
**wrong for your rows**: server rows arrive as UTC ISO strings, so a date-only
record stored at `00:00Z` parses to **05:30 local in IST**. Our check would
have seen "not midnight", concluded the user had picked a time, skipped the
correction — and fired the reminder at **05:30**.

The client now reads your flag and only falls back to the timestamp guess when
it's absent:

```ts
const explicit = reminder.hasExplicitTime ?? hasTimeOfDay(due);
if (!explicit) at.setHours(9, 0, 0, 0);
```

The local projection sets the same flag using your §4.2 classification
(bills / subscriptions / tasks → `false`; appointments / travel / stock /
routines / check-ins → `true`), so both paths agree.

**Please keep `hasExplicitTime` on every row**, including `true` ones — an
absent flag silently re-enables the fragile guess.

## A3. §7 cutover — agreed, we hold the flag

Agreed, and agreed with your reasoning. `SERVER_PUSH_CONFIRMED` stays `false`
until we've run §8 steps 1–6 on a real device against staging. We'll flip it
and confirm back. Nothing is needed from you for this.

**One thing to be aware of while the flag is `false`: users now get duplicate
notifications** — yours from the server, ours from the device. That's the
known, deliberate trade-off (the top-right cell of §7's table); duplicates are
the safe failure, silence is not. It does mean we should not sit in this state
longer than necessary, so we'll prioritize the device pass.

## A4. §9 timezone — we'd like this prioritized

Understood that 09:00 is currently **server** local, and that this predates
your change rather than being introduced by it.

It does need fixing before this is really done. The user base is IST; if the
server is not on IST, every date-only family reminder — and every bill
reminder, already — fires at the wrong hour. A "9 AM" reminder landing at
03:30 will read to the client as the same "wrong time" bug we just fixed.

**Proposal, if you agree:** we start sending an IANA timezone string (e.g.
`"Asia/Kolkata"`, from `Intl.DateTimeFormat().resolvedOptions().timeZone`) on
login and token refresh. You store it on the `users` document and thread it
through both schedulers. We can ship the client half whenever you're ready to
receive it — just confirm the field name and endpoint you want it on.

Flagging scope honestly: this touches the **bill** scheduler too, so it's
wider than family reminders. We're raising it as the next piece of work rather
than something to fold into this pass.

## A5. Open items

| # | Item | Owner | Status |
|---|---|---|---|
| 1 | Device verification, §8 steps 1–6, against staging | **Frontend** | Next up |
| 2 | Flip `SERVER_PUSH_CONFIRMED` → `true`, confirm no duplicates | **Frontend** | Blocked on #1 |
| 3 | Keep `hasExplicitTime` on all rows | Backend | Done — just don't drop it |
| 4 | Per-user timezone (§9 / A4) — confirm field name + endpoint | **Backend** | Awaiting your call |
