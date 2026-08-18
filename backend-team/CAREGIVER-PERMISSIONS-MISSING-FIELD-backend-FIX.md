# Caregiver Permissions — The Exact Missing Piece (3 small changes)

**Audience:** Backend team
**Date:** 2026-08-18
**Priority:** HIGH — "View only" currently grants full access to every caregiver
**Supersedes:** `CAREGIVER-PERMISSIONS-NOT-WORKING-backend-ACTION-REQUIRED.md`
and `CAREGIVER-PERMISSIONS-STILL-NOT-ON-REMOTE-reply.md`

---

## 0. First — you were right, and I was wrong

My previous two documents claimed the permissions code was not deployed. **That
was incorrect and I apologise for the noise.** I was checking the git remote;
you were right that it is live on Render.

Verified by probing the deployed server directly (401 = route exists and needs
auth; 404 would mean missing):

```
PATCH /api/family/:id/connected-caregivers/:uid/permissions  → 401  ✅ deployed
GET   /api/family/:id/connected-caregivers                    → 401  ✅ deployed
GET   /api/family/:id/checkins                                → 401  ✅ deployed
GET   /api/family/:id/healthLogs                              → 401  ✅ deployed
GET   /api/family/:id/appointments                            → 401  ✅ deployed
```

The enforcement work is there. Please disregard the "not on remote" thread.

**The real bug is much smaller and very specific**, and it is genuinely on the
backend side. It is three missing lines across three routes. Details below.

---

## 1. The bug in one sentence

`GET /api/family/:memberId/connected-caregivers` **does not return a
`permissions` field**, and the invite/accept flow **never stores one** — so the
app can never see the restrictions an owner sets, and every caregiver falls back
to full access.

---

## 2. Evidence

### 2.1 What the caregiver list returns today

From `server/routes.ts`, `GET /api/family/:memberId/connected-caregivers`:

```js
...connected.map((c) => {
  const u = userById.get(String(c.userId));
  return {
    id: c.userId,
    userId: c.userId,
    name: u?.name || null,
    email: u?.email || null,
    avatarUrl: u?.avatarUrl || null,
    role: 'caregiver',
    connectedAt: c.connectedAt || null,
    // ← no `permissions` key
  };
}),
```

### 2.2 What the invite route reads

```js
const emailRaw = (req.body?.email || '').toString().trim().toLowerCase();
// ← `req.body.permissions` is never read
```

The app **is** sending it (see §4), but it is dropped.

### 2.3 What accept writes

```js
{ $push: { connectedCaregivers: {
    userId: requesterId,
    role: 'caregiver',
    connectedAt: new Date(),
    // ← no `permissions`
} } }
```

### 2.4 Why this makes "View only" do nothing

Traced through the client with the real response shape:

```
server row.permissions            = undefined
  ↓ normalizeCaregiverPermissions(undefined)
  = { allowedModules: null, accessLevel: 'full' }
  ↓
canMarkDone = true
canEdit     = true      ← add / edit / delete buttons all render
```

The client is behaving **exactly as specified**: `absent → full access` is the
deliberate legacy rule from
`CAREGIVER-PERMISSIONS-backend-requirements.md` §1, so caregivers connected
before this feature do not silently lose access. A server that sends nothing is
indistinguishable from a legacy caregiver.

> The `PATCH .../permissions` route exists and presumably writes something — but
> since the `GET` never returns it, the app can never read it back. Whatever it
> stores is currently write-only.

---

## 3. The fix — three changes

### 3.1 `GET /api/family/:memberId/connected-caregivers` — return it

**This one alone makes existing restrictions take effect.** Highest priority.

```js
...connected.map((c) => {
  const u = userById.get(String(c.userId));
  return {
    id: c.userId,
    userId: c.userId,
    name: u?.name || null,
    email: u?.email || null,
    avatarUrl: u?.avatarUrl || null,
    role: 'caregiver',
    connectedAt: c.connectedAt || null,
    permissions: c.permissions ?? null,      // ← ADD THIS
  };
}),
```

**Owner rows: leave `permissions` off entirely** (or `null`). The client already
treats the owner as unrestricted and ignores the field for them.

**`null` for a caregiver with nothing stored is correct** — the client
normalises it to full access, which is the intended legacy behaviour.

### 3.2 `POST .../connected-caregivers/invite` — accept and store it

```js
const emailRaw = (req.body?.email || '').toString().trim().toLowerCase();
const permissions = req.body?.permissions ?? null;   // ← ADD

// validate before storing (see §3.4), then persist on the invite document:
//   { ...invite, permissions }
```

### 3.3 `POST /api/caregiver-invites/:inviteId/accept` — copy it across

