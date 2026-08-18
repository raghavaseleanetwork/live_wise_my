# Subscription Payment History — Backend Done

**Audience:** Frontend team
**Received from backend team:** 2026-08-15
**Status:** ✅ Both backend pieces from `SUBSCRIPTION-PAYMENT-HISTORY-backend-requirements.md` are implemented, typechecked, and verified live with synthetic webhook events against a local instance connected to the shared MongoDB. Pushed to `origin/main` at commit `bb9c202`.
**Files changed (backend):** `server/routes.ts`

> ### ⚠️ FRONTEND NOTE ADDED ON RECEIPT — read alongside §0
>
> **The backend team's §0 below is factually incorrect for this branch.** They
> appear to have checked `origin/main`, but all the RevenueCat work lives on
> `aselea-frontend-fixers` and some of it is **not yet committed**. Verified
> 2026-08-15 on this branch:
>
> | Their §0 claim | Actual state on `aselea-frontend-fixers` |
> |---|---|
> | No `react-native-purchases` in `package.json` | **Present**, `^10.5.0` (package.json:83) |
> | No `lib/revenuecat.ts` | **Present**, 16.6 KB — modified, uncommitted |
> | No `app/subscription/payment-history.tsx` | **Present**, 12.7 KB — **untracked** |
> | No RevenueCat client integration | `lib/subscription-context.tsx` has 26 RevenueCat references |
> | (implied) no `resolvePlanPrice` | **Present** in `constants/plans.ts` |
>
> See `CLAUDE.md` → "Payments: RevenueCat only" for the integration's design.
>
> **Two real action items this surfaced:**
> 1. **Commit and push the RevenueCat work.** Until `payment-history.tsx` and
>    the `lib/revenuecat.ts` changes are on a shared branch, the backend team
>    is working blind against a repo that looks like RevenueCat was never
>    started. This is what caused the whole §0 misunderstanding.
> 2. **`payment-history.tsx` does NOT call `GET /api/subscription/payments`.**
>    Grepped: zero matches for the endpoint, `apiRequest`, or `fetch` in that
>    file. It is not yet wired to this new backend. That wiring is the
>    remaining frontend task — see §6 below.
>
> Everything in §1–§4 (the endpoints themselves) is unaffected by the above and
> should be taken as accurate.

---

## 0. Backend team's original note — premise does not match this branch

> The original requirements doc described this as upgrading an **existing** Payment History screen from "latest term, approximate price" to "every payment, exact charge." That screen, and the RevenueCat client integration it depends on, **do not exist in this repo**:
>
> - No `react-native-purchases` (or any RevenueCat package) in `package.json`
> - No `app/subscription/payment-history.tsx`
> - No `lib/revenuecat.ts`
> - No `SUBSCRIPTION_BACKEND_TODO.md`
>
> What *does* already exist server-side is a separate, working plan/subscription model — `user.plan` / `planSource` / `planInterval` / `planRenewsAt`, `POST /api/subscription/purchase`, `POST /api/subscription/test-grant`, all built against `constants/plans.ts` (`free` / `starter` / `family` / `pro`). None of that talks to RevenueCat.
>
> **What this means:** the two endpoints below are built and tested against RevenueCat's documented webhook event shape, ready for the moment RevenueCat is actually integrated client-side — but there is currently no app screen anywhere that calls `GET /api/subscription/payments`, and no purchases will ever reach `POST /api/webhooks/revenuecat` until a RevenueCat project exists and the app is wired to it (SDK added, `Purchases.configure()`, `logIn(userId)`, real product ids matching `constants/plans.ts`'s `productIdMonthly`/`productIdYearly`, and the webhook URL configured in the RevenueCat dashboard). If your team is not currently planning a RevenueCat integration, treat this as backend groundwork laid ahead of that work, not a drop-in upgrade to something already shipped.

**Correction:** the SDK, `lib/revenuecat.ts`, the context wiring, and the
payment-history screen all exist (see the frontend note above). What the
backend team got right, and what still stands: **the screen is not calling
their endpoint yet**, and the RevenueCat dashboard/webhook configuration is not
done. So "ready for the moment RevenueCat is integrated" is roughly correct in
effect, just not for the reason stated.

---

## 1. What's live now

| # | Requirement | Result |
|---|---|---|
| 1 | `POST /api/webhooks/revenuecat` — shared-secret auth (not the app JWT), returns 200 fast | ✅ Built and tested |
| 2 | Idempotent on RevenueCat's `event.id` | ✅ Verified: sending the identical event id twice produced exactly one row both times |
| 3 | `subscription_payments` collection, unique index on `eventId`, plus `{ userId, purchasedAt }` for the list query | ✅ Both indexes created in `initIndexes()` |
| 4 | Sandbox events filtered out of user-facing queries | ✅ Verified: a `SANDBOX`-environment event is accepted and stored (for audit), but does not appear in `GET /api/subscription/payments` |
| 5 | `GET /api/subscription/payments` — scoped to `req.userId`, newest first, paginated | ✅ Verified: two separate users each see only their own rows; `?limit=` + `?before=` cursor pagination both tested and advance correctly with no overlap |
| 6 | Empty state returns `200` with `{ payments: [], hasMore: false }`, not `404` | ✅ Verified on a user with zero purchases |
| 7 | Full renewal history, not just latest term per product | ✅ Verified: three separate `RENEWAL` events for the same product produced three distinct rows — this is the exact case the client SDK alone cannot do |
| 8 | Refunds recorded | ✅ Verified: a `REFUND` event lands with `isRefunded: true` |

