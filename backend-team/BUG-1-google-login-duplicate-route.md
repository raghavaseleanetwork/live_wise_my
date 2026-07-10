# Bug #1 — Google Login: duplicate route cleanup

**Audience:** Backend team
**File to edit:** `server/routes.ts`
**Status:** Frontend part is fixed (real Google OAuth client IDs are now configured). This is a small, safe cleanup — not a functional bug, since Express only ever runs the first match.

---

## What's there

`server/routes.ts` has the **same route registered twice**:

- **Line 911** — `app.post('/api/auth/oauth/google', ...)` — this one actually runs. Verifies the Google ID token via `https://oauth2.googleapis.com/tokeninfo`, looks up/creates the user in the `users` collection, issues a JWT.
- **Line 1082** — `app.post('/api/auth/oauth/google', ...)` — dead code. Express matches routes in registration order, so this second handler **never executes**. It has slightly different logic (uses `emailVerified`/`googleSub` field names instead of the first one's `avatarUrl`/`googleId`), which is a little concerning — it suggests two different people wrote a Google login route at different times without noticing the other already existed.

## The fix

Delete the second handler (`server/routes.ts`, the `app.post('/api/auth/oauth/google', ...)` block starting at line 1082, ending right before `app.post('/api/auth/oauth/apple', ...)`). Keep the first one (line 911) — it's the one actually running and already tested working end-to-end (real client IDs confirmed working from the frontend as of this doc).

No other changes needed. This is purely dead-code removal — deleting it will not change any behavior, since it never ran.

## How to verify

1. Confirm only one `/api/auth/oauth/google` route remains in the file (`grep -n "oauth/google" server/routes.ts` should show exactly one `app.post` line).
2. Google login should continue to work exactly as it did before — nothing observable changes, since the deleted code was unreachable.
</content>
