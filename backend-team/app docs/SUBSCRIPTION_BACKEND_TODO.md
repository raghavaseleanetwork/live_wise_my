# Subscription / Premium — Backend Work Required

**For:** Backend team
**Context:** The **frontend for the subscription/premium system is fully built and working** (plans, prices, limits, paywalls, plan management UI, 7-day trial, feature gates). It currently runs **entirely on the device** (AsyncStorage) with **no payment gateway**. This document lists **only the backend work** needed to make it server-backed and real.

> The mobile app makes **no** subscription API calls yet. Nothing below is wired on the client — you are building the server side; a small follow-up frontend task will point the app at these endpoints once they exist. **Do not expect existing app requests for these.**

Source of truth for all numbers: `LifeWise_Product_Logic_with_Timeline (1).docx` §4–5. The frontend already encodes them in `constants/plans.ts` — mirror those values server-side.

---

## 1. Data model

### 1.1 Add subscription fields to the **user** document
The `users` collection currently returns `{ id, email, name, phone, ... }` (see `server/routes.ts` auth responses). Add:

```
plan:            "free" | "starter" | "family" | "pro"     // default "free"
planInterval:    "month" | "year"                          // default "month"
planStatus:      "active" | "cancelled" | "expired"        // default "active"
planRenewsAt:    ISO date | null                           // next billing/expiry date
trialStartedAt:  ISO date | null                           // when the 7-day trial began
trialUsed:       boolean                                   // true once trial ever started (no restart)
```

Return these fields on **every** auth response (`/api/auth/login`, `/register`, `/oauth/google`, `/verify-otp`, `GET/PUT /api/auth/me`).

### 1.2 Usage counters (for monthly-metered limits)
Track per-user, per-calendar-month counts for: `voiceReminderPerMonth`, `billScanPerMonth`, `wiseAiPerMonth`, `bankPdfImportPerMonth`, `noticeboardPostsPerMonth`. Suggested collection `usage`:

```
{ userId, yearMonth: "2026-07", voiceReminderPerMonth: 0, billScanPerMonth: 0, wiseAiPerMonth: 0, ... }
```
Counters reset by virtue of the `yearMonth` key (a new month = a new doc). No cron needed.

---

## 2. Plans catalogue (align existing seed with the doc)

The server already seeds placeholder plans (`Basic Shield` / `Premium Guard` / `Enterprise Core` in `server/routes.ts`) and the admin panel manages them. These **do not match** the product doc. Replace the seed/records with the real four plans:

| id | name | ₹/month | ₹/year | notes |
|----|------|---------|--------|-------|
| free | Free | 0 | 0 | — |
| starter | Starter | 99 | 799 | 33% off yearly |
| family | Family | 199 | 1499 | 37% off yearly · **recommended** |
| pro | Pro | 499 | 3999 | — |

Full per-plan limits + feature flags are in `constants/plans.ts` (`LIMITS`, `FLAGS`). Keep the server copy identical — this is what enforcement checks against.

Expose read-only: **`GET /api/plans`** → the four plans with prices, limits, flags. (Public/authed, no admin.)

---

## 3. Endpoints to add

All authed via the existing `Bearer` token unless noted.

| Method | Path | Purpose |
|--------|------|---------|
| `GET`  | `/api/plans` | Return the 4 plans (meta + limits + flags). |
| `GET`  | `/api/subscription/me` | Current user's plan, status, trial info, and this month's usage counters. |
| `POST` | `/api/subscription/trial` | Start the one-time 7-day Family trial. Reject if `trialUsed` already true. Sets `trialStartedAt`, `trialUsed=true`. |
| `POST` | `/api/subscription/usage` | Body `{ key }` — increment one monthly usage counter. Return the new count + whether the plan limit is now exceeded. |
| `POST` | `/api/subscription/purchase` | **Placeholder until the payment gateway exists.** Body `{ planId, interval }`. For now just set the plan (mirrors the app's current local behaviour). Later this becomes the receipt-verification endpoint (see §5). |

**Trial expiry:** the effective plan is **Family while `now < trialStartedAt + 7 days`**, otherwise `plan`. Compute this server-side wherever you return the effective plan/limits (the frontend computes the same rule locally today).

---

## 4. Server-side enforcement (important)

The client gates are **UX only** and are spoofable. For anything that costs money or storage, **enforce the limit on the server** and return a clear error the app can turn into a paywall. Priority endpoints to guard:

- **Add family member** (`POST /api/family`) → reject when owned member count ≥ plan `familyMembers`.
- **Create reminder/bill** (`POST /api/bills` or equivalent) → reject when count ≥ plan `reminders` (and `billsPerMember`).
- **WiseAI chat** (`POST /api/assistant/chat`) → reject when monthly `wiseAiPerMonth` used up; increment on success.
- **Bill scan / voice / bank import** → increment the matching monthly counter; reject over limit.
- **PDF report export** (if any server role) → require plan flag `pdfReports`.

Suggested rejection shape (so the app can map it to the right paywall):
```json
{ "error": "plan_limit", "limitKey": "familyMembers", "recommendedPlan": "family" }
```

---

## 5. Payment gateway (LATER — not now)

Deferred by product decision. When it's time (doc §5.4): react-native-iap / **RevenueCat**, Apple StoreKit + Google Play Billing, product IDs `lifewise_{starter,family,pro}_{monthly,yearly}` (already in `constants/plans.ts` as `productIdMonthly`/`productIdYearly`). Backend then verifies receipts (Apple `verifyReceipt` / Google Play Developer API) or consumes RevenueCat webhooks, and `POST /api/subscription/purchase` becomes receipt-verified rather than a trusted set. Until then, keep `/purchase` as the simple setter.

---

## 6. Summary checklist for backend

- [ ] Add subscription fields to the user doc (§1.1) and return them on all auth responses.
- [ ] Add `usage` collection keyed by `userId + yearMonth` (§1.2).
- [ ] Replace placeholder plan seed with the real 4 plans matching `constants/plans.ts` (§2).
- [ ] `GET /api/plans`, `GET /api/subscription/me`, `POST /api/subscription/trial`, `POST /api/subscription/usage`, `POST /api/subscription/purchase` (§3).
- [ ] Compute effective plan = Family during the 7-day trial window (§3).
- [ ] Server-side limit enforcement on member/reminder/WiseAI/scan endpoints with the `plan_limit` error shape (§4).
- [ ] Payment gateway / receipt verification — **later** (§5).

Everything else (all UI, paywalls, plan screens, trial countdown, gating UX) is **already done on the frontend**. No frontend changes are requested of the backend team.
