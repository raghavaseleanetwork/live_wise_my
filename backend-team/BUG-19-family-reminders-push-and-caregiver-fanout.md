# BUG-19 — Family reminders: no push delivery, no caregiver fan-out

**Audience:** Backend team
**Reported by:** Client, 2026-08-07
**Status:** Frontend half **DONE** (this release). Backend half **NOT STARTED** — this document is the spec.
**Related:** [BUG-17](./BUG-17-notifications-not-delivered-and-wrong-icon.md) (push payload/icon), [BUG-18](./BUG-18-family-hub-missing-notifications.md) (feature coverage)

---

## 0. TL;DR for the backend team

Three things are required, in this order:

1. **Build `GET /api/reminders/family`** — the app already calls it; it does not exist. §4
2. **Send push for all family reminder kinds**, not just medicines. §5
3. **Fan out every family notification to connected caregivers**, not just the record owner. §6

Then, in the **same release**, flip the cutover flag described in §7 — or every user gets
duplicate notifications.

---

## 1. What the client reported

> "If I have a daily routine and I wake up at 12:30, it should give me a notification at 12:30.
> If I have a walk at 13:00, it should give me a notification. It is not giving that... If there is
> a specific day, like Monday or Tuesday, it should remind me at that time... The people we are
> connected with through family connections should also get a notification about that."

Investigation found **four** distinct defects. Two were frontend and are now fixed. Two are
backend and are specified below.

| # | Defect | Layer | Status |
|---|---|---|---|
| 1 | Daily routines fired **once, ever** — never repeated | Frontend | ✅ Fixed, §2 |
| 2 | Day-of-week ("Mon/Tue") ignored for check-ins; didn't exist for routines | Frontend | ✅ Fixed, §2 |
| 3 | No server push for family reminders — nothing arrives when app is closed | **Backend** | ❌ §4, §5 |
| 4 | Connected caregivers never notified | **Backend** | ❌ §6 |

---

## 2. What the frontend already fixed (context — no backend action)

Included so you understand the data shape you must now match.

### 2.1 Recurring reminders now use OS repeating triggers

Previously `lib/family-reminders.ts` scheduled every reminder — including daily routines — as a
**one-shot `DATE` trigger** built from `dueDate`. `dueDate` for a routine is a *derived* value
("the next 12:30"), so the notification fired once and nothing ever re-armed it. If the app
wasn't opened before that moment, it never fired at all.

Now routines and check-ins schedule genuine `DAILY` / `WEEKLY` triggers via
`scheduleRepeatingLocalNotification()` in `lib/notifications.ts`. These keep firing at the OS
level without the app being opened.

### 2.2 Day-of-week is now honoured, and exists for routines

- `CheckinItem.days` existed and was written by the UI, but **no scheduler ever read it** — a
  Mon/Tue check-in was treated as daily.
- `RoutineItem` had **no `days` field at all**. It has been added.

```ts
// lib/family-records.ts
export interface RoutineItem {
  id: string;
  type: RoutineType;
  label: string;
  time: string;          // "HH:MM AM/PM"
  days?: number[];       // NEW — 0=Sun..6=Sat. Empty/absent = every day.
  enabled: boolean;
  createdAt: string;
}
```

> ⚠️ **`days` is optional and `undefined` means "every day".** Records written by older builds
> have no such field. Any server-side code MUST treat `undefined` and `[]` identically as "every
> day" — treating `undefined` as "no days selected" would silently stop every pre-existing routine
> from ever firing.

The routine add screen now has the same 7-day chip selector the check-in screen already had, and
both list screens show `"07:30 AM · Mon, Tue"` or `"07:30 AM · Every day"`.

### 2.3 New field on the reminder projection

`FamilyReminder` gained an optional `recurrence`:

```ts
recurrence?: {
  hour: number;      // 0..23, local time
  minute: number;    // 0..59
  weekdays: number[];// 0=Sun..6=Sat; empty = every day
};
```

Present **only** on `routine` and `checkin`. **This — not `dueDate` — is the schedule.**
`dueDate` on those kinds is display/sort data only.

### 2.4 Files changed (frontend)

| File | Change |
|---|---|
| `lib/notifications.ts` | Added `scheduleRepeatingLocalNotification()`, `cancelScheduledNotifications()` |
| `lib/family-reminders.ts` | `recurrence` field; `parseClockTime`/`normaliseWeekdays`; weekday-aware next-occurrence; repeating schedule path; orphan cancellation |
| `lib/family-records.ts` | `RoutineItem.days?: number[]` |
| `lib/family-reminders-api.ts` | Clears repeating-id ledger on cutover and rollback |
| `app/family-routine/add.tsx` | Day selector UI |
| `app/family-routine/[memberId].tsx` | Shows selected days |

