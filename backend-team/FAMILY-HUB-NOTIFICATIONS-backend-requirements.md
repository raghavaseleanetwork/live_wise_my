# Family Hub Notifications — Backend Requirements

**Audience:** Backend team
**Date:** 2026-07-31
**Owner (frontend):** app team

**Status:** Frontend is shipped and works **on-device only**. The notification
bell now shows Family Hub items, but they are *derived on the phone* — they do
not exist as notifications on the server, do not push while the app is closed,
and do not survive a reinstall. Closing that gap is backend work.

**Related, read alongside:**
- `app docs/FAMILY_REMINDERS_BACKEND_SPEC.md` — the reminder projection spec
  (`GET /api/reminders/family`). This document is its notification counterpart
  and reuses the same identity model.
- `app docs/FAMILY_RECORDS_PERSISTENCE_SPEC.md` — persisting the records
  themselves. **That is a hard prerequisite for §3 here.**
- `CAREGIVER-SYSTEM-backend-requirements.md` — fan-out to connected caregivers.

---

## 1. The problem in one table

The user asked: *"the Family Hub notification section should also tell me about
reminders — if a family member has a bill to pay, it should show there."*

It could not, because the two halves of the app store data in different places:

| | User's own bills & medicines | Family Hub records |
|---|---|---|
| Storage | **Server** (MongoDB) | **Device only** (AsyncStorage) |
| Seen by the notification cron | Yes | **No** |
| Fires push when app is closed | Yes | **No** |
| Survives reinstall | Yes | **No** |
| Syncs across the user's devices | Yes | **No** |

`GET /api/notifications` only ever returns rows the server generated, and the
server has never seen a family appointment, bill, task, routine, or check-in.

There are **12 Family Hub features**, all local (`lib/family-records.ts`):
appointments, health logs, medicine stock, routines, family bills,
subscriptions, expenses, tasks, documents, check-ins, travel, emergency.

Only **medicines** are already server-side (on the `family_members` document),
which is why medicine reminders are the one family item that already notifies —
see `server/routes.ts` around line 3167.

---

## 2. What the frontend does today (interim)

`app/notifications.tsx` now merges two sources:

1. `GET /api/notifications` — unchanged, server rows.
2. **A local projection** of Family Hub records, via the existing
   `useFamilyReminders()` hook, filtered to the next **7 days**.

```
title:  "<Member name> · <Record name>"      e.g. "Papa · Electricity Bill"
body:   "₹2,400 · Bill due in 3 days."
tap →   /family-reminder/fam:<kind>:<memberId>:<sourceId>
```

**Deliberate limitations of the interim fix — these are exactly what §3 fixes:**

- Rows are **always rendered unread** and are excluded from `mark-read` /
  `mark-read-all`. They have no server id, so marking them read would 404.
- They appear **only when the app is opened**. No push, no background delivery.
- They are **invisible to the unread badge count** on the home screen, which is
  driven by `GET /api/notifications`.
- A record created on one device never notifies on another.

For a medicine or a doctor's appointment, "only notifies if you happen to open
the app" is a real-world safety gap, not a cosmetic one.

---

## 3. What we need built

### 3.0 Prerequisite

Family records must exist server-side first. Follow
`app docs/FAMILY_RECORDS_PERSISTENCE_SPEC.md`. **Nothing below can work while
the records live only in AsyncStorage** — the cron has nothing to read.

### 3.1 Generate notifications from family records

Extend the existing notification cron (the one at `server/routes.ts` ~line 3000
that already walks bills and medicines) to also walk family records and insert
into the same `notifications` collection.

Use the **same document shape already in use** — no new collection, so the
existing `GET /api/notifications`, mark-read, and badge count all work unchanged:

```ts
await notifications.insertOne({
  userId:    <owner's user id>,
  type:      'reminder',
  title:     `${member.name} · ${record.name}`,
  body:      `₹${record.amount} · Bill due in 3 days.`,
  read:      false,
  createdAt: new Date(),
  meta: {
    type:        'family',
    kind:        'family-bill',          // see §3.2
    memberId:    member._id.toString(),
    sourceId:    record.id,              // the family record's own id
    referenceId: record.id,
    route:       `/family-reminder/fam:family-bill:${member._id}:${record.id}`,
    redirectUrl: `/family-reminder/fam:family-bill:${member._id}:${record.id}`,
  },
});
```

