> **SUPERSEDED (2026-08-14).** This doc has the invite/remove endpoints at the
> wrong path (`/api/family/:memberId/caregivers/...`). The shipped frontend
> calls `/api/family/:memberId/connected-caregivers/...` instead. Build from
> `CAREGIVER-CONNECTED-SYSTEM-backend-requirements.md` — kept here for
> history only.

# Connected Caregiver System — Backend Requirements

**Audience:** Backend team
**Status:** Frontend is fully built and calling the endpoints described below. Every call currently 404s because none of this exists on the server yet. Nothing will work end-to-end until this is built — this is not a nice-to-have polish item, it's a hard blocker for the "Connected Caregiver" feature to function at all.

---

## 1. Background — what this feature is

Today, a family member (e.g. "Papa") belongs to exactly one LifeWise account — the `userId` on the `family_members` document. Nobody else can see Papa, get his reminders, or mark his tasks done.

**New requirement:** the person who added Papa (the "owner") should be able to invite other LifeWise users (e.g. a sibling) as **caregivers** for Papa. Once accepted:
- The caregiver sees Papa in their own Family Hub, marked as "Shared".
- The caregiver receives the same reminders, bill alerts, emergency alerts, and health notifications as the owner.
- If the caregiver (or the owner) marks a reminder/task done, it updates for everyone connected to Papa.
- Either side can be removed later; the owner has extra control (can remove any caregiver), a caregiver can only remove themselves.

This requires a genuine schema change — family members currently have a single `userId` field, not a list of connected accounts.

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

Owner is still `userId` (unchanged, no migration needed for existing documents — just treat a missing/empty `caregivers` array as "no caregivers yet", same pattern already used for `features`).

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

Why a separate collection instead of embedding invites in `family_members`: an invitee may not have created their LifeWise account yet, or the lookup needs to happen by email across all members system-wide (see `GET /api/caregiver-invites` below) — a dedicated collection makes that a single indexed query instead of a full collection scan.

**Index needed:** `{ inviteeEmail: 1, status: 1 }` for the invite-inbox lookup, and `{ memberId: 1 }` for per-member invite listing.

---

## 3. New REST endpoints

All routes use the existing `authMiddleware` pattern (reads `Authorization: Bearer <token>`, sets `req.userId`/`req.userEmail`), same as every other `/api/family/*` route already in `server/routes.ts`.

### 3.1 `GET /api/family/:memberId/caregivers`

Returns everyone connected to a member — the owner plus all accepted caregivers, so the frontend can render one unified list.

**Auth check:** requester must be the owner OR an accepted caregiver of this member (403 otherwise).

Response `200`:
```json
[
  { "id": "<ownerUserId>", "userId": "<ownerUserId>", "name": "Raghav", "email": "raghav@...", "avatarUrl": null, "role": "owner", "connectedAt": "2026-01-01T00:00:00Z" },
  { "id": "<caregiverUserId>", "userId": "<caregiverUserId>", "name": "Priya", "email": "priya@...", "avatarUrl": null, "role": "caregiver", "connectedAt": "2026-07-10T00:00:00Z" }
]
```
Note `name`/`email`/`avatarUrl` for the owner and each caregiver come from the `users` collection — join/lookup by `userId`, don't trust anything cached on `family_members` for this.

### 3.2 `POST /api/family/:memberId/caregivers/invite`

Body: `{ "email": "priya@example.com" }`

**Auth check:** requester must be the owner (`family_members.userId === req.userId`). 403 if a caregiver (not owner) tries to invite someone else — matches the "owner has extra control" permission model.

Logic:
1. 404 if member not found / not owned by requester.
2. 400 if `email` missing/invalid, or if `email` matches the owner's own account email (can't invite yourself).
3. 409 if that email is already an accepted caregiver, or already has a `pending` invite for this member.
4. Insert a `caregiver_invites` document with `status: 'pending'`.
5. **Send a push notification** to the invitee if they already have a LifeWise account and a registered push token (reuse the existing `pushTokens` + Firebase messaging pattern at `server/routes.ts:3169-3180`) — "Raghav wants to add you as a caregiver for Papa." If the invitee has no account yet, the invite just sits pending; when they eventually sign up with that email, it should show up in their invite inbox (see 3.4).

