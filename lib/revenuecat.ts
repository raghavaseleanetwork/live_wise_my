/**
 * RevenueCat integration — the single payment gateway for LifeWise.
 *
 * This module is the ONLY place that talks to `react-native-purchases`. Everything
 * else (subscription context, paywalls, plan screens) works against the plan model
 * in `constants/plans.ts` and never imports the SDK directly.
 *
 * DEGRADES SAFELY. The SDK is only loaded when:
 *   - a public API key is configured (`EXPO_PUBLIC_REVENUECAT_*_KEY`), AND
 *   - the platform is native (iOS/Android) — `react-native-purchases` has no web
 *     implementation, and the app ships a web build.
 *
 * When either is false, `isConfigured()` returns false and the subscription
 * context falls back to its local AsyncStorage behaviour. No crashes, no stubs
 * leaking into the UI.
 *
 * TEST STORE: a `test_...` key works exactly like a production key here — same
 * offerings, same purchase flow, same CustomerInfo. Going live is a key swap
 * only, provided the store product IDs match `PLAN_META[*].productId*`.
 */

import { Platform } from 'react-native';
import {
  PlanId,
  BillingInterval,
  PLAN_ORDER,
  PLAN_META,
} from '@/constants/plans';

/** Public SDK keys. Safe to embed in the client — these are not secrets. */
const API_KEY =
  Platform.OS === 'ios'
    ? process.env.EXPO_PUBLIC_REVENUECAT_IOS_KEY
    : process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_KEY;

/** The SDK is native-only; the web build must never attempt to load it. */
const IS_SUPPORTED_PLATFORM = Platform.OS === 'ios' || Platform.OS === 'android';

export function isConfigured(): boolean {
  return IS_SUPPORTED_PLATFORM && !!API_KEY;
}

/**
 * Lazily-required SDK handle. A static import would pull the native module into
 * the web bundle and break it, so we require on first use behind the platform
 * check above.
 */
let Purchases: any = null;

function loadSdk(): any {
  if (!isConfigured()) return null;
  if (Purchases) return Purchases;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    Purchases = require('react-native-purchases').default;
    return Purchases;
  } catch {
    // Native module missing (e.g. running in Expo Go). Treat as unconfigured.
    return null;
  }
}

let configured = false;

/**
 * Initialise the SDK. Safe to call repeatedly; only the first call configures.
 * `appUserId` links purchases to the logged-in LifeWise account — pass it so a
 * user's plan follows them across devices and reinstalls. Omit for anonymous.
 */
export async function configure(appUserId?: string | null): Promise<boolean> {
  const sdk = loadSdk();
  if (!sdk) return false;
  if (configured) {
    if (appUserId) await logIn(appUserId);
    return true;
  }
  try {
    await sdk.configure({ apiKey: API_KEY, appUserID: appUserId ?? null });
    configured = true;
    return true;
  } catch {
    return false;
  }
}

/** Associate the RevenueCat customer with a LifeWise user id after login. */
export async function logIn(appUserId: string): Promise<void> {
  const sdk = loadSdk();
  if (!sdk || !configured) return;
  try {
    await sdk.logIn(appUserId);
  } catch {
    // Non-fatal — entitlements still resolve against the anonymous id.
  }
}

/**
 * Detach the customer on logout so the next user starts clean.
 *
 * No-ops when the SDK is already anonymous — calling `logOut()` on an anonymous
 * customer is not an error but logs a loud RevenueCat warning, which fires on
 * every cold start for a logged-out user.
 */
export async function logOut(): Promise<void> {
  const sdk = loadSdk();
  if (!sdk || !configured) return;
  try {
    if (await sdk.isAnonymous()) return;
    await sdk.logOut();
  } catch {
    // Non-fatal — the customer stays on the current id.
  }
}

/**
 * Resolve the highest plan the customer is entitled to.
 *
 * Entitlement identifiers in the RevenueCat dashboard MUST be `starter`,
 * `family`, `pro` (lowercase) so they map onto `PlanId` with no translation
 * table. Anything unrecognised is ignored rather than guessed at.
 *
 * Returns the HIGHEST active tier — if a customer somehow holds two, the better
 * one wins rather than whichever iterated first.
 */