`route` **must** use the `fam:<kind>:<memberId>:<sourceId>` id format — the app
parses it to find the record. It is defined in `lib/family-reminders.ts`
(`makeFamilyReminderId`) and is the same natural key used by the reminder spec.

### 3.2 Kinds and lead times

Mirror `KIND_LEAD_DAYS` in `lib/family-reminders.ts` exactly, or the two halves
will disagree about when a reminder is due:

| `kind` | Due field | Lead times (days before) |
|---|---|---|
| `appointment` | `date` | 1, 0 |
| `medicine-stock` | computed refill date | 3, 1 |
| `family-bill` | `dueDate` | 3, 1, 0 |
| `subscription` | `renewalDate` | 3, 1 |
| `task` | `dueDate` | 1, 0 |
| `routine` | daily clock time | 0 |
| `checkin` | daily clock time | 0 |
| `travel` | `date` | 1, 0 |

`medicine-stock` is projected, not stored: remind when
`(quantityRemaining - lowStockThreshold) / dailyUsage` days have elapsed — i.e.
when stock hits the low-water mark, not zero. See `refillDateFor()`.

`routine` and `checkin` repeat **daily at a wall-clock time** with no date, so
they need a per-day dedupe key (below), or they will fire on every cron tick.

### 3.3 Deduplication

Reuse the existing `reminderLogs` pattern (the medicine path already does this
at `server/routes.ts` ~line 3155). Suggested key:

```
fam-<kind>-<memberId>-<sourceId>-<YYYY-MM-DD>-<leadDays>
```

Include the date so daily kinds fire once per day, and `leadDays` so the 3-day
and 1-day warnings for the same bill are distinct notifications.

⚠️ **Build that `YYYY-MM-DD` in the user's local timezone, not UTC.** We just
fixed this class of bug across the app: `toISOString().slice(0,10)` in IST
(UTC+5:30) rolls the date over at 05:30 local, so an evening reminder gets
tomorrow's key and can double-fire or be suppressed. Note `server/routes.ts:3155`
currently uses `toISOString().slice(0,10)` for the medicine log id — worth
reviewing for the same reason.

### 3.4 Push delivery

Once the rows are server-side, send them through the **existing** FCM path
(`getFirebaseMessaging()` → `sendEachForMulticast` with tokens from
`pushTokens`). No new infrastructure — the bill and medicine paths already do
exactly this; family rows just need to be included.

### 3.5 Caregiver fan-out

If `CAREGIVER-SYSTEM-backend-requirements.md` is built, a family notification
must go to **every connected caregiver**, not just the owner — insert one
notification per accepted caregiver `userId`. A caregiver who cannot see Papa's
bill reminder is the main thing that feature is for.

---

## 4. Client cutover (what we do once this is live)

Small and already scoped:

1. Delete `familyReminderToNotification()` and the merge block in
   `app/notifications.tsx` — server rows arrive through the existing fetch.
2. Family rows gain real read state automatically (they become normal rows).
3. The home-screen unread badge starts counting them with no change.

Please tell us when §3.1 is deployed and we will remove the interim projection
in the same release. Until then the two would double up, so we will **not** ship
the cutover early.

---

## 5. Acceptance criteria

- [ ] A family bill due in 3 days produces a notification row from
      `GET /api/notifications` with `meta.type === 'family'`.
- [ ] Tapping it opens the correct family record detail screen.
- [ ] It fires as **push with the app fully closed**.
- [ ] It appears on a **second device** signed into the same account.
- [ ] It survives **uninstall + reinstall**.
- [ ] Marking it read persists across a restart.
- [ ] A daily routine at 08:00 fires **once** per day, not on every cron tick.
- [ ] The date key is correct for a user in IST at 23:00 local.
- [ ] Connected caregivers receive the same notification (if §3.5 in scope).

---

## 6. Open questions for backend

1. **Lookahead window.** The client shows 7 days. Should the server generate
   further out and let the client filter, or match at 7?
2. **Retention.** Family notifications could be high-volume (daily routines and
   check-ins per member). Do we prune `notifications` on a schedule?
3. **Per-feature opt-out.** Should a user be able to mute, say, routine
   notifications but keep bills? There is no UI for this today; if you want it,
   we need a settings shape to build against.