Response `201`: the created invite document (same shape as 3.4 list items).

### 3.3 `DELETE /api/family/:memberId/caregivers/:caregiverUserId`

Removes a connected caregiver.

**Auth check:**
- If requester is the owner: can remove any caregiver.
- If requester is a caregiver: can only remove themself (`caregiverUserId === req.userId`), 403 otherwise.
- Owner cannot be removed via this route (there's no "remove owner" — that's member deletion, a separate existing flow).

Logic: `$pull` the matching entry from `family_members.caregivers`. 404 if member not found or caregiver not in the array.

Response `200`: `{ "ok": true }`

### 3.4 `GET /api/caregiver-invites`

Returns pending invites addressed to the **current logged-in user's email** (`req.userEmail`), across all family members/owners — this is the invite inbox.

Query: `caregiver_invites.find({ inviteeEmail: req.userEmail.toLowerCase(), status: 'pending' })`.

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

### 3.5 `POST /api/caregiver-invites/:inviteId/accept`

**Auth check:** `invite.inviteeEmail === req.userEmail.toLowerCase()`, 403 otherwise. 404 if invite not found or not `pending`.

Logic (should be a transaction / ordered so it can't half-apply):
1. Push `{ userId: req.userId, role: 'caregiver', connectedAt: new Date() }` into the target `family_members.caregivers` array (skip if already present, to be safe against double-accepts).
2. Set the invite's `status = 'accepted'`, `respondedAt = new Date()`.
3. Optionally notify the owner ("Priya accepted your caregiver invite for Papa") via the same push pattern.

Response `200`: `{ "ok": true }`

### 3.6 `POST /api/caregiver-invites/:inviteId/decline`

Same auth check as 3.5. Sets `status = 'declined'`, `respondedAt = new Date()`. No changes to `family_members`.

Response `200`: `{ "ok": true }`

### 3.7 `GET /api/family/shared-with-me`

Returns every family member where the current user is a connected caregiver (not the owner) — this is what the frontend merges into the Family Hub list alongside the user's own `GET /api/family` results.

Query: `family_members.find({ 'caregivers.userId': req.userId })`.

Response shape: **same as `GET /api/family`**, i.e. `{ id, name, relationship, avatarUrl, features, medicines }[]` — the frontend reuses the exact same rendering code for owned vs. shared members, just tags shared ones with `isSharedWithMe: true` client-side. So just return the normal member shape; no extra fields needed here (the frontend infers "shared" from which endpoint returned it).

**Important — also fix while touching this:** per the existing Phase 5 guide (`FAMILY-HUB-backend-guide.md`), `GET /api/family` is still missing the `features` field in its response even though it's stored (see `server/routes.ts:485-491`). Since `shared-with-me` is new code following the same mapping, make sure **both** `GET /api/family` and `GET /api/family/shared-with-me` include `features` in their response — otherwise a caregiver's dashboard won't know which modules to show for a shared member.

---

## 4. Making reminders/alerts reach every connected caregiver (not just the owner)

This is the core of the feature — without this part, caregivers can see Papa's data but won't get notified, which defeats the purpose.

Every place the server currently does "look up the one owning user and push to their devices" needs to become "look up the owner **and all accepted caregivers**, push to all of them."

**Concretely, in `server/routes.ts`:**

- **Medicine reminder scheduler** (~line 3115-3199): currently does `const user = await users.findOne({ _id: toId(member.userId) })` then pushes to that one user's tokens. Change to: build a list of recipient user ids = `[member.userId, ...member.caregivers.map(c => c.userId)]`, look up push tokens for all of them (`pushTokens.find({ userId: { $in: recipientIds } })`), and send to all.
- **Bill reminders** (~line 2990-3113): same change — same single-owner pattern today, needs the same recipient-list fan-out.
- **Emergency alerts** (if/when built per the Phase 5 guide's §5 — it was flagged there as needing exactly this multi-recipient capability, and this schema now answers the "open question for product" that doc raised: yes, (b) is what's wanted — notify linked caregiver accounts, not just the owner's other devices).
- Any other scheduled job that resolves "the user for this family member" should use the same recipient-list helper. Suggest writing one small shared helper, e.g. `getRecipientUserIds(member): string[]`, and using it everywhere instead of duplicating the `[owner, ...caregivers]` logic per scheduler.

## 5. Real-time "mark done" sync across caregivers

Per product's ask: if one caregiver marks something done, everyone connected should see it update **instantly**, not just on next pull-to-refresh.

Current state: `PATCH /api/family/:memberId/medicines/:medId` (the only server-backed mutate-status route today) updates the shared Mongo doc correctly, but the frontend only re-fetches on screen focus (`useFocusEffect`) — no push-based sync. Two options, pick one:

- **Minimum viable (recommended to start):** no new backend work — send a **silent push notification** (data-only, no visible alert) to all other connected caregivers whenever a mark-done mutation happens, and have the frontend treat receipt of that push as "refetch this member's data now." Reuses the exact same push infrastructure as reminders, so no new real-time transport needed.
- **Fuller solution:** use the Socket.IO server already running in this codebase (currently only used for the support-ticket chat feature, `server/routes.ts` ~lines 351-400) — open a room per `memberId`, join all connected caregivers' sockets to it, and emit an event on every mutation (medicine mark-done, task toggle, bill paid, etc.) so connected clients update live without even a refetch. More work, but matches "instantly" more literally than a push-triggered refetch.

**This document doesn't prescribe which — flagging both so product/backend can decide based on effort budget.** Start with the push-triggered-refetch approach if time is tight; it satisfies the requirement well enough (updates arrive within seconds) without a new real-time subsystem.

---

## 6. Suggested priority order

1. **Schema + the 7 endpoints in §3** — this is the hard blocker; nothing else works without it.
2. **§4 fan-out for existing medicine/bill reminder schedulers** — mechanical change to two existing functions, do this right after §3 since it's small.
3. **§5 real-time sync** — start with the push-triggered-refetch approach; only build the Socket.IO room version if there's time/appetite for it.

## 7. How to verify each piece once built

1. `POST /api/family` as User A → creates Papa.
2. `POST /api/family/<papaId>/caregivers/invite` as User A with User B's email → `201`, and confirm a `caregiver_invites` doc exists with `status: 'pending'`.
3. `GET /api/caregiver-invites` as User B → confirm the invite appears.
4. `POST /api/caregiver-invites/<inviteId>/accept` as User B → `200`.
5. `GET /api/family/shared-with-me` as User B → confirm Papa appears.
6. `GET /api/family/<papaId>/caregivers` as either User A or User B → confirm both appear, User A tagged `role: 'owner'`.
7. Trigger (or wait for) the medicine reminder scheduler with a due medicine on Papa → confirm both User A and User B's registered push tokens receive the notification.
8. `PATCH /api/family/<papaId>/medicines/<medId>` as User B (mark taken) → confirm User A's app reflects the update (via whichever §5 approach was built).
9. `DELETE /api/family/<papaId>/caregivers/<userBId>` as User A → `200`, confirm User B no longer sees Papa via `GET /api/family/shared-with-me`.
10. Confirm User B (a caregiver, not owner) gets `403` when calling `POST /api/family/<papaId>/caregivers/invite` or `DELETE /api/family/<papaId>` (member deletion) — owner-only actions.

No frontend changes are needed once these routes exist and behave as specified above — the app already calls all of them; every screen is built and waiting.