```js
{ $push: { connectedCaregivers: {
    userId: requesterId,
    role: 'caregiver',
    connectedAt: new Date(),
    permissions: invite.permissions ?? null,   // ← ADD
} } }
```

### 3.4 Validation (both write paths)

```ts
accessLevel ∈ { 'view', 'mark_done', 'full' }
allowedModules === null  OR  an array of valid FamilyFeatureKey strings
```

Valid module keys (20):
`medicines`, `appointments`, `bills`, `health`, `emergency`, `routine`,
`subscriptions`, `expenses`, `tasks`, `checkin`, `travel`, `stock`, `diet`,
`insurance`, `custom`, `fitness`, `study`, `wellness`, `vehicles`,
`homeMaintenance`

Anything else → **`400`**. Never store an unrecognised value, and never treat it
as "allow".

---

## 4. The exact payload the app sends

Already shipping. `lib/family-caregivers.ts`:

**On invite** — `POST /api/family/:memberId/connected-caregivers/invite`

```jsonc
{
  "email": "romil@example.com",
  "permissions": {
    "allowedModules": ["health", "checkin"],   // or null = all modules
    "accessLevel": "view"                       // 'view' | 'mark_done' | 'full'
  }
}
```

**On edit** — `PATCH /api/family/:memberId/connected-caregivers/:caregiverUserId/permissions`

```jsonc
{
  "allowedModules": ["health", "checkin"],
  "accessLevel": "view"
}
```

**What the app expects back** from `GET .../connected-caregivers`:

```jsonc
[
  { "id": "...", "userId": "...", "name": "Raghav", "role": "owner",
    "connectedAt": "..." },
  { "id": "...", "userId": "...", "name": "Romil", "role": "caregiver",
    "connectedAt": "...",
    "permissions": {                       // ← the only addition
      "allowedModules": ["health", "checkin"],
      "accessLevel": "view"
    } }
]
```

---

## 5. Access-level semantics (for reference)

| Level | Read | Mark reminders done | Add / edit / delete |
|---|---|---|---|
| `view` | ✅ | ❌ | ❌ |
| `mark_done` | ✅ | ✅ | ❌ |
| `full` | ✅ | ✅ | ✅ |

`allowedModules: null` = all modules. An array = only those modules.

Both dimensions are independent: a caregiver can be `full` on two modules, or
`view` on all of them.

---

## 6. How to verify the fix

Setup: owner **A**, member **M** (modules: Medicines, Health, Appointments,
Check-in). Caregiver **B** connected to M.

| # | Step | Expected |
|---|---|---|
| 1 | A sets B to `view`, all modules. `GET .../connected-caregivers` as A | B's row includes `"permissions": { "allowedModules": null, "accessLevel": "view" }` |
| 2 | Same call — owner row | **no** `permissions` key (or `null`) |
| 3 | A invites C with `permissions` in the body; C accepts; `GET .../connected-caregivers` | C's row carries the permissions from the invite |
| 4 | A sets B to `full` + `["health"]`; `GET` again | `allowedModules: ["health"]` returned |
| 5 | A caregiver connected **before** this change | `permissions: null` → still full access, nothing revoked |
| 6 | Invite with `accessLevel: "banana"` | **400**, not stored |
| 7 | Invite with `allowedModules: ["notamodule"]` | **400**, not stored |

**Step 1 is the whole fix.** If B's row comes back with `permissions`, the app
will immediately start respecting it — no client release needed.

Then the end-to-end enforcement checks (a `view` caregiver getting `403` on
`POST /api/family/M/checkins`, etc.) become meaningful, since the server will
finally know what B's level is. Those are listed in
`CAREGIVER-PERMISSIONS-backend-requirements.md` §9.

---

## 7. Why no client change is needed

The app already:

- sends `permissions` on invite and via `PATCH`,
- reads `permissions` off each caregiver row,
- normalises absent/null → full access (legacy-safe),
- hides add/edit/delete and disables completion toggles by level,
- filters the member dashboard to `allowedModules`.

It is all shipping and typechecked. The only thing missing is the server
returning the field, so §3.1 unblocks it end to end.

---

## 8. One unrelated item, same endpoint family

`GET /api/family` still does not return `dateOfBirth` or `bloodGroup`
(`FAMILY-MEMBER-AGE-BLOOD-GROUP-backend-requirements.md` §3.3). Still blocking:
Age shows a placeholder and Blood Group appears not to save whenever a member is
opened on a device that did not create them.

On `features` in that same response — please return `null` or omit it when
unset, rather than `{}`. An empty object is indistinguishable from "never
configured", which caused a phantom-module bug on our side this week. An empty
**array** is fine and meaningful.
