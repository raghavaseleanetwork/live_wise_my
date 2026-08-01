# Family Records — Server Persistence & Caregiver Sharing

**Status:** Blocked on backend. Frontend work is complete.
**Date:** 2026-08-01
**Owner (frontend):** LifeWise app team
**Priority:** HIGH — a shipped, user-visible feature is silently non-functional.

---

## 1. The reported bug

> "When I add a doctor's appointment to my family member, it should appear in my
> reminders and also in the connected caregiver's. Currently it is not happening."

This is **confirmed, reproducible, and backend-side.** The frontend cannot fix
it, because the data never leaves the device that created it.

### What actually happens today

1. User A owns family member "Papa" and invites User B as a connected caregiver.
2. User B accepts. **This part works** — B sees "Papa" in their Family Hub,
   badged `Shared`.
3. User A adds a doctor's appointment for Papa.
4. The appointment is written to **`AsyncStorage` on User A's phone only**.
   No HTTP request is made. The server never learns it exists.
5. User B's device has no appointment to display. Their Reminders tab shows
   nothing, forever.

Sharing today is **member-level only**. The caregiver receives the *person* but
none of that person's *records*.

---

## 2. Root cause

Every Family Hub record type is persisted locally, in
[`lib/family-records.ts`](../../lib/family-records.ts). That file contains no
`apiRequest` call of any kind. Its own header states the intent:

> Doctor Appointments, Health Monitoring, Medication Stock, Daily Routine
> (Phase 2); Bill Management, Subscription Tracking, Expense Tracking, Reminder
> Tasks, Insurance & Documents (Phase 3); and Call & Check-in, Travel & Visits,
> Emergency Alerts, Custom Feature (Phase 4) all store their entries **on-device
> (AsyncStorage)**, keyed per family member … **Phase 5 documents how the backend
> team mirrors this server-side later.**

**Phase 5 was never implemented.** Everything below is Phase 5.

A representative example — this is the entire persistence path for an
appointment:

```ts
const APPT_KEY = (memberId: string) => `@lifewise_family_appointments_${memberId}`;

export async function saveAppointments(memberId: string, items: Appointment[]) {
  await AsyncStorage.setItem(APPT_KEY(memberId), JSON.stringify(items));
}
```

### Consequences beyond caregiver sharing

Because records are device-local, **all** of the following are broken and are
fixed by the same work:

| Scenario | Current behaviour |
|---|---|
| Caregiver sharing | Caregiver sees the member, never their records |
| User reinstalls the app | **All family records are permanently lost** |
| User logs in on a second device | Family Hub appears empty |
| Push while app is closed | Impossible — the server has nothing to schedule from |

The reinstall case is a silent data-loss bug and is arguably more urgent than
the sharing request that prompted this document.

---

## 3. What the frontend already does (do not rebuild)

These are live and working. The backend should conform to them rather than
inventing a parallel shape.

### 3.1 Caregiver connection — working

Implemented in [`lib/family-caregivers.ts`](../../lib/family-caregivers.ts):

| Endpoint | Purpose |
|---|---|
| `GET /api/family/:memberId/connected-caregivers` | Owner + accepted caregivers |
| `POST /api/family/:memberId/connected-caregivers/invite` | Invite by email |
| `DELETE /api/family/:memberId/connected-caregivers/:userId` | Remove |
| `GET /api/caregiver-invites` | Pending invites for current user |
| `POST /api/caregiver-invites/:id/accept` | Accept |
| `POST /api/caregiver-invites/:id/decline` | Decline |
| `GET /api/family/shared-with-me` | Members shared *with* current user |

**The permission model this establishes is what record access must reuse.**

### 3.2 The reminder projection — working, client-side

[`lib/family-reminders.ts`](../../lib/family-reminders.ts) converts family
records into reminder rows. The client already merges owned **and** shared
members when projecting ([`lib/use-family-reminders.ts`](../../lib/use-family-reminders.ts)):

```ts
const members = [
  ...owned,
  ...shared.filter((s) => !owned.some((o) => String(o.id) === String(s.id))),
];
```

So the moment the backend serves records for shared members, caregiver reminders
begin working with **no further frontend change**.

---

## 4. Required work

### 4.1 Persist family records server-side

Twelve record types currently live only on-device. Eight of them project into
reminders and are the priority:

