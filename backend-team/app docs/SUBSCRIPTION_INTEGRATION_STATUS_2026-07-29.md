# Subscription & Paywall — Integration Status, Gaps, and Action Plan

**Date:** 2026-07-29
**Frontend branch:** `aselea-frontend-fixers` @ `420c7d4`
**Audience:** Backend team + frontend team
**Supersedes:** `SUBSCRIPTION_TEST_MODE_AND_BACKEND_TODO.md` (still valid, but read
this first — it reconciles the two conflicting handoff docs)

---

## 0. Executive summary

Two teams built two halves of this feature **in parallel, on separate machines,
without a shared branch.** Both halves work. Neither has ever seen the other.

Each team then reviewed the repo it could see and concluded the other half
didn't exist. Both conclusions were wrong — and both were reasonable given what
each could actually inspect.

| | Frontend | Backend |
|---|---|---|
| Where it lives | `aselea-frontend-fixers` @ `420c7d4` (pushed) | A developer's local machine (**uncommitted, unpushed**) |
| Status | Complete, typechecks clean | Complete, enforcing |
| Visible to the other team | Yes | **No** |

**The single most important action:** the backend team must commit and push their
work. Until then no integration testing is possible, and the two halves will keep
drifting.

### What is actually broken

One real, confirmed bug, and it is on the frontend:

> **4 of the 5 endpoints that return `403 plan_limit` do not handle it.**
> Users will see a generic error instead of a paywall.

Details in §4. This is our bug, we found it, and we will fix it. It is described
here because it changes what the backend will observe during joint testing.

---

## 1. How the confusion happened (and why it will recur)

### 1.1 The two documents

**Doc A** — `SUBSCRIPTION_TEST_MODE_AND_BACKEND_TODO.md` (frontend → backend)
Said: frontend complete, backend has no plan storage. **True of the pushed branch.**

**Doc B** — "Subscription & Paywall — Frontend Integration Guide" (backend → frontend)
Said: backend complete and enforcing, frontend modules do not exist.
**True of the backend developer's local machine.**

Both documents are internally accurate. They describe different machines.

### 1.2 Verification of Doc B's claims against the pushed branch

Doc B listed nine items as missing from the frontend. All nine were checked
directly:

| Doc B claim | Verified state on `420c7d4` |
|---|---|
| `lib/entitlements.ts` does not exist | **Exists** — 135 lines |
| `lib/subscription-context.tsx` does not exist | **Exists** — 458 lines |
| `lib/revenuecat.ts` does not exist | **Exists** — 321 lines |
| `lib/paywall-context.tsx` does not exist | **Exists** — 170 lines |
| `react-native-purchases` not installed | **Installed** — `package.json:77`, v10.5.0 |
| Test payment mode toggle does not exist | **Exists** — `app/subscription/index.tsx` |
| `app/scan-bill.tsx` has no `plan_limit` handler | **Has one** — `scan-bill.tsx:134` |
| Backend has full plan storage | **0** matches for `api/subscription` in `server/routes.ts` |
| `withSubscriptionFields` at `routes.ts:478` | **No such function** in the 3602-line file |

Doc B also cites commit `c9a6d51`, which is not on this branch.

**No blame here** — the backend developer inspected the only `server/routes.ts`
they had, and it was theirs. The lesson is purely procedural: unpushed work is
invisible, and reviewing a repo you haven't synced produces confident, wrong
conclusions.

### 1.3 The one thing Doc B got right, which matters

> §7: "zero matches for `revenuecat` in `server/`"

**Correct.** The backend has no RevenueCat integration — no webhook consumer, no
`rcAppUserId`. This is genuine outstanding work (§7 of this doc).

---

## 2. What the frontend has built

All present on `aselea-frontend-fixers`, `tsc` + `eslint` clean.

| File | Purpose |
|---|---|
| `constants/plans.ts` | Plans, limits, flags, product IDs, paywall triggers. **Source of truth.** |
| `lib/entitlements.ts` | Pure engine: "can this plan do X?" No state, no network. |
| `lib/subscription-context.tsx` | Plan state, trial, usage counters, purchase/restore |
| `lib/revenuecat.ts` | The **only** module importing `react-native-purchases` |
| `lib/paywall-context.tsx` | Paywall presentation, soft→hard escalation |
| `components/PaywallSheet.tsx` / `PaywallScreen.tsx` | Soft and hard paywalls |
| `app/subscription/index.tsx` | Plan management, test-mode toggle, restore |

### 2.1 RevenueCat is the only payment gateway

No Razorpay, no Stripe, no direct card handling. The server never sees card data.
Purchases go: app → RevenueCat → Google Play / App Store.

**Verified working** against the RevenueCat Test Store on 2026-07-27: the store
sheet opened showing `Product: lifewise_starter_monthly`, price `US$1.19`, phase
`P1M`. The SDK, product catalogue, and purchase call are all confirmed good.

