# Google Play Billing — Go-Live Setup Guide

**Status:** app code is DONE. What remains is Play Console + RevenueCat dashboard
configuration, which cannot be done from the codebase.

- Package name: `com.lifewise` (locked once the app is created in Play Console)
- Payment gateway: **RevenueCat only** (see CLAUDE.md — do not add Razorpay/Stripe/direct IAP)
- Play Billing is reached *through* RevenueCat. The app never calls Play Billing directly.

---

## 0. Blocker — fix this first

Play Console currently shows:

> **There is an issue with your payments profile** — Contact your account owner.

Until this is cleared, subscriptions you create are **not purchasable**, and test
purchases will fail. Fix path:

1. Play Console → **Setup → Payments profile** (or `payments.google.com`).
2. Sign in as the **account owner** (the Google account that owns the developer account).
3. Complete whatever is flagged — usually one of:
   - Business/tax details (India: PAN + GST if applicable)
   - Bank account for payouts (name must match the business name)
   - Identity verification documents
4. Wait for verification. Google typically takes **1–3 business days**; India tax
   verification can take longer.

You can create the subscription products while this is pending — you just cannot
buy them.

---

## 1. One-time prerequisites in Play Console

| Item | Where | Notes |
|---|---|---|
| App created | Play Console → All apps | Already done ("LifeWise – AI Family Hub") |
| Merchant account linked | Setup → Payments profile | See §0 |
| App signed & uploaded | Test and release → Internal testing | **Required** — you cannot buy IAP against an app that has never been uploaded |
| Billing permission | Automatic | `com.android.vending.BILLING` is added by `react-native-purchases`; no manual edit needed |
| Licence testers added | Setup → Licence testing | Add every Gmail account that will test — they get **real purchase UI with no charge** |

**Important:** the APK/AAB you install for testing must have the **same package
name (`com.lifewise`), the same version code or higher, and the same signing key**
as what is on the testing track. A local `npx expo run:android` debug build is
signed with a debug key and **will not see** Play products. Use an internal
testing track build (or an EAS build with the same upload key).

---

## 2. Create the 6 subscription products

Play Console → **Monetise with Play → Products → Subscriptions → Create subscription**.

The dialog you are on asks for **Product ID** and **Name**. Product ID is
permanent and cannot be reused — type these exactly. They must match
`constants/plans.ts` → `PLAN_META[*].productIdMonthly / productIdYearly`.

### Product IDs to create

| # | Product ID | Name (≤55 chars) | Tier | Period | INR price |
|---|---|---|---|---|---|
| 1 | `lifewise_starter_monthly` | LifeWise Starter – Monthly | Starter | 1 month | ₹99 |
| 2 | `lifewise_starter_yearly`  | LifeWise Starter – Yearly  | Starter | 1 year  | ₹799 |
| 3 | `lifewise_family_monthly`  | LifeWise Family – Monthly  | Family  | 1 month | ₹199 |
| 4 | `lifewise_family_yearly`   | LifeWise Family – Yearly   | Family  | 1 year  | ₹1499 |
| 5 | `lifewise_pro_monthly`     | LifeWise Pro – Monthly     | Pro     | 1 month | ₹499 |
| 6 | `lifewise_pro_yearly`      | LifeWise Pro – Yearly      | Pro     | 1 year  | ₹3999 |

> There is no `free` product. Free is the default state, not a purchase.

### Per-subscription configuration (repeat for each of the 6)

After clicking **Create**, each subscription needs a **base plan**:

1. **Base plan ID** — lowercase letters, numbers and hyphens only. It must be
   unique *within* its subscription, so the same two names can be reused across
   tiers:
   - monthly subscriptions → base plan `monthly-autorenew`
   - yearly subscriptions → base plan `yearly-autorenew`
2. **Type:** Auto-renewing
3. **Billing period:** Monthly (1 month) or Yearly (1 year), matching the product
4. **Grace period:** 7 days (recommended — retries failed payments instead of
   instantly cancelling)
