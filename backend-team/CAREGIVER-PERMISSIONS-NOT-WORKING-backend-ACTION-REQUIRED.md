# 🔴 Caregiver Permissions Are Not Working — Action Required

**Audience:** Backend team
**Date:** 2026-08-17
**Priority:** **HIGH — this is a live privacy hole, not a cosmetic bug**
**Supersedes the status claim in:** `CAREGIVER-PERMISSIONS-backend-STATUS.md`

---

## 0. The report

Tested on a real device today: a caregiver set to **View only** can still
**add, edit and delete** records on the member they are connected to. Setting
restrictions in the app has no effect on what the caregiver can actually do.

This document is what needs to happen server-side to fix it. Please read §1
before anything else — it changes what "fix" means here.

---

## 1. ⚠️ The permissions code is not on `origin/main`

`CAREGIVER-PERMISSIONS-backend-STATUS.md` (received 2026-08-17) reported §1–§7
as **✅ Done**, including a new `server/family-permissions.ts` and enforcement
across all routes.

**None of it is on `origin/main`.** Verified today:

| Checked on `origin/main` | Result |
|---|---|
| `server/family-permissions.ts` exists | ❌ **Not present** |
| `allowedModules` anywhere in `server/routes.ts` | ❌ **0 matches** |
| `accessLevel` anywhere in `server/routes.ts` | ❌ **0 matches** |
| `canAccessModule` / `hasAccessLevel` helpers | ❌ **0 matches** |
| `PATCH .../connected-caregivers/:id/permissions` route | ❌ **Not registered** |

What **is** on `origin/main` — the connection layer, working:

```
GET    /api/family/shared-with-me
GET    /api/family/:memberId/connected-caregivers
POST   /api/family/:memberId/connected-caregivers/invite
DELETE /api/family/:memberId/connected-caregivers/:caregiverUserId
GET    /api/caregiver-invites
POST   /api/caregiver-invites/:inviteId/accept
POST   /api/caregiver-invites/:inviteId/decline
```

So caregivers can be invited and connected — but **every connected caregiver
has unrestricted access**, exactly as before the permissions work.

**Please confirm first:** is the permissions work on an unmerged branch, in a
stash, or on a different remote? If it exists, merging it may be most of the
fix. If it does not, §3 below is the build.

Either way, **the deployed server today has no permission enforcement**, which
is why the app's restrictions do nothing.

---

## 2. Why the app cannot fix this alone

The frontend already:

- lets the owner set `allowedModules` + `accessLevel` per caregiver,
- sends them on invite and via `PATCH .../permissions`,
- hides add/edit/delete buttons and disables completion toggles for
  under-permissioned caregivers,
- filters the member dashboard to permitted modules only.

**But the client is a courtesy, not a gate.** Hiding a button does not stop
anyone calling the API directly, and the client cannot enforce a rule the
server does not know about. Until the server rejects unauthorised calls,
"View only" is a label, not a restriction.

There is also a concrete failure loop right now (§4): the server never returns
what modules a member has, so the app cannot reliably tell a restricted
caregiver what they are allowed to see.

---

## 3. What to build

The full specification is in
**`CAREGIVER-PERMISSIONS-backend-requirements.md`** — schema, routes, the
record-kind → module-key mapping table, and the access-level rules. Please
build from that document; this section is the summary and priority order.

### 3.1 Store the permissions (required first)

On each `family_members.caregivers[]` entry and on `caregiver_invites`:

```ts
permissions: {
  allowedModules: string[] | null,   // null = all modules
  accessLevel: 'view' | 'mark_done' | 'full',
} | null                             // absent = full access (legacy safe)
```

**`null` / absent must mean full access.** Every caregiver connected before
this feature existed has no `permissions` field, and must not lose access.
Restriction is opt-in by the owner.

### 3.2 Return them

`GET /api/family/:memberId/connected-caregivers` must include `permissions` on
each caregiver row. Omit it entirely for the owner. Without this the app cannot
display or edit current permissions.

### 3.3 Accept them

- `POST .../connected-caregivers/invite` — optional `permissions` in the body.
- **NEW** `PATCH /api/family/:memberId/connected-caregivers/:caregiverUserId/permissions`
  — owner-only (`403` for anyone else, **including the caregiver being
  edited** — they must not be able to widen their own access).

Validate both: an unknown module key or access level returns `400`, never
stored, never treated as "allow".

### 3.4 ENFORCE — this is the actual fix

Everything above only stores preferences. **Nothing changes for the user until
the server rejects unauthorised requests.**

For a **caregiver** (never the owner) on any route touching that member:

**Module scoping** — if `allowedModules !== null` and the route's module is not
in the list → **403**. Mapping table is in the requirements doc §6.1; it covers
all 21 record kinds plus `medicines`.

