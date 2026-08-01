# Family Hub Reminders — Backend Specification

**Status:** Frontend shipped (local-only). Backend not started.
**Date:** 2026-07-31
**Owner (frontend):** app team
**Audience:** backend team

---

## 1. What this is

When a user adds a doctor's appointment, medicine, bill, task, or routine for a
family member in **Family Hub**, that item must also appear in the user's
**Reminders** tab and fire a notification at the right time.

Today it does not, because the two halves of the app store data in different
places:

| | User's own reminders | Family Hub records |
|---|---|---|
| Storage | **Server** — `/api/bills` | **Device only** — AsyncStorage |
| Survives reinstall | Yes | **No** |
| Syncs across devices | Yes | **No** |
| Notifications | Server + local | **None before this change** |

The frontend has now bridged this **on-device**: family records are projected
into the same shape as reminders and merged into the Reminders tab, with local
notifications scheduled. This works today with no backend.

**What the backend must add** is durability and multi-device sync. Right now a
family reminder exists only on the phone that created it — reinstall the app and
every appointment, medicine schedule, and routine is gone. Push notifications
also cannot fire while the app is uninstalled or the device is off, which for a
medicine reminder is a real-world safety problem, not a cosmetic one.

---

## 2. How the frontend works now (read this first)

### 2.1 Projection, not duplication

Family records are **not** copied into the reminder list. They are *projected*:
the family record stays the single source of truth, and a read-only reminder
view is derived from it on every load.

This matters for the API design. A projected reminder is **derived data**. If
you store it as an independent row that can be edited on its own, it will drift
from the record it came from the first time someone edits the appointment.

**The rule: the family record is authoritative. The reminder is a view of it.**

### 2.2 Files

| File | Role |
|---|---|
| `lib/family-records.ts` | Family record CRUD (AsyncStorage). Pre-existing. |
| `lib/family-reminders.ts` | **New.** Projects records → reminders, schedules notifications. |
| `lib/use-family-reminders.ts` | **New.** Loads members, builds reminders, refreshes on focus. |
| `app/(tabs)/bills.tsx` | Merges family reminders into the user's list. |
| `lib/data.ts` | `Bill` gained `memberId`, `sourceKind`, `sourceId`. |

### 2.3 The identity triple

Every projected reminder carries three fields that identify where it came from:

```ts
memberId: string     // which family member
sourceKind: string   // which feature: 'appointment' | 'family-bill' | ...
sourceId: string     // the family record's own id
```

`(memberId, sourceKind, sourceId)` is the **natural key**. It is what makes
edit, delete, and dedupe possible. The client-side id is a formatted version of
it:

```
fam:<sourceKind>:<memberId>:<sourceId>
```

The `fam:` prefix is deliberate — it guarantees a projected id can never
collide with or be mistaken for a server bill id. `isFamilyReminderId()` uses
this to route actions correctly.

**Please preserve this triple server-side.** It is the join key for everything
below.

---

## 3. The eight reminder kinds

Only records with a meaningful future date become reminders. Of the 14 Family
Hub features, **8** qualify.

| `sourceKind` | Source record | Date field | Repeats | Lead times (days before) |
|---|---|---|---|---|
| `appointment` | `Appointment` | `date` | none | `[1, 0]` |
| `medicine-stock` | `MedicationStockItem` | *computed* — see §3.1 | none | `[3, 1]` |
| `family-bill` | `FamilyBill` | `dueDate` | monthly | `[3, 1, 0]` |
| `subscription` | `FamilySubscription` | `renewalDate` | monthly/yearly | `[3, 1]` |
| `task` | `FamilyTask` | `dueDate` (optional) | none | `[1, 0]` |
| `routine` | `RoutineItem` | `time` — clock only, see §3.2 | daily | `[0]` |
| `checkin` | `CheckinItem` | `time` — clock only, see §3.2 | daily | `[0]` |
| `travel` | `TravelItem` | `date` | none | `[1, 0]` |

**Excluded, and why:**

- `HealthLog` (BP/sugar/weight) — a *past* reading, not a future event.
- `FamilyDocument` — no date. (Could become a reminder if an expiry date is
  added later; out of scope now.)
- `FamilyExpense` — already recorded, nothing to remind about.
- `EmergencyLogEntry` — alerts are immediate, not scheduled.
- `CustomTrackerItem` — user-defined shape, no guaranteed date field.
- `Caregiver` — not an event.

