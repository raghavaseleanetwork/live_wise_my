# Family Member: Age & Blood Group — Backend Requirements

**Audience:** Backend team
**Status:** Frontend is fully built and sending `bloodGroup` on every
create/update of a family member. It currently has no effect — the server
does not read, store, or return this field.
**Client requirement source:** "Add Missing Fields in 'Add Family Member' —
Age, Blood Group" (client bugfix list, logged 2026-08-14).

---

## 1. What changed on the frontend, and why age needs no backend change

Two fields were added to the "Add New Member" / "Edit Member" screens,
positioned directly below Date of Birth:

- **Age** — NOT a new stored field. It's computed client-side from the
  existing `dateOfBirth` (`calculateAge()` in `lib/data.ts`) and displayed
  read-only. There is nothing for the backend to add for Age — it derives
  from a field that already exists in the schema.
- **Blood Group** — a new field. Optional picker, one of 8 standard groups
  (`A+ A- B+ B- AB+ AB- O+ O-`), or left unset. This is the one that needs
  backend work.

## 2. What the frontend now sends

`POST /api/family` and `PUT /api/family/:id` both now include a `bloodGroup`
field in the request body, alongside the existing `name`/`relationship`/
`avatarUrl`/`dateOfBirth`/`features`:

```json
{
  "name": "Papa",
  "relationship": "parent",
  "avatarUrl": null,
  "dateOfBirth": "1958-03-12",
  "bloodGroup": "O+",
  "features": ["medicines", "appointments"]
}
```

- `bloodGroup` is one of the 8 literal strings above, or `null` if the user
  didn't select one. Never an empty string — the client sends `null`.
- This is purely additive. Every other field/behavior of these two endpoints
  is unchanged.

## 3. What to change in `server/routes.ts`

### 3.1 `POST /api/family` (around line 508)

```ts
const { name, relationship, avatarUrl, dateOfBirth, bloodGroup, features } = req.body;
const doc = {
  userId: (req as any).userId,
  name: String(name || 'New Member').trim(),
  relationship: String(relationship || 'other'),
  avatarUrl: avatarUrl || null,
  dateOfBirth: dateOfBirth || null,
  bloodGroup: bloodGroup || null,   // <-- add this line
  features: features || { medicines: true, reminders: true, reports: false },
  medicines: [],
  createdAt: new Date(),
};
```

### 3.2 `PUT /api/family/:id` (around line 529)

```ts
const { name, relationship, avatarUrl, dateOfBirth, bloodGroup, features } = req.body;
const update: any = { updatedAt: new Date() };
if (name !== undefined) update.name = String(name).trim();
if (relationship !== undefined) update.relationship = String(relationship);
if (avatarUrl !== undefined) update.avatarUrl = avatarUrl;
if (dateOfBirth !== undefined) update.dateOfBirth = dateOfBirth;
if (bloodGroup !== undefined) update.bloodGroup = bloodGroup;   // <-- add this line
if (features !== undefined) update.features = features;
```

No validation beyond what's already implicit — treat `bloodGroup` as an
optional free string/null, same trust level as `relationship`. (If you'd
rather validate against the 8-value enum server-side, that's fine too, but
not required — the picker UI already constrains the value client-side.)

### 3.3 `GET /api/family` (around line 490) — must add `bloodGroup` to the response, and while you're here, also add `dateOfBirth`

```ts
const out = list.map((m: any) => ({
  id: m._id.toString(),
  name: m.name,
  relationship: m.relationship || 'self',
  avatarUrl: (m as any).avatarUrl || null,
  dateOfBirth: (m as any).dateOfBirth || null,   // <-- currently MISSING, add this
  bloodGroup: (m as any).bloodGroup || null,      // <-- add this
  medicines: Array.isArray(m.medicines) ? m.medicines : [],
}));
```

**Important finding while writing this doc:** `GET /api/family` does not
currently return `dateOfBirth` at all, even though it's already stored and
both add/edit forms already collect it. This means Edit Family Member's DOB
field, and now the new Age display (which is computed from `dateOfBirth`),
silently show blank every time a member is reopened for editing or the
detail page is revisited — not a regression from this change, a pre-existing
gap this change happens to make newly visible. Please fix `dateOfBirth`
alongside `bloodGroup` in this same response, since both are needed for Age
to render correctly on-screen.

### 3.4 `GET /api/family/shared-with-me` — same fix needed here too

This endpoint (spec'd in
`CAREGIVER-CONNECTED-SYSTEM-backend-requirements.md` §3.7) returns the same
shape as `GET /api/family` for members shared with the current user as a
caregiver. If it's already built, apply the same `dateOfBirth`/`bloodGroup`
fields there. If it isn't built yet, this is just a note to include both
fields when you do.

## 4. No schema migration needed

`family_members` is schemaless (MongoDB) — existing documents simply have no
`bloodGroup` key, which reads back as `undefined`/falls through to `null`
via `(m as any).bloodGroup || null`. No backfill, no migration script.

## 5. Verification

1. `POST /api/family` with `bloodGroup: "AB-"` → `201`, confirm the returned
   doc includes `bloodGroup: "AB-"`.
2. `GET /api/family` → confirm the same member's `bloodGroup` and
   `dateOfBirth` both appear in the list response (not just in the
   single-create response).
3. `PUT /api/family/:id` with `bloodGroup: null` (user cleared the picker) →
   confirm it actually clears to `null`, not left as the old value.
4. `PUT /api/family/:id` with a body that omits `bloodGroup` entirely (e.g. a
   client that only updates `name`) → confirm the existing `bloodGroup` is
   left untouched (the `if (bloodGroup !== undefined)` guard already handles
   this correctly, matching how `dateOfBirth`/`avatarUrl` behave today).
5. Open Edit Member on a member that has both fields set → confirm Age
   displays correctly (proves `dateOfBirth` now round-trips) and the Blood
   Group picker pre-selects the stored value.

## 6. Out of scope

- No new endpoints.
- Age is never sent to or stored by the server — it's a pure frontend
  computation from `dateOfBirth`. Do not add an `age` field.
- No validation/enum enforcement required server-side (optional, see §3.2).
