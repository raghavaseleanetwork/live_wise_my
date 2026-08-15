# Connected Caregiver System — Backend Requirements (v2, authoritative)

**Audience:** Backend team
**Status (updated 2026-08-14): BUILT AND VERIFIED BY BACKEND.** All 7 endpoints
below are implemented in `server/routes.ts` at the `connected-caregivers` path
and were verified end-to-end against the shared MongoDB. The sync push now
fires from every record-mutation route (all 12 record types, plus
adjust-stock and emergency-log), not only medicines.

Two follow-ups accepted from the backend's status report, both handled
frontend-side — no backend action needed:
- Their `DELETE /api/family/:id` returns `404` (not `403`) when a non-owner
  attempts member deletion. Confirmed harmless: `deleteMember` in
  `app/family.tsx` does not branch on status, and the delete control is
  already hidden for shared members.
- Their `caregiver-invite-accepted` push type is not in the client's switch,
  but their payload includes `route: '/caregiver-invites'`, which the generic
  fallback handler in `app/_layout.tsx` routes correctly.

**Remaining backend item:** the invite email in §3.2 step 6 / §4.4 (template
already in `server/templates/caregiver-invite-email.html`). The status report
did not mention it — please confirm whether it is wired.

**Updated 2026-08-14:** added §3.2 step 6 and §4.4 — the invite endpoint must
also send an email to the invitee, not just a push notification. This was a
direct client requirement ("I want that user to also receive an email that
this person wants to add you to the family"). A ready-to-use HTML template
(`server/templates/caregiver-invite-email.html`) has been added to the repo;
the backend team only needs to wire the send call using the existing
`sendReminderEmail()` Resend helper, no new infra.

**This document replaces `CAREGIVER-SYSTEM-backend-requirements.md`.** That
doc had the invite/remove routes at the wrong path
(`/api/family/:memberId/caregivers/...`); the shipped app calls
`/api/family/:memberId/connected-caregivers/...` (confirmed by reading
`lib/family-caregivers.ts` directly). Build from this doc, not the old one.

---

## 1. Background — what this feature is

Today, a family member (e.g. "Papa") belongs to exactly one LifeWise account —
the `userId` on the `family_members` document. Nobody else can see Papa, get
his reminders, or mark his tasks done.

**Requirement:** the person who added Papa (the "owner") can invite other
LifeWise users (e.g. a sibling) as **caregivers** for Papa. Once accepted:

- The caregiver sees Papa in their own Family Hub, marked "Shared".
- The caregiver receives the same reminders, bill alerts, and medicine alerts
  as the owner.
- If the caregiver (or the owner) marks a reminder/medicine done, it updates
  for everyone connected to Papa.
- Either side can be removed later; the owner has extra control (can remove
  any caregiver), a caregiver can only remove themselves.

This is a **flat, full-access role model** — every accepted caregiver gets the
same permissions (receive alerts, mark done, view the member). There is no
view-only or partial-access tier; that was evaluated against the client's
requirement and against the fuller product PRD and explicitly descoped for
this phase.

**Explicitly out of scope for this document** (tracked separately, do not
build as part of this):
- Server-side persistence of the family member's actual records (appointments,
  medicines, bills, etc.) — those still live in on-device AsyncStorage. See
  `FAMILY_RECORDS_CAREGIVER_SHARING_BACKEND_SPEC.md` for that (much larger)
  effort. This doc only covers the *linking* layer — who is connected to whom,
  and getting notifications/mark-done status to reach all of them.
- Socket.IO real-time rooms. Use the push-triggered-refetch approach in §5
  below.
- Any permission tier beyond flat owner/caregiver.

---

## 2. Schema changes

### 2.1 `family_members` collection — add a `caregivers` array

```ts
// existing document, add this field:
{
  _id: ObjectId,
  userId: string,       // unchanged — the OWNER's account id
  name: string,
  relationship: string,
  avatarUrl: string | null,
  dateOfBirth: string | null,
  features: ...,
  medicines: [...],
  createdAt: Date,

  // NEW:
  caregivers: [
    {
      userId: string,        // the caregiver's LifeWise account id
      role: 'caregiver',      // owner is implicit via `userId` above, not stored here
      connectedAt: Date,
    },
  ],
}
```