**Skip rules** (frontend already applies these; server must match or the two
will disagree):

> **CORRECTED 2026-07-31 — see the cutover reply §5A.** The original rule below
> ("completed produces no reminder") was wrong and is superseded. Completed
> records must be **emitted with `isPaid: true` / `status: "paid"`**, not
> dropped, or ticking a reminder off makes it vanish instead of moving to the
> Completed section. They still must never fire a notification. Cancelled
> subscriptions, and records with no usable date, are still genuinely skipped.

- ~~One-off kinds that are `completed`/`isPaid` produce **no** reminder.~~
  Superseded — emit them as completed.
- Recurring kinds (`routine`, `checkin`) produce a reminder only while
  `enabled === true`.
- `task` with no `dueDate` produces **no** reminder — it has nothing to schedule.
- Any record whose date fails to parse is dropped, not shown as "Invalid Date".

### 3.1 Medicine refill dates are computed, not stored

`MedicationStockItem` has no due date. The refill date is derived:

```
usableUnits = quantityRemaining - lowStockThreshold
daysLeft    = floor(usableUnits / dailyUsage)
refillDate  = today + max(0, daysLeft), at 09:00 local
```

Reminding at the low-stock threshold rather than at zero is intentional — by
zero it is already too late to reorder.

**This date moves whenever `quantityRemaining` changes.** Recompute on every
stock update; do not cache it as a fixed timestamp.

If `dailyUsage <= 0`, no reminder is produced (division by zero).

### 3.2 Routines and check-ins store a clock time, not a date

Both store `"HH:MM AM/PM"` with no date, because they repeat daily. The frontend
resolves this to *the next occurrence*: today at that time if it is still ahead,
otherwise tomorrow.

`CheckinItem` also has `days: number[]` (0=Sun..6=Sat, empty = every day). **The
current frontend projection does not yet honour `days`** — it treats every
check-in as daily. If you implement server-side scheduling, honour `days`; we
will match on the client. Flagging this explicitly so it is not mistaken for
intended behaviour.

---

## 4. What the backend needs to build

### 4.1 Phase 1 — Persist family records (highest value)

**This is the most important piece.** Family records are currently device-only.
Everything else in this document is secondary to making them durable.

Mirror `lib/family-records.ts` server-side. Each of the 14 features needs
standard CRUD, scoped to `(userId, memberId)`.

```
GET    /api/family/:memberId/records/:kind
POST   /api/family/:memberId/records/:kind
PUT    /api/family/:memberId/records/:kind/:id
DELETE /api/family/:memberId/records/:kind/:id
```

`:kind` is the feature key (`appointments`, `stock`, `bills`, `subscriptions`,
`tasks`, `routines`, `checkins`, `travel`, `health`, `documents`, `expenses`,
`emergency`, `caregivers`, `custom`).

**Field shapes must match the TypeScript interfaces in `lib/family-records.ts`
exactly** — same names, same types, same optionality. The client parses these
directly. Any rename breaks the app silently. Copy them from the file rather
than retyping.

**Authorization:** a connected caregiver (see `/api/family/shared-with-me`) can
read and write records for members shared with them. The frontend already
merges shared members into the reminder list, so the API must permit this or
caregivers will see empty lists.

### 4.2 Phase 2 — Projected reminders endpoint

Once records are server-side, expose the projection so the client does not have
to recompute it:

```
GET /api/reminders/family
```

**Response:**

```json
[
  {
    "id": "fam:appointment:42:a7f3c91",
    "memberId": "42",
    "memberName": "Sunita Baheti",
    "sourceKind": "appointment",
    "sourceId": "a7f3c91",
    "name": "Dr. Mehta · Sunita Baheti",
    "amount": 0,
    "dueDate": "2026-08-04T10:30:00.000Z",
    "category": "health",
    "icon": "medkit",
    "reminderType": "custom",
    "repeatType": "none",
    "status": "active",
    "isPaid": false,
    "reminderDaysBefore": [1, 0],
    "source": "family"
  }
]
```

Every field above is required — this is exactly the `Bill` shape the Reminders
tab renders, plus the identity triple. `source: "family"` marks the origin.

**Category and icon mapping** (must match `KIND_META` in
`lib/family-reminders.ts`):

