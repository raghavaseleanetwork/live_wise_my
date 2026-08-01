# Email OTP Verification — Backend Specification

**From:** frontend
**Date:** 2026-07-31
**Status:** Frontend complete. Backend not started — the flow does not work until §3 ships.
**Client decision (2026-07-31):** verification is by **email**, not phone. Google
sign-in must go through OTP as well.

---

## 1. What is broken today

**No OTP is ever sent or asked for.** A user signs up and is immediately logged
in.

The pieces exist but were never connected:

| Piece | State |
|---|---|
| `verify-otp` screen | Existed, fully built — but nothing routed to it |
| `POST /api/auth/verify-otp` | Exists |
| `POST /api/auth/resend-otp` | Exists |
| OTP generator + 10-min expiry store | Exists |
| Email sending (Resend) | Exists and is live — reminder emails use it |
| **`/api/auth/register` sending an OTP** | **Missing** |

Four defects, all server-side except the last:

1. **`/register` returns a JWT immediately** (`server/routes.ts:1006`). The user
   is authenticated before verifying anything.
2. **`/register` never generates or sends an OTP.** No `generateOtp()`, no
   `otpStore` write, no email.
3. **The OTP endpoints key on `phone`**, but registration collects only name,
   email, password. `resend-otp` looks up `users.findOne({ phone })` and 404s.
4. **Field name mismatch:** the client sent `{ phone, code }` while the server
   reads `req.body.otp`. Verification would have failed even with a valid code.
   *(Fixed on the client — it now sends `otp`.)*

---

## 2. The contract the frontend now implements

The client is already updated and shipped against this contract. **The only
thing it needs from a response is `otpRequired`.**

### Rule

> **No account gets a token until its email is verified.** This applies to
> email/password registration, email/password login, and Google sign-in alike.

### Response shape

When verification is needed, return **HTTP 200** with no token:

```json
{
  "otpRequired": true,
  "email": "user@example.com",
  "message": "Verification code sent to your email"
}
```

When the account is verified, return the existing shape unchanged:

```json
{ "user": { "...": "..." }, "token": "eyJ..." }
```

**`otpRequired` must be `200`, not `401`/`403`.** The client treats it as
"success, one more step" and routes to the OTP screen. An error status would
surface as a red error message on a signup that actually worked.

The client also treats **a missing `token`** as `otpRequired`, so a response
that omits both is handled safely — but please send the flag explicitly.

---

## 3. What to build

### 3.1 `POST /api/auth/register` — send a code, do not sign in

**Current:** creates the user, signs a JWT, returns it.

**Required:**

1. Create the user with `emailVerified: false`.
2. Generate a 6-digit OTP (`generateOtp()` already exists).
3. Store it keyed by **email**, with the existing 10-minute expiry.
4. Email it (see §3.5).
5. Return `{ otpRequired: true, email }` — **no token, no user object.**

Duplicate-email handling (`409`) stays as it is.

### 3.2 `POST /api/auth/verify-otp` — key on email

**Current:** reads `{ phone, otp }`, looks up `otpStore.findOne({ phone })`.

**Required:** read `{ email, otp }`, look up by email.

On success:
- Set `emailVerified: true` on the user (replacing `phoneVerified`).
- Delete the OTP record.
- **Return `{ user, token }`** — this is the moment the session is created, and
  the only place `/register` and Google sign-in hand out a token.

Keep the existing failure cases as they are — they are correct:
- no record → `400 "Invalid or expired OTP"`
- older than 10 minutes → delete + `400 "OTP expired..."`
- mismatch → `400 "Invalid OTP"`

**Please add**: an attempt counter, max 5 per code, then invalidate it. A
6-digit code is 1-in-a-million per guess, but unlimited guesses against a
10-minute window is brute-forceable. This is the one security gap in the
current implementation.

### 3.3 `POST /api/auth/resend-otp` — key on email

Read `{ email }`, look up `users.findOne({ email })`, regenerate, re-send.

**Do not reveal whether the account exists.** The current handler returns
`404 "No account found for this phone"`, which turns this endpoint into an
account-enumeration oracle — anyone can test which emails are registered.
Return `200` with a neutral message either way.

**Please add rate limiting**: max 3 resends per email per 15 minutes. Without
it this endpoint can be used to send unlimited email to an arbitrary address.

### 3.4 `POST /api/auth/login` — unverified users get a code, not a session

An account can exist unverified (user closed the app on the OTP screen). On a
**correct password** for an unverified account:

