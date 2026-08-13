# Bug #18 — Family Hub: features with no reminder notifications

**Audience:** Backend team
**Reported by:** Client, 2026-08-07 — *"in Family Hub everything should have a notification"*
**Status:** Investigated. Coverage gaps confirmed. **This one is split work** — see §2.
**Depends on:** [BUG-17](./BUG-17-notifications-not-delivered-and-wrong-icon.md) must be fixed first, or nothing added here will actually be delivered.

---

## 1. Current coverage

Family Hub declares 15 features (`lib/f
amily-features.ts:14-29`). Reminder projections exist for
only 8 of them (`lib/family-reminders.ts:254-358`).

| # | Feature | Reminder today? | Notes |
|---|---|---|---|
| 1 | Appointments | ✅ | `kind: 'appointment'` |
| 2 | Bills | ✅ | `kind: 'family-bill'` |
| 3 | Subscriptions | ✅ | `kind: 'subscription'` |
| 4 | Tasks | ✅ | `kind: 'task'` |
| 5 | Routine | ✅ | `kind: 'routine'` |
| 6 | Check-in | ✅ | `kind: 'checkin'` |
| 7 | Travel | ✅ | `kind: 'travel'` |
| 8 | Medicine stock | ✅ | `kind: 'medicine-stock'` |
| 9 | Medicines | ⚠️ Partial | Slot-based; only path with a server push today (`routes.ts:3223`) |
| 10 | Emergency | ⚠️ Partial | Missed-medicine alert only (`app/family-emergency/[memberId].tsx:69`) |
| 11 | **Insurance** | ❌ **None** | **`reminderDate` is collected and saved but never read — see §3** |
| 12 | **Health** | ❌ None | Log of past readings; see §4 |
| 13 | **Expenses** | ❌ None | Log of past spending; see §4 |
| 14 | **Custom** | ❌ None | User-defined tracker with a date |
| 15 | **Diet** | ❌ None | **Not implemented at all** — see §5 |

### Critical: push coverage is far worse than local coverage

The 8 ✅ rows above are **local notifications only** — scheduled on the device by
`lib/family-reminders.ts`. The server currently sends push for **exactly two** things:

```
server/routes.ts:3119   bill due reminders
server/routes.ts:3223   family medicine reminders
```

**Appointments, travel, tasks, routine, check-in, subscriptions and medicine stock have no server
push at all.** If the user's phone is off, reinstalled, or the local schedule is lost, those
reminders are simply gone. The client asked for both local and push; today only 2 of 15 features
have push.

---

## 2. Split of work — read this before starting

| Work | Owner | Why |
|---|---|---|
| Add local reminders for insurance / custom (§3, §6) | **Frontend** | Built on-device in `lib/family-reminders.ts`; no API involved |
| Add **push** for all family reminder kinds (§7) | **Backend** | Only the server can send FCM |
| Decide health/expenses/diet behaviour (§4, §5) | **Product** | These are logs, not schedules — see below |

The frontend half is already understood and can be done independently. **This document is scoped
to what the backend must build**: server-side scheduling and push for family reminders.

---

## 3. Insurance — a half-built feature (highest priority)

`lib/family-records.ts:586-594`:

```ts
export interface FamilyDocument {
  id: string;
  title: string;
  type: 'insurance' | 'id' | 'medical' | 'other';
  /** Policy/renewal reminder date, if applicable. */
  reminderDate?: string | null;   // ISO
  notes?: string;
  createdAt: string;
}
```

The field exists, the UI collects it (`app/family-documents/add.tsx:31,48-49`), the value is
saved — and **no scheduler ever reads it**. Verified:

```
grep -rn "reminderDate" lib/ app/ --include=*.ts --include=*.tsx
→ app/family-documents/add.tsx    (writes it)
→ app/(tabs)/bills.tsx            (an unrelated CSS class of the same name)
→ (no reminder/notification code reads it)
```

A user setting a policy renewal date gets no reminder, ever. This is the single clearest defect in
this report: not a missing feature, but a feature that silently does nothing.

**Backend requirement:** treat any `FamilyDocument` with a non-null `reminderDate` as a reminder
source and schedule push for it, using the same lead-day logic as bills.

Suggested copy:
```
Title: Insurance · {memberName}
Body : {title} renewal is due today          (lead 0)
       {title} renewal in {n} days           (lead n)
```

---

## 4. Health & Expenses — these are logs, not schedules

`HealthLog` (`family-records.ts:204`) and `FamilyExpense` (`family-records.ts:481`) both carry
`date: string`, but it is the date the reading/expense **happened**, not a future due date. There
is nothing to remind about.

**Do not build due-date reminders for these.** They would fire on past events.

If the client wants notifications here, it has to be a different kind of trigger — a
**product decision**, not a scheduling gap:

- **Health:** "no BP reading logged in 7 days" (an absence-of-data nudge)
- **Expenses:** "₹X spent on {member} this month" (a periodic digest)

Both need new rules and new copy. Flag back to the client before building. **Recommend deferring.**

---

## 5. Diet — not implemented

`'diet'` appears in `FamilyFeatureKey` (`family-features.ts:26`) but has **zero** implementation:

```
grep -ric "diet" lib/family-records.ts  →  0
```

