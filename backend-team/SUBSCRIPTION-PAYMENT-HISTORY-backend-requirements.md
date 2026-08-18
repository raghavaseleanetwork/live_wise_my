# Subscription Payment History — Backend Requirements

**Audience:** Backend team
**Feature:** Payment History under Settings → Subscription
**Source:** Client request — "Settings Enhancements: Add Payment History under the Subscription section. Display all subscription payments with relevant details."
**Status:** ✅ Frontend screen is **built and shipped** against the RevenueCat SDK. ⚠️ It can only show a partial history — see §2. Backend work below is what makes it complete.
**Files to edit:** `server/routes.ts`
**Date:** 2026-08-15

---

## 1. What exists today

A Payment History screen is live at [app/subscription/payment-history.tsx](../app/subscription/payment-history.tsx), reachable from Settings → Subscription → Payment History.

It reads purchase records straight from the RevenueCat client SDK via `getPurchaseHistory()` in [lib/revenuecat.ts](../lib/revenuecat.ts), and renders one row per purchase/renewal term with: plan name, billing interval, purchase date, expiry or renewal date, store, and an ACTIVE badge for the current term.

**No backend endpoint is involved.** The screen works right now on a native build with RevenueCat configured.

---

## 2. Why the client-only version is not enough

RevenueCat's **client** SDK is an *entitlement* API, not a billing ledger. `CustomerInfo` answers "what does this user currently own, and until when" — which is what entitlement gating needs. It does not carry the things a payment history is normally expected to show.

| Field | Available client-side? | Notes |
|---|---|---|
| Product purchased | ✅ Yes | `allPurchaseDates` keys |
| Purchase date | ✅ Yes | `allPurchaseDates` |
| Expiry / renewal date | ✅ Yes | `allExpirationDates` |
| Active / will-renew | ✅ Yes | `entitlements.all[*].willRenew` |
| Store (Play / App Store) | ✅ Yes | `entitlements.all[*].store` |
| **Amount actually charged** | ❌ **No** | Not in `CustomerInfo` at all |
| **Currency charged** | ❌ **No** | — |
| **Tax breakdown** | ❌ **No** | — |
| **Invoice / order id** | ❌ **No** | — |
| **Refunds / chargebacks** | ❌ **No** | — |
| **Billing issues / grace period** | ❌ Partial | Only the current state, no history |
| **Full renewal history** | ❌ **No** | See below |

Two consequences worth being explicit about, because they are what users will notice:

**(a) Amounts are approximate.** The screen looks up each product's *current* store price from the active offering. If a plan's price changed after the user bought it — or the product was withdrawn from sale — the row shows `—` rather than a wrong number. There is a footnote on the screen telling users to check Google Play / App Store for exact charges.

**(b) Only the latest term per product is listed, not every renewal.** `allPurchaseDates` is keyed by product id, so a user 14 months into a monthly plan produces **one row**, not 14. The client literally asked to "display **all** subscription payments" — that requirement cannot be met client-side. It needs the webhook history below.

---

## 3. What we need from the backend

### 3.1 Consume RevenueCat webhooks

This is the prerequisite for everything else, and is already flagged as needed in [backend-team/app docs/SUBSCRIPTION_BACKEND_TODO.md](app%20docs/SUBSCRIPTION_BACKEND_TODO.md) §5 for server-side entitlement enforcement. Payment history is a second reason to do it.

**Endpoint to build:**

```
POST /api/webhooks/revenuecat
Auth: Authorization header must equal the shared secret configured in the
      RevenueCat dashboard (NOT the app's user JWT).
Response: 200 quickly — RevenueCat retries on non-2xx.
```

Set the webhook URL and auth header in RevenueCat → Project Settings → Integrations → Webhooks.

**Event types to persist** (RevenueCat sends `event.type`):

| Event | Meaning |
|---|---|
| `INITIAL_PURCHASE` | First purchase of a subscription |
| `RENEWAL` | A term renewed and the user was charged |
| `PRODUCT_CHANGE` | Upgrade/downgrade between plans |
| `CANCELLATION` | Auto-renew turned off (still active until expiry) |
| `UNCANCELLATION` | Auto-renew turned back on |
| `EXPIRATION` | Access actually ended |
| `BILLING_ISSUE` | Payment failed, entering grace period |
| `SUBSCRIPTION_PAUSED` | Play Store pause |
| `TRANSFER` | Entitlements moved between app user ids |
| `REFUND` / `REFUND_REVERSED` | Money returned / reversal undone |

**Critical fields on the event payload:**

- `app_user_id` — this is our `userId`. **The client must be identifying users to RevenueCat via `logIn(userId)` for this to be joinable** — it already does, see `lib/revenuecat.ts:logIn`.
- `product_id` — e.g. `lifewise_family_monthly`
- `entitlement_ids` — maps to our `PlanId` (`starter` / `family` / `pro`)
- `purchased_at_ms`, `expiration_at_ms`
- `price`, `currency` — **the actual charged amount**, which is the whole point
- `price_in_purchased_currency`, `tax_percentage`, `commission_percentage`
- `store` — `PLAY_STORE` / `APP_STORE` / `RC_BILLING` etc.
- `environment` — `SANDBOX` or `PRODUCTION`
- `id` — RevenueCat's event id, **use this for idempotency**

### 3.2 Store them

Suggested collection `subscription_payments`:

