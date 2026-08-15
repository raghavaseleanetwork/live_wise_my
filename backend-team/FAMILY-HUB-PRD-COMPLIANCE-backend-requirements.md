# Family Hub — PRD Compliance: Backend Requirements

**Audience:** Backend team
**Date:** 2026-08-14
**Status:** **Frontend is fully built and shipping these payloads today.** Every
field and endpoint below is already being sent by the app. Anything the server
does not yet understand is silently dropped, so the feature *looks* like it
works until the user reopens the screen and their data is gone.

**Why this exists:** the client asked us to audit all 20 Family Hub modules
against the PRD (`LifeWise_PRD_v1`, §5.3 "All 20 Modules — Deep
Specifications"). The audit found **6 modules missing entirely** and **field
gaps in all 14 that existed**. The frontend for all of it is now complete.
This document is everything the backend needs to make it real.

---

## 0. TL;DR — what to build, in priority order

| # | Work | Size | Blocking? |
|---|---|---|---|
| 1 | 8 new record-kind CRUD routes (§2) | Medium — same shape as the 12 you already have | **Yes** — new modules lose all data on reinstall without it |
| 2 | New fields on 8 existing record kinds (§3) | Small — mostly "stop stripping unknown fields" | **Yes** — silent data loss today |
| 3 | New fields on `POST /api/family/:id/medicines` (§4) | Small | **Yes** — same |
| 4 | Reminder-engine additions (§5) | Medium | No — records still save, just no notification |
| 5 | S3 document upload + secure share link (§6) | Medium | No — flagged as not-built in the app |

---

## 1. Context: how Family Hub records already work

You already expose 12 record kinds at:

```
GET    /api/family/:memberId/:kind
POST   /api/family/:memberId/:kind
PATCH  /api/family/:memberId/:kind/:recordId
DELETE /api/family/:memberId/:kind/:recordId
```

…with these segment names (confirmed against the live API):
`appointments`, `medicationStock`, `familyBills`, `subscriptions`,
`familyTasks`, `routines`, `checkins`, `travelItems`, `healthLogs`,
`documents`, `familyExpenses`, `customItems`.

The client side of this lives in `lib/family-records-sync.ts`. Records are
**local-first**: they save to AsyncStorage immediately, then mirror to the
server, queuing on failure. That means **a missing route does not throw a
visible error** — it queues forever and the user only notices when a second
device or a reinstall shows nothing.

Everything in §2 and §3 plugs into this exact mechanism. No new transport, no
new auth, no new response shape.

---

## 2. NEW: 8 record kinds for the 6 previously-missing modules

The PRD specifies 20 modules. The app had 14. These are the 6 that did not
exist at all, now built on the frontend and needing server routes.

**Add these to your `:kind` router using the identical CRUD contract above.**
Segment names are already hardcoded in the shipped app — these are not
negotiable without a client release:

| `:kind` segment | Module | Shape |
|---|---|---|
| `dietProfile` | Diet & Meal Planning (PRD 12) | **Single record** per member |
| `fitnessItems` | Fitness Tracking (PRD 15) | List |
| `studyProfile` | Study & Education (PRD 16) | **Single record** per member |
| `moodLogs` | Mental Health — mood log (PRD 17) | List |
| `wellnessReminders` | Mental Health — reminders (PRD 17) | List |
| `vehicles` | Vehicle Management (PRD 18) | List |
| `fuelLog` | Vehicle Management — fuel entries (PRD 18) | List |
| `homeMaintenance` | Home Maintenance (PRD 19) | List |
| `emergencyProfile` | Emergency SOS medical profile (PRD 4) | **Single record** per member |

> **Note on the three "single record" kinds** (`dietProfile`, `studyProfile`,
> `emergencyProfile`): the client still uses the *list* endpoints for these —
> it POSTs one record whose `id` equals the `memberId`, and reads `[0]` from
> the GET. **Treat them exactly like the list kinds; no special-casing
> needed.** A repeat POST with the same `id` must upsert, not duplicate (this
> is the same idempotent-POST behaviour you already confirmed for the
> existing kinds).

### 2.1 Record shapes

All records carry `id: string` (client-generated) and `createdAt: string`
(ISO). Store additional fields as-is; the client owns the schema.

```ts
// dietProfile  (one per member, id === memberId)
{
  dietType: 'normal'|'diabetic'|'low_salt'|'low_fat'|'vegetarian'|'vegan'|'custom',
  customDietName?: string,
  meals: {                       // any subset of the 4 slots
    breakfast?:     { time: string, notes?: string, reminderEnabled: boolean },
    lunch?:         { ... },
    evening_snack?: { ... },
    dinner?:        { ... },
  },
  dailyCalorieTarget?: number | null,
  foodRestrictions?: string,
  waterIntakeReminderEnabled: boolean,
  waterIntakeReminderHourly?: number,   // remind every N hours
  doctorNotes?: string,
  weeklyPlan: { day: number, meals: Record<string,string> }[],
}

// fitnessItems  (list)
{
  workoutType: 'walking'|'running'|'yoga'|'gym'|'swimming'|'cycling'|'other',
  days: number[],                // 0=Sun..6=Sat; empty = every day
  time: string,                  // "HH:MM AM/PM"
  durationGoalMinutes?: number | null,
  stepCountGoal?: number | null,
  isRestDay?: boolean,
  notes?: string,
  reminderEnabled: boolean,
  streak: number,
  lastDoneAt?: string | null,    // ISO
}

// studyProfile  (one per member, id === memberId)
{
  grade: string,
  subjects: { id, name, scheduleDays: number[], scheduleTime: string,
              homeworkReminderEnabled: boolean, homeworkReminderTime?: string,
              createdAt }[],
  exams:    { id, subject, examDate /*ISO*/, board?: string,
              reminderDaysBefore: number[] /* e.g. [7,3,1] */, createdAt }[],
  events:   { id, title, eventDate /*ISO*/, notes?: string, createdAt }[],
  fees:     { id, title, amount: number, dueDate /*ISO*/, isPaid: boolean,
              createdAt }[],
}

// moodLogs  (list)
{ mood: 1|2|3|4|5, note?: string, loggedAt: string /*ISO*/ }

// wellnessReminders  (list)
{
  kind: 'meditation'|'breathing'|'journal'|'self_care'|'therapy',
  title: string,
  time?: string,                 // "HH:MM AM/PM"
  frequencyDays?: number,        // for 'breathing'
  sessionDate?: string,          // ISO, for 'therapy'
  doctorName?: string,           // for 'therapy'
  enabled: boolean,
}

// vehicles  (list)
{
  vehicleType: 'car'|'bike'|'scooter'|'other',
  name: string,
  registrationNumber?: string,
  insuranceExpiry?: string | null,   // ISO
  pucExpiry?: string | null,         // ISO
  serviceDueDate?: string | null,    // ISO
  serviceDueNote?: string,           // free text when KM-based
  loanEmiAmount?: number | null,
  loanEmiDueDate?: string | null,    // ISO
}

// fuelLog  (list)
{ vehicleId: string, date: string /*ISO*/, litres: number, cost: number }

// homeMaintenance  (list)
{
  taskType: 'ac_service'|'water_purifier'|'pest_control'|'plumbing'
          |'electrical'|'painting'|'other',
  taskName: string,
  vendorName?: string,
  vendorPhone?: string,
  lastDoneDate?: string | null,   // ISO
  nextDueDate?: string | null,    // ISO
  frequency?: 'monthly'|'quarterly'|'yearly'|'custom',
  hasAmc: boolean,
  amcExpiryDate?: string | null,  // ISO
  cost?: number | null,
}

// emergencyProfile  (one per member, id === memberId)  — PRD Module 4
{
  contacts: { id, name, phone, relation }[],   // max 5, enforced client-side
  bloodGroup?: string,
  knownAllergies?: string,
  existingMedicalConditions?: string,
  currentMedicationsNote?: string,
  doctorName?: string,
  doctorPhone?: string,
  hospitalPreference?: string,
  insurancePolicyNumber?: string,
}
```

### 2.2 Caregiver visibility

These new kinds must follow the **same access rule as the existing 12**: the
member's owner *and* every accepted connected caregiver can read and write
them. `emergencyProfile` especially — the whole point of an emergency medical
profile is that the caregiver can see it.

---

## 3. NEW FIELDS on 8 existing record kinds

These are additive. The app is sending them **now**. If your handlers use an
explicit field allowlist or a strict schema, these are being **silently
dropped on write** and the user's data is disappearing on refetch.

**Action: make sure each of these persists and round-trips.**

### 3.1 `familyBills` (PRD Module 5)
```ts
category: // WIDENED from 4 values to 13
  'electricity'|'gas'|'water'|'internet'|'mobile_postpaid'|'cable_tv'
 |'society_maintenance'|'rent'|'loan_emi'|'credit_card'|'medical'
 |'insurance'|'other'
accountNumber?: string            // NEW
paymentMethod?: 'upi'|'net_banking'|'credit_card'|'auto_debit'|'cash'   // NEW
reminderDaysBefore?: number       // NEW — 1|3|5|7
dayOfReminderEnabled?: boolean    // NEW — extra reminder on the due date
```

### 3.2 `appointments` (PRD Module 2)
```ts
specialty?: string        // now a fixed enum client-side, still a string here
hospitalName?: string                        // NEW
notes?: string                               // now actually populated by the form
followUpDate?: string | null                 // NEW, ISO
isRecurring?: boolean                        // NEW
recurrence?: 'monthly'|'quarterly'|'every_6_months'|'yearly'   // NEW
reminderLead?: '1_day'|'3_hours'|'1_hour'|'30_min'             // NEW
// `date` now carries BOTH date and time (previously date-only).
```

### 3.3 `healthLogs` (PRD Module 3)
```ts
type:  // WIDENED from 3 to 7
  'bp'|'sugar'|'weight'|'temperature'|'oxygen'|'heart_rate'|'cholesterol'
systolic?: number                 // NEW — BP is now structured
diastolic?: number                // NEW
pulse?: number                    // NEW
sugarReadingType?: 'fasting'|'post_meal'    // NEW
weightUnit?: 'kg'|'lbs'                     // NEW
targetRangeLow?: number                     // NEW — out-of-range alerting
targetRangeHigh?: number                    // NEW
// `value` is still sent (e.g. "120/80") for display/back-compat.
```

### 3.4 `subscriptions` (PRD Module 7)
```ts
cycle: 'monthly'|'quarterly'|'yearly'        // WIDENED — 'quarterly' is new
category: // REPLACED old 'ott'|'utility'|'other'
  'entertainment'|'productivity'|'health'|'education'|'other'
planType?: string                            // NEW
autoRenews?: boolean                         // NEW
paymentMethod?: 'upi'|'net_banking'|'credit_card'|'debit_card'|'other'  // NEW
reminderDaysBefore?: number                  // NEW — 3|7
```
> ⚠️ `category` values changed. Old rows may hold `'ott'`/`'utility'`. Either
> migrate them (`ott`→`entertainment`, `utility`→`other`) or leave them; the
> client renders unknown values harmlessly. Your call — flag it if you migrate.

### 3.5 `travelItems` (PRD Module 11)
```ts
notes?: string                               // NEW
isRecurring?: boolean                        // NEW
recurrence?: 'weekly'|'monthly'|'yearly'     // NEW
reminderHoursBefore?: number                 // NEW — 1|3|24
returnDate?: string | null                   // NEW, ISO (trips)
companionMemberIds?: string[]                // NEW — other family member ids
// `date` now carries BOTH date and time.
```

### 3.6 `medicationStock` (PRD Module 13)
```ts
linkedMedicineId?: string | null             // NEW — links to a real medicine
pharmacyName?: string                        // NEW
purchaseLog?: { id, quantityAdded: number, purchasedAt: string }[]  // NEW
```

### 3.7 `documents` (PRD Module 14)
```ts
type: // WIDENED — 'id' REMOVED, 8 specific types added
  'aadhaar'|'pan'|'passport'|'driving_license'|'birth_certificate'
 |'marriage_certificate'|'property'|'vehicle_rc'|'insurance'|'medical'|'other'
documentNumber?: string                      // NEW
issueDate?: string | null                    // NEW, ISO
expiryDate?: string | null                   // NEW, ISO
expiryReminderLead?: '6_months'|'3_months'|'1_month'   // NEW
// `reminderDate` still sent, mirrored to expiryDate, for back-compat.
```
> ⚠️ The `'id'` document type was removed. Existing rows with `type: 'id'`
> will render with a fallback label. Migrating them to `'aadhaar'` or
> `'other'` is optional.

### 3.8 `routines` (PRD Module 9) and `checkins` (PRD Module 10)
```ts
// routines
completedDates?: string[]        // NEW — 'YYYY-MM-DD', drives weekly compliance %

// checkins
frequency?: 'daily'|'every_2_days'|'weekly'|'custom'   // NEW
callType?: 'regular_call'|'video_call'|'whatsapp_call' // NEW
contactNumber?: string                                 // NEW
missedCallAlertEnabled?: boolean                       // NEW
```

### 3.9 `customItems` + custom config (PRD Module 20)
```ts
// customItems
fieldValues?: Record<string, string>   // NEW — keyed by custom field id
```
The custom-tracker **config** (name, icon, and the new user-defined field
definitions, reminder toggle, frequency) is still **device-local only** —
`AsyncStorage`, not synced. If you want caregivers to share a custom tracker's
schema, that needs a new kind; flagged, not built.

---

## 4. NEW FIELDS on `POST /api/family/:memberId/medicines` (PRD Module 1)

Medicines are **not** part of the record-sync layer — they go through their own
endpoint. The add-medicine form now sends these additional fields:

```ts
frequency: 'daily'|'alternate_days'|'weekly'|'monthly'|'as_needed'   // NEW
daysOfWeek?: number[]        // NEW — 0=Sun..6=Sat, only when frequency==='weekly'
reminderEnabled: boolean     // NEW
snoozeDuration: 5|10|15|30   // NEW — minutes
doctorNotes: string          // NEW
```

Persist these on the medicine subdocument and return them from
`GET /api/family` so the edit form can round-trip.

**`frequency` and `daysOfWeek` change reminder scheduling** — see §5.1.

---

## 5. Reminder-engine work

The records above are useless without notifications. Each of these is a
scheduling rule the PRD specifies and the app now captures but cannot act on
alone (the device can only schedule local notifications for itself; reaching
caregivers needs the server).

### 5.1 Medicine frequency (PRD 1)
Today every medicine is assumed daily. Honour `frequency`:
`alternate_days` (every other day from `startDate`), `weekly` (only on
`daysOfWeek`), `monthly` (same day-of-month as `startDate`), `as_needed`
(**no scheduled reminder at all**). Honour `reminderEnabled: false` by not
scheduling. `snoozeDuration` is the snooze interval when the user taps snooze.

### 5.2 Lead-time reminders
Several modules now specify *when* to fire, not just *what*:
- `familyBills.reminderDaysBefore` + `dayOfReminderEnabled`
- `appointments.reminderLead` (`1_day`/`3_hours`/`1_hour`/`30_min`)
- `subscriptions.reminderDaysBefore` (3 or 7)
- `travelItems.reminderHoursBefore` (1/3/24)
- `documents.expiryReminderLead` (6/3/1 months before `expiryDate`)
- `studyProfile.exams[].reminderDaysBefore` (array, e.g. fire at 7, 3 and 1)

### 5.3 Recurrence
`appointments.isRecurring`/`recurrence` and `travelItems.isRecurring`/
`recurrence` must re-generate the next occurrence after one passes.

### 5.4 New module reminders
- `fitnessItems` — at `time` on `days`, when `reminderEnabled` and not `isRestDay`.
- `wellnessReminders` — at `time`; `breathing` repeats every `frequencyDays`;
  `therapy` fires ahead of `sessionDate`.
- `dietProfile.meals[slot]` — at each slot's `time` when `reminderEnabled`.
  Plus `waterIntakeReminderEnabled` every `waterIntakeReminderHourly` hours.
- `vehicles` — ahead of `insuranceExpiry`, `pucExpiry` (PRD says 30/7/1 days),
  `serviceDueDate`, `loanEmiDueDate`.
- `homeMaintenance` — ahead of `nextDueDate` and `amcExpiryDate`.
- `studyProfile.subjects[].homeworkReminderTime`, and `fees[].dueDate`.

### 5.5 Missed check-in follow-up (PRD 10)
`checkins.missedCallAlertEnabled`: if a check-in is not marked done within
**2 hours** of its scheduled time, send a follow-up notification. The app
detects and badges this on-device already (`isCheckinMissed`), but only while
the app is open — server-side is what makes it actually reach anyone.

### 5.6 Caregiver fan-out
All of the above must go to **the owner *and* every accepted connected
caregiver**, consistent with
`CAREGIVER-CONNECTED-SYSTEM-backend-requirements.md` §4.3.

---

## 6. NOT BUILT — needs backend before the frontend can finish

These PRD items were deliberately left out rather than faked. Each needs
server capability first; tell us when it exists and we'll wire the UI.

1. **Document scan/upload to S3** (PRD 14). There's an existing `/api/upload`
   used for avatars — extend or mirror it for documents (PDF + image), return
   a URL to store on the document record. Needs a size cap and MIME check like
   the avatar route already has.
2. **Secure temporary share link for a document** (PRD 14). Needs a
   signed-URL endpoint with an expiry.
3. **Health report PDF export** (PRD 3, marked Premium). Server-side render of
   a member's `healthLogs` to PDF.
4. **SOS trigger — shake-3× / long-press → SMS + call with location** (PRD 4).
   Needs an SMS provider and a location-attached emergency dispatch endpoint.
   The medical *profile* is built; the *dispatch* is not.
5. **Shareable digital medical card** (PRD 4). Depends on (2) and (4).
6. **Maps integration for appointment location** (PRD 2). Currently a text
   field.
7. **Drag-to-reorder routine items** (PRD 9). Needs an `order` field on
   `routines`; trivial to add whenever you're ready.

---

## 7. How to verify

1. `POST /api/family/:id/vehicles` with the §2.1 vehicle shape → `201`, then
   `GET` the same kind and confirm **every field** came back, not a subset.
   Repeat for all 9 new kinds.
2. `POST /api/family/:id/dietProfile` twice with the same `id` → confirm one
   record, not two (idempotent upsert).
3. `POST /api/family/:id/familyBills` with `category: 'loan_emi'`,
   `accountNumber`, `paymentMethod`, `reminderDaysBefore`,
   `dayOfReminderEnabled` → `GET` and confirm all five round-trip.
   Repeat the equivalent for each kind in §3.
4. `POST /api/family/:id/medicines` with `frequency: 'weekly'`,
   `daysOfWeek: [1,4]`, `snoozeDuration: 15`, `doctorNotes` → confirm
   `GET /api/family` returns them.
5. As a **connected caregiver** (not the owner), `GET
   /api/family/:id/emergencyProfile` → must succeed and return the owner's
   data.
6. Set a medicine to `frequency: 'alternate_days'` → confirm reminders fire
   every other day, not daily.

---

## 8. Related documents

- `CAREGIVER-CONNECTED-SYSTEM-backend-requirements.md` — the connected
  caregiver linking layer. **Still unbuilt**; §2.2 and §5.6 above depend on it.
- `CAREGIVER-INVITE-EMAIL-backend-requirements.md` — invite email.
- `FAMILY-MEMBER-AGE-BLOOD-GROUP-backend-requirements.md` — the `bloodGroup`
  field on `family_members`. Note `emergencyProfile.bloodGroup` (§2.1) is a
  separate, emergency-card-specific value; the app falls back to the member's
  own `bloodGroup` when it's unset.
- `FAMILY_RECORDS_PERSISTENCE_SPEC.md` — the original record-sync spec.