No interface, no storage key, no loader. There is nothing to attach a reminder to. **The feature
itself must be built before notifications can exist.** Out of scope for this document.

---

## 6. Custom trackers

`CustomTrackerItem` (`family-records.ts:906`) has `title`, `date` (ISO) and `completed`. This is a
genuine schedulable item: remind on `date` when `completed === false`.

Copy:
```
Title: {customFeatureName} · {memberName}
Body : {title} is due today
```

---

## 7. **The main backend task** — push for all family reminder kinds

### What exists on the client

`lib/family-reminders.ts` projects family records into a common shape (line 43):

```ts
export type FamilyReminderKind =
  | 'appointment'
  | 'medicine-stock'
  | 'family-bill'
  | 'subscription'
  | 'task'
  | 'routine'
  | 'checkin'
  | 'travel';
```

Each projected reminder carries:

```ts
{
  id: string;
  memberId: string;
  memberName: string;
  sourceKind: FamilyReminderKind;
  sourceId: string;
  name: string;
  dueDate: string;              // ISO
  reminderDaysBefore: number[]; // e.g. [3, 1, 0]
  isPaid: boolean;
}
```

### What the server must do

Extend the existing reminder scheduler (`routes.ts:2997`, the same loop being fixed in BUG-17) to
also walk family records and push for **every** kind above, plus `insurance` and `custom` from §3
and §6.

The medicine path at `routes.ts:3223` is the model to follow — but note it currently sets no
`icon`, no `color` and no `channelId`. **Apply the BUG-17 §5 payload fix to every new send site
you add here**, or these new notifications will have the same wrong-icon bug:

```ts
android: {
  notification: {
    icon: 'notification_icon',
    color: '#4F46E5',
    channelId: 'default',
    priority: 'high',
  },
},
```

### Dedup against the client — important

`lib/family-reminders.ts:450` already contains the cutover switch:

```ts
if (await isServerSchedulingActive()) return;   // reads AsyncStorage 'true'
```

The client is **designed to stop scheduling locally once the server takes over**, so the user is
not notified twice for one appointment. That flag is currently not set.

**Coordinate the flip.** Turning on server push for family reminders without setting this flag
means every user gets **two notifications for every family reminder** — the exact duplicate the
client has already complained about for bills. The flag must be switched on in the same release
that ships server-side family push.

---

## 8. Suggested notification copy

| Kind | Title | Body (lead 0 / lead n) |
|---|---|---|
| appointment | Appointment · {member} | {name} is today / {name} in {n} days |
| family-bill | Bill · {member} | {name} is due today / {name} due in {n} days |
| subscription | Subscription · {member} | {name} renews today / {name} renews in {n} days |
| task | Task · {member} | {name} is due today / {name} due in {n} days |
| routine | Routine · {member} | {name} is due today / {name} in {n} days |
| checkin | Check-in · {member} | Check in with {member} today |
| travel | Travel · {member} | {name} is today / {name} in {n} days |
| medicine-stock | Medicine stock · {member} | {name} is running low |
| **insurance** | Insurance · {member} | {title} renewal is due today / renewal in {n} days |
| **custom** | {featureName} · {member} | {title} is due today / {title} in {n} days |

These match the existing local format (`family-reminders.ts:470`) so local and push read
identically — which matters, because during the cutover a user may see both.

---

## 9. Checklist

- [ ] **Prerequisite:** BUG-17 fixed and deployed. Nothing here is deliverable until it is.
- [ ] Extend the scheduler to project family records into reminders server-side.
- [ ] Push for all 8 existing `FamilyReminderKind` values.
- [ ] Push for `insurance` (`FamilyDocument.reminderDate`) — §3, the clearest current defect.
- [ ] Push for `custom` (`CustomTrackerItem.date` where `completed === false`) — §6.
- [ ] Apply the BUG-17 §5 icon/color/channelId payload to every new send site.
- [ ] Reuse the `reminderLogs` dedup so a reminder sends once per `(record, dayOffset)`.
- [ ] Coordinate the `isServerSchedulingActive` flag flip in the same release — §7.
- [ ] **Do not** build reminders for health/expenses (§4) or diet (§5) without a product decision.

---

## 10. Open questions for the client

1. **Health / Expenses** — is a "you haven't logged in 7 days" nudge or a monthly digest wanted, or
   should these have no notifications? (§4)
2. **Diet** — the feature does not exist yet. Should it be built, and if so what does it hold? (§5)
3. **Lead days** — family records currently use `reminderDaysBefore`. Should insurance renewals use
   a longer default (e.g. `[30, 7, 1]`) than the `[3, 1, 0]` used for bills?

---

## 11. Summary

| | Today | After |
|---|---|---|
| Family features with a local reminder | 8 of 15 | 10 of 15 (+ insurance, custom) |
| Family features with a **push** | **2 of 15** | 10 of 15 |
| Insurance `reminderDate` | Saved, never used | Fires a renewal reminder |
| Duplicate risk | — | Controlled by the cutover flag (§7) |

The headline is §7: **only 2 of 15 family features have push notifications today**, and 6 of the 8
that "work" are device-local only. Insurance (§3) is the most defensible starting point — the field
already exists and users are already filling it in.