5. **Account hold:** Enabled, 30 days (default)
6. **Resubscribe:** Allow
7. **Prices:** set India ₹ per the table. Then either:
   - let Google auto-convert for other countries, **or**
   - restrict availability to India only, if that is the launch plan
8. **Tax:** India — select the correct tax category (digital goods/services)
9. **Activate** the base plan — it stays a draft otherwise and RevenueCat will
   not see it

### Offers — do NOT create a Play free trial

The 7-day Family trial is a **local product rule**, not a store introductory
offer (CLAUDE.md: "Trial stays local"). Do not add a free-trial offer in Play, or
users get two overlapping trials and the client-side trial logic will disagree
with the store.

---

## 3. Play service account → RevenueCat

RevenueCat needs server access to Play to verify purchases and receive
notifications. This is the step most often missed.

### 3a. Create the service account (Google Cloud Console)

1. Play Console → **Setup → API access**
2. Link a Google Cloud project (create one if prompted, e.g. `lifewise-play`)
3. Click **Create new service account** → opens Google Cloud Console
4. Cloud Console → **IAM & Admin → Service Accounts → Create service account**
   - Name: `revenuecat-lifewise`
   - Role: skip project-level roles (permissions are granted in Play, below)
5. On the created account → **Keys → Add key → Create new key → JSON** → downloads a `.json` file
6. **Keep this file out of git.** Do not commit it to the repo.

### 3b. Grant it Play permissions

1. Back in Play Console → **Setup → API access** → click **Refresh service accounts**
2. Find `revenuecat-lifewise` → **Grant access**
3. Give it at minimum:
   - View app information and download bulk reports
   - View financial data, orders, and cancellation survey responses
   - **Manage orders and subscriptions**
4. Restrict to the LifeWise app only
5. **Invite user / Apply**

> Propagation can take **up to 36 hours**. RevenueCat may report the credentials
> as invalid during this window — that is expected, retry later.

### 3c. Upload to RevenueCat

1. RevenueCat dashboard → your project → **Apps → Google Play Store app**
   (create it if it does not exist)
2. Package name: `com.lifewise`
3. Upload the service account JSON from §3a
4. Save. RevenueCat will validate the credentials.

### 3d. Real-time developer notifications (RTDN)

So RevenueCat learns about renewals, cancellations and refunds immediately:

1. Copy the Pub/Sub topic name from RevenueCat (Google Play app settings page)
2. Play Console → **Monetise with Play → Monetisation setup**
3. Paste it into **Real-time developer notifications → Topic name**
4. **Send test notification** → confirm success

---

## 4. Configure RevenueCat entitlements & offerings

This is what maps store products to LifeWise plans. Getting the IDs wrong is the
number one cause of "purchase succeeds but the plan does not change".

### 4a. Products

RevenueCat → **Products → Import** (it can pull them from Play once §3 is done),
or add manually. You should end up with 6 products matching the IDs in §2.

### 4b. Entitlements — IDs must be lowercase and exact

RevenueCat → **Entitlements → New**. Create exactly three:

| Entitlement ID | Attach these products |
|---|---|
| `starter` | `lifewise_starter_monthly`, `lifewise_starter_yearly` |
| `family`  | `lifewise_family_monthly`, `lifewise_family_yearly` |
| `pro`     | `lifewise_pro_monthly`, `lifewise_pro_yearly` |

**These strings must be `starter` / `family` / `pro`, lowercase.** They map
directly onto `PlanId` in `constants/plans.ts` with no translation table.
`lib/revenuecat.ts` ignores entitlements it does not recognise — it does not
guess — so a typo means the user pays and stays on Free.

### 4c. Offering

RevenueCat → **Offerings → New offering**

- Identifier: `default`, and mark it **Current** — the app reads the current
  offering to render prices
- Add 6 packages, one per product. `$rc_monthly` / `$rc_annual` are RevenueCat's
  reserved identifiers and only cover one tier, so use custom identifiers:
  `starter_monthly`, `starter_yearly`, `family_monthly`, `family_yearly`,
  `pro_monthly`, `pro_yearly`

