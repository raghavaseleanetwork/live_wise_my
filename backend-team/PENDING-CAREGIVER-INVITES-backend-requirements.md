# Pending Caregiver Invites — Backend Requirements

**Created:** 2026-08-19
**Status:** 🔴 Not implemented — verified against the deployed API
**Priority:** High — this is a live, client-reported bug
**Frontend:** ✅ Complete and shipped. It activates automatically when this endpoint goes live. No client release is required.

---

## 1. The reported bug

> "Whenever I add a member to any family, the newly added member's name does not
> appear in the family member list. The member should be displayed in the list
> with a 'Pending' status until they accept the invitation."

An owner invites a caregiver by email. The invite is created successfully and a
success message is shown — then the person **completely disappears**. They are
nowhere in the UI until they accept.

From the owner's point of view the invite silently failed. In practice they
re-invite the same person repeatedly, because nothing on screen suggests the
first attempt worked.

---

## 2. Root cause

`GET /api/family/:memberId/connected-caregivers` returns **only accepted**
caregivers. There is **no endpoint that returns outgoing pending invites for a
member**, so the client has no way to display them.

Verified against the deployed API (`lifewise-backend-5u6n.onrender.com`) on
2026-08-19. `401` means the route exists but needs auth; `404` means it does not
exist at all:

| Endpoint | Status | Meaning |
|---|---|---|
| `GET /api/family/:id/connected-caregivers` | **401** | ✅ Exists — accepted only |
| `GET /api/caregiver-invites` | **401** | ✅ Exists — **incoming** invites (invites addressed to me) |
| `GET /api/family/:id/connected-caregivers/invites` | **404** | ❌ **Missing — this is the gap** |
| `GET /api/family/:id/caregiver-invites` | **404** | ❌ Missing |
| `GET /api/family/:id/pending-caregivers` | **404** | ❌ Missing |

### The direction that is missing

There are two opposite questions, and only one is currently answerable:

- **Incoming** — "who has invited *me*?" → `GET /api/caregiver-invites` ✅ exists
- **Outgoing** — "who have *I* invited?" → ❌ **does not exist**

The invite records already exist in the database (the incoming endpoint reads
them). They simply cannot be queried from the owner's side. This is very likely
a **read endpoint over existing data**, not a new data model.

---

## 3. What to build

### `GET /api/family/:memberId/connected-caregivers/invites`

Returns outstanding invites the owner has sent for this family member.

**Auth:** required.

**Authorisation:** the requester must be the **owner** of `:memberId`.
A caregiver must not see who else has been invited — that is the owner's
information, and invitee email addresses are personal data. Return `403` for a
non-owner.

**Response — `200 OK`:**

```json
[
  {
    "id": "inv_a1b2c3",
    "memberId": "665f...",
    "memberName": "Papa",
    "memberAvatarUrl": null,
    "invitedByName": "Raghav",
    "invitedByEmail": "raghav@example.com",
    "inviteeEmail": "sister@example.com",
    "status": "pending",
    "createdAt": "2026-08-19T11:02:33.000Z"
  }
]
```

This is the **exact same `CaregiverInvite` shape** already returned by
`GET /api/caregiver-invites` and by the invite POST. Please reuse the existing
serialiser rather than writing a new one — the client parses both with one type.

**Only return `status: "pending"`.** Accepted invites must not appear here; the
person is already in `connected-caregivers` and would otherwise be rendered
twice. Declined and expired invites should also be excluded.

Return `[]` (not `404`) when there are no pending invites.

**Errors:**

| Code | When |
|---|---|
| `401` | No/invalid token |
| `403` | Requester is not the owner of `:memberId` |
| `404` | `:memberId` does not exist |

---

## 4. Frontend status — already done

No client work is pending. Shipped 2026-08-19:

- `lib/family-caregivers.ts` — new `loadPendingCaregiverInvites(memberId, token)`.
- `app/family-caregivers/[memberId].tsx` — fetches both lists in parallel and
  renders pending rows with an amber **"Pending"** badge and the subtitle
  *"Invited — waiting for them to accept"*.
- Empty state now checks **both** lists, so a member with only an outstanding
  invite no longer renders as "no caregivers".
- `pendingBadge` / `pendingSubtitle` translated into all 7 locales.

### It is safe to deploy in any order

`loadPendingCaregiverInvites` **swallows `404` and resolves to `[]`**. Until this
endpoint exists the screen behaves exactly as it does today — no error, no
crash, no empty-state regression. **The moment the route goes live, pending rows
appear with no app update.**

Only `404` is swallowed. A `500` or network failure still surfaces, so a broken
endpoint is never silently indistinguishable from "no invites".

The client also defensively filters to `status === 'pending'`, so if the
endpoint is ever widened to all statuses, accepted caregivers still will not be
duplicated. Please still filter server-side — the client filter is a safety net,
not the contract.

---

## 5. How to verify

1. Owner invites `someone@example.com` as a caregiver for member "Papa".
2. `GET /api/family/<papaId>/connected-caregivers/invites` returns one row,
   `status: "pending"`, `inviteeEmail: "someone@example.com"`.
3. **In the app**, that email now appears in the caregiver list with a
   **"Pending"** badge. ← *this is the reported bug, fixed*
4. The invitee accepts.
5. The row **disappears** from `/invites` and appears in
   `/connected-caregivers` instead. It must never be in both — that would
   render the person twice.
6. A **non-owner** caregiver calling `/invites` gets `403`.

---

## 6. Related open items

- **Invite email.** `server/templates/caregiver-invite-email.html` exists, but no
  status report has confirmed the send call is wired. If the email never goes
  out, "Pending" will be permanent for anyone who is not told out-of-band.
  Worth confirming alongside this work.
- **Revoking an invite.** Not in scope here and not requested by the client, but
  once pending invites are visible, "cancel this invite" is the obvious next
  ask. A `DELETE .../connected-caregivers/invites/:inviteId` would cover it.
  Flagging so it can be planned, not built now.

---

## 7. Note on this repo

`server/routes.ts` in the frontend repo is **stale** relative to the deployed
backend — grepping it for `connected-caregivers` returns nothing even though
those routes are live and returning `401`. Please treat the **deployed API** as
the source of truth, not this checkout. Probing endpoints directly
(`401` = exists, `404` = missing) is the reliable check; this has caused
incorrect "the route does not exist" reports before.