---

## 3. Why the backend half is mandatory

The frontend fix has a hard ceiling: **local notifications only exist on one device.**

| Scenario | Local (today) | Push (required) |
|---|---|---|
| Phone off / rebooted at trigger time | ❌ Lost | ✅ Delivered |
| App reinstalled | ❌ All schedules gone | ✅ Delivered |
| User's second device | ❌ Never scheduled | ✅ Delivered |
| Connected caregiver | ❌ Never notified | ✅ Delivered |
| Android battery optimisation kills app | ⚠️ Unreliable | ✅ Delivered |

Android OEMs (Xiaomi, Oppo, Vivo, Samsung) aggressively kill background apps, and scheduled local
notifications are frequently dropped. **Push is the only reliable delivery mechanism.** This is
very likely the root cause of "family reminders are not coming for one person properly" — that
person's device is dropping local schedules.

---

## 4. Build `GET /api/reminders/family`

**The app already calls this endpoint. It does not exist on the server.**

Client call site: `lib/family-reminders-api.ts:153`

```ts
const res = await apiRequest('GET', '/api/reminders/family', undefined, token);
```

Verified absent — the server only has `/api/reminders/quick-add` and `/api/reminders/parse`
(`server/routes.ts:2065`, `:2105`).

### 4.1 Response contract

Return a JSON **array**. Each element must match the client's `FamilyReminder` field-for-field:

```ts
{
  id: string;                  // "fam:<kind>:<memberId>:<sourceId>" — see §4.2
  memberId: string;
  memberName: string;
  sourceKind: string;          // see §4.3
  sourceId: string;            // the underlying record's id

  name: string;                // "<title> · <memberName>"  ← the " · " separator matters
  amount: number;              // 0 when not monetary
  dueDate: string;             // ISO 8601
  category: string;            // 'health'|'bills'|'subscriptions'|'tasks'|'habits'|'family'|'travel'|'others'
  isPaid: boolean;
  icon: string;                // Ionicons name
  reminderType: 'subscription' | 'custom';
  repeatType: 'none'|'daily'|'weekly'|'monthly'|'yearly';
  status: 'active' | 'paid';
  reminderDaysBefore: number[];
  source: 'family';

  recurrence?: {               // routine & checkin ONLY
    hour: number;
    minute: number;
    weekdays: number[];
  };
}
```

### 4.2 Id format — must match exactly

```
fam:<sourceKind>:<memberId>:<sourceId>
```

Screens use this as a React list key and for dedupe. A mismatch causes duplicate-key errors and
dropped rows.

### 4.3 Kinds and their presentation

| `sourceKind` | category | icon | reminderDaysBefore |
|---|---|---|---|
| `appointment` | health | medkit | `[1, 0]` |
| `medicine-stock` | health | medical | `[3, 1]` |
| `family-bill` | bills | receipt | `[3, 1, 0]` |
| `subscription` | subscriptions | refresh | `[3, 1]` |
| `task` | tasks | checkmark-circle | `[1, 0]` |
| `routine` | habits | time | `[0]` |
| `checkin` | family | call | `[0]` |
| `travel` | travel | airplane | `[1, 0]` |
| `insurance` *(new)* | others | shield-checkmark | `[30, 7, 1]` |
| `custom` *(new)* | others | notifications | `[1, 0]` |

The client already degrades unknown kinds gracefully (`familyReminderLabel`,
`FALLBACK_KIND_META`), so adding kinds server-side will not crash older builds.

### 4.4 Projection rules — mirror `lib/family-reminders.ts` exactly

- **Skip** records with no usable date.
- **Skip** routines/check-ins where `enabled === false`.
- **Include** completed records with `isPaid: true` (they render in a "Completed" section —
  dropping them reads as data loss).
- Tasks with no `dueDate` are skipped.
- Medicine stock: due date = `floor((quantityRemaining − lowStockThreshold) / dailyUsage)` days
  from now, at 09:00. Skip if `dailyUsage <= 0`.
- `name` is always `` `${title} · ${memberName}` ``.

### 4.5 ⚠️ Empty array has a special meaning

The client treats `[]` as "the server has nothing useful" and **falls back to local scheduling**
(`family-reminders-api.ts:168`). This is deliberate: an earlier build latched the cutover flag on
an empty response and permanently disabled local notifications for those installs.

**Return real rows or an empty array — never fabricate.** But be aware the cutover in §7 only
engages once you return a non-empty array.