| Kind | AsyncStorage key | Projects to reminder? |
|---|---|---|
| `appointment` | `@lifewise_family_appointments_{memberId}` | ✅ |
| `medicine-stock` | `@lifewise_family_stock_{memberId}` | ✅ |
| `family-bill` | `@lifewise_family_bills_{memberId}` | ✅ |
| `subscription` | `@lifewise_family_subscriptions_{memberId}` | ✅ |
| `task` | `@lifewise_family_tasks_{memberId}` | ✅ |
| `routine` | `@lifewise_family_routine_{memberId}` | ✅ |
| `checkin` | `@lifewise_family_checkins_{memberId}` | ✅ |
| `travel` | `@lifewise_family_travel_{memberId}` | ✅ |
| `health` | `@lifewise_family_health_{memberId}` | ❌ (log, not scheduled) |
| `expense` | `@lifewise_family_expenses_{memberId}` | ❌ |
| `document` | `@lifewise_family_documents_{memberId}` | ❌ |
| `emergency` | `@lifewise_family_emergency_*_{memberId}` | ❌ |

**Suggested REST shape**, mirroring the existing family routes:

```
GET    /api/family/:memberId/appointments
POST   /api/family/:memberId/appointments
PATCH  /api/family/:memberId/appointments/:id
DELETE /api/family/:memberId/appointments/:id
```

…and the same for each kind. Use the existing plural feature name as the path
segment so the client's storage keys map 1:1.

### 4.2 Scope records to the MEMBER, not the creating user

This is the single most important rule in this document.

> A family record belongs to the **family member**. Anyone with access to that
> member — the owner **or any accepted caregiver** — must be able to read it.

Authorisation check for every record route:

```
allow if  member.ownerUserId == currentUser.id
       OR exists(connected_caregiver
                 where memberId == :memberId
                   and userId  == currentUser.id
                   and status  == 'accepted')
```

