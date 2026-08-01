# Subscription — Test Payment Mode (frontend, done) + Backend Work Required

**Date:** 2026-07-29
**For:** Backend team
**Status of frontend:** ✅ Complete. No frontend work is requested of you.

---

## 0. TL;DR — what the backend must do

| # | Item | Priority |
|---|------|----------|
| 1 | Store the user's plan server-side and return it on every auth response | **BLOCKER** |
| 2 | Track monthly usage counters server-side | **BLOCKER** |
| 3 | Enforce plan limits on cost-bearing endpoints; return the `plan_limit` error shape | **HIGH** |
| 4 | Consume RevenueCat webhooks so the server learns about real purchases | **HIGH** |
| 5 | Support the test-grant endpoint (non-production only) | MEDIUM |
| 6 | Ensure a test grant unlocks **identical** perks to a real purchase (§5A) | **HIGH** |

**The single most important point:** the app currently stores the user's plan
**only on the device** (`AsyncStorage`). The server does not know what plan
anyone is on. Until item 1 exists, a user who reinstalls the app loses their
subscription, and any user can grant themselves Pro by editing local storage.

---

## 1. Context — what changed on the frontend

### 1.1 RevenueCat is the only payment gateway
Purchases go through RevenueCat → Google Play / App Store. There is no Razorpay,
Stripe or direct card handling anywhere in the app, and none is planned. The
server never sees card data.

### 1.2 A "Test payment mode" toggle was added
Because the real gateway is still being set up (Play Console is not live yet),
the subscription screen now has a **Test payment mode** toggle.

When ON:
- Tapping a plan shows a confirmation dialog, then grants that plan instantly
- **No payment is taken and no store subscription is created**
- **Every perk of that plan activates in full** — same limits, same feature
  flags, identical to a real purchase (see §5A)
- The grant is local to the device
- Turning the toggle OFF re-syncs from the store and drops the test grant

**It is gated on `__DEV__`, so it cannot appear in a production build.** This is
a deliberate safety property: the toggle grants paid entitlements for free, so it
must never be reachable by a real user.

> **Backend implication:** if you implement server-side plan storage (item 1),
> test grants must NOT be written to the production user record as real
> subscriptions. See §5.

---

## 2. Data model changes

### 2.1 Add subscription fields to the user document

The `users` collection currently returns `{ id, email, name, phone, ... }`. Add:

```
plan:            "free" | "starter" | "family" | "pro"   // default "free"
planInterval:    "month" | "year"                        // default "month"
planStatus:      "active" | "cancelled" | "expired"      // default "active"
planRenewsAt:    ISO date | null                         // next billing/expiry
planSource:      "store" | "test" | "manual"             // NEW — see §5
trialStartedAt:  ISO date | null
trialUsed:       boolean                                 // true once ever started
rcAppUserId:     string | null                           // RevenueCat customer id
```

Return these on **every** auth response: `/api/auth/login`, `/register`,
`/oauth/google`, `/verify-otp`, `GET/PUT /api/auth/me`.

`planSource` is new versus the earlier version of this doc. It exists so test
grants are distinguishable from real purchases in analytics and support, and so
they can be bulk-cleared without touching paying customers.

### 2.2 Usage counters

Per-user, per-calendar-month counts for the five metered limits:

```
{ userId, yearMonth: "2026-07",
  voiceReminderPerMonth: 0, billScanPerMonth: 0, wiseAiPerMonth: 0,
  bankPdfImportPerMonth: 0, noticeboardPostsPerMonth: 0 }
```

Keyed by `userId + yearMonth`, so counters reset naturally each month. No cron.

---

## 3. Plans catalogue

The server seeds placeholder plans (`Basic Shield` / `Premium Guard` /
`Enterprise Core`) that **do not match the product**. Replace with:

| id | name | ₹/month | ₹/year |
|----|------|---------|--------|
| free | Free | 0 | 0 |
| starter | Starter | 99 | 799 |
| family | Family | 199 | 1499 |
| pro | Pro | 499 | 3999 |

Full limits and feature flags are in `constants/plans.ts` (`LIMITS`, `FLAGS`).
**Mirror those values exactly** — that file is the source of truth and the
client gates against it.

---

## 4. Endpoints

All authed via the existing `Bearer` token.

