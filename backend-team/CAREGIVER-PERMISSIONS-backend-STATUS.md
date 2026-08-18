# Caregiver Permissions & Scoped Access — Backend Status

**Audience:** Frontend team
**Received from backend team:** 2026-08-17
**Source doc:** `CAREGIVER-PERMISSIONS-backend-requirements.md` (2026-08-17)

Status against that doc's TL;DR table: **everything is implemented**, §1
through §7.

| # | Work | Status |
|---|---|---|
| 1 | Store `permissions` on each caregiver entry (§2) | ✅ Done |
| 2 | Return `permissions` from `GET .../connected-caregivers` (§3) | ✅ Done |
| 3 | Accept `permissions` on the invite call (§4) | ✅ Done |
| 4 | New `PATCH .../permissions` route (§5) | ✅ Done |
| 5 | Enforce on every read/write (§6) | ✅ Done |
| 6 | Scope reminders/push to permitted modules (§7) | ✅ Done |

New file: `server/family-permissions.ts` — the model, validators, and the
`:kind` → module-key / `sourceKind` → module-key maps, shared by every route
below rather than duplicated per-route.

> ### ✅ Frontend verification on receipt (2026-08-17)
>
> **Contract matches exactly.** Checked the two things that would silently
> break:
>
> | Item | Client | Backend | Match |
> |---|---|---|---|
> | PATCH route path | `/api/family/{id}/connected-caregivers/{uid}/permissions` | same | ✅ |
> | Access levels | `'view' \| 'mark_done' \| 'full'` | same | ✅ |
> | Absent = full access | `normalizeCaregiverPermissions()` | "treats absent/null as full access" | ✅ |
> | Owner rows carry no `permissions` | client special-cases owner | "owner rows never carry `permissions`" | ✅ |
>
> **This is the most important status doc received this week** — §6 was the
> actual feature, and unlike the fields-only work it would have been easy to
> stop short on. It wasn't. Enforcement covers all 21 record kinds plus the
> one-off routes (`adjust-stock`, `emergency-settings`, `emergency-log`,
> `custom-config`, medicines `PATCH`), which is more than the source doc's
> table strictly listed.
>
> Two follow-ups for us, both in §"Frontend action items" at the bottom — one
> is a **real UI bug this surfaces**.

---

## §1–§2: the model, stored as specified

`allowedModules: FamilyFeatureKey[] | null` and
`accessLevel: 'view' | 'mark_done' | 'full'`, stored on each
`family_members.caregivers[]` entry and on `caregiver_invites`, exactly as
specified. **No migration was run or needed** — existing caregiver entries
simply have no `permissions` field, and every enforcement check treats
absent/null as full access. Verified directly: a caregiver with no
`permissions` object is unaffected by any of this work.

> **Frontend note:** this was the single most important thing to get right and
> it's correct. Treating absent as "no access" would have silently cut off
> every caregiver connected before today.

## §3: `GET .../connected-caregivers`

Owner rows never carry `permissions`. Caregiver rows include it only when the
owner has actually stored a restriction — a legacy or never-restricted
caregiver still gets no `permissions` key, matching the client's
absent-means-full normalization.

## §4: `POST .../connected-caregivers/invite`

Accepts an optional `permissions` body field, validated before anything is
written: an unrecognized module key or access level returns `400`, never
silently stored or interpreted as "allow." Stored on the invite; copied onto
the `connectedCaregivers` entry when the invite is accepted.

## §5: `PATCH /api/family/:memberId/connected-caregivers/:caregiverUserId/permissions`

New route, exactly as specified: `200` on success, `400` on an invalid
module/level, `403` for anyone but the member's owner (**including the
caregiver whose own permissions are being changed** — a caregiver cannot
widen their own access by calling this on themselves), `404` if the member
or caregiver isn't found.

> **Frontend note:** the self-escalation case being explicitly handled is the
> one that mattered. Thank you for calling it out rather than leaving it
> implied.

---

## §6: Enforcement — where it actually lives

Two helpers in `server/routes.ts` do the gating:

- `resolveRequesterPermissions(member, requesterId)` — the owner always
  resolves to unrestricted `full`; a caregiver resolves to their stored
  `permissions`, normalized (absent/null → full).
- Every route then calls `canAccessModule(permissions, moduleKey)` for reads
  and `hasAccessLevel(permissions, requiredLevel)` for writes, returning
  `403` on failure.

**Coverage — every route the doc's §6.1 table and §9 verification steps
name:**

- All 21 kinds under `registerFamilyArrayFeature` (the 12 original + 9 added
  for the previously-missing PRD modules) — `GET`/`POST`/`PATCH`/`DELETE`
  all gated. `GET` needs `view`, `POST`/`DELETE` always need `full`, `PATCH`
  needs `mark_done` **only** when the patch body touches nothing but a
  completion/snooze field (`isPaid`, `completed`, `taken`, `lastDoneAt`,
  `completedDates`, `snoozedUntil`, `status`, and — new, not in the source
  doc's list but the same category — `acknowledged`, used by
  `emergencyLog`); any other field in the same patch requires `full`.