export function planFromCustomerInfo(customerInfo: any): PlanId {
  const active = customerInfo?.entitlements?.active ?? {};
  let best: PlanId = 'free';
  for (const id of Object.keys(active)) {
    const candidate = id as PlanId;
    if (!PLAN_ORDER.includes(candidate)) continue;
    if (PLAN_ORDER.indexOf(candidate) > PLAN_ORDER.indexOf(best)) best = candidate;
  }
  return best;
}

/** Billing interval of the active subscription, best-effort. */
export function intervalFromCustomerInfo(customerInfo: any): BillingInterval | null {
  const active = customerInfo?.entitlements?.active ?? {};
  for (const id of Object.keys(active)) {
    const productId: string | undefined = active[id]?.productIdentifier;
    if (!productId) continue;
    if (productId.includes('yearly') || productId.includes('annual')) return 'year';
    if (productId.includes('monthly')) return 'month';
  }
  return null;
}

/** Current entitlements straight from the SDK cache/network. */
export async function getCustomerInfo(): Promise<any | null> {
  const sdk = loadSdk();
  if (!sdk || !configured) return null;
  try {
    return await sdk.getCustomerInfo();
  } catch {
    return null;
  }
}

/**
 * The current offering's packages, or null when unavailable.
 *
 * Falls back to `offerings.all.default` when `current` is unset — an offering
 * that exists but hasn't been marked "current" in the dashboard is the most
 * common reason a correctly-built catalogue still yields nothing.
 */
export async function getOfferings(): Promise<any | null> {
  const sdk = loadSdk();
  if (!sdk || !configured) return null;
  try {
    const offerings = await sdk.getOfferings();
    const offering = offerings?.current ?? offerings?.all?.default ?? null;

    if (__DEV__ && !offering?.availablePackages?.length) {
      console.warn(
        '[LifeWise/RevenueCat] No packages available. Check the dashboard: ' +
          'products created, attached to an offering, and the offering marked "current". ' +
          `Offerings seen: ${JSON.stringify(Object.keys(offerings?.all ?? {}))}`,
      );
    }
    return offering;
  } catch (e: any) {
    if (__DEV__) console.warn('[LifeWise/RevenueCat] getOfferings failed:', e?.message ?? e);
    return null;
  }
}

/**
 * Find the package matching a plan + interval by store product identifier,
 * using the IDs declared in `constants/plans.ts` as the source of truth.
 */
export function findPackage(offering: any, plan: PlanId, interval: BillingInterval): any | null {
  if (!offering?.availablePackages?.length) return null;
  const meta = PLAN_META[plan];
  const wanted = interval === 'year' ? meta.productIdYearly : meta.productIdMonthly;
  if (!wanted) return null;

  const match =
    offering.availablePackages.find(
      (p: any) =>
        p?.product?.identifier === wanted ||
        // Play appends `:base-plan-id` to subscription product identifiers.
        p?.product?.identifier?.split(':')[0] === wanted,
    ) ?? null;

  if (__DEV__ && !match) {
    const available = offering.availablePackages.map((p: any) => p?.product?.identifier);
    console.warn(
      `[LifeWise/RevenueCat] No product "${wanted}". Available: ${JSON.stringify(available)}`,
    );
  }
  return match;
}

export interface PurchaseResult {
  success: boolean;
  /** True when the user backed out — callers should stay silent, not error. */
  cancelled: boolean;
  /** Plan granted by the store, when the purchase went through. */
  plan: PlanId | null;
  error?: string;
}

/** Run the store purchase flow for a plan + interval. */
export async function purchase(
  plan: PlanId,
  interval: BillingInterval,
): Promise<PurchaseResult> {
  const sdk = loadSdk();
  if (!sdk || !configured) {
    return { success: false, cancelled: false, plan: null, error: 'not_configured' };
  }

  const offering = await getOfferings();
  if (!offering) {
    return { success: false, cancelled: false, plan: null, error: 'no_offerings' };
  }

  const pkg = findPackage(offering, plan, interval);
  if (!pkg) {
    return { success: false, cancelled: false, plan: null, error: 'product_not_found' };
  }

  try {
    const { customerInfo } = await sdk.purchasePackage(pkg);
    return { success: true, cancelled: false, plan: planFromCustomerInfo(customerInfo) };
  } catch (e: any) {
    // User dismissing the store sheet is a normal outcome, not a failure.
    if (e?.userCancelled) {
      return { success: false, cancelled: true, plan: null };
    }
    return {
      success: false,
      cancelled: false,
      plan: null,
      error: e?.message ?? 'purchase_failed',
    };
  }
}

