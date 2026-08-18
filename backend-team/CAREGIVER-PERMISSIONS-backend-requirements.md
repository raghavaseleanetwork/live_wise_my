# Caregiver Permissions & Scoped Access — Backend Requirements

**Audience:** Backend team
**Date:** 2026-08-17
**Status:** Frontend is **built and shipping**. The app already sends and reads
every field below. Until the server stores and **enforces** them, the UI hides
things the API will still hand over to anyone who asks.

**Client request this answers (item 11):**
> *"Implement the caregiver role as defined in the PRD. Permissions: receive
> reminder notifications and alerts; mark reminders as completed; **access only
> the data and permissions assigned by the primary account holder**."*

The first two already worked. The third — scoped access — did not exist at all,
and is what this document is about.

---

## 0. TL;DR

| # | Work | Size | Blocking? |
|---|---|---|---|
| 1 | Store `permissions` on each caregiver entry (§2) | Small | **Yes** — nothing persists without it |
| 2 | Return `permissions` from `GET .../connected-caregivers` (§3) | Trivial | **Yes** — UI cannot show current state |
| 3 | Accept `permissions` on the invite call (§4) | Trivial | **Yes** |
| 4 | New `PATCH .../permissions` route (§5) | Small | **Yes** — editing after invite |
| 5 | **Enforce on every read/write** (§6) | Medium | **Yes — this is the actual security fix** |
| 6 | Scope reminders/push to permitted modules (§7) | Medium | No — but leaks data via notifications otherwise |

> ⚠️ **Items 1–4 are plumbing. Item 5 is the feature.** A caregiver who is
> restricted in the UI can still call the API directly today. Please do not
> treat this as done when the fields merely round-trip.

---

## 1. The permission model

Two **independent** dimensions, both chosen by the member's owner:

**1. WHICH modules — `allowedModules`**
Which of the member's Family Hub modules the caregiver can see at all.

```ts
allowedModules: FamilyFeatureKey[] | null
```

Valid keys are the 20 module keys already used by `family_members.features`:
`medicines`, `appointments`, `bills`, `health`, `emergency`, `routine`,
`subscriptions`, `expenses`, `tasks`, `checkin`, `travel`, `stock`, `diet`,
`insurance`, `custom`, `fitness`, `study`, `wellness`, `vehicles`,
`homeMaintenance`.

> **`null` means "all modules", and that is load-bearing.** Every caregiver
> connected before this feature existed has no `permissions` field. They must
> keep full access, not silently lose it. **Absent or `null` ⇒ everything.**
> Restriction is strictly opt-in by the owner.

**2. WHAT they may do — `accessLevel`**

```ts
accessLevel: 'view' | 'mark_done' | 'full'
```

| Level | May read | May mark reminders done | May create/edit/delete |
|---|---|---|---|
| `view` | ✅ | ❌ | ❌ |
| `mark_done` | ✅ | ✅ | ❌ |
| `full` | ✅ | ✅ | ✅ |

`mark_done` is the PRD's default caregiver — *"receive alerts, mark reminders
done"*. `full` is the current de-facto behaviour and remains the default when
no permissions are stored.

---

## 2. Schema

Extend each entry in `family_members.caregivers[]`:

```ts
caregivers: [
  {
    userId: string,
    role: 'caregiver',
    connectedAt: Date,

    // NEW — both optional; absent means unrestricted (see §1).
    permissions: {
      allowedModules: string[] | null,
      accessLevel: 'view' | 'mark_done' | 'full',
    } | null,
  },
]
```

Also store the same shape on `caregiver_invites` so permissions chosen at invite
time survive until the invite is accepted, then copy onto the caregiver entry.

**No migration needed.** Existing rows have no `permissions`, which §1 defines
as full access — identical to today's behaviour.

---

## 3. `GET /api/family/:memberId/connected-caregivers`

Add `permissions` to each returned caregiver:

```jsonc
[
  { "id": "...", "userId": "...", "name": "Raghav", "role": "owner", "...": "..." },
  {
    "id": "...", "userId": "...", "name": "Priya", "role": "caregiver",
    "connectedAt": "2026-07-10T00:00:00Z",
    "permissions": {                        // ← NEW
      "allowedModules": ["medicines", "appointments"],
      "accessLevel": "mark_done"
    }
  }
]
```

- **Owner rows:** omit `permissions` entirely (or send `null`). The owner is
  never restricted; the client already special-cases this.
- **Legacy caregivers:** omit it. The client normalises absent → full access.

---

## 4. `POST /api/family/:memberId/connected-caregivers/invite`

The body now optionally carries initial permissions:

```jsonc
{
  "email": "priya@example.com",
  "permissions": {                          // ← NEW, optional
    "allowedModules": ["medicines", "appointments"],
    "accessLevel": "mark_done"
  }
}
```

Store on the invite; copy to the caregiver entry on accept. If omitted, default
to full access.

**Validate:** reject unknown module keys and unknown access levels with `400`
rather than storing them — an unrecognised value must never be interpreted as
"allow".

---

## 5. NEW: `PATCH /api/family/:memberId/connected-caregivers/:caregiverUserId/permissions`

Lets the owner change permissions after the caregiver is already connected —
the common case, since owners usually discover they over-shared later.

```
PATCH /api/family/:memberId/connected-caregivers/:caregiverUserId/permissions
Auth: required. OWNER ONLY.

Body:
{ "allowedModules": ["medicines"] | null, "accessLevel": "view" }

200 → { "ok": true }
400 → invalid module key or access level
403 → requester is not the owner of this member
404 → member or caregiver not found
```