---

## 5. App-side changes when going live

Small, but required.

### 5a. Swap the API key

`.env`:

```
# Test Store key (current) — remove for production
# EXPO_PUBLIC_REVENUECAT_ANDROID_KEY=test_xxxxxxxx

# Production Google Play key — RevenueCat → Apps → Google Play → Public API key
EXPO_PUBLIC_REVENUECAT_ANDROID_KEY=goog_xxxxxxxxxxxxxxxx
```

The production key starts with `goog_`. Nothing else in the code changes — that
was the point of matching the product IDs.

### 5b. Manage / cancel subscription

Already implemented. The Subscription screen shows a **Manage subscription**
link (paid plans only), and choosing **Free** while a store subscription is live
no longer flips local state — it explains that Google does the billing and opens
the store. Both go through `openManageSubscription()` in
`lib/subscription-context.tsx`, backed by `getManagementUrl()` in
`lib/revenuecat.ts` (prefers RevenueCat's `managementURL`, falls back to the
generic Play subscriptions page).

This is not optional polish: an in-app "cancel" that only changes local state
leaves Play still charging the user, which is a policy problem and a support
nightmare.

### 5c. Test payment mode

The **Test payment mode** toggle on the Subscription screen is already gated on
`__DEV__`, so it cannot appear in a release build. **Verify** by building a
release AAB and confirming the toggle is absent. Do not remove the `__DEV__`
gate; do not simplify it to a stored boolean.

### 5d. Prices

Do not touch `priceMonthly` / `priceYearly` in `constants/plans.ts` for display
purposes. `resolvePlanPrice(plan, interval, storePrices)`
(`constants/plans.ts:487`) already prefers the store price and falls back to the
hardcoded INR values only when offerings have not loaded. Showing a price that
differs from what Play charges is a review rejection.

---

## 6. Testing checklist

| Test | How | Expected |
|---|---|---|
| Offerings load | Open Subscription screen on a Play-installed build | Prices render in Play's formatting, not the hardcoded fallback |
| Purchase | Tap a paid plan as a licence tester | Real Play sheet, "This is a test purchase, you will not be charged" |
| Entitlement maps | After purchase | Current plan chip changes to Starter/Family/Pro |
| Restore | Reinstall app, tap Restore | Plan comes back |
| Upgrade | Starter → Family | Play prorates; app reflects Family |
| Cancel | Play Store → Subscriptions → Cancel | Access continues until period end, then drops to Free |
| Renewal | Licence-test subscriptions renew fast | Stays active |

**Test-purchase renewal speeds** (licence testers only): 1 week → 5 min,
1 month → 5 min, 1 year → 30 min. A test subscription auto-cancels after 6
renewals.

---

## 7. What is deliberately NOT in scope

- **iOS / App Store** — there is no `ios/` folder. Needs `expo prebuild`, a Mac
  or EAS Build, a $99/yr Apple Developer account, and an `appl_...` key.
- **Web payments** — RevenueCat's SDK has no web implementation. Would require
  RevenueCat Web Billing (Stripe-backed), a separate integration.
- **Backend receipt verification** — entitlements are client-side via the SDK.
  The server should consume RevenueCat webhooks before limits are enforced
  server-side. See `backend-team/app docs/SUBSCRIPTION_BACKEND_TODO.md` §5.
- **Play free-trial offers** — the 7-day Family trial stays local (§2).

---

## 8. Order of operations (summary)

1. Clear the payments profile issue (§0) — **blocking**
2. Create 6 subscriptions + base plans, activate them (§2)
3. Upload a build to Internal testing; add licence testers (§1)
4. Service account → Play permissions → RevenueCat JSON → RTDN (§3)
5. RevenueCat entitlements `starter`/`family`/`pro` + `default` offering (§4)
6. Swap `.env` to the `goog_` key (§5a)
7. Run the §6 checklist on an internal-testing build