/** Restore previous purchases (required by App Store review). */
export async function restorePurchases(): Promise<PurchaseResult> {
  const sdk = loadSdk();
  if (!sdk || !configured) {
    return { success: false, cancelled: false, plan: null, error: 'not_configured' };
  }
  try {
    const customerInfo = await sdk.restorePurchases();
    return { success: true, cancelled: false, plan: planFromCustomerInfo(customerInfo) };
  } catch (e: any) {
    return {
      success: false,
      cancelled: false,
      plan: null,
      error: e?.message ?? 'restore_failed',
    };
  }
}

/**
 * Subscribe to entitlement changes (renewals, cancellations, expiries, and
 * purchases made outside the app). Returns an unsubscribe function.
 */
export function addCustomerInfoListener(cb: (info: any) => void): () => void {
  const sdk = loadSdk();
  if (!sdk || !configured) return () => {};
  try {
    sdk.addCustomerInfoUpdateListener(cb);
    return () => {
      try {
        sdk.removeCustomerInfoUpdateListener(cb);
      } catch {
        // Listener already detached.
      }
    };
  } catch {
    return () => {};
  }
}

/**
 * One row in the subscription payment history.
 *
 * `amount` is deliberately optional and usually absent — see the note on
 * `getPurchaseHistory` about what the SDK does and does not expose.
 */
export interface PurchaseRecord {
  /** Store product id, e.g. `lifewise_family_monthly`. Unique per row with `date`. */
  productId: string;
  /** Plan this product maps to, or null when the id isn't one of ours. */
  plan: PlanId | null;
  interval: BillingInterval | null;
  /** ISO date the purchase/renewal was recorded by the store. */
  date: string;
  /** ISO date this term expires or renews. Absent for non-renewing purchases. */
  expiresDate: string | null;
  /** True when this is the term currently granting access. */
  isActive: boolean;
  /** Whether the subscription is set to renew at `expiresDate`. */
  willRenew: boolean;
  /** 'App Store' | 'Play Store' | 'Test Store' etc., as the SDK reports it. */
  store: string | null;
  /**
   * Localised price. Only present when the current offering still sells this
   * product — the SDK has no per-transaction amount, so historic prices for
   * products no longer on sale cannot be recovered client-side.
   */
  amount?: string;
}

/**
 * Subscription payment history, newest first.
 *
 * ## What this can and cannot show
 *
 * RevenueCat's client SDK is an *entitlement* API, not a billing ledger. From
 * `CustomerInfo` we can read which products the user owns, when each term began
 * (`allPurchaseDates`), and when it expires (`allExpirationDates`). That is
 * enough for "what did you buy and when".
 *
 * It does **not** expose a per-transaction amount, currency, payment method,
 * invoice number, or refund status — those live in the store account and in
 * RevenueCat's server-side API. Prices here are therefore looked up from the
 * *current* offering, so a product whose price has since changed (or which was
 * pulled from sale) shows no amount rather than a wrong one.
 *
 * A complete, auditable payment history with real charged amounts requires the
 * backend to consume RevenueCat webhooks and serve them. See
 * `backend-team/SUBSCRIPTION-PAYMENT-HISTORY-backend-requirements.md`.
 *
 * Returns `[]` when the SDK is unconfigured (web build, missing key), which the
 * UI renders as an explicit "not available" state rather than an error.
 */
