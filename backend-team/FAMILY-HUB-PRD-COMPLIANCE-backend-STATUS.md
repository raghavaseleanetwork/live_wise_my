# Family Hub — PRD Compliance: Backend Status

**Audience:** Frontend team
**Received from backend team:** 2026-08-17
**Source doc:** `FAMILY-HUB-PRD-COMPLIANCE-backend-requirements.md` (2026-08-14)

This is the status update against that doc's TL;DR table. Short version:
**the 9 new record kinds are live** — you can start sending real traffic to
them. Everything else in the requirements doc (§4, §5, §6) is **not yet
built**.

> ### ✅ Frontend verification on receipt (2026-08-17)
>
> **Segment names match exactly.** All 9 `RECORD_PATH` values in
> `lib/family-records-sync.ts:108-116` are byte-identical to the segments the
> backend registered:
>
> | Client `RecordKind` | `RECORD_PATH` value | Backend registered |
> |---|---|---|
> | `diet` | `dietProfile` | ✅ |
> | `fitness` | `fitnessItems` | ✅ |
> | `study` | `studyProfile` | ✅ |
> | `moodLogs` | `moodLogs` | ✅ |
> | `wellness` | `wellnessReminders` | ✅ |
> | `vehicles` | `vehicles` | ✅ |
> | `fuelLog` | `fuelLog` | ✅ |
> | `homeMaintenance` | `homeMaintenance` | ✅ |
> | `emergencyProfile` | `emergencyProfile` | ✅ |
>
> This was the one thing that could have silently failed — the requirements doc
> flagged these as "hardcoded in the shipped app, not negotiable without a
> client release." They match, so **the 6 new modules should start persisting
> with no frontend change at all.**
>
> **§4 data loss confirmed from this side too.** `app/add-medicine.tsx:139-143`
> sends `frequency`, `daysOfWeek`, `reminderEnabled`, `snoozeDuration`, and
> `doctorNotes` on every medicine save today. The backend's "silently dropped"
> assessment is accurate — see the frontend note under §4 for what this means
> for QA.

---

## ✅ Done — safe to use now

### §2: 9 new record-kind CRUD routes

All 9 previously-missing `:kind` segments are now registered on the existing
generic CRUD contract:

```
GET    /api/family/:memberId/:kind
POST   /api/family/:memberId/:kind
PATCH  /api/family/:memberId/:kind/:recordId
DELETE /api/family/:memberId/:kind/:recordId
```

Segments added: `dietProfile`, `fitnessItems`, `studyProfile`, `moodLogs`,
`wellnessReminders`, `vehicles`, `fuelLog`, `homeMaintenance`,
`emergencyProfile`.

- Same contract as the 12 existing kinds — no new auth, no new response shape.
- The three single-record kinds (`dietProfile`, `studyProfile`,
  `emergencyProfile`) work exactly as specified: POST a record whose `id`
  equals the `memberId`; a repeat POST with the same `id` upserts in place
  (confirmed — does not duplicate).
- Records store whatever fields you send, as-is (schemaless) — no allowlist
  to keep in sync on our side as your record shapes evolve.
- Caregiver visibility matches the existing 12 kinds exactly: the member's
  owner and every accepted connected caregiver can read and write, including
  `emergencyProfile`.

**Not yet load-tested against production traffic** — please run the §7
verification steps from the requirements doc against your dev/staging
environment (POST + GET round-trip per kind, double-POST idempotency check on
the 3 single-record kinds, caregiver-read check on `emergencyProfile`) and
flag anything that doesn't match.

> **Frontend note:** the offline queue in `lib/family-records-sync.ts` will
> replay automatically on the next `pullRecords()` for anything that queued
> while these routes 404'd — so **records users created before this went live
> should upload themselves** on next app open, no migration needed. Worth
> spot-checking that on a device that has pre-existing local data, since a
> queued op that hit a permanent 4xx would have been dropped rather than
> retried (see `flushFamilyRecordQueue`).

### §3: New fields on the 8 existing record kinds

**No backend change was needed.** The existing record routes were already
schemaless — they persist and return whatever fields are sent, with no field
allowlist stripping unknown keys. All the new fields listed in §3.1–§3.9 of
the requirements doc (`familyBills.accountNumber`, `appointments.notes`,
`healthLogs.systolic`/`diastolic`, `subscriptions.planType`, etc.) already
round-trip correctly. If you've seen any of these fields disappear on
refetch, it's not a server-side stripping issue — flag the specific field and
kind and we'll look at it as a bug, not a missing-feature request.