### 2.2 Where plan state lives today

**On the device only** (`AsyncStorage`). This is the core architectural gap:

- A user who reinstalls loses their subscription
- Any user can grant themselves Pro by editing local storage
- The server has no idea what plan anyone is on

Fixing this requires the backend work in §6.

---

## 3. What we are trying to achieve with test mode

### 3.1 The problem it solves

Google Play Console is not set up yet — no $25 registration, no payments profile,
no products. So real purchases cannot be made, and paid tiers could not be
exercised end-to-end. That blocked QA on every premium feature.

### 3.2 What was built

A **Test payment mode** toggle on the subscription screen.

**ON:** tapping a plan shows a confirmation dialog ("This is a TEST activation —
no payment will be taken"), then grants that plan instantly.
**OFF:** the normal RevenueCat store flow.

### 3.3 The requirement — stated precisely

> **When a user is in test mode and selects a plan, EVERY perk of that plan must
> apply to their account — identical to a real purchase.**

Not a reduced "test tier." Not partial access. The same limits, the same feature
flags, the same behaviour on every gate.

### 3.4 Status: works on the frontend, will break on the backend

**Frontend — already correct, by construction.** Every gate derives from one value:

```
purchasePlan()  →  ownedPlan  →  currentPlan        [subscription-context.tsx:275]
                                      ↓
                    getLimit() · isFeatureEnabled() · checkLimit() · checkFlag()
```

So a test grant of `family` immediately yields `billScanPerMonth: Infinity`,
`pdfReports: true`, unlimited members — across all 15 screens that consume
`useSubscription`. Nothing extra was needed; this is why the toggle works at all.

**Backend — will NOT work, and this is the crux.** Once the server enforces
limits (which it already does, per Doc B), every gated endpoint reads the
*server's* copy of the plan. A device-local test grant leaves the server
believing the user is on Free.

Result: **the app shows Pro while the server rejects Pro-tier actions.** The user
sees a paywall for a plan the app says they own. This is the single most
confusing possible outcome, and it is exactly the bug that started this
investigation.

### 3.5 Safety properties of the toggle

- **Gated on `__DEV__`** — cannot appear in a release build. The gate is on
  `isTestMode` itself (`IS_TEST_MODE_ALLOWED && stored`), not merely on rendering
  the toggle, so a stale `true` in AsyncStorage cannot enable it in production.
- **RevenueCat sync is suppressed while on.** Without this the feature silently
  undoes itself: the store correctly reports `free` (no real entitlement exists),
  so the `CustomerInfo` listener would overwrite the test grant within seconds and
  again on every cold start.
- **Turning it off drops the grant** and re-syncs from the store, so a free grant
  cannot linger and be mistaken for a real subscription.
- **Test branch is evaluated before the trial branch.** Otherwise a first-time
  tester tapping Pro is diverted into the one-time 7-day Family trial — and burns
  it, since `canStartTrial` is one-shot.

---

## 4. ⚠️ CONFIRMED BUG: 4 of 5 endpoints ignore `plan_limit`

**This is a frontend bug. We found it, we own it, we are fixing it.** Documented
here because it directly affects what the backend team will observe in testing.

### 4.1 The mechanism

`lib/query-client.ts:41` — `throwIfResNotOk`:

```js
if (!res.ok) {
  const text = await res.text();
  throw new Error(`${res.status}: ${text}`);   // ← structured JSON becomes a string
}
```

The `plan_limit` body survives as text inside an `Error` message, but no caller
parses it back out. So the paywall never fires.

### 4.2 Endpoint-by-endpoint status

| Endpoint | Caller | Handles 403? | Current user experience |
|---|---|---|---|
| `POST /api/bills/scan/commit` | `app/scan-bill.tsx:405` | ✅ **Yes** | Correct paywall |
| `POST /api/family` | `app/add-family-member.tsx:120` | ❌ No | Generic save failure |
| `POST /api/bills` | `lib/expense-context.tsx:348` | ❌ No | **Silent** — returns `null`, no error shown |
| `POST /api/reminders/voice/parse` | `app/voice-reminder.tsx:497` | ❌ No | **Actively misleading** — see below |
| `POST /api/assistant/chat` | `app/assistant.tsx:157` | ❌ No | "Assistant API failed (403)" |

Only scan-bill works, because it uses a raw `fetch` and reads the body **before**
throwing — the pattern the other four need.

### 4.3 Two cases worth calling out

**`POST /api/bills` fails silently.** `expense-context.tsx:348` checks
`if (res.ok)` and otherwise falls through to `return null` with no error at all.
A user hitting the reminder cap sees the bill simply not save — no message, no
paywall.

**`POST /api/reminders/voice/parse` is actively misleading.** That call site has
a deliberate 403 branch, written when the only known cause of a 403 there was the
transcription provider rejecting the *server's* key:

> `voice-reminder.tsx:514` — "Voice transcription is unavailable on the server
> right now. **This needs a backend fix — please report it.**"

Once the backend starts returning `403 plan_limit`, a user who has simply used up
their voice quota will be told the **server is broken and to file a bug**. This
will generate false backend bug reports. It is our highest-priority fix.

### 4.4 The fix

A shared helper that inspects the response before throwing:

```ts
// lib/plan-limit.ts
export type PlanLimitError = {
  error: 'plan_limit';
  limitKey: LimitKey;
  recommendedPlan: PlanId;
};

/** Returns the parsed 403 body, or null if this was not a plan limit. */
export async function readPlanLimit(res: Response): Promise<PlanLimitError | null> {
  if (res.status !== 403) return null;
  try {
    const body = await res.clone().json();
    return body?.error === 'plan_limit' ? body : null;
  } catch {
    return null;
  }
}
```

Then wire the four remaining call sites.

> **Not every 403 is a plan limit.** Auth failures and the voice route's
> provider errors also use 403. Always check `error === 'plan_limit'` rather than
> treating bare status 403 as a paywall. This is precisely why
> `voice-reminder.tsx` must keep its existing 403 branch as the fallback.

---

## 5. Confirming the response contract

Frontend and backend must agree exactly. **Backend team: please confirm or
correct each line.**

### 5.1 The rejection shape

```json
{ "error": "plan_limit", "limitKey": "billScanPerMonth", "recommendedPlan": "starter" }
```

- HTTP status **403** — confirm?
- `limitKey` values match the `PlanLimits` keys in `constants/plans.ts` — confirm?
- `recommendedPlan` is one of `free` / `starter` / `family` / `pro` — confirm?

### 5.2 `GET /api/subscription/me`

Doc B documents this shape. Two questions:

1. **`limits` uses `null` for unlimited.** The frontend uses `Infinity`
   (`constants/plans.ts`). We will convert at the boundary — just confirm `null`
   is correct and that it is never `0` or `-1`.
2. **`effectivePlan` folds in the trial.** Confirm the rule is
   `now < trialStartedAt + 7 days → "family"`, matching the client
   (`subscription-context.tsx:275`).

### 5.3 Entitlement identifiers

RevenueCat is configured with entitlements named **exactly** `starter`, `family`,
`pro` (lowercase), so they map onto `PlanId` with no translation table. When the
webhook consumer is built, please preserve this — and log-and-ignore unrecognised
entitlements rather than guessing a tier.

---

## 6. Backend work required

### 6.1 Make test grants unlock the same perks (§3.4)

**Requirement:** a test grant must produce identical entitlements to a real
purchase on every server-side check.

Add `planSource: "store" | "test" | "manual"` to the user record. The **only**
differences:

| | `"store"` | `"test"` |
|---|---|---|
| Feature access | Full | **Full — identical** |
| Limits | Plan's limits | **Plan's limits — identical** |
| Counts toward MRR / revenue reporting | Yes | **No** |
| Has `planRenewsAt` | Yes | No |
| Clearable in bulk before launch | No | Yes |

Resolve the plan in **one** place, and do not branch on `planSource`:

```
effectivePlan(user):
    if user.trialStartedAt and now < trialStartedAt + 7 days:
        return "family"          # trial overrides — matches the client
    return user.plan             # regardless of planSource
```

Branching on `planSource` here is exactly how the two paths silently diverge.

**Pre-launch:** clear test grants and verify none remain in production.

```
db.users.updateMany({ planSource: "test" },
  { $set: { plan: "free", planStatus: "expired", planSource: null } })
```

### 6.2 🔴 SECURITY: gate the purchase endpoint

Doc B flagged this itself, and it is correct — **this is a launch blocker.**

`POST /api/subscription/purchase` grants a plan with **no payment verification**.
Any authenticated user can grant themselves Pro with a single request. It is also
indistinguishable from a real purchase in the database.

Required:
1. Gate behind an env var (e.g. `ALLOW_TEST_GRANTS=true`), never set in production
2. Return **404** when disabled, not 403 — do not advertise the endpoint's existence
3. Set `planSource: "test"`, never `"store"`
4. Never set `planRenewsAt`
5. Log every call with the user id for audit
6. Consider restricting to an allowlist of test accounts

**A `__DEV__` toggle on the client does not mitigate this.** The endpoint is
reachable from curl regardless of what the app does.

### 6.3 RevenueCat webhook consumer

Currently absent. Without it the server never learns about real purchases,
renewals, or cancellations unless the app happens to be open.

1. Endpoint e.g. `POST /api/webhooks/revenuecat`
2. **Verify the `Authorization` header** against the dashboard shared secret —
   this endpoint is public
3. Handle:

| Event | Action |
|---|---|
| `INITIAL_PURCHASE` | Set `plan` from entitlement; `planSource: "store"` |
| `RENEWAL` | Update `planRenewsAt` |
| `CANCELLATION` | `planStatus: "cancelled"` — keep access until expiry |
| `EXPIRATION` | `plan: "free"`, `planStatus: "expired"` |
| `PRODUCT_CHANGE` | Update `plan` to the new tier |
| `BILLING_ISSUE` | Flag the account; do **not** revoke immediately (grace period) |

4. `app_user_id` in the payload is the LifeWise `user.id` — the app already calls
   `Purchases.logIn(user.id)` after authentication, so they are linked.

---

## 7. Action plan

### Backend

| # | Task | Priority |
|---|---|---|
| B1 | **Commit and push the backend work** | 🔴 **BLOCKER** |
| B2 | Gate `/api/subscription/purchase` (§6.2) | 🔴 **Launch blocker** |
| B3 | Confirm the response contract (§5) | 🔴 Blocks F1 |
| B4 | `planSource` + `effectivePlan()` (§6.1) | 🟠 High |
| B5 | RevenueCat webhook consumer (§6.3) | 🟠 High |

### Frontend

| # | Task | Priority |
|---|---|---|
| F1 | `readPlanLimit` helper + wire 4 call sites (§4.4) | 🔴 **Blocker** |
| F2 | Fix the misleading voice-reminder 403 message (§4.3) | 🔴 Blocker |
| F3 | Extend the `User` type with subscription fields | 🟠 High |
| F4 | Point `subscription-context` at `/api/subscription/me` | 🟠 High |
| F5 | Route test mode through the server, not just AsyncStorage (§3.4) | 🟠 High |

**F1–F2 are unblocked** and start immediately. F4–F5 need B1 and B3.

### Joint

| # | Task |
|---|---|
| J1 | Merge both halves onto one branch |
| J2 | End-to-end test: hit each of the 5 limits, confirm the correct paywall |
| J3 | Verify a test grant unlocks identical perks client- and server-side |
| J4 | Verify `planSource: "test"` records are excluded from revenue reporting |

---

## 8. Open questions for the backend team

1. **When can the backend be pushed?** Everything else depends on it.
2. Confirm the `plan_limit` response contract (§5.1).
3. Is `null` definitely "unlimited" in the `limits` payload, never `0`/`-1`? (§5.2)
4. Does `effectivePlan` use the same 7-day trial rule as the client? (§5.2)
5. Timeline for gating `/api/subscription/purchase`? (§6.2)
6. Timeline for the RevenueCat webhook consumer? (§6.3)
7. `pdfReports`, `prioritySupport`, `caregiverSharing` are returned but not
   enforced server-side — is client-side gating intended for now?
8. `bankPdfImportPerMonth` and `noticeboardPostsPerMonth` have counters but no
   enforcement site. Should the client increment them via
   `POST /api/subscription/usage`, or will those endpoints gate themselves?

---

## 9. Process note

This cost both teams real time. Two concrete preventions:

1. **Push work before writing a handoff doc about it.** Doc B's central claim was
   false only because the code it described was invisible.
2. **State the branch and commit in every handoff doc.** Doc B cited `c9a6d51`,
   which is not on `aselea-frontend-fixers` — that alone would have surfaced the
   mismatch immediately instead of after a full review cycle.

---

## Appendix A — verification commands

Run on `aselea-frontend-fixers` to confirm §1.2:

```bash
ls lib/entitlements.ts lib/subscription-context.tsx \
   lib/revenuecat.ts lib/paywall-context.tsx     # all exist
grep react-native-purchases package.json          # ^10.5.0
grep -n plan_limit app/scan-bill.tsx              # :143
grep -c "api/subscription" server/routes.ts       # 0
grep -c "withSubscriptionFields" server/routes.ts # 0
git log --oneline -1                              # 420c7d4
```

## Appendix B — frontend files, for reference

| Path | Lines | Role |
|---|---|---|
| `constants/plans.ts` | 496 | Plans, limits, flags, triggers, product IDs |
| `lib/entitlements.ts` | 135 | Pure limit/flag engine |
| `lib/subscription-context.tsx` | 458 | Plan state, trial, usage, purchase, test mode |
| `lib/revenuecat.ts` | 321 | RevenueCat SDK wrapper (only SDK importer) |
| `lib/paywall-context.tsx` | 170 | Paywall presentation + escalation |
| `app/subscription/index.tsx` | ~620 | Plan management, test toggle, restore |
| `components/PaywallSheet.tsx` | ~260 | Soft paywall |
| `components/PaywallScreen.tsx` | ~215 | Hard paywall |