export async function getPurchaseHistory(): Promise<PurchaseRecord[]> {
  const info = await getCustomerInfo();
  if (!info) return [];

  const purchaseDates: Record<string, string> = info.allPurchaseDates ?? {};
  const expirationDates: Record<string, string> = info.allExpirationDates ?? {};
  const activeSubs: string[] = info.activeSubscriptions ?? [];

  // Best-effort price lookup. Failure here must not lose the history itself.
  let prices: Record<string, string> = {};
  try {
    prices = await getProductPriceStrings();
  } catch {
    prices = {};
  }

  const rows: PurchaseRecord[] = [];
  for (const [productId, purchasedAt] of Object.entries(purchaseDates)) {
    if (!purchasedAt) continue;

    const expiresAt = expirationDates[productId] ?? null;
    const entitlement = findEntitlementForProduct(info, productId);

    rows.push({
      productId,
      plan: planForProductId(productId),
      interval: intervalForProductId(productId),
      date: purchasedAt,
      expiresDate: expiresAt,
      isActive: activeSubs.includes(productId),
      willRenew: entitlement?.willRenew ?? false,
      store: entitlement?.store ?? null,
      amount: prices[productId],
    });
  }

  return rows.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
}

/** The entitlement (active or not) backed by a given product id. */
function findEntitlementForProduct(info: any, productId: string): any | null {
  const all = info?.entitlements?.all ?? {};
  for (const key of Object.keys(all)) {
    if (all[key]?.productIdentifier === productId) return all[key];
  }
  return null;
}

/** Reverse of `PLAN_META[*].productIdMonthly/Yearly` — product id back to plan. */
function planForProductId(productId: string): PlanId | null {
  for (const plan of PLAN_ORDER) {
    if (plan === 'free') continue;
    const meta = PLAN_META[plan];
    if (meta?.productIdMonthly === productId || meta?.productIdYearly === productId) {
      return plan;
    }
  }
  return null;
}

/** Billing interval implied by a product id. */
function intervalForProductId(productId: string): BillingInterval | null {
  for (const plan of PLAN_ORDER) {
    if (plan === 'free') continue;
    const meta = PLAN_META[plan];
    if (meta?.productIdMonthly === productId) return 'month';
    if (meta?.productIdYearly === productId) return 'year';
  }
  // Fall back to the naming convention for anything not in PLAN_META.
  if (productId.includes('yearly') || productId.includes('annual')) return 'year';
  if (productId.includes('monthly')) return 'month';
  return null;
}

/**
 * Where the user manages or cancels their subscription.
 *
 * Cancellation is NOT something the app can perform — Google and Apple own it.
 * An in-app "cancel" that only flips local state leaves the store still
 * billing, which is both a support nightmare and a Play policy problem, so the
 * UI must send users here instead.
 *
 * Prefers RevenueCat's `managementURL`, which deep-links to the *specific*
 * subscription when the store provides it. Falls back to the platform's generic
 * subscriptions page, which always exists.
 */
export async function getManagementUrl(): Promise<string> {
  const fallback =
    Platform.OS === 'ios'
      ? 'https://apps.apple.com/account/subscriptions'
      : 'https://play.google.com/store/account/subscriptions';

  const info = await getCustomerInfo();
  return info?.managementURL ?? fallback;
}

/** Localised price strings keyed by *product id* rather than plan+interval. */
async function getProductPriceStrings(): Promise<Record<string, string>> {
  const offering = await getOfferings();
  if (!offering?.availablePackages?.length) return {};

  const prices: Record<string, string> = {};
  for (const pkg of offering.availablePackages) {
    const id = pkg?.product?.identifier;
    const priceString = pkg?.product?.priceString;
    if (id && priceString) prices[id] = priceString;
  }
  return prices;
}

/**
 * Store-localised price strings keyed by `${plan}_${interval}` (e.g. "₹199").
 *
 * Apple and Google own displayed pricing — showing the hardcoded INR values from
 * `constants/plans.ts` to a user in another region is a store-review rejection.
 * The UI prefers these when present and falls back to the static numbers.
 */
export async function getPriceStrings(): Promise<Record<string, string>> {
  const offering = await getOfferings();
  if (!offering?.availablePackages?.length) return {};

  const prices: Record<string, string> = {};
  for (const plan of PLAN_ORDER) {
    if (plan === 'free') continue;
    for (const interval of ['month', 'year'] as BillingInterval[]) {
      const pkg = findPackage(offering, plan, interval);
      const priceString = pkg?.product?.priceString;
      if (priceString) prices[`${plan}_${interval}`] = priceString;
    }
  }
  return prices;
}