### 4.6 Prerequisite: family records must actually be persisted

`GET /api/reminders/family` can only project records the server has. `lib/family-records-sync.ts`
write-throughs to `/api/family/:memberId/<kind>` already exist client-side. Confirm these are
persisting for all kinds:

```
appointments · medicationStock · familyBills · subscriptions · familyTasks
routines · checkins · travelItems · healthLogs · documents · familyExpenses · customTrackers
```

If `routines` and `checkins` are not being stored, §4 and §5 cannot work at all. **Verify this
first.**

> **New field:** `routines` records now carry `days: number[]`. Ensure your schema does not strip
> unknown fields, or day-of-week selection will be lost on sync.

---

## 5. Send push for all family reminder kinds

Today the scheduler (`server/routes.ts:2997`) pushes exactly two things:

```
server/routes.ts:3119   bill reminders
server/routes.ts:3223   family medicine reminders
```

Everything else has **no push whatsoever**.

### 5.1 Dated kinds

Extend the existing `setInterval` loop. For each family reminder with a `dueDate`, follow the
existing bill logic: compute `daysLeft`, check membership in `reminderDaysBefore`, dedupe via
`reminderLogs` on `(userId, recordId, channel, dayOffset)`.

### 5.2 Recurring kinds — routines and check-ins

**These need different handling and are the client's headline complaint.**

Do **not** use `dueDate`. Use `recurrence`:

```
For each enabled routine/checkin:
  if recurrence.weekdays is non-empty AND today's weekday ∉ weekdays: skip
  if current local time is within the 5-minute window of (recurrence.hour, recurrence.minute):
      send push
      log to reminderLogs keyed on (recordId, YYYY-MM-DD) so it sends once per day
```

> ### ⚠️ Timezone — the single biggest correctness risk
>
> `recurrence.hour`/`minute` are **the user's local wall-clock time**. A routine set for 12:30 in
> IST must fire at 12:30 IST, not 12:30 UTC.
>
> The server currently stores **no timezone per user**. You will need to either:
> - **(Recommended)** add a `timezone` field to the user document (IANA, e.g. `Asia/Kolkata`),
>   captured by the client at login/registration; or
> - store a UTC offset alongside each recurring record.
>
> Without this, every recurring reminder fires at the wrong time for anyone not on server time.
> **Please confirm which approach you want — the client may need a change to send it.**

### 5.3 Payload — apply the BUG-17 fix to every new send site

The existing medicine send site sets no `icon`, `color`, or `channelId`. Every **new** site must:

```ts
await messaging.sendEachForMulticast({
  tokens,
  notification: { title, body },
  android: {
    notification: {
      icon: 'notification_icon',
      color: '#4F46E5',
      channelId: 'default',
      priority: 'high',
    },
  },
  data: {
    type: 'family-reminder',
    memberId: String(memberId),
    sourceKind,
    sourceId: String(sourceId),
    route: `/family-member-detail/${memberId}`,
  },
});
```

> `data` values must all be **strings** — FCM rejects non-string values in the data payload.

The client already routes on `data.type === 'family-reminder'`.

### 5.4 Copy

| Kind | Title | Body |
|---|---|---|
| appointment | `Appointment · {member}` | `{name} is today` / `{name} in {n} days` |
| family-bill | `Bill · {member}` | `{name} is due today` / `{name} due in {n} days` |
| subscription | `Subscription · {member}` | `{name} renews today` / `renews in {n} days` |
| task | `Task · {member}` | `{name} is due today` / `due in {n} days` |
| **routine** | `Routine · {member}` | `{name} — it's time` |
| **checkin** | `Check-in · {member}` | `Time to check in with {member}` |
| travel | `Travel · {member}` | `{name} is today` / `{name} in {n} days` |
| medicine-stock | `Medicine stock · {member}` | `{name} is running low` |
| insurance | `Insurance · {member}` | `{title} renewal is due today` / `in {n} days` |
| custom | `{featureName} · {member}` | `{title} is due today` / `in {n} days` |

Routine/check-in copy matches the frontend exactly (`family-reminders.ts`), which matters because
during cutover a user may briefly see both.

---

## 6. Caregiver fan-out

**Currently every send site notifies exactly one user:**

```ts
pushTokens.find({ userId: user._id })   // owner only
```

There is no fan-out anywhere in `server/routes.ts`.

The client already *displays* shared members' reminders — `lib/use-family-reminders.ts:56-66`
merges `loadSharedMembers()` into the list. So a caregiver **sees** the reminder but is **never
notified** about it. That is exactly the reported gap.

### 6.1 Required behaviour