| `sourceKind` | `category` | `icon` | `reminderType` |
|---|---|---|---|
| `appointment` | `health` | `medkit` | `custom` |
| `medicine-stock` | `health` | `medical` | `custom` |
| `family-bill` | `bills` | `receipt` | `custom` |
| `subscription` | `subscriptions` | `refresh` | `subscription` |
| `task` | `tasks` | `checkmark-circle` | `custom` |
| `routine` | `habits` | `time` | `custom` |
| `checkin` | `family` | `call` | `custom` |
| `travel` | `travel` | `airplane` | `custom` |

These reuse existing `CategoryType` values so no new categories are needed.

**Title format is `"<title> · <memberName>"`** (middle dot U+00B7, spaces both
sides). The Reminders tab is one flat list, so without the member name the user
cannot tell whose appointment it is. The client splits on `" · "` when building
notification bodies — keep the separator exact.

**These are read-only.** `POST`/`PUT`/`DELETE` against this endpoint should
return `405`. Mutations go to the underlying family record (§4.1), and the
projection is recomputed.

### 4.3 Phase 3 — Server-side push notifications

Local notifications (what ships today) die when the app is uninstalled, the
device restarts in some OEM configurations, or the OS evicts them. For medicine
and appointment reminders that is not acceptable long-term.

A scheduler should, for each projected reminder and each entry in
`reminderDaysBefore`, send a push at `dueDate - daysBefore`.

**Notification payload** — must match what the client already handles:

```json
{
  "title": "Appointment · Sunita Baheti",
  "body": "Dr. Mehta is due today",
  "data": {
    "type": "family-reminder",
    "memberId": "42",
    "sourceKind": "appointment",
    "sourceId": "a7f3c91"
  }
}
```

Body copy the client currently generates:
- `daysBefore === 0` → `"<title> is due today"`
- otherwise → `"<title> in N day"` / `"in N days"` (singular at 1)

Push tokens are already registered — see `registerForPushNotifications()` in
`lib/notifications.ts`.

**Do not send for:** completed/paid records, disabled routines/check-ins, or any
lead time already in the past. The frontend skips past-due lead times
deliberately; without that rule a bill added on its due date fires a burst of
backdated alerts at once.

**Deduplication is required.** When Phase 3 ships, the client must stop
scheduling locally for any reminder the server covers, or **every reminder fires
twice**. Coordinate this cutover with the frontend team — see §6.

### 4.4 Phase 4 — Connected caregivers must receive the same reminders

**This is a requirement, not an enhancement.** The Connected Caregiver system
already exists (`lib/family-caregivers.ts`, and the backend's own
`CAREGIVER-SYSTEM-backend-requirements.md`). Its stated purpose is that
"reminders/alerts reach everyone connected and a 'done' status updates for all
of them." Reminder fan-out is what that system is *for*; without it, sharing a
member accomplishes very little.

The product case: an adult child in another city is connected as a caregiver to
their parent. A medicine refill or doctor's appointment must reach them too —
that is the entire reason the feature exists.

**Fan-out rule.** When a projected reminder fires, send the push to:

- the **owner** of the family member, and
- **every accepted caregiver** connected to that member
  (`GET /api/family/:memberId/connected-caregivers`, `status = accepted`).

Pending and declined invites receive nothing.

**Read path already works.** The client merges `/api/family/shared-with-me` into
the reminder list (`lib/use-family-reminders.ts`), so a caregiver already *sees*
shared members' reminders. What is missing is the push and the shared completion
state below.

#### Completion must be shared, or two people get reminded for one task

If the owner marks an appointment complete, the caregiver's reminder must stop
too — and vice versa. Completion belongs to the **record**, not to the viewer.

- `completed` / `isPaid` is a property of the family record, not per-user.
- Whoever marks it done updates the shared record.
- Any pending notifications for that record are cancelled **for every
  recipient**, not just the actor.
- The change should reach other connected devices promptly (push-triggered
  refresh or a short poll). A caregiver who is reminded about a task the owner
  finished two hours ago will not trust the feature.

This is the piece most likely to be missed, because it works fine in
single-user testing and only breaks once two accounts are connected. Please
include it in test coverage explicitly.

#### Who may mark things done

`removeCaregiver` already encodes the trust model: an owner may remove any
caregiver, a caregiver may only remove themself. Applying the same shape here —
caregivers can mark records complete, only the owner can delete them — is our
recommendation, but confirm with the client. See §7.

#### Not in scope: reminders for people without a LifeWise account

Fan-out reaches **connected LifeWise accounts only**, because it works by push
token. Sending a reminder to a family member who does not use the app (SMS,
WhatsApp, email) is a different feature with its own cost and consent
requirements. If the client wants that, it needs to be specified separately —
do not assume it falls out of this work.

