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