For every family reminder push, build the recipient set:

```
recipients = { owner of the family member }
           ∪ { all caregivers with an ACCEPTED connection to that member }
```

Then collect push tokens for **all** recipients and send to the union.

### 6.2 Rules

- **Only accepted/active connections.** Pending or revoked invitations must not receive push.
- **Respect per-caregiver permissions** if your connection model has them (e.g. view-only vs
  full). If a caregiver cannot see a feature, do not notify them about it.
- **Dedupe per recipient.** `reminderLogs` must be keyed on `(recipientUserId, recordId, channel,
  dayOffset)`. Keying only on the record would let the first recipient's log suppress everyone
  else's notification.
- **In-app notifications too.** Insert a `notifications` row per recipient, not just the owner.
- **Don't notify the actor.** If a caregiver marks a check-in done, they don't need their own
  completion push.

### 6.3 Open question for the client

Should **all** connected caregivers get **every** reminder, or should this be configurable
per-caregiver / per-feature? Blanket fan-out on a large family could be noisy. **Recommend
shipping blanket fan-out first** (it's what was asked for) and adding preferences later if the
client requests it.

---

## 7. ⚠️ Cutover — read before deploying

The client has a permanent switch that disables local scheduling once the server takes over:

```ts
// lib/family-reminders.ts
if (await isServerSchedulingActive()) return;
```

It latches when `GET /api/reminders/family` returns a **non-empty array**
(`family-reminders-api.ts:174`).

### What this means for your deploy

| Order | Result |
|---|---|
| Endpoint returns rows, push **not yet** sending | ❌ Local off, push absent → **no reminders at all** |
| Push sending, endpoint returns `[]` | ❌ Local stays on → **duplicate notifications** |
| **Both together** | ✅ Correct |

**Ship §4 and §5 in the same release.** Do not deploy the endpoint returning real rows until push
is actually sending.

The client handles rollback: a `404` or `[]` calls `clearStaleServerScheduling()` and re-arms
local notifications. So if you need to back out, returning `[]` is safe.

---

## 8. Verification checklist

Backend:

- [ ] Confirm family records persist server-side for **all** kinds, especially `routines`/`checkins`
- [ ] Confirm `routines.days` is stored and not stripped
- [ ] Decide and implement timezone storage (§5.2) — **blocking for recurring reminders**
- [ ] `GET /api/reminders/family` returns correctly-shaped rows (§4)
- [ ] Push for all 8 existing kinds (§5)
- [ ] Recurring kinds fire on the right weekday at the right local time (§5.2)
- [ ] `insurance` (`FamilyDocument.reminderDate`) — see BUG-18 §3
- [ ] `custom` (`CustomTrackerItem.date`) — see BUG-18 §6
- [ ] BUG-17 payload (icon/color/channelId) on every new send site (§5.3)
- [ ] Caregiver fan-out with per-recipient dedupe (§6)
- [ ] §4 + §5 deploy together (§7)

End-to-end test:

- [ ] Routine at 12:30, every day → push at 12:30 **with app force-closed**
- [ ] Routine Mon+Tue only → fires Mon/Tue, silent Wed–Sun
- [ ] Connected caregiver receives the same reminder
- [ ] Exactly **one** notification per person (no duplicates)
- [ ] Reminder in a non-server timezone fires at correct local time
- [ ] Deleting a routine stops both local and push
- [ ] Notification icon is the LifeWise mark, not the generic Android square

---

## 9. Summary

| | Before | After frontend fix | After backend fix |
|---|---|---|---|
| Daily routine repeats | ❌ Fires once | ✅ Repeats | ✅ Repeats |
| Day-of-week | ❌ Ignored | ✅ Honoured | ✅ Honoured |
| Works with app closed | ❌ | ⚠️ Unreliable (OEM kills) | ✅ Push |
| Survives reinstall | ❌ | ❌ | ✅ |
| Second device | ❌ | ❌ | ✅ |
| Caregiver notified | ❌ | ❌ | ✅ |
| Family kinds with push | 2 of 15 | 2 of 15 | 10 of 15 |

The frontend fixes make reminders correct **on one device that stays open often enough**. Only the
backend work makes them dependable.

---

## 10. Questions for the backend team

1. **Timezone** — how do you want to handle it (§5.2)? This blocks recurring push and may require
   a client change to send the user's IANA zone.
2. Are family records (esp. `routines`, `checkins`) currently persisting? If not, what's the ETA?
3. Does your caregiver connection model carry per-feature permissions we should respect (§6.2)?
4. Can you confirm the same-release cutover (§7) is workable on your side?