---

## 5. Data model suggestion

Family records: one table per feature, or a single table with a `kind`
discriminator and a JSON payload. Either is fine; per-feature tables give better
query performance and real column constraints.

```sql
CREATE TABLE family_appointments (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users(id),
  member_id     TEXT NOT NULL REFERENCES family_members(id) ON DELETE CASCADE,
  doctor_name   TEXT NOT NULL,
  specialty     TEXT,
  date          TIMESTAMPTZ NOT NULL,
  location      TEXT,
  notes         TEXT,
  is_follow_up  BOOLEAN NOT NULL DEFAULT FALSE,
  completed     BOOLEAN NOT NULL DEFAULT FALSE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX ON family_appointments (member_id, date) WHERE NOT completed;
```

`ON DELETE CASCADE` on `member_id` matters: deleting a family member must take
their records and therefore their reminders with them, or the user keeps getting
notifications for someone no longer in the app.

**Do not create a `family_reminders` table.** The projection is derived; storing
it creates a second source of truth that will drift. If you need to persist
scheduler state, store only *delivery* rows (`natural_key`, `fire_at`,
`sent_at`), keyed on the identity triple, and rebuild them when the source
record changes.

---

## 6. Migration and cutover

The frontend works standalone today. Introducing the backend must not double up.

1. **Phase 1 lands.** Client writes records to both AsyncStorage and the server,
   reads from the server when available. One-time upload of existing local
   records on first launch after upgrade, so nothing already entered is lost.
2. **Phase 2 lands.** Client prefers `GET /api/reminders/family` and stops
   computing the projection locally. Local projection stays as the offline
   fallback.
3. **Phase 3 lands.** Client disables local scheduling for server-covered
   reminders. **This step must ship in the same release as the server
   scheduler**, or users get duplicate notifications.

The client tracks what it has already scheduled in AsyncStorage under
`@lifewise_family_reminder_scheduled`, keyed by reminder id + due date. That key
must be cleared at the Phase 3 cutover.

---

## 7. Open questions for the backend team

1. **Timezones.** Routines and check-ins are wall-clock times ("08:00 AM") with
   no timezone. A server-side scheduler needs the user's timezone to fire at
   the right local moment. Should we add `timezone` to the user profile, or
   send an IANA zone with each record?
2. **Check-in `days`.** Should the server honour `CheckinItem.days` for weekday
   filtering (see §3.2)? The frontend currently does not. We would like to match
   whichever behaviour you implement.
3. **Recurrence expansion.** For monthly/yearly family bills and subscriptions,
   does the scheduler roll the date forward automatically after each occurrence,
   or does the client update `dueDate` on payment as it does today?
4. **Caregiver permissions.** Fan-out itself is settled — §4.4 requires it.
   What is not settled is who may *act*: we propose caregivers can mark records
   complete but only the owner can delete them, mirroring the existing
   `removeCaregiver` trust model. Confirm with the client.
5. **Per-caregiver mute.** Should a caregiver be able to mute reminder types for
   a shared member (e.g. receive appointments but not daily routines)? Not
   required for launch, but the fan-out table should leave room for it rather
   than assuming every recipient wants every reminder.

---

## 8. Acceptance criteria

The integration is complete when:

- [ ] A family record created on device A appears in the Reminders tab on
      device B after sync.
- [ ] Reinstalling the app restores every family record and reminder.
- [ ] A reminder notification arrives at each configured lead time, on the
      correct local date, with the member's name in the title.
- [ ] Marking the underlying record complete stops further notifications.
- [ ] Deleting a family member removes their records and cancels their pending
      notifications.
- [ ] A caregiver with a shared member sees that member's reminders.
- [ ] No reminder fires twice (local + push).
- [ ] `GET /api/reminders/family` returns the exact field set in §4.2.

Connected caregivers (§4.4) — test with **two real accounts**, not one:

- [ ] Owner adds an appointment; the connected caregiver receives the push too.
- [ ] Owner marks it complete; the caregiver's reminder disappears and no
      further notification fires for them.
- [ ] Caregiver marks it complete; the same holds in reverse for the owner.
- [ ] A caregiver whose invite is still `pending` receives nothing.
- [ ] Removing a caregiver stops their notifications for that member.
- [ ] Deleting the member cancels pending notifications for **all** recipients.