| Method | Path | Purpose |
|--------|------|---------|
| `GET`  | `/api/plans` | The 4 plans (meta + limits + flags) |
| `GET`  | `/api/subscription/me` | Current plan, status, trial info, this month's usage |
| `POST` | `/api/subscription/trial` | Start the one-time 7-day Family trial; reject if `trialUsed` |
| `POST` | `/api/subscription/usage` | Body `{ key }` — increment a counter, return new count + whether over limit |
| `POST` | `/api/subscription/sync` | Body `{ rcAppUserId }` — pull entitlements from RevenueCat and update the user |
| `POST` | `/api/subscription/test-grant` | **Non-production only.** See §5 |

**Effective plan rule:** the plan is **Family** while
`now < trialStartedAt + 7 days`, otherwise `plan`. Compute this server-side
wherever the effective plan or limits are returned — the client applies the same
rule locally today.

---

## 5. Test-grant endpoint (`POST /api/subscription/test-grant`)

Only needed if you want test grants reflected server-side. **If you would rather
keep test mode purely client-side, skip this section entirely** — the frontend
works either way, and skipping it is the safer default.

If implemented:

```
POST /api/subscription/test-grant
Body: { planId: "starter" | "family" | "pro", interval: "month" | "year" }
```

**Mandatory safeguards:**

1. **Disabled in production.** Gate on an env var, e.g.
   `ALLOW_TEST_GRANTS=true`, and never set it in the production environment.
   Return `404` (not `403`) when disabled, so the endpoint's existence isn't
   advertised.
2. Set `planSource: "test"` on the user record. Never `"store"`.
3. Never set `planRenewsAt` — a test grant is not a real subscription.
4. Log every call with the user id for audit.
5. Consider restricting to allowlisted test accounts.

**Why this matters:** this endpoint grants paid features for free. If it ships
enabled in production, anyone who finds it gets Pro at no cost.

---

## 5A. Test grants must unlock the SAME perks as a real purchase

This is the behaviour the product owner has explicitly asked for, so it is worth
stating precisely.

**On the frontend this already works.** Every gate in the app derives from a
single value:

```
purchasePlan()  →  ownedPlan  →  currentPlan  →  getLimit()
                                              →  isFeatureEnabled()
                                              →  checkLimit()
                                              →  checkFlag()
```

So a test grant of `family` immediately yields `billScanPerMonth: Infinity`,
`pdfReports: true`, unlimited members, and so on — identical to a real purchase.
There is no separate "test tier" with reduced features, and there must not be.

**On the backend this will NOT work unless you make it work.** Once §7
(server-side enforcement) is implemented, any endpoint that checks the plan will
read the *server's* copy. If a test grant only ever exists on the device, the
server still believes the user is on Free and will reject the very actions the
test grant was meant to unlock. The user sees a paywall for a plan the app says
they own — which is exactly the confusing behaviour this section exists to
prevent.

### Requirement

**A test grant must produce the same entitlements as a real purchase on every
server-side check.** Concretely:

- `GET /api/subscription/me` returns the granted plan and its limits
- All §7 enforcement checks pass at the granted tier
- Monthly usage counters are metered against the granted tier's limits
- Feature flags (`pdfReports`, `budgetAlerts`, …) resolve at the granted tier

### The one thing that must differ

`planSource` distinguishes them, and **only** these consequences follow:

| | `planSource: "store"` | `planSource: "test"` |
|---|---|---|
| Feature access | Full | **Full — identical** |
| Limits | Plan's limits | **Plan's limits — identical** |
| Counts toward revenue/MRR reporting | Yes | **No** |
| Has `planRenewsAt` | Yes | No (never expires on its own) |
| Appears in paying-customer exports | Yes | No |
| Can be bulk-cleared before launch | No | Yes |

In other words: **identical entitlements, different bookkeeping.** Do not
implement `planSource: "test"` as a restricted or partial tier.

### Recommended implementation

Resolve the effective plan once, in one place, and have every check call it:

```
effectivePlan(user):
    if user.trialStartedAt and now < trialStartedAt + 7 days:
        return "family"           # trial overrides, matches the client
    return user.plan              # regardless of planSource
```

Note it does **not** branch on `planSource`. That field is for reporting only.
Branching on it here is how the two paths accidentally diverge.

### Before launch

Clear test grants so they cannot be mistaken for real subscriptions:

```
db.users.updateMany(
  { planSource: "test" },
  { $set: { plan: "free", planStatus: "expired", planSource: null } }
)
```

Verify no `planSource: "test"` records remain in production before going live.