> **Frontend note:** good outcome — this was listed as "Blocking: Yes" in the
> original TL;DR on the assumption that a field allowlist existed. It didn't,
> so §3 was a non-issue all along. No action needed from us.

---

## ⏳ Not done yet

### §4: New fields on `POST /api/family/:memberId/medicines`

The medicines endpoint is separate from the record-sync layer and still uses
an explicit field allowlist. `frequency`, `daysOfWeek`, `reminderEnabled`,
`snoozeDuration`, and `doctorNotes` are being sent by the app today and are
**silently dropped** — this is real, ongoing data loss, not just a future
gap. Not fixed in this pass.

> **Frontend note — this is the one to prioritise.** Confirmed from our side:
> `app/add-medicine.tsx:139-143` sends all five fields on every save.
>
> **User-visible symptom right now:** someone sets a medicine to "Weekly, Mon &
> Thu, snooze 15 min" with doctor's notes, saves, reopens the medicine — and
> it's back to daily with the notes gone. The form looks broken, not
> incomplete.
>
> **For QA:** don't file these as frontend bugs. The form is sending correctly;
> the fields die at the server. Re-test after §4 ships.
>
> Also note §5.1 depends on this — `frequency` and `daysOfWeek` are what make
> alternate-day and weekly medicines schedule correctly, so §4 is a hard
> prerequisite for that part of the reminder engine, not just a storage fix.

### §5: Reminder-engine work

Nothing in §5 (medicine frequency honoring, lead-time reminders, recurrence
regeneration, new-module reminders, missed check-in follow-up, caregiver
fan-out) has been started. Records for the new modules save correctly, but
no notifications will fire for them yet.

> **Frontend note:** this overlaps with
> `FAMILY-REMINDERS-HOME-backend-requirements.md` (2026-08-15), which covers
> `GET /api/reminders/family` and the push side. **Read that doc's §3 before
> starting §5** — there's a cutover trap: the client cancels its own local
> notifications the first time that endpoint returns a non-empty array, on the
> assumption the server has taken over scheduling. Returning rows before push
> works leaves users with *no* reminders at all.

### §6: S3 document upload + secure share link

Not started. Still flagged as not-built, same as before this update.

> **Frontend note:** correct — the app still shows these as unavailable rather
> than a broken button. No change needed until the endpoints exist.

---

## What this means for you right now

- Safe to point the app's already-shipped payloads for the 6 new modules at
  the live routes — data will persist and survive reinstall/second-device.
- Do **not** expect reminders/notifications for any of the 6 new modules yet.
- Medicine `frequency`/`daysOfWeek`/`reminderEnabled`/`snoozeDuration`/
  `doctorNotes` will keep silently vanishing on refetch until §4 ships —
  worth knowing if QA is currently testing that form.
- Document upload/share-link UI should stay in its flagged "not built" state.

We'll follow up with a separate update as §4/§5/§6 land.

---

## Frontend action items from this update (2026-08-17)

| # | Item | Owner | Priority |
|---|---|---|---|
| 1 | Run the §7 verification steps against staging — POST/GET round-trip per new kind, double-POST idempotency on the 3 single-record kinds, caregiver read on `emergencyProfile` | Frontend/QA | **Now** — backend explicitly asked |
| 2 | Spot-check that pre-existing local records upload via the offline queue on a device with old data | Frontend/QA | High |
| 3 | Tell QA that medicine frequency/snooze/notes loss is a **known backend gap**, not a form bug | — | **Now**, before it's filed as a frontend bug |
| 4 | Nothing to build — the 6 new modules need no client change to start persisting | — | ✅ |

---

## Related documents

- `FAMILY-HUB-PRD-COMPLIANCE-backend-requirements.md` — the original request this answers.
- `FAMILY-REMINDERS-HOME-backend-requirements.md` — `GET /api/reminders/family`
  and push; overlaps §5 and carries the cutover warning above.
- `CAREGIVER-CONNECTED-SYSTEM-backend-requirements.md` — the caregiver access
  rule §2 relies on. Backend confirmed all 7 endpoints live on 2026-08-14.