Owner is still `userId` (unchanged, no migration needed for existing
documents — just treat a missing/empty `caregivers` array as "no caregivers
yet", same pattern already used for `features`).

### 2.2 New collection: `caregiver_invites`

```ts
{
  _id: ObjectId,
  memberId: ObjectId,       // ref to family_members._id
  memberName: string,        // denormalized for display, snapshot at invite time
  memberAvatarUrl: string | null,
  invitedByUserId: string,
  invitedByName: string,     // denormalized
  invitedByEmail: string,    // denormalized
  inviteeEmail: string,      // lowercased, trimmed — the person being invited
  status: 'pending' | 'accepted' | 'declined',
  createdAt: Date,
  respondedAt: Date | null,
}
```

Why a separate collection instead of embedding invites in `family_members`: an
invitee may not have created their LifeWise account yet, or the lookup needs
to happen by email across all members system-wide (see
`GET /api/caregiver-invites` below) — a dedicated collection makes that a
single indexed query instead of a full collection scan.

**Index needed:** `{ inviteeEmail: 1, status: 1 }` for the invite-inbox
lookup, and `{ memberId: 1 }` for per-member invite listing.

---

## 3. New REST endpoints

All routes use the existing `authMiddleware` pattern (reads
`Authorization: Bearer <token>`, sets `req.userId`/`req.userEmail`), same as
every other `/api/family/*` route already in `server/routes.ts`.

**Path segment is `connected-caregivers`, not `caregivers`** — this is the
correction from the superseded doc. Verified directly against
`lib/family-caregivers.ts`, the module every caregiver screen in the app
calls through.

### 3.1 `GET /api/family/:memberId/connected-caregivers`

Returns everyone connected to a member — the owner plus all accepted
caregivers, so the frontend can render one unified list.

**Auth check:** requester must be the owner OR an accepted caregiver of this
member (403 otherwise).

Response `200`:
```json
[
  { "id": "<ownerUserId>", "userId": "<ownerUserId>", "name": "Raghav", "email": "raghav@...", "avatarUrl": null, "role": "owner", "connectedAt": "2026-01-01T00:00:00Z" },
  { "id": "<caregiverUserId>", "userId": "<caregiverUserId>", "name": "Priya", "email": "priya@...", "avatarUrl": null, "role": "caregiver", "connectedAt": "2026-07-10T00:00:00Z" }
]
```

Matches the `Caregiver` type in `lib/family-caregivers.ts` exactly:
`{ id, userId, name, email, avatarUrl?, role: 'owner'|'caregiver', connectedAt }`.

Note `name`/`email`/`avatarUrl` for the owner and each caregiver come from the
`users` collection — join/lookup by `userId`, don't trust anything cached on
`family_members` for this.

### 3.2 `POST /api/family/:memberId/connected-caregivers/invite`

Body: `{ "email": "priya@example.com" }`

**Auth check:** requester must be the owner (`family_members.userId ===
req.userId`). **403** if a caregiver (not owner) tries to invite someone else
— matches the "owner has extra control" permission model, and matches the
client-side error branch in `app/family-caregivers/add.tsx` which maps a 403
to "only the owner can invite."

Logic:
1. 404 if member not found / not owned by requester.
2. **400** if `email` missing/invalid, or if `email` matches the owner's own
   account email (can't invite yourself) — the client maps 400 specifically
   to "you can't invite yourself," so keep this the self-invite case, not a
   generic validation catch-all.
3. **409** if that email is already an accepted caregiver, or already has a
   `pending` invite for this member — the client maps 409 to "already
   connected."
4. Insert a `caregiver_invites` document with `status: 'pending'`.
5. **Send a push notification** to the invitee if they already have a
   LifeWise account and a registered push token (reuse the existing
   `pushTokens` + Firebase messaging pattern already used elsewhere in
   `server/routes.ts` for reminder pushes). Payload contract (§4 below):
   `{ type: 'caregiver-invite' }`. If the invitee has no account yet, the
   invite just sits pending; when they eventually sign up with that email, it
   should show up in their invite inbox (see 3.4).
6. **Send an invite email to `inviteeEmail`, always** (regardless of whether
   the invitee already has a LifeWise account or a push token) — this is a
   **client-required addition**: the client's original complaint was that an
   invited caregiver only ever saw an in-app/push notification and never
   received anything in their inbox confirming "X wants to add you to Y's
   care team." Unlike the push in step 5, this does not depend on the
   invitee already being a registered user with a token — email is the one
   channel that reaches them either way. See §4.4 for the exact template and
   send contract. This must not block the `201` response — send it the same
   fire-and-forget way `sendReminderEmail` is already called elsewhere in
   `server/routes.ts` (i.e. do not `await` it in a way that fails the
   request if Resend errors).

Response `201`: the created invite document (same shape as 3.4 list items).

### 3.3 `DELETE /api/family/:memberId/connected-caregivers/:caregiverUserId`

Removes a connected caregiver.

**Auth check:**
- If requester is the owner: can remove any caregiver.
- If requester is a caregiver: can only remove themself
  (`caregiverUserId === req.userId`), 403 otherwise.
- Owner cannot be removed via this route (there's no "remove owner" — that's
  member deletion, a separate existing flow).

Logic: `$pull` the matching entry from `family_members.caregivers`. 404 if
member not found or caregiver not in the array.

Response `200`: `{ "ok": true }`

### 3.4 `GET /api/caregiver-invites`

Returns pending invites addressed to the **current logged-in user's email**
(`req.userEmail`), across all family members/owners — this is the invite
inbox shown at `app/caregiver-invites.tsx`.

Query: `caregiver_invites.find({ inviteeEmail: req.userEmail.toLowerCase(),
status: 'pending' })`.

Response `200`:
```json
[
  {
    "id": "<inviteId>",
    "memberId": "<memberId>",
    "memberName": "Papa",
    "memberAvatarUrl": null,
    "invitedByName": "Raghav",
    "invitedByEmail": "raghav@...",
    "inviteeEmail": "priya@...",
    "status": "pending",
    "createdAt": "2026-07-16T00:00:00Z"
  }
]
```

Matches the `CaregiverInvite` type in `lib/family-caregivers.ts` exactly.

### 3.5 `POST /api/caregiver-invites/:inviteId/accept`

**Auth check:** `invite.inviteeEmail === req.userEmail.toLowerCase()`, 403
otherwise. 404 if invite not found or not `pending`.

Logic (should be a transaction / ordered so it can't half-apply):
1. Push `{ userId: req.userId, role: 'caregiver', connectedAt: new Date() }`
   into the target `family_members.caregivers` array (skip if already
   present, to be safe against double-accepts).
2. Set the invite's `status = 'accepted'`, `respondedAt = new Date()`.
3. Optionally notify the owner ("Priya accepted your caregiver invite for
   Papa") via the same push pattern — no specific `type` is required by the
   client for this one since it's informational only, a generic route-based
   payload (`{ route: '/family' }`) is enough per the fallback handler in
   `app/_layout.tsx`.

Response `200`: `{ "ok": true }`

### 3.6 `POST /api/caregiver-invites/:inviteId/decline`

Same auth check as 3.5. Sets `status = 'declined'`, `respondedAt = new
Date()`. No changes to `family_members`.

Response `200`: `{ "ok": true }`

### 3.7 `GET /api/family/shared-with-me`

Returns every family member where the current user is a connected caregiver
(not the owner) — this is what the frontend merges into the Family Hub list
alongside the user's own `GET /api/family` results (see `app/family.tsx` and
`lib/use-family-reminders.ts`, both already do this merge and tag shared rows
`isSharedWithMe: true` client-side).

Query: `family_members.find({ 'caregivers.userId': req.userId })`.

Response shape: **same as `GET /api/family`**, i.e.
`{ id, name, relationship, avatarUrl, features, medicines }[]` — no extra
fields needed; the frontend infers "shared" from which endpoint returned it.

**Important — also fix while touching this:** `GET /api/family` must include
the `features` field in its response (it's already stored, just check it's in
the projection). Since `shared-with-me` is new code following the same
mapping, make sure **both** endpoints include `features` — otherwise a
caregiver's dashboard won't know which modules to show for a shared member.

---

## 4. Push notification payload contracts

The client already has a generic push router in `app/_layout.tsx` that
switches on `data.type`. These are the exact shapes it understands for this
feature — sending anything else means the notification arrives but the tap
does nothing useful (falls through to a generic "open notifications list").

### 4.1 Caregiver invite received

```json
{ "type": "caregiver-invite" }
```
No other fields are read. Tapping it opens `/caregiver-invites` (the inbox).
Send this from §3.2 step 5.

### 4.2 Cross-caregiver mark-done sync (silent)

```json
{ "type": "sync", "memberId": "<memberId>" }
```

Must be sent as a **silent / data-only push (no visible alert, no sound)** —
the client's `addNotificationReceivedListener` in `app/_layout.tsx` treats
receipt of `type: 'sync'` as "refetch this member's data now" via
`emitCaregiverSync(memberId)` (see `lib/caregiver-sync.ts`), not as something
to show the user. A visible alert here would read as a duplicate/spurious
notification.

**When to send it:** whenever a mark-done mutation happens on a shared member
— e.g. `PATCH /api/family/:memberId/medicines/:medId` — send this to every
*other* connected caregiver (owner + accepted caregivers, excluding whoever
just made the change). This is the "minimum viable" real-time sync approach;
it reuses existing push infrastructure, no new transport needed. Do this for
every route that mutates a shared member's mark-done/status field, not just
medicines.

### 4.3 Reminder/bill/medicine push fan-out

Every place the server currently does "look up the one owning user and push
to their devices" needs to become "look up the owner **and all accepted
caregivers**, push to all of them."

Concretely, in `server/routes.ts`:
- **Medicine reminder scheduler**: currently does
  `const user = await users.findOne({ _id: toId(member.userId) })` then
  pushes to that one user's tokens. Change to: build a list of recipient user
  ids = `[member.userId, ...member.caregivers.map(c => c.userId)]`, look up
  push tokens for all of them (`pushTokens.find({ userId: { $in:
  recipientIds } })`), and send to all.
- **Bill reminders**: same change — same single-owner pattern today, needs
  the same recipient-list fan-out.
- Any other scheduled job that resolves "the user for this family member"
  should use the same recipient-list helper. Suggest writing one small shared
  helper, e.g. `getRecipientUserIds(member): string[]`, and using it
  everywhere instead of duplicating the `[owner, ...caregivers]` logic per
  scheduler.

These existing push types (`type: 'reminder'`, `'family-reminder'`,
`'medication'`) already have working client-side handlers — no new payload
shape needed for them, just send to more recipients.

### 4.4 Caregiver invite email (new — client requirement)

**Why:** the client explicitly asked for this. Today an invited caregiver
only gets an in-app/push notification; if they don't have the app open (or
don't have a LifeWise account/push token yet), they never find out someone
wants to add them. Email is the reliable channel that reaches them either
way — required regardless of push/account status.

**No new email infrastructure needed.** This server already sends
transactional email via Resend for bill reminders and OTP verification
(`sendReminderEmail()` / `renderReminderEmailTemplate()` in
`server/routes.ts`, gated on `process.env.RESEND_API_KEY`, sent `from:
REMINDER_EMAIL_FROM`). Reuse that exact function and pattern — do not add a
new provider, SDK, or `.env` key.

**Template:** a ready-to-use HTML template has been added at
`server/templates/caregiver-invite-email.html`, matching the visual style of
the existing `server/templates/reminder-email.html` (same header gradient,
card layout, button, footer). It expects a small, generic template-loading
helper — the same pattern `REMINDER_EMAIL_TEMPLATE` already uses for
`reminder-email.html` (read once at startup / lazily, cache in memory). If a
`CAREGIVER_INVITE_EMAIL_TEMPLATE` constant doesn't already exist, add one
next to `REMINDER_EMAIL_TEMPLATE` following the same loading code.

**Placeholders in the template** (replace all with `String.replace(/{{X}}/g,
...)`, same as `renderReminderEmailTemplate`):

| Placeholder | Value |
|---|---|
| `{{INVITER_NAME}}` | `invitedByName` from the invite doc |
| `{{INVITER_EMAIL}}` | `invitedByEmail` from the invite doc |
| `{{MEMBER_NAME}}` | `memberName` from the invite doc |
| `{{INVITEE_EMAIL}}` | `inviteeEmail` from the invite doc |
| `{{APP_URL}}` | same app deep-link/URL constant already used for `renderReminderEmailTemplate`'s `{{APP_URL}}` |

**Send call** — reuse `sendReminderEmail()` as-is (it just takes `to`,
`subject`, `html`; nothing reminder-specific about its implementation):

```ts
const html = renderCaregiverInviteEmailTemplate({
  inviterName: invitedByName,
  inviterEmail: invitedByEmail,
  memberName,
  inviteeEmail,
  appUrl: APP_URL, // same constant used for reminder emails
});
await sendReminderEmail({
  to: inviteeEmail,
  subject: `${invitedByName} invited you to help care for ${memberName} on LifeWise`,
  html,
});
```

Add a `renderCaregiverInviteEmailTemplate()` function mirroring
`renderReminderEmailTemplate()`'s structure (load template string, do the
placeholder replacements from the table above, return `''` if the template
failed to load so the send is skipped the same way reminders already
no-op on a missing template).

**Failure handling:** identical to the existing reminder email — if
`RESEND_API_KEY` is unset, log and skip (do not throw); if the Resend API
call fails, log the error and continue. Never let an email failure affect
the `201` response for the invite itself or roll back the `caregiver_invites`
insert.

---

## 5. Suggested priority order

1. **Schema + the 7 endpoints in §3** — this is the hard blocker; nothing
   else works without it.
2. **§4.4 invite email** — do this alongside §3.2 (the invite endpoint),
   since it's a client-required part of "sending an invite," not a
   follow-up. Trivial once §3's endpoint exists — reuses `sendReminderEmail`
   as-is plus the template already provided.
3. **§4.3 fan-out for existing medicine/bill reminder schedulers** —
   mechanical change to existing functions, do this right after §3 since it's
   small.
4. **§4.2 silent sync push** — only needs wiring into the existing mark-done
   mutation route(s); everything else re-used.

---

## 6. How to verify each piece once built

1. `POST /api/family` as User A → creates Papa.
2. `POST /api/family/<papaId>/connected-caregivers/invite` as User A with
   User B's email → `201`, and confirm a `caregiver_invites` doc exists with
   `status: 'pending'`. **Also confirm User B's email inbox receives the
   caregiver invite email** (§4.4) — check this even if User B has no push
   token registered yet, since email must not depend on that.
3. `GET /api/caregiver-invites` as User B → confirm the invite appears.
4. `POST /api/caregiver-invites/<inviteId>/accept` as User B → `200`.
5. `GET /api/family/shared-with-me` as User B → confirm Papa appears.
6. `GET /api/family/<papaId>/connected-caregivers` as either User A or User B
   → confirm both appear, User A tagged `role: 'owner'`.
7. Trigger (or wait for) the medicine reminder scheduler with a due medicine
   on Papa → confirm both User A and User B's registered push tokens receive
   the notification.
8. `PATCH /api/family/<papaId>/medicines/<medId>` as User B (mark taken) →
   confirm User A receives a silent `{ type: 'sync', memberId: '<papaId>' }`
   push and their app reflects the update on next foreground/refetch.
9. `DELETE /api/family/<papaId>/connected-caregivers/<userBId>` as User A →
   `200`, confirm User B no longer sees Papa via
   `GET /api/family/shared-with-me`.
10. Confirm User B (a caregiver, not owner) gets `403` when calling
    `POST /api/family/<papaId>/connected-caregivers/invite` or
    `DELETE /api/family/<papaId>` (member deletion) — owner-only actions.

**No frontend changes are needed once these routes exist and behave as
specified above** — the app already calls all of them, every screen is built
and waiting (verified directly: `app/caregiver-invites.tsx`,
`app/family-caregivers/[memberId].tsx`, `app/family-caregivers/add.tsx`,
`app/family.tsx`, `lib/family-caregivers.ts`, `lib/caregiver-sync.ts`,
`lib/use-family-reminders.ts`).

---

## 7. Related documents

- `FAMILY_RECORDS_CAREGIVER_SHARING_BACKEND_SPEC.md` — the separate, larger
  effort to make actual family records (appointments, bills, etc.)
  server-persisted and visible to caregivers. Not part of this document's
  scope.
- `CAREGIVER-SYSTEM-backend-requirements.md` — superseded by this document,
  kept for history. Do not build from it; the `connected-caregivers` path
  segment here is correct, its `caregivers` path segment is not.