**403 for a non-owner is important.** A caregiver must not be able to widen
their own permissions. Please test that case explicitly.

---

## 6. Enforcement — the part that actually matters

Everything above only stores preferences. **The server must enforce them**, on
every route that touches a member a caregiver is connected to.

### 6.1 Module scoping (reads)

For a **caregiver** (never the owner) with `allowedModules !== null`, requests
for a record kind outside that list must return `403`, not filtered data.

Map record kinds to module keys:

| `:kind` segment | Module key |
|---|---|
| `appointments` | `appointments` |
| `medicationStock` | `stock` |
| `familyBills` | `bills` |
| `subscriptions` | `subscriptions` |
| `familyTasks` | `tasks` |
| `routines` | `routine` |
| `checkins` | `checkin` |
| `travelItems` | `travel` |
| `healthLogs` | `health` |
| `documents` | `insurance` |
| `familyExpenses` | `expenses` |
| `customItems` | `custom` |
| `dietProfile` | `diet` |
| `fitnessItems` | `fitness` |
| `studyProfile` | `study` |
| `moodLogs` / `wellnessReminders` | `wellness` |
| `vehicles` / `fuelLog` | `vehicles` |
| `homeMaintenance` | `homeMaintenance` |
| `emergencyProfile` | `emergency` |

Medicines (`/api/family/:id/medicines`) map to `medicines`.

### 6.2 Access-level scoping (writes)

| Operation | Minimum level |
|---|---|
| Any `GET` | `view` |
| Mark done / taken / paid / snooze — i.e. a `PATCH` that only flips a completion or snooze field | `mark_done` |
| `POST` (create), `DELETE`, or any other `PATCH` | `full` |

Anything below the required level returns `403`.

> The mark-done vs edit distinction is the fiddly one: both are `PATCH`. The
> cleanest rule is to inspect the patch body — if it only touches completion or
> snooze fields (`isPaid`, `completed`, `taken`, `lastDoneAt`, `completedDates`,
> `snoozedUntil`, `status`), `mark_done` suffices; any other field requires
> `full`.

### 6.3 `GET /api/family/shared-with-me`

Members shared with a caregiver should still be listed, but consider returning
only the permitted module keys in `features` so the caregiver's Family Hub does
not advertise modules they cannot open.

---

## 7. Reminders and push

A caregiver must not be notified about a module they cannot see — a push preview
leaks exactly the data the owner restricted.

- `GET /api/reminders/family` — filter rows by the requester's `allowedModules`
  for members where they are a caregiver.
- Push fan-out — when sending a reminder for module M, include a caregiver only
  if M is in their `allowedModules`.
- **Snooze/Done notification buttons** (see
  `NOTIFICATION-ACTIONS-backend-requirements.md`): a `view`-level caregiver
  should not receive the action buttons, and the actions must be rejected
  server-side regardless of what the client sent.

---

## 8. What the frontend already does

Shipped, no further client work needed once the server side lands:

- `lib/family-caregivers.ts` — `CaregiverPermissions`, `CaregiverAccessLevel`,
  `canAccessModule()`, `hasAccessLevel()`, `normalizeCaregiverPermissions()`,
  and `updateCaregiverPermissions()` calling §5.
- `components/CaregiverPermissionEditor.tsx` — the owner-facing editor for both
  dimensions. Used by the invite flow and the edit screen, so they cannot drift.
- `app/family-caregivers/permissions.tsx` — edit screen for an existing caregiver.
- `app/family-caregivers/[memberId].tsx` — each caregiver row shows a
  one-line permission summary plus an edit button (owner only).
- `app/family-caregivers/add.tsx` — permissions chosen during the invite.
- `lib/use-caregiver-permissions.ts` — the hook screens use to gate UI.
- `app/family-member-detail/[memberId].tsx` — hides modules outside
  `allowedModules`; shows a "view only" banner for `view`-level caregivers.
- i18n across all 7 locales.

**The client fails open by design.** If the caregiver list cannot be fetched it
assumes owner-level access rather than locking someone out of their own data.
That is safe *only because the server is the real gate* — which is why §6 is not
optional.

---

## 9. How to verify

1. Invite a caregiver with `allowedModules: ["medicines"]`, `accessLevel: "view"`.
   As that caregiver, `GET /api/family/:id/familyBills` → **403**.
2. Same caregiver, `GET /api/family/:id/medicines` → **200**.
3. Same caregiver, `PATCH` a medicine to mark it taken → **403** (needs `mark_done`).
4. Raise them to `mark_done`; repeat step 3 → **200**. Then `POST` a new
   appointment → **403** (needs `full`).
5. As the **caregiver**, `PATCH .../permissions` to widen their own access →
   **403**.
6. `GET .../connected-caregivers` → the owner row has no `permissions`; the
   caregiver row has the stored object.
7. A caregiver connected **before** this shipped (no `permissions` stored) →
   still has full access to everything. Nothing silently revoked.
8. `GET /api/reminders/family` as a module-restricted caregiver → no rows for
   modules outside their list.

---

## 10. Related documents

- `CAREGIVER-CONNECTED-SYSTEM-backend-requirements.md` — the connection layer
  this extends. Its §1 notes the flat role model was *"explicitly descoped for
  this phase"*; the client has now asked for it, so this document supersedes
  that decision.
- `NOTIFICATION-ACTIONS-backend-requirements.md` — Snooze/Done buttons, which
  §7 restricts by access level.
- `FAMILY-REMINDERS-HOME-backend-requirements.md` — `GET /api/reminders/family`,
  which §7 filters.
- `FAMILY-HUB-PRD-COMPLIANCE-backend-requirements.md` — the record kinds §6.1
  maps.