**Access-level scoping:**

| Operation | Minimum level |
|---|---|
| Any `GET` | `view` |
| `PATCH` touching **only** completion/snooze fields | `mark_done` |
| `POST`, `DELETE`, any other `PATCH` | `full` |

Completion/snooze fields: `isPaid`, `completed`, `taken`, `lastDoneAt`,
`completedDates`, `snoozedUntil`, `status`, `acknowledged`. A patch containing
**any** other field requires `full`.

> This is the one to test hardest. A `view` caregiver calling
> `POST /api/family/:id/familyBills` must get **403**, not a created record.

### 3.5 Filter reminders and push

A caregiver must not be notified about a module they cannot see — a push
preview leaks exactly the data the owner restricted.

- `GET /api/reminders/family` — filter rows by the requester's `allowedModules`.
- Push fan-out — include a caregiver only if the module is permitted.
- Snooze/Done notification buttons — omit for `view`-level caregivers, and
  reject the actions server-side regardless of what the client sent.

---

## 4. Separate but related: `GET /api/family` does not return `features`

Currently on `origin/main`:

```js
const out = list.map((m) => ({
  id, name, relationship, avatarUrl, medicines,
  features: m.features || {},        // ← present on origin/main
}));
```

…but the **deployed** server appears not to be returning it, because the app
receives `undefined` for `features` on every member. Please confirm what is
actually deployed.

**Why this matters for permissions specifically:** the app decides which
modules to show a caregiver by intersecting *the member's modules* with *the
caregiver's `allowedModules`*. With no `features` from the server, the app
cannot know the member's real module list for anyone who has not opened that
member on that device — so a restricted caregiver can end up seeing nothing at
all.

**Two asks:**
1. Confirm `features` is deployed on `GET /api/family` (it is in the code on
   `origin/main`, so this may be a deployment lag).
2. Make sure `features` is a **`FamilyFeatureKey[]` array**, not the legacy
   `{ medicines: true, reminders: true }` boolean object. `m.features || {}`
   returning `{}` for a member with no modules is indistinguishable from "no
   data" on the client.

Also still outstanding from
`FAMILY-MEMBER-AGE-BLOOD-GROUP-backend-requirements.md` §3.3: `dateOfBirth`
and `bloodGroup` are missing from the same response.

---

## 5. How we will verify it is fixed

Please run these **against a running server**, not by reading code. The failure
mode here is a route that simply forgot to call the gate — unit tests cannot
catch that.

Set up: owner **A** with member **M** (modules: Medicines, Health,
Appointments, Check-in). Caregiver **B** connected to M.

| # | Set B to | B calls | Expected |
|---|---|---|---|
| 1 | `view`, all modules | `POST /api/family/M/checkins` | **403** |
| 2 | `view`, all modules | `PATCH /api/family/M/checkins/:id` (mark done) | **403** |
| 3 | `view`, all modules | `GET /api/family/M/checkins` | **200** |
| 4 | `mark_done`, all modules | `PATCH .../checkins/:id` (mark done only) | **200** |
| 5 | `mark_done`, all modules | `POST /api/family/M/checkins` | **403** |
| 6 | `mark_done`, all modules | `PATCH .../checkins/:id` (change `label`) | **403** |
| 7 | `full`, `["health"]` only | `GET /api/family/M/checkins` | **403** |
| 8 | `full`, `["health"]` only | `GET /api/family/M/healthLogs` | **200** |
| 9 | any | `PATCH .../connected-caregivers/B/permissions` **as B** | **403** |
| 10 | no `permissions` stored (legacy) | anything | **works as before** — nothing revoked |
| 11 | `full`, `["health"]` | `GET /api/reminders/family` | no check-in rows |

**Step 1 is the reported bug.** If step 1 returns 201, nothing else in this
document has landed.

---

## 6. Priority

1. **§1** — confirm where the permissions code is. This may already be written.
2. **§3.4 enforcement** — the actual fix. Storing fields changes nothing on its own.
3. **§4** — confirm `features` is deployed, as an array.
4. **§3.5** — push/reminder filtering.
5. **§5** — run the 11 checks live before calling it done.

---

## 7. Related documents

- `CAREGIVER-PERMISSIONS-backend-requirements.md` — **the full spec. Build from this.**
- `CAREGIVER-PERMISSIONS-backend-STATUS.md` — the status report whose claims
  could not be verified on `origin/main` (§1 above).
- `CAREGIVER-CONNECTED-SYSTEM-backend-requirements.md` — the connection layer,
  which **is** live and working.
- `FAMILY-MEMBER-AGE-BLOOD-GROUP-backend-requirements.md` §3.3 — the other
  missing fields on `GET /api/family`.