All 9 numbered tests in the original doc's §6 passed, run with synthetic payloads shaped like RevenueCat's real webhook format (`{ event: { id, type, app_user_id, product_id, purchased_at_ms, price, currency, store, environment, ... } }`).

---

## 2. `POST /api/webhooks/revenuecat`

Not called by the app — this is RevenueCat's server calling ours. Configure in RevenueCat dashboard → Project Settings → Integrations → Webhooks:

- **URL:** `<your deployed backend>/api/webhooks/revenuecat`
- **Authorization header value:** must exactly match the `REVENUECAT_WEBHOOK_SECRET` environment variable set on the server. Pick any long random string and set it in both places — RevenueCat's dashboard config and the backend's env — before going live. **This is not set in production yet**; the endpoint returns `401` on every call until it is.

Handles `INITIAL_PURCHASE`, `RENEWAL`, `PRODUCT_CHANGE`, `CANCELLATION`, `UNCANCELLATION`, `EXPIRATION`, `BILLING_ISSUE`, `SUBSCRIPTION_PAUSED`, `TRANSFER`, `REFUND`, `REFUND_REVERSED`. Events of any other type, or missing `event.id`/`app_user_id`, are acknowledged with `200` but not stored (so RevenueCat doesn't retry something we'll never be able to use).

`product_id` is mapped to our `plan`/`interval` via `constants/plans.ts`'s `productIdMonthly`/`productIdYearly` fields — **the real store product ids configured in RevenueCat must exactly match those strings** (`lifewise_starter_monthly`, `lifewise_family_yearly`, etc.) for a payment to resolve to a plan. If a webhook arrives for a product id that doesn't match any plan, the row is still stored (for audit via `rawEvent`) but `plan`/`interval` will be `null`.

> This matches CLAUDE.md's existing rule #2 ("Product IDs must match
> `PLAN_META[*].productIdMonthly/Yearly` exactly"). Nothing new to decide.

---

## 3. `GET /api/subscription/payments`

```
Auth: required (standard Bearer JWT, same as every other authenticated route)
Query: ?limit=50&before=<ISO date>   (both optional; limit defaults to 50, capped at 200)

200:
{
  "payments": [
    {
      "id": "...", "type": "RENEWAL", "plan": "family", "productId": "lifewise_family_monthly",
      "interval": "month", "amount": 199, "currency": "INR", "store": "PLAY_STORE",
      "purchasedAt": "2026-07-15T10:22:31.000Z", "expiresAt": "2026-08-15T10:22:31.000Z",
      "isRefunded": false
    }
  ],
  "hasMore": false
}
```

For pagination: pass the `purchasedAt` of the last row you received as `before` to get the next page. `hasMore: true` means there are more rows older than what you got back.

This matches the response shape the original doc specified — if/when a payment-history screen is built, it can call this directly.

---

## 4. Backfill — still an open decision, unaffected by today's work

Per the original doc's §5: webhooks only fire from the moment they're configured, so anyone who subscribed before that moment has no history rows. Since there's no RevenueCat integration live yet at all, this is moot for now — **configuring the webhook before the first real RevenueCat-processed purchase means there is nothing to backfill, ever.** If RevenueCat integration and launch happen together, this concern disappears on its own.

---

## 5. Backend team's list of what's needed before this does something useful

> In rough order:
> 1. Add RevenueCat SDK, configure a RevenueCat project, wire `Purchases.configure()` + `logIn(userId)` client-side
> 2. Set matching product ids in the RevenueCat dashboard (must equal `constants/plans.ts`'s `productIdMonthly`/`productIdYearly` values)
> 3. Set `REVENUECAT_WEBHOOK_SECRET` on the deployed backend, and the identical value as the Authorization header in RevenueCat's webhook config
> 4. Build the actual Payment History screen and point it at `GET /api/subscription/payments`
>
> None of these are backend work — flagging them so it's clear why "backend done" here doesn't yet mean "feature done."

---

## 6. Corrected remaining-work list (frontend view, 2026-08-15)

Their §5 list is right in spirit but wrong on items 1 and 4. Actual state:

| # | Item | Status |
|---|---|---|
| 1 | RevenueCat SDK added + `Purchases.configure()` / `logIn(userId)` wired client-side | ✅ **Already done** — `lib/revenuecat.ts`, `lib/subscription-context.tsx`. Needs committing/pushing. |
| 2 | Product ids set in RevenueCat dashboard matching `constants/plans.ts` | ❌ Dashboard config — not done |
| 3 | `REVENUECAT_WEBHOOK_SECRET` set on deployed backend + in RevenueCat webhook config | ❌ Not done (backend confirms endpoint 401s until then) |
| 4 | Payment History screen built | ✅ **Already built** — `app/subscription/payment-history.tsx` |
| 5 | **Point that screen at `GET /api/subscription/payments`** | ❌ **Not done** — the screen makes no network call at all. This is the real frontend task. |
| 6 | Commit + push `payment-history.tsx` (untracked) and `lib/revenuecat.ts` (modified) | ❌ Not done — and it's why §0 got written |

**Immediate next step:** wire item 5, then handle 6 so the backend team stops
seeing a repo without RevenueCat in it. Items 2 and 3 are Play Console /
RevenueCat dashboard chores that gate real end-to-end testing but not the code.

---

## 7. Related documents

- `SUBSCRIPTION-PAYMENT-HISTORY-backend-requirements.md` — the original request this answers.
- `CLAUDE.md` → "Payments: RevenueCat only" — the client-side architecture, the
  entitlement-id and product-id rules, and the note that this integration was
  already reverted once (2026-07-29). Worth re-reading given §0 above;
  uncommitted RevenueCat work going missing is a repeat of that failure mode.