- `PATCH .../medicationStock/:itemId/adjust-stock` — module `stock`, `full`
  (adjusting a quantity isn't a completion toggle).
- `GET`/`PUT /emergency-settings` — module `emergency`, `PUT` needs `full`.
- `GET /emergency-log` + `PATCH /emergency-log/:itemId` — module
  `emergency`, `PATCH` needs `mark_done` only for an `acknowledged`-only
  patch, `full` otherwise.
- `GET`/`PUT /custom-config` — module `custom`, `PUT` needs `full`.
- `PATCH /api/family/:memberId/medicines/:medId` (taken/snooze/skip) —
  module `medicines`, `mark_done` (this route never edits the medicine's own
  fields, only completion state, so `mark_done` is always sufficient).
- `GET /api/family/shared-with-me` — §6.3's "consider returning only
  permitted modules in `features`" is done, not just considered: a
  restricted caregiver's `features` object is filtered down to their
  `allowedModules` before it reaches the client.

**One pre-existing gap this doc doesn't create and I didn't expand**:
`POST /api/family/:id/medicines` (creating a new medicine) is, and remains,
owner-only — it queries `{ userId: requesterId }` directly and has no
caregiver path at all today. §6.2's table implies a `full`-level caregiver
should be able to create one; that's not true yet, for anyone, regardless of
permissions. Opening that up would be a separate, real behavior change (it
currently blocks ALL caregivers, not just under-permissioned ones), so I left
it as-is rather than fold it into a permissions PR. Flagging it in case it
matters for the caregiver flow you're building against.

> ### ⚠️ Frontend note — the medicines gap IS a visible bug on our side
>
> Confirmed from here: `app/add-medicine.tsx` posts to
> `POST /api/family/:id/medicines` and is **not gated by permissions at all**.
> So today a connected caregiver — at any access level, including `full` —
> sees the "Add Medicine" button, fills in the whole form, taps save, and gets
> a failure. The form looks broken.
>
> Correct call to keep it out of the permissions PR; agreed it's a separate
> behaviour change. But it needs deciding, because right now the answer is
> "no caregiver can ever add a medicine", which contradicts what our UI offers.
>
> **Two ways to close it, product call needed:**
> 1. **Open it up** — let `full`-level caregivers create medicines, consistent
>    with every other record kind (where `POST` needs `full`). Backend change.
> 2. **Keep it owner-only** — then we hide the Add button for caregivers.
>    Frontend change, and we'd need a rule for why medicines differ from the
>    other 20 modules.
>
> Option 1 is more consistent. Flagging for the client rather than guessing.
> Tracked as frontend action item 2 below.

---

## §7: Reminders and push

- `GET /api/reminders/family` — rows are filtered by the requester's
  `allowedModules` per member before the response is sent (mapped via each
  row's `sourceKind`).
- Push fan-out for both the Family Hub reminder scheduler and the medicine
  dose scheduler now excludes any caregiver not permitted to see that
  module, **before** anything is logged or sent (not filtered after the
  fact).
- Snooze/Done action buttons: within a single reminder's push, recipients
  are split into two groups — `mark_done`+ caregivers get the buttons
  (`categoryId` set), `view`-only caregivers get the same notification with
  no buttons. Belt-and-braces: even if a client somehow rendered a button
  for a `view`-level caregiver, tapping Done calls the same `PATCH`
  route already gated in §6 and gets `403`.

> **Frontend note:** the per-recipient button split is a genuinely nice touch —
> the source doc only asked that view-level caregivers not receive buttons, and
> splitting recipients within one send is the clean way to do it. The `403`
> backstop is the right instinct: the client hides buttons as a courtesy, the
> server is the gate.
>
> Filtering **before** logging (not after) also matters — a filtered-after-send
> implementation would still have written restricted module names into logs.

---

## How to verify

Ran the exact model logic (not the live HTTP routes — see note below)
against `server/family-permissions.ts` directly: legacy/absent permissions
resolve to full access, module scoping and access-level ranking behave as
specified, invalid module/level input is rejected rather than silently
accepted, and mark-done-only vs. full-edit patch detection matches the
doc's field list. All checks passed.

**Not run**: the doc's §9 end-to-end HTTP steps (actual `POST`/`GET`/`PATCH`
calls against a running server with a real invite/accept flow). A dev server
was already running on the configured port during this work and I didn't
want to bounce it out from under whoever has it up — recommend running
through §9's 8 steps against staging before this goes to production traffic,
same as flagged for the record-kind routes work earlier this week.

> **Frontend note:** reasonable, and the unit-level verification is the part
> that catches logic errors. But §9 exists because this is a **privacy
> boundary** — the failure mode isn't a broken screen, it's a caregiver seeing
> data the owner restricted. Unit tests can't catch a route that simply forgot
> to call the gate.
>
> **Step 5 especially** (a caregiver PATCHing their own permissions to widen
> them) should be run live before this reaches production. Please flag when
> staging is free and we'll run the 8 steps together.

---

## Related

Supersedes the flat-role model noted as "explicitly descoped" in
`CAREGIVER-CONNECTED-SYSTEM-backend-requirements.md` §1, per that document's
own §10 reference. The reminder/push filtering in §7 above also affects
`NOTIFICATION-ACTIONS-backend-requirements.md`'s Snooze/Done buttons —
already covered in this build (see §7 above), not a separate follow-up.

---

## Frontend action items (2026-08-17)

| # | Item | Priority |
|---|---|---|
| 1 | **Run §9's 8 end-to-end steps against staging** with the backend team, especially step 5 (self-escalation) | **High** — privacy boundary, not yet live-tested |
| 2 | **Resolve the medicines gap** (§6 note): either backend opens `POST /medicines` to `full` caregivers, or we hide the Add button for caregivers. Currently the button is shown and always fails. | **High** — visible broken flow today |
| 3 | Nothing else — the permission UI, hook, and enforcement gating are built and need no change to work against this backend | ✅ |

**No client changes required for §1–§7 as delivered.** The field names, route
path, access levels, and absent-means-full semantics all match what shipped.