Storing `createdByUserId` on each record is useful for attribution ("added by
Ravi") but **must not** be used for access control — that reintroduces exactly
the bug being fixed.

**Write permissions:** owner and accepted caregivers may both create and edit.
The product intent is shared caregiving, not read-only observation. If you want
a read-only caregiver tier, flag it — it is a product decision, not a technical
one, and the frontend has no UI for it today.

### 4.3 Implement `GET /api/reminders/family`

The client already calls this
([`lib/family-reminders-api.ts`](../../lib/family-reminders-api.ts)). It does not
exist in [`server/routes.ts`](../../server/routes.ts).

It must return the projection across **owned + shared** members in one call.

**Response:** a JSON array of `FamilyReminder`, which extends the app's existing
`Bill` shape:

```jsonc
[
  {
    // --- Bill fields (rendered by the existing Bills tab components) ---
    "id": "fam:appointment:8821:appt_1730",   // see id format below
    "name": "Dr. Sharma · Papa",
    "amount": 0,
    "dueDate": "2026-08-14T09:30:00.000Z",
    "category": "health",
    "isPaid": false,
    "status": "pending",
    "reminderDaysBefore": [1, 0],

    // --- Family provenance ---
    "memberId": "8821",
    "memberName": "Papa",
    "sourceKind": "appointment",
    "sourceId": "appt_1730"
  }
]
```

**The `id` format is load-bearing and must match exactly:**

```
fam:{sourceKind}:{memberId}:{sourceId}
```

The client uses the `fam:` prefix to distinguish projected rows from real bills
(`isFamilyReminderId`). Family rows are read-only in the Bills tab — attempting
to delete one shows "Managed in Family Hub". Getting this wrong causes the
Reminders tab to try to `DELETE /api/bills/fam:...`.

**Per-kind mapping** — replicate from
[`lib/family-reminders.ts`](../../lib/family-reminders.ts), do not invent:

| `sourceKind` | `category` | Title format | `reminderDaysBefore` |
|---|---|---|---|
| `appointment` | `health` | `Dr. {doctorName}` | `[1, 0]` |
| `medicine-stock` | `health` | `Refill {medicineName}` | `[3, 1]` |
| `family-bill` | `bills` | `{name}` | `[3, 1, 0]` |
| `subscription` | `subscriptions` | `{serviceName}` | `[3, 1]` |
| `task` | `tasks` | `{title}` | `[1, 0]` |
| `routine` | `habits` | `{label}` | `[0]` |
| `checkin` | `family` | `{label}` | `[0]` |
| `travel` | `travel` | `{title}` | `[1, 0]` |

Notes on edge cases the client already handles:

- **`routine` / `checkin` store a wall-clock `"HH:MM AM/PM"` with no date.**
  Resolve to the next occurrence at or after now.
- **`medicine-stock` has no due date.** It is derived:
  `daysLeft = quantityRemaining / dailyUsage`, reminder fires as stock nears
  `lowStockThreshold`.
- **Records with an unparseable date are skipped**, not surfaced as errors.
- **Completed / paid records are still returned** with `isPaid: true` so the
  Completed section can render them.

### 4.4 Server-side notification scheduling

Once records are server-side, the backend scheduler should deliver these as push
so reminders arrive while the app is closed — local `expo-notifications`
scheduling cannot do this reliably.

**There is a client-side cutover guard you must be aware of.** When
`GET /api/reminders/family` returns a **non-empty** array, the client
permanently disables its own local scheduling for that install, to avoid
notifying the user twice for one appointment.

> ⚠️ **Therefore: do not ship `GET /api/reminders/family` returning real rows
> until the push scheduler is live.** Doing so switches off local notifications
> and replaces them with nothing. Ship the two together, or ship the endpoint
> returning `[]` until the scheduler is ready — the client treats `[]` as "not
> ready" and keeps scheduling locally.

---

## 5. Frontend changes already shipped (2026-08-01)

Two real client bugs were found while diagnosing this and are **fixed**, in
[`lib/family-reminders-api.ts`](../../lib/family-reminders-api.ts):

### 5.1 An empty server response blanked the list

`fetchFamilyReminders` treated **any** successful JSON array — including `[]` —
as authoritative and returned early, skipping the local projection entirely.
Since the server has no family records, it returns `[]`, so the user's own
locally-stored appointments **disappeared from their own Reminders tab.**

Now: `[]` falls through to the local projection.

### 5.2 The scheduling cutover latched on that same empty response

The same code path then called `markServerSchedulingActive()`, which is
deliberately **permanent and sticky**. It cancelled every scheduled local family
notification and disabled future local scheduling for the life of the install —
triggered by a server that had no reminders at all.

Now: the cutover only fires on a **non-empty** response. A new
`clearStaleServerScheduling()` repairs installs already stuck in this state,
called when the server returns `[]` or `404`.

**Impact for QA:** testers whose builds hit the old code have local family
notifications permanently disabled. The fix self-heals on next launch, but a
reinstall guarantees a clean state.

---

## 6. Acceptance criteria

The original report is fixed when all of these pass:

1. User A adds a doctor's appointment for member "Papa".
2. It appears in **A's** Reminders tab. *(Regression check — 5.1 above.)*
3. User B, an accepted caregiver for Papa, opens their Reminders tab on a
   **different device** and sees the same appointment.
4. B marks it complete; A sees it completed after refresh.
5. A reinstalls the app, logs in, and **all** Family Hub records are still there.
6. Neither user receives duplicate notifications.

---

## 7. Suggested delivery order

| # | Work | Unblocks |
|---|---|---|
| 1 | Persist the 8 reminder-projecting record types (§4.1) with member-scoped auth (§4.2) | Reinstall data loss; the foundation for everything else |
| 2 | `GET /api/reminders/family` returning owned + shared (§4.3) | **The reported caregiver bug** |
| 3 | Push scheduler (§4.4) | Reminders while the app is closed |
| 4 | Remaining 4 non-reminder record types (§4.1) | Full parity |

Steps 1 and 2 alone close the user-reported issue.

---

## 8. Open questions for the backend team

1. **Do accepted caregivers get write access, or read-only?** Frontend currently
   assumes write (there is no read-only UI state).
2. **What happens to records when a caregiver is removed?** Suggested: they
   retain nothing — access is revoked, records stay with the member.
3. **Conflict resolution** when owner and caregiver edit the same record
   offline? Last-write-wins is acceptable for v1 unless you prefer otherwise.
4. **Migration:** should the client upload its existing on-device records on
   first launch after the backend goes live? Without it, every user's current
   Family Hub data stays stranded on one device. The frontend can implement a
   one-time push if you confirm the endpoints are idempotent.

---

## 9. Related documents

- [`FAMILY_RECORDS_PERSISTENCE_SPEC.md`](FAMILY_RECORDS_PERSISTENCE_SPEC.md) — the original Phase 5 spec
- [`FAMILY_REMINDERS_BACKEND_SPEC.md`](FAMILY_REMINDERS_BACKEND_SPEC.md) — projection contract
- [`../CAREGIVER-SYSTEM-backend-requirements.md`](../CAREGIVER-SYSTEM-backend-requirements.md) — the caregiver layer that already works
- [`../FAMILY-HUB-backend-guide.md`](../FAMILY-HUB-backend-guide.md)