1. Generate and send a fresh OTP.
2. Return `{ otpRequired: true, email }` — no token.

A **wrong** password must still return the normal `401`. Do not disclose
verification state before the password is validated, or login becomes an
enumeration oracle too.

### 3.5 `POST /api/auth/oauth/google` — Google is not exempt

**Client decision: Google sign-in must also require OTP.**

Signing in with Google proves control of the Google account. The product rule
is that a LifeWise account is unusable until *this app* has verified the email,
and that rule is not waived by the identity provider.

- **First-time Google user** (account being created): create with
  `emailVerified: false`, send an OTP, return `{ otpRequired: true, email }`.
- **Returning, already-verified Google user:** return `{ user, token }` as now.

The email comes from the verified Google ID token, so it is safe to use as the
OTP destination.

**Decision needed from you:** should a returning Google user who was created
*before* this change (and so has no `emailVerified` field) be treated as
verified or unverified? Our recommendation is **verified** — see §5.

### 3.6 Sending the email

`sendReminderEmail()` at `server/routes.ts:195` already works via Resend and is
live. Reuse the same transport; a dedicated `sendOtpEmail()` wrapper with its
own subject and template is cleaner than overloading the reminder one.

Suggested copy:

```
Subject: Your LifeWise verification code

Your verification code is 483920.
It expires in 10 minutes.

If you didn't create a LifeWise account, you can ignore this email.
```

**If `RESEND_API_KEY` is unset**, `sendReminderEmail` currently logs and returns
silently. For OTP that is dangerous in a different way: registration would
"succeed" and the user would wait forever for a code that was never sent.
Please make OTP send failure **fail the request** (`500`) rather than pass
silently, so the user is told to try again instead of being stranded.

In development, keep logging the code to the console — it is what makes the flow
testable without a live mailbox.

---

## 4. Data model

```js
// otpStore — keyed by email now, not phone
{
  email: "user@example.com",   // lowercased, trimmed
  otp: "483920",
  userId: "...",
  attempts: 0,                 // new, see §3.2
  createdAt: ISODate            // 10-minute window
}
```

```js
// users
{
  emailVerified: false,        // new; replaces phoneVerified for this flow
  // ...
}
```

Index `otpStore.email`. A TTL index on `createdAt` (600s) would let Mongo expire
records automatically, but keep the explicit expiry check too — TTL eviction is
not instant.

---

## 5. Migration — existing users must not be locked out

**This is the part most likely to cause an incident.**

Every current user predates `emailVerified`. If the field is absent and the code
treats absent as `false`, **every existing user is locked out of their account**
at the next login and forced to verify.

Required: backfill `emailVerified: true` for all existing users before deploying,
or treat *absent* as verified and only ever set `false` on accounts created after
this change.

We recommend the explicit backfill — "absent means true" is a rule that gets
forgotten and inverted later.

---

## 6. Test cases

- [ ] Register → no token returned, code arrives by email
- [ ] Correct code → token returned, user lands in the app
- [ ] Wrong code → `400`, still on the OTP screen
- [ ] Code older than 10 minutes → `400 expired`
- [ ] 6 wrong attempts → code invalidated (§3.2)
- [ ] Resend → new code works, old one does not
- [ ] 4 resends in 15 minutes → rate limited (§3.3)
- [ ] Login with unverified account → `otpRequired`, new code sent
- [ ] Login with wrong password on unverified account → `401`, no code sent
- [ ] **First-time Google sign-in → `otpRequired`, code sent**
- [ ] **Returning verified Google user → straight in, no code**
- [ ] **Pre-existing user logs in → straight in, NOT asked to verify** (§5)
- [ ] Register with an already-registered email → `409`, unchanged

---

## 7. Frontend status

Complete and typechecked. Files changed:

| File | Change |
|---|---|
| `lib/auth-context.tsx` | `register`/`login`/`loginWithGoogle` return `otpRequired`; no token stored on that path. `verifyOtp`/`resendOtp` switched to email; fixed the `code`→`otp` field name |
| `app/(auth)/register.tsx` | Routes to the OTP screen on `otpRequired` (both email and Google paths) |
| `app/(auth)/login.tsx` | Same, incl. checking `otpRequired` **before** navigating into the app |
| `app/(auth)/verify-otp.tsx` | Email instead of phone throughout |
| `app/(auth)/_layout.tsx` | Registered the route |

The client is backward-compatible: if the server still returns a token from
`/register`, the user is signed in as before. **Nothing breaks when you deploy;
the flow simply starts working once §3 lands.**
