# Family Hub Reminders — Client Cutover Done (reply to backend)

**From:** frontend
**Date:** 2026-07-31
**Re:** "Family Hub Reminders — Backend Complete, Frontend Integration Guide"

---

## 1. Status: §4 is done

All three client steps from your §4 are implemented in one change, because your
own warning made staging them unsafe:

> *"the double-fire risk starts the moment you point at real push tokens in
> production, not at some future backend milestone."*

Since the server scheduler is already live in backend code, shipping step 2
(read from the server) without step 3 (stop local scheduling) would have meant
every family reminder firing twice. They ship together.

| Your §4 step | Status |
|---|---|
| 1. Compare outputs in a non-shipping build | Superseded — see §4 below |
| 2. Prefer `GET /api/reminders/family`, local as offline fallback | **Done** |
| 3. Disable local scheduling, clear the AsyncStorage key | **Done** |

**Files:** `lib/family-reminders-api.ts` (new), `lib/use-family-reminders.ts`,
`lib/family-reminders.ts`, `app/_layout.tsx`.

---

## 2. How the cutover is guarded

A successful response from `GET /api/reminders/family` sets a sticky flag
(`@lifewise_family_reminders_server_scheduling`). From then on:

- `scheduleFamilyReminderNotifications()` no-ops.
- Every previously-scheduled family notification is **cancelled** via
  `getAllScheduledNotificationsAsync()`, filtered on
  `data.type === 'family-reminder'`.
- `@lifewise_family_reminder_scheduled` is cleared, per your step 3.

**Cancelling matters more than clearing the key.** The OS holds the pending
schedules, not AsyncStorage — clearing the ledger alone would leave every
notification queued before the cutover still firing alongside yours, for as long
as its trigger date lasted. That is the double-fire you warned about, and it
would have looked like a backend bug.

**The flag is deliberately sticky.** A user who goes offline after cutover does
*not* get local scheduling switched back on, because your server-side schedule
for those same reminders still exists and will still fire.

**Failure direction is deliberate too:** if the flag cannot be read, the client
assumes the server is *not* active and keeps scheduling locally. A duplicate
notification is a smaller failure than a medicine reminder that never arrives.

---

## 3. Notification tap route — answering your §3 question

> *"if you want tap-to-navigate on these, tell us what route to add and we'll
> add `meta.route`."*

**No `meta.route` needed — handled client-side.** Tapping a `family-reminder`
push now opens:

```
/family-member-detail/<memberId>
```

`memberId` is already in your `data` payload, so nothing changes on your end.

Rationale: there is no detail screen for a composite `fam:...` id, and
`/bill-details` would 404 on one. The member page is where the underlying record
actually lives and can be acted on. If you *do* add `meta.route` later, please
tell us before shipping it — we would want to honour it rather than have two
mechanisms competing.

---

## 4. On your §4 step 1 (compare outputs before cutting over)

Skipped deliberately, not overlooked. A comparison build would only prove the
two projections agree *for records already on that one device* — which is the
case least likely to differ. The interesting divergences are multi-device and
caregiver-shared records, which the local projection cannot see at all, so the
comparison would report a false "agreement" precisely where the server adds
value.

The local path is retained as the offline fallback rather than deleted, so if
the server projection turns out to disagree in practice, the client already has
a working path to fall back to.

**What we would like from you instead:** a heads-up before the backend commit is
pushed/deployed, so client testing lines up with the endpoint actually being
reachable.

---

## 5. Confirmations back to you

- **Title separator** — client still does `.split(' · ')` on U+00B7 with spaces
  both sides. Your byte-for-byte verification matches what we parse.
- **Caregiver fix (your §1)** — confirmed no client change needed; the app was
  already merging `/api/family/shared-with-me` into the reminder list and
  calling the per-member routes exactly as you describe.
- **Fan-out to caregivers** — this was the requirement we raised as §4.4 of the
  spec, and your `getRecipientUserIds` precedent resolves it. Agreed.
- **`isPaid` / completion** — please confirm completion is stored on the
  *record* and not per-viewer, so an owner marking an appointment done also
  stops the caregiver's reminder. Your dedup test covers "marked complete before
  fire time" but not explicitly the two-account case.

---

## 5A. Change request: return completed records, don't drop them

**Found in device testing (2026-07-31). Affects both sides — our original spec
got this wrong, so this is a correction to it, not a bug report against you.**

Your §2 table says `appointment` is excluded when `completed: true`,
`family-bill` when `isPaid`, `task` when `completed`, `travel` when
`completed`. That matches what our local projection did, so the two agreed —
and both were wrong.

**The user-visible bug:** ticking a family reminder off makes it *vanish*. It
does not move to the Reminders tab's "Completed" section, because the
projection no longer emits it at all and that section filters on
`status === 'paid' || isPaid`. Completing something and watching it disappear
with no confirmation reads as data loss.

**What we need instead:**

| Kind | Old (drop) | New |
|---|---|---|
| `appointment` | omit when `completed` | emit with `isPaid: true`, `status: "paid"` |
| `family-bill` | omit when `isPaid` | emit with `isPaid: true`, `status: "paid"` |
| `subscription` | omit when `isPaid`/`cancelled` | emit `isPaid: true` when paid; **keep omitting `cancelled`** — see below |
| `task` | omit when `completed` | emit with `isPaid: true`, `status: "paid"` |
| `travel` | omit when `completed` | emit with `isPaid: true`, `status: "paid"` |

Unchanged, and please keep them unchanged:

- **Records with no usable date** — still omit. Nothing to sort or schedule by.
- **`routine` / `checkin`** — still gated on `enabled`. "Completed" is not a
  state a recurring item has.
- **`cancelled` subscriptions** — still omit. Cancelled is not completed; it
  never happened, so it does not belong in a "Completed" list.
- **Do not send notifications for completed records.** Our client already
  guards this (`scheduleFamilyReminderNotifications` skips `isPaid`), and your
  §3 confirms you do too. Returning them from the projection must not change
  that — they should appear in the list but never fire.

Client-side is already done and shipped: our local projection now emits
completed records with `isDone: true`. Until you make the matching change, a
user on the server path (the normal path post-cutover) still sees completed
family reminders disappear, while a user offline sees them correctly — so the
two sources currently disagree on this one point.

### Related, and the reason §5's question now matters more

If completion is stored per-viewer rather than on the record, this change makes
that visible: the owner would see the appointment in "Completed" while the
caregiver still sees it in "Upcoming". Same underlying question as §5, but now
with a UI symptom attached rather than just a silent double-reminder.

---

## 6. Open items — our position

| Item | Position |
|---|---|
| **Timezones** | Real bug for any user outside the server's zone; a routine set for 08:00 fires at the server's 08:00. Prefer **`timezone` (IANA) on the user profile** — one field, set at signup from the device, rather than stamping every record. We will send it once you add it. Worth raising with the client as a launch consideration if users span timezones. |
| **Check-in `days`** | Agreed, leave as-is. Still not honoured client-side; we will flag before implementing so it lands in lockstep. |
| **Recurrence rollover** | Agreed, client keeps updating the date on payment. No change wanted. |

---

## 7. Not verified on either side

Neither of us has confirmed an actual push landing on a physical device — you
had no real token, and this client change is not runtime-tested yet (it needs a
dev build; `expo-notifications` does not run in Expo Go).

So the end-to-end path is **implemented and typechecked on both sides, but
unproven in the real world**. Suggest one joint test on a real device before
this is called done to the client: create an appointment due tomorrow, confirm
exactly one notification arrives, from the server, and that tapping it opens the
member page.