---

## 6. RevenueCat webhooks (the real purchase path)

RevenueCat is the source of truth for real subscriptions. The server should
consume its webhooks so it learns about purchases, renewals, cancellations and
expiries **without depending on the app being open**.

1. Create a webhook in the RevenueCat dashboard → Integrations → Webhooks,
   pointing at e.g. `POST /api/webhooks/revenuecat`
2. **Verify the `Authorization` header** against the shared secret configured in
   the dashboard. Reject anything that fails — this endpoint is public.
3. Handle these event types:

| Event | Action |
|-------|--------|
| `INITIAL_PURCHASE` | Set `plan` from the entitlement; `planSource: "store"` |
| `RENEWAL` | Update `planRenewsAt` |
| `CANCELLATION` | Set `planStatus: "cancelled"` (keep access until expiry) |
| `EXPIRATION` | Set `plan: "free"`, `planStatus: "expired"` |
| `PRODUCT_CHANGE` | Update `plan` to the new tier |
| `BILLING_ISSUE` | Flag the account; do not revoke immediately (grace period) |

4. The entitlement identifier maps **directly** onto `plan`. RevenueCat is
   configured with entitlements named exactly `starter`, `family`, `pro`
   (lowercase). Do not add a translation layer — if an unrecognised entitlement
   arrives, log it and ignore rather than guessing a tier.

5. `app_user_id` in the payload is the LifeWise `user.id` — the app calls
   `Purchases.logIn(user.id)` after authentication, so the two are already
   linked.

---

## 7. Server-side enforcement

Client gates are **UX only and are spoofable**. For anything that costs money or
storage, enforce server-side and return an error the app can map to a paywall.

Priority endpoints:

- **Add family member** (`POST /api/family`) → reject when count ≥ `familyMembers`
- **Create reminder/bill** → reject when count ≥ `reminders` / `billsPerMember`
- **WiseAI chat** (`POST /api/assistant/chat`) → reject when `wiseAiPerMonth`
  exhausted; increment on success
- **Bill scan commit** (`POST /api/bills/scan/commit`) → increment
  `billScanPerMonth`; reject over limit
- **Voice / bank import** → increment the matching counter; reject over limit
- **PDF export** → require the `pdfReports` flag

**Rejection shape the app already understands:**

```json
{ "error": "plan_limit", "limitKey": "familyMembers", "recommendedPlan": "family" }
```

Return it with HTTP **403**. The client (`app/scan-bill.tsx`) already parses this
exact shape and presents the correct paywall — the handler exists and is waiting
for the server to start sending it.

> **Note:** `POST /api/bills/scan/commit` currently has **no plan check at all**.
> The client-side counter is a pre-check only and resets on reinstall.

---

## 8. Checklist

- [ ] Add subscription fields to the user doc (§2.1), incl. `planSource`
- [ ] Return them on all auth responses
- [ ] Add the `usage` collection keyed `userId + yearMonth` (§2.2)
- [ ] Replace the placeholder plan seed with the real 4 plans (§3)
- [ ] `GET /api/plans`, `GET /api/subscription/me`, `POST /api/subscription/trial`,
      `POST /api/subscription/usage`, `POST /api/subscription/sync` (§4)
- [ ] Effective plan = Family during the trial window (§4)
- [ ] RevenueCat webhook consumer with signature verification (§6)
- [ ] Server-side enforcement with the `plan_limit` 403 shape (§7)
- [ ] *(Optional)* `POST /api/subscription/test-grant`, disabled in production (§5)
- [ ] Test grants resolve to the SAME entitlements as real purchases — one
      `effectivePlan()` helper, no branching on `planSource` (§5A)
- [ ] A pre-launch step to clear `planSource: "test"` records (§5A)

---

## 9. What the frontend already does — do not rebuild

All of this is complete and working:

- Plan/limit/flag tables (`constants/plans.ts`)
- Entitlement engine (`lib/entitlements.ts`)
- Subscription state + RevenueCat integration (`lib/subscription-context.tsx`,
  `lib/revenuecat.ts`)
- Paywall presentation, triggers, soft/hard escalation (`lib/paywall-context.tsx`)
- Plan management UI, trial countdown, restore purchases
- Test payment mode toggle (dev builds only)
- Parsing of the `plan_limit` 403 response — already implemented, waiting on the
  server to send it

Questions on any of the above → ask before implementing; the shapes are already
fixed on the client side.
