# Family Hub Records — Server Persistence (Phase 1)

**From:** frontend
**Date:** 2026-07-31
**Status:** Frontend complete and working. This is the missing backend half.
**Relates to:** §4.1 of `FAMILY_REMINDERS_BACKEND_SPEC.md` — this is that phase,
respecified now that edit exists and the gap is user-visible.

---

## 1. Why this is now urgent

Family Hub records have always been **device-only** (AsyncStorage, 32 call
sites, zero network calls in `lib/family-records.ts`). That was tolerable while
the app only added and deleted them.

Two recent changes made the gap visible to users:

1. **Edit shipped** (2026-07-31) — all 10 Family Hub features now support
   editing a record.
2. **Reminders sync** — family reminders come from the server now
   (`GET /api/reminders/family`), so the *reminder* is multi-device while the
   *record behind it* is not.

The result is a contradiction the user can see:

> A reminder created on the phone shows up on the tablet. Editing or completing
> it on the tablet changes nothing, because the record only exists on the phone.

Plus the long-standing one: **reinstall the app and every family record is
gone.** Appointments, medicine schedules, routines — all of it.

---

## 2. What the client does today

`lib/family-records.ts` is the entire data layer. Per member, per feature, one
AsyncStorage key:

```
@lifewise_family_appointments_<memberId>
@lifewise_family_stock_<memberId>
@lifewise_family_bills_<memberId>
...
```

Each holds a JSON array of records. Every record has `id` (client-generated,
`Date.now() + random`) and `createdAt`.

Operations per feature: `load`, `save`, `add`, `update`, `delete`, and where
applicable a `toggle` for completion.

---

## 3. What to build

Standard CRUD, scoped to `(userId, memberId)`:

```
GET    /api/family/:memberId/records/:kind
POST   /api/family/:memberId/records/:kind
PATCH  /api/family/:memberId/records/:kind/:id
DELETE /api/family/:memberId/records/:kind/:id
```

`:kind` — `appointments`, `stock`, `bills`, `subscriptions`, `tasks`,
`routines`, `checkins`, `travel`, `health`, `documents`, `expenses`,
`emergency`, `caregivers`, `custom`.

### 3.1 Field shapes: copy them, do not retype

**Every field name and type must match the TypeScript interfaces in
`lib/family-records.ts` exactly.** The client parses responses directly into
those types. A renamed field does not throw — it arrives as `undefined` and the
UI renders blank, which is far harder to trace than a hard failure.

The interfaces are the contract. Copy them from the file.

### 3.2 PATCH semantics matter for edit

`PATCH` must **merge**, not replace. The client sends only the fields its form
exposes.

Concretely: the appointment edit form does not expose `notes`, so its patch
omits that field. A replacing `PUT` would wipe a note the user set elsewhere.
The client's local `updateRecord` helper merges for exactly this reason.

**`id` and `createdAt` must be immutable.** Ignore them if present in a patch
body. The client re-applies them locally after merging; the server should do
the same rather than trusting the payload.

### 3.3 Keep client-generated ids

Records already exist on devices with ids like `1785496194477-xdopnzqng`. Accept
them on `POST` rather than issuing new ones.

Two reasons: the migration in §5 would otherwise need an id-remapping table, and
family reminder projections key on `fam:<kind>:<memberId>:<sourceId>` — changing
`sourceId` server-side would orphan every existing reminder and its scheduled
notifications.

Use `(memberId, kind, id)` as the primary key. If you must have server ids,
keep the client id as a unique `client_id` column and tell us, because the
projection must continue to emit the client id as `sourceId`.

### 3.4 Caregiver access

Already fixed per your integration guide §1 — connected caregivers get
read/write on member records. Same rule applies here.

**Completion is a property of the record, not the viewer.** If the owner marks
an appointment complete, the caregiver's copy is complete too. This is the
open question from `FAMILY_REMINDERS_CLIENT_CUTOVER_REPLY.md` §5 and it becomes
concrete here: with server persistence there is one row, so please confirm
there is no per-user completion state anywhere.

---

## 4. Data model

One table per feature, or a single table with a `kind` discriminator and a JSON
payload. Per-feature tables give real constraints and better queries.

```sql
CREATE TABLE family_appointments (
  id          TEXT NOT NULL,              -- client-generated, see §3.3
  user_id     TEXT NOT NULL REFERENCES users(id),
  member_id   TEXT NOT NULL REFERENCES family_members(id) ON DELETE CASCADE,
  doctor_name TEXT NOT NULL,
  specialty   TEXT,
  date        TIMESTAMPTZ NOT NULL,
  location    TEXT,
  notes       TEXT,
  is_follow_up BOOLEAN NOT NULL DEFAULT FALSE,
  completed   BOOLEAN NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (member_id, id)
);
```

`ON DELETE CASCADE` on `member_id` is important: deleting a family member must
take their records with them, or reminders keep firing for someone no longer in
the app.

`updated_at` is new — the client does not have it, but it is needed for §6.

---

## 5. Migration: existing device data must not be lost

Users have real records on their phones right now. A naive "server is the source
of truth" cutover would delete all of it on first sync.

Required sequence:

1. **Client uploads first.** On first launch after the update, the client `POST`s
   every local record it has, preserving ids.
2. **Server accepts idempotently.** A `POST` with an id that already exists
   should be a no-op (or an upsert), not a `409`. Two devices uploading the same
   record must converge, not error.
3. **Then read from the server**, keeping local storage as an offline cache.

We will implement steps 1 and 3. **What we need from you is step 2** — confirm
`POST` is idempotent on `(memberId, kind, id)` before we ship the upload, or the
second device to sync will fail loudly.

---

## 6. Conflict resolution

Two devices editing the same record offline will conflict.

**Proposal: last-write-wins on `updated_at`.** Not perfect, but right for this
domain — these are personal records with a small number of editors, and the
alternative (merge UI, version vectors) is disproportionate.

The client will send `updated_at` with each patch. Server takes the later
timestamp. Please confirm, or propose otherwise before building.

---

## 7. Scope note

**Do not add server-side conversion, computation, or projection logic here.**
This endpoint stores and returns records verbatim. The reminder projection
(`GET /api/reminders/family`) is the separate, already-built layer that derives
from these — it should read the same rows once they exist server-side, rather
than keeping its own copy.

---

## 8. Priority

**High, and higher than it looks.** This one gap is the root cause of several
separate symptoms already reported:

| Symptom | Root cause |
|---|---|
| Family records lost on reinstall | No server persistence |
| Edit on device A not seen on device B | No server persistence |
| Completing a reminder on one device only | No server persistence |
| Caregiver sees stale record state | No server persistence |

All four close with this one piece of work.