```js
{
  _id: ObjectId,
  eventId: String,        // RevenueCat event.id — UNIQUE INDEX, see note
  userId: String,         // from app_user_id
  type: String,           // INITIAL_PURCHASE | RENEWAL | REFUND | ...
  productId: String,      // lifewise_family_monthly
  plan: String,           // starter | family | pro  (from entitlement_ids)
  interval: String,       // month | year
  amount: Number,         // price actually charged
  currency: String,       // INR, USD, ...
  taxPercentage: Number,
  store: String,          // PLAY_STORE | APP_STORE | ...
  environment: String,    // SANDBOX | PRODUCTION
  purchasedAt: Date,
  expiresAt: Date,
  isRenewal: Boolean,
  isRefunded: Boolean,
  rawEvent: Object,       // keep the original payload for auditing
  createdAt: Date,
}
```

**Indexes:**

```js
db.subscription_payments.createIndex({ eventId: 1 }, { unique: true });
db.subscription_payments.createIndex({ userId: 1, purchasedAt: -1 });
```

> **Idempotency is not optional.** RevenueCat retries webhooks on any non-2xx response, and will resend events after transient failures. Without the unique index on `eventId` a user's history will show duplicated charges. Upsert on `eventId`; do not blind-insert.

> **Filter or flag `SANDBOX` events.** Test-store and sandbox purchases carry `environment: "SANDBOX"`. If those are served to production users they will see payments they never made. Either drop them at ingest or exclude them in the query at §3.3.

### 3.3 Serve them

```
GET /api/subscription/payments
Auth: required (standard authMiddleware)
Query: ?limit=50&before=<ISO date>   (both optional; default limit 50)

Response 200:
{
  "payments": [
    {
      "id": "6512...",
      "type": "RENEWAL",
      "plan": "family",
      "productId": "lifewise_family_monthly",
      "interval": "month",
      "amount": 199,
      "currency": "INR",
      "store": "PLAY_STORE",
      "purchasedAt": "2026-07-15T10:22:31.000Z",
      "expiresAt": "2026-08-15T10:22:31.000Z",
      "isRefunded": false
    }
  ],
  "hasMore": false
}
```

Requirements:
- Scope strictly by `req.userId` — one user must never see another's payments.
- Sort `purchasedAt` descending.
- Exclude `environment: 'SANDBOX'` in production.
- Return `{ payments: [], hasMore: false }` (200, not 404) for a user who never paid.

---

## 4. Frontend integration once the endpoint exists

The screen was written so this is a small change, not a rewrite. In [app/subscription/payment-history.tsx](../app/subscription/payment-history.tsx), the `load()` callback is the only place that fetches:

```ts
// today
setRecords(await getPurchaseHistory());

// after this endpoint ships — prefer the server, fall back to the SDK
const res = await fetchWithAuth(token, '/api/subscription/payments');
setRecords(res.ok ? mapServerPayments(await res.json()) : await getPurchaseHistory());
```

The `PurchaseRecord` shape in `lib/revenuecat.ts` deliberately mirrors the response above. Keeping the SDK path as a fallback is worth doing — it keeps the screen useful if the webhook pipeline is ever down or backfilled late.

Once the server is authoritative, the frontend should also:
- render real `amount` + `currency` on every row instead of `—`
- drop the "amounts are current store prices" footnote (`paymentHistory.footnote`)
- show refunded rows with a distinct style
- add pagination using `hasMore` / `before`

---

## 5. Backfill

Webhooks only fire from the moment they are configured. **Any user who subscribed before the webhook goes live will have no history rows.**

Options:
- **Backfill via RevenueCat's REST API** — `GET /v1/subscribers/{app_user_id}` per user, which returns their subscription and transaction data. Reasonable for a small user base.
- **Accept the gap** and let the client-side SDK fallback (§4) cover pre-webhook users, which shows at least their latest term.

Given the app is not yet live on Play Console, doing this *before* launch avoids the problem entirely. That is the recommendation: configure webhooks before the first real purchase and there is nothing to backfill.

---

## 6. Test plan

| # | Test | Expected |
|---|---|---|
| 1 | Send a `INITIAL_PURCHASE` webhook with a valid auth header | 200; one row in `subscription_payments` |
| 2 | Send the **same event id** twice | 200 both times; still exactly **one** row |
| 3 | Send a webhook with a wrong/missing auth header | 401; nothing written |
| 4 | `GET /api/subscription/payments` as user A | Only A's payments, newest first |
| 5 | `GET /api/subscription/payments` as a user with no purchases | 200 with `{ payments: [], hasMore: false }` |
| 6 | Send a `SANDBOX` event, then query in production | Row excluded from the response |
| 7 | Send `RENEWAL` ×3 for the same product | 3 distinct rows (this is the case the SDK cannot do) |
| 8 | Send `REFUND` | Row recorded with `isRefunded: true` |
| 9 | Query with `?limit=2` when 5 exist | 2 rows, `hasMore: true` |

---

## 7. Summary checklist

- [ ] §3.1 — `POST /api/webhooks/revenuecat` built, shared-secret auth, returns 200 fast
- [ ] §3.1 — Webhook URL + auth header configured in RevenueCat dashboard
- [ ] §3.2 — `subscription_payments` collection + **unique index on `eventId`**
- [ ] §3.2 — Sandbox events filtered or flagged
- [ ] §3.3 — `GET /api/subscription/payments` built, scoped to `req.userId`
- [ ] §5 — **Decision:** backfill existing subscribers, or configure webhooks before launch?
- [ ] §6 — All 9 tests pass
- [ ] §4 — Tell the frontend team when the endpoint is live so the screen can be switched over

---

## 8. Priority note

The screen is **already shipped and useful** without any of this — a user can see what plan they bought and when. This work upgrades it from "latest term, approximate price" to "every payment, exact charge."

Given the app is not yet live on Play Console and has no paying users, **§3.1 (webhooks) is the time-sensitive part**: configuring it before the first real purchase means no backfill is ever needed. The query endpoint (§3.3) can follow later.
