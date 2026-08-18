# Re: Caregiver Permissions — Frontend Verification & Answers

**Audience:** Backend team
**Date:** 2026-08-18
**Responding to:** `Re: Caregiver Permissions — The Exact Missing Piece — Backend Response` (2026-08-18)

Good find on the `PATCH` leniency bug — that is a much better catch than what
my document reported, and the reasoning for why `parsePermissionsInput`'s
leniency was right for invite but wrong for `PATCH` is exactly right.

Answers to your three action items below, plus one correction to my own §2/§3
that I owe you.

---

## 1. Your action item 2 — our `PATCH` body shape

**We send the flat shape. We are not affected by the wrapped-body bug.**

Verified in `lib/family-caregivers.ts`:

```ts
export async function updateCaregiverPermissions(memberId, caregiverUserId, permissions, token) {
  await apiRequest(
    'PATCH',
    `/api/family/${memberId}/connected-caregivers/${caregiverUserId}/permissions`,
    permissions,              // ← passed directly, not wrapped
    token,
  );
}
```

`apiRequest` does `body: JSON.stringify(data)`, so the wire payload is:

```json
{"allowedModules":["health","checkin"],"accessLevel":"view"}
```

Top-level keys: `allowedModules`, `accessLevel`. No `permissions` wrapper.

Also confirmed there is **exactly one call site** for this endpoint
(`app/family-caregivers/permissions.tsx`), and no other code in the app builds
a permissions request body. So there is no second path that could be sending
the wrapped shape.

**For completeness — our `POST .../invite` body IS wrapped**, which matches
your spec for that endpoint:

```json
{"email":"romil@example.com","permissions":{"allowedModules":["health"],"accessLevel":"view"}}
```

So: wrapped on invite, flat on PATCH. If that is what your two parsers expect,
we are aligned on both.

---

## 2. Correction to my §2/§3 — I was wrong again

My previous document asserted that `GET .../connected-caregivers` does not
return `permissions`, based on reading the route source on `origin/main`. You
tested it live and found it round-trips correctly.

Given that the repo I can see is eight days stale (established in the previous
exchange) while the deploy is current, **your live test is authoritative and
mine was not.** Apologies — that is twice now that I have reported from the
repo rather than the running server, and both times it was misleading.

Going forward I will verify against the deployed API rather than source, since
the two are demonstrably not in sync from where I sit.

---

## 3. What we changed on our side

**Error messages from this endpoint are now shown to the user.**

Previously the permissions screen caught any failure and showed a generic
"Please try again in a moment" — which would have completely hidden your new
`400` and its very specific message. Now it extracts the server's `message`
field and displays it, falling back to the generic string only when there is
no parseable message (e.g. a network failure with no response).

Verified against realistic bodies:

| Server response | Shown to user |
|---|---|
| `400 {"message":"Unrecognised field(s) on permissions update: permissions. Expected allowedModules and accessLevel at the top level…"}` | that full message |
| `400 {"message":"accessLevel is required"}` | `accessLevel is required` |
| `403 {"message":"Forbidden"}` | `Forbidden` |
| `500 Internal Server Error` (plain text) | `Internal Server Error` |
| Network failure, no status | generic fallback |

`tsc` clean.

This matters for your point that a wrongly-shaped call "will now get a clear
400 … but the screen will show an error until the call site is fixed" — if that
ever happens, the user and we will now see *which* error, rather than a generic
retry prompt.

---

## 4. Your action item 3 — the `features: {}` migration

**Yes please, run it.**

Every member created before your fix has `{}` persisted, and `{}` is precisely
the value our client cannot interpret — it is indistinguishable from "never
configured". That ambiguity caused a real user-visible bug on our side this
week (every member's module count displayed one higher than reality, and
restricted caregivers saw an empty dashboard).

Your read-side fix (`m.features ?? null`) will not help those existing members,
because `{}` is not null — it will be returned verbatim.

**Requested:** update members where `features` is an empty object to `null` (or
`$unset`). Legacy members with the real boolean shape
(`{ medicines: true, reminders: true }`) must be **left alone** — our client
already migrates that shape correctly on read, so they are not affected.

Roughly:

```js
db.family_members.updateMany(
  { features: {} },        // exactly empty — not the boolean-shaped ones
  { $unset: { features: "" } }
)
```

Please confirm the filter only matches truly-empty objects before running it.

---

## 5. Your action item 1 — re-running the test table

We will re-run §6 against a fresh deploy. Two notes:

- Steps that exercise the `PATCH` should now pass either way for us, since we
  were already sending the flat shape.
- The more valuable run is now the **enforcement** table from
  `CAREGIVER-PERMISSIONS-backend-requirements.md` §9 — a `view` caregiver
  getting `403` on `POST /api/family/:id/checkins`, etc. That is what the
  original user report was about, and it is only meaningful now that the
  permissions actually persist end to end.

If anything fails there we will send the exact request and response body per
numbered case, as you asked.

---

## 6. Still open, unrelated to this thread

`dateOfBirth` / `bloodGroup` — you report these as present and correct on every
read route. We will re-test against the live API rather than the repo (per §2)
and send you an exact response body if we still see them missing. Treat as
unconfirmed on our side rather than a live defect for now.

---

## 7. Note

This exchange worked well — your live testing found a bug my source-reading
missed, and the specific error message you added turns a silent wrong result
into something diagnosable. Thanks for pushing back on the diagnosis rather
than just implementing what I asked for.
