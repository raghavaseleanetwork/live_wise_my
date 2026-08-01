# LifeWise App — Project Notes

## Active workstream: Client UI/Feature Fixes

Client-requested UI and bug fixes are tracked in [ui.log](ui.log), sourced from
`backend-team/app docs/UI_Feature_Fixes - Google Docs.pdf`.

**Workflow for this list (per user instruction, 2026-07-16):**
1. Every item from the client PDF is logged in `ui.log` as a to-do — nothing is changed until told to start.
2. User tells Claude to start a specific item or group.
3. Claude must ask the user for complete detail on that item before writing any code.
4. User provides full detail.
5. Claude implements exactly that change, then marks it done in `ui.log` with a short entry (date, files touched).

Do not batch-implement multiple items speculatively. Do not fix adjacent/related things not explicitly requested. Always confirm scope before editing when working through this list.

If continuing this work in a new session: read `ui.log` first for current status before making any changes.

## Payments: RevenueCat only

**Client decision (2026-07-27): RevenueCat is the app's ONLY payment gateway.**
Do not add Razorpay, Stripe, direct `react-native-iap`, or any other payment path.

### Architecture

`lib/revenuecat.ts` is the **only** module that imports `react-native-purchases`.
Everything else — subscription context, paywalls, plan screens — works against
`PlanId` from `constants/plans.ts` and must never import the SDK directly.

- `lib/subscription-context.tsx` — `purchasePlan()` / `restore()` are the seam.
  The store is authoritative when active: the plan comes from RevenueCat
  entitlements, not from what the user tapped.
- `constants/plans.ts` — plans, limits, flags, and store product IDs. Still the
  source of truth for everything except **price display**.

### Rules that will break things if ignored

1. **Entitlement IDs must be `starter` / `family` / `pro`, lowercase**, matching
   `PlanId`. This is what lets entitlements map to plans with no translation
   table. Unrecognised entitlements are ignored, not guessed at.
2. **Product IDs must match `PLAN_META[*].productIdMonthly/Yearly`** exactly
   (`lifewise_family_monthly`, etc.) in both the Test Store and Play/App Store.
   Matching IDs are what make going live a key swap and nothing more.
3. **Never render `priceMonthly` / `priceYearly` directly.** Use
   `resolvePlanPrice(plan, interval, storePrices)`. Apple and Google own
   displayed pricing; showing a price that differs from what the store charges
   is a review rejection. The hardcoded INR values are a fallback only.
4. **The SDK is native-only.** This app ships a web build. `lib/revenuecat.ts`
   gates on platform + key presence and `require`s the SDK lazily — a static
   import would pull the native module into the web bundle and break it. When
   unconfigured, the app falls back to local AsyncStorage plan switching.
5. **User cancellation is not an error.** `purchasePackage` throws with
   `userCancelled` when the store sheet is dismissed. Stay silent.

### Testing

Native modules cannot run in Expo Go. A dev build is required:

```
npx expo run:android          # or an EAS development build
```

**Test Store** (RevenueCat → Apps → "Show key") runs the full purchase flow with
no Google Play or App Store setup — no $25 fee, no bank details, no service
account. Paste the key into `.env`:

```
EXPO_PUBLIC_REVENUECAT_ANDROID_KEY=test_xxxxxxxx
```

Test Store products are USD-only, so prices display as e.g. `US$1.19` rather
than `₹99`. That is expected and is in fact the signal that offerings loaded —
if you still see the exact INR values, the store did NOT connect.

Test Store validates the *code path*. It does not validate Play Billing itself
(real purchase UI, proration, grace periods, billing retry) — expect a second
round of testing once Play Console is live.

### Test payment mode

The subscription screen has a **Test payment mode** toggle that bypasses the
store and grants plans locally after a confirmation dialog. It exists so paid
tiers can be exercised while Play Console is still being set up.

- **Gated on `__DEV__`** — it grants paid entitlements for free, so it must never
  reach a release build. `isTestMode = IS_TEST_MODE_ALLOWED && stored`, so a
  stale `true` in AsyncStorage cannot enable it in production.
- `applyCustomerInfo()` is skipped while it's on, or the store (correctly
  reporting `free`) would immediately overwrite the test grant.
- Turning it off re-syncs from RevenueCat and drops the grant.
- The test branch is checked **before** the trial branch, so a tester can reach
  any tier instead of being diverted into the one-time Family trial.

Do not remove the `__DEV__` gate, and do not "simplify" it to a plain stored
boolean.

### Deliberately NOT done

- **Trial stays local.** The 7-day Family trial is a product rule (doc §5.3),
  not a store introductory offer. It remains in AsyncStorage.
- **No backend receipt verification.** Entitlements are client-side via the
  RevenueCat SDK. See `backend-team/app docs/SUBSCRIPTION_BACKEND_TODO.md` §5 —
  the server should consume RevenueCat webhooks before limits are enforced
  server-side.
- **Web payments.** RevenueCat's SDK has no web implementation. Real payments on
  web would need RevenueCat **Web Billing** (Stripe-backed), a separate
  integration. Not built.
- **iOS.** There is no `ios/` folder. iOS needs `expo prebuild`, a Mac or EAS
  Build, a $99/yr Apple Developer account, and an `appl_...` key.
- **Android package is `com.lifewise`** (user's decision to keep, 2026-07-27).
  Note it locks permanently once the app is created in Play Console.

### If this integration goes missing again

It was reverted once (2026-07-29) — `lib/revenuecat.ts` survived but the wiring,
`resolvePlanPrice`, and the `react-native-purchases` dependency were all rolled
back. Check with:

```
grep -c resolvePlanPrice constants/plans.ts        # expect 1+
grep -c RevenueCat lib/subscription-context.tsx    # expect 5+
grep react-native-purchases package.json           # expect a version
```
