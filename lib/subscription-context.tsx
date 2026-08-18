import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useMemo,
  ReactNode,
} from 'react';
import { Linking } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  PlanId,
  BillingInterval,
  LimitKey,
  FlagKey,
  TRIAL,
  MONTHLY_LIMIT_KEYS,
  PLAN_ORDER,
} from '@/constants/plans';
import {
  getLimit as getPlanLimit,
  isFlagEnabled,
  checkLimit as engineCheckLimit,
  checkFlag as engineCheckFlag,
  LimitCheck,
  FlagCheck,
} from '@/lib/entitlements';
import * as RevenueCat from '@/lib/revenuecat';
import { useAuth } from '@/lib/auth-context';

/**
 * Subscription state — the client-side source of the user's current plan, trial
 * status, and monthly usage counters.
 *
 * PAYMENTS: RevenueCat is the single payment gateway (see `lib/revenuecat.ts`).
 * When a RevenueCat key is configured AND the platform is native, the store is
 * authoritative: `purchasePlan()` runs the real purchase flow and the plan is
 * derived from RevenueCat entitlements. Otherwise — no key, or the web build —
 * the provider falls back to local AsyncStorage behaviour so the app stays
 * fully usable and demoable.
 *
 * Trial handling remains LOCAL by design. The 7-day Family trial is a product
 * rule (doc §5.3), not a store trial; converting it to a store-managed
 * introductory offer is a separate decision.
 *
 * Mirrors the shape of `AuthProvider` / `CurrencyProvider` so it feels native to
 * the codebase.
 */

interface TrialState {
  /** ISO date the trial started, or null if never started. */
  startedAt: string | null;
  /** Whether the one-time trial has already been consumed (prevents restart). */
  used: boolean;
}

type UsageMap = Partial<Record<LimitKey, number>>;

interface SubscriptionContextValue {
  /** The effective plan RIGHT NOW (this is FAMILY while a trial is active). */
  currentPlan: PlanId;
  /** The plan the user actually owns/selected (ignores trial). */
  ownedPlan: PlanId;
  interval: BillingInterval;
  isLoading: boolean;

  isTrialActive: boolean;
  trialDaysLeft: number;
  /** True if the one-time trial has never been started yet. */
  canStartTrial: boolean;
  /**
   * True only when the trial is what's actually granting the current plan.
   * False once the user owns something equal or better, so the UI stops
   * labelling them a trial user after they've paid.
   */
  isTrialProvidingPlan: boolean;

  /** Numeric limit for the effective plan. */
  getLimit: (key: LimitKey) => number;
  /** Boolean feature availability for the effective plan. */
  isFeatureEnabled: (key: FlagKey) => boolean;
  /** How many of a monthly-metered action the user has used this month. */
  usage: (key: LimitKey) => number;
  /** Check whether one more of `key` is allowed, given known usage. */
  checkLimit: (key: LimitKey, currentCount?: number) => LimitCheck;
  /** Check whether a boolean feature is available. */
  checkFlag: (key: FlagKey) => FlagCheck;
  /** Record one use of a monthly-metered action (voice, scan, WiseAI, etc.). */
  incrementUsage: (key: LimitKey) => Promise<void>;

  /** Start the one-time 7-day Family trial. No-op if already used/active. */
  startTrial: () => Promise<void>;
  /**
   * Buy a plan. Runs the real RevenueCat purchase flow when the store is active;
   * otherwise persists the chosen plan locally (demo / web fallback).
   */
  purchasePlan: (
    planId: PlanId,
    interval?: BillingInterval,
  ) => Promise<{ success: boolean; cancelled?: boolean; error?: string }>;
  /** Restore previous purchases from the store. */
  restore: () => Promise<{ success: boolean; error?: string }>;
  /**
   * Open the store's subscription management page (Play/App Store), where the
   * user cancels or switches. The app cannot cancel on their behalf.
   */
  openManageSubscription: () => Promise<void>;

  /** True when RevenueCat is live (native + key present) — the store is authoritative. */
  isStoreActive: boolean;
  /** Store-localised price strings keyed `${plan}_${interval}`, e.g. "US$1.19". */
  storePrices: Record<string, string>;
  /** True while a purchase/restore is in flight — drives button spinners. */
  isPurchasing: boolean;

  /**
   * TEST MODE — bypasses the store and grants plans locally on confirmation.
   *
   * Exists so the app can be demoed and every paid tier exercised while the
   * real gateway is still being set up. It grants entitlements WITHOUT payment,
   * so it must never be reachable in a production build (see `isTestModeAllowed`).
   */
  isTestMode: boolean;
  setTestMode: (on: boolean) => Promise<void>;
  /** Whether the test-mode toggle may be shown at all (dev builds only). */
  isTestModeAllowed: boolean;
}

const SubscriptionContext = createContext<SubscriptionContextValue | null>(null);

const STORAGE_KEYS = {
  PLAN: '@lifewise_plan',
  INTERVAL: '@lifewise_plan_interval',
  TRIAL: '@lifewise_trial',
  TEST_MODE: '@lifewise_test_payment_mode',
};

/**
 * Test mode is a DEV-ONLY affordance. `__DEV__` is false in any release build,
 * so the toggle cannot appear in a store binary even if the flag was left on in
 * storage — `isTestMode` below is gated on this too, not just the stored value.
 */
const IS_TEST_MODE_ALLOWED = __DEV__;

/** Usage counters are namespaced by month so they reset automatically. */
function usageKeyForMonth(date = new Date()): string {
  const ym = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
  return `@lifewise_usage_${ym}`;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Days remaining in the trial (0 if not active/expired). */
function computeTrialDaysLeft(trial: TrialState): number {
  if (!trial.startedAt) return 0;
  const started = new Date(trial.startedAt).getTime();
  if (Number.isNaN(started)) return 0;
  const elapsedDays = Math.floor((Date.now() - started) / MS_PER_DAY);
  return Math.max(0, TRIAL.durationDays - elapsedDays);
}

export function SubscriptionProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [ownedPlan, setOwnedPlan] = useState<PlanId>('free');
  const [interval, setInterval] = useState<BillingInterval>('month');
  const [trial, setTrial] = useState<TrialState>({ startedAt: null, used: false });
  const [usageMap, setUsageMap] = useState<UsageMap>({});
  const [isLoading, setIsLoading] = useState(true);
  const [isStoreActive, setIsStoreActive] = useState(false);
  const [storePrices, setStorePrices] = useState<Record<string, string>>({});
  const [isPurchasing, setIsPurchasing] = useState(false);
  const [testModeStored, setTestModeStored] = useState(false);

  /** Never true in a release build, whatever storage says. */
  const isTestMode = IS_TEST_MODE_ALLOWED && testModeStored;

  useEffect(() => {
    (async () => {
      try {
        const [storedPlan, storedInterval, storedTrial, storedUsage, storedTestMode] =
          await Promise.all([
            AsyncStorage.getItem(STORAGE_KEYS.PLAN),
            AsyncStorage.getItem(STORAGE_KEYS.INTERVAL),
            AsyncStorage.getItem(STORAGE_KEYS.TRIAL),
            AsyncStorage.getItem(usageKeyForMonth()),
            AsyncStorage.getItem(STORAGE_KEYS.TEST_MODE),
          ]);
        if (storedPlan) setOwnedPlan(storedPlan as PlanId);
        if (storedInterval === 'month' || storedInterval === 'year') setInterval(storedInterval);
        if (storedTrial) setTrial(JSON.parse(storedTrial));
        if (storedUsage) setUsageMap(JSON.parse(storedUsage));
        if (storedTestMode === 'true') setTestModeStored(true);
      } catch {
        // Non-fatal: fall back to Free defaults.
      } finally {
        setIsLoading(false);
      }
    })();
  }, []);

  /**
   * Persist the plan the store reports, so it survives an offline cold start.
   *
   * Skipped entirely while test mode is on: the store would otherwise report
   * `free` (no real entitlement exists) and immediately undo a test grant, both
   * on launch and whenever RevenueCat pushes a CustomerInfo update.
   */
  const applyCustomerInfo = useCallback(
    (info: any) => {
      // Wait for the persisted flags to load. `isTestMode` is false on the very
      // first render because AsyncStorage is async, and the RevenueCat effect
      // fires immediately — without this guard the store (correctly reporting
      // `free`, since no real entitlement exists) overwrites a test grant on
      // every cold start, seconds after the user activated it.
      if (isLoading || isTestMode) return;

      const plan = RevenueCat.planFromCustomerInfo(info);
      const storeInterval = RevenueCat.intervalFromCustomerInfo(info);

      // Never let the store silently downgrade a user to Free. `free` here is
      // ambiguous: it means EITHER "the subscription genuinely lapsed" OR "an
      // entitlement exists but under an unrecognised name" — and we cannot tell
      // which from the client. Downgrading on the wrong guess locks a paying
      // user out of the whole app, so the safe reading is to leave the plan
      // alone. A real lapse is caught server-side once the backend consumes
      // RevenueCat webhooks (see SUBSCRIPTION_*_TODO.md).
      if (plan === 'free') {
        const active = Object.keys(info?.entitlements?.active ?? {});
        if (__DEV__ && active.length) {
          console.warn(
            `[LifeWise/RevenueCat] Unrecognised entitlement(s) ${JSON.stringify(active)} — ` +
              `expected "starter" / "family" / "pro". Keeping the current plan.`,
          );
        }
        return;
      }

      setOwnedPlan(plan);
      AsyncStorage.setItem(STORAGE_KEYS.PLAN, plan).catch(() => {});

      if (storeInterval) {
        setInterval(storeInterval);
        AsyncStorage.setItem(STORAGE_KEYS.INTERVAL, storeInterval).catch(() => {});
      }
    },
    [isLoading, isTestMode],
  );

  /**
   * Bring up RevenueCat and let the store correct the locally-cached plan.
   * The store is the source of truth when active: a subscription that lapsed or
   * was cancelled outside the app must downgrade the user even though
   * AsyncStorage still says otherwise.
   */
  useEffect(() => {
    // Hold off until the persisted plan/test-mode flags are in memory, so the
    // store can't race them (see `applyCustomerInfo`).
    if (isLoading) return;

    let cancelled = false;

    (async () => {
      const ok = await RevenueCat.configure();
      if (cancelled || !ok) return;
      setIsStoreActive(true);

      const info = await RevenueCat.getCustomerInfo();
      if (!cancelled && info) applyCustomerInfo(info);

      const prices = await RevenueCat.getPriceStrings();
      if (!cancelled && Object.keys(prices).length) setStorePrices(prices);
    })();

    // Renewals, cancellations and expiries arrive here without a user action.
    const unsubscribe = RevenueCat.addCustomerInfoListener((info) => {
      if (!cancelled) applyCustomerInfo(info);
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [isLoading, applyCustomerInfo]);

  /**
   * Keep the RevenueCat customer aligned with the logged-in LifeWise account, so
   * a subscription follows the user across devices and reinstalls rather than
   * being stranded on an anonymous device id.
   */
  useEffect(() => {
    if (!isStoreActive) return;
    let cancelled = false;

    (async () => {
      if (user?.id) {
        await RevenueCat.logIn(user.id);
      } else {
        await RevenueCat.logOut();
      }
      const info = await RevenueCat.getCustomerInfo();
      if (!cancelled && info) applyCustomerInfo(info);
    })();

    return () => {
      cancelled = true;
    };
  }, [user?.id, isStoreActive, applyCustomerInfo]);

  const trialDaysLeft = useMemo(() => computeTrialDaysLeft(trial), [trial]);
  const isTrialActive = trialDaysLeft > 0;
  const canStartTrial = !trial.used && !trial.startedAt;

  /**
   * Effective plan = the BEST of the trial plan and the owned plan.
   *
   * The trial must not drag a paying user *down*. Someone who buys Pro during
   * their Family trial would otherwise be capped at Family (100 WiseAI messages
   * instead of 300, no medicine interaction) until the trial expired — paying
   * more for fewer features, which also makes a Pro purchase look like it did
   * nothing.
   */
  const currentPlan: PlanId = useMemo(() => {
    if (!isTrialActive) return ownedPlan;
    return PLAN_ORDER.indexOf(ownedPlan) > PLAN_ORDER.indexOf(TRIAL.planId)
      ? ownedPlan
      : TRIAL.planId;
  }, [isTrialActive, ownedPlan]);

  /** The trial only "counts" while it beats what the user already owns. */
  const isTrialProvidingPlan = isTrialActive && currentPlan === TRIAL.planId && ownedPlan !== currentPlan;

  const getLimit = useCallback((key: LimitKey) => getPlanLimit(currentPlan, key), [currentPlan]);

  const isFeatureEnabled = useCallback(
    (key: FlagKey) => isFlagEnabled(currentPlan, key),
    [currentPlan],
  );

  const usage = useCallback((key: LimitKey) => usageMap[key] ?? 0, [usageMap]);

  const checkLimit = useCallback(
    (key: LimitKey, currentCount?: number) => {
      const count = currentCount ?? (MONTHLY_LIMIT_KEYS.includes(key) ? usageMap[key] ?? 0 : 0);
      return engineCheckLimit(currentPlan, key, count);
    },
    [currentPlan, usageMap],
  );

  const checkFlag = useCallback((key: FlagKey) => engineCheckFlag(currentPlan, key), [currentPlan]);

  const incrementUsage = useCallback(
    async (key: LimitKey) => {
      // Don't meter what isn't metered. On an unlimited plan the counter can
      // never gate anything, and letting it climb means a later downgrade
      // instantly locks the user out on a month they barely used.
      if (getPlanLimit(currentPlan, key) === Infinity) return;

      setUsageMap((prev) => {
        const next = { ...prev, [key]: (prev[key] ?? 0) + 1 };
        AsyncStorage.setItem(usageKeyForMonth(), JSON.stringify(next)).catch(() => {});
        return next;
      });
    },
    [currentPlan],
  );

  const startTrial = useCallback(async () => {
    if (trial.used || trial.startedAt) return;
    const next: TrialState = { startedAt: new Date().toISOString(), used: true };
    setTrial(next);
    await AsyncStorage.setItem(STORAGE_KEYS.TRIAL, JSON.stringify(next)).catch(() => {});
  }, [trial]);

  /** Persist a plan locally (fallback path, and the cache for the store path). */
  const setPlanLocally = useCallback(
    async (planId: PlanId, newInterval: BillingInterval) => {
      setOwnedPlan(planId);
      setInterval(newInterval);

      // Reset this month's meters on an UPGRADE. Counters accrued under a
      // smaller plan otherwise carry over — a user who used their 3 free scans
      // and then upgrades would still be blocked at 3, so the thing they just
      // paid for appears not to work. Downgrades keep their counters.
      const isUpgrade = PLAN_ORDER.indexOf(planId) > PLAN_ORDER.indexOf(ownedPlan);
      if (isUpgrade) {
        setUsageMap({});
        AsyncStorage.removeItem(usageKeyForMonth()).catch(() => {});
      }

      await Promise.all([
        AsyncStorage.setItem(STORAGE_KEYS.PLAN, planId),
        AsyncStorage.setItem(STORAGE_KEYS.INTERVAL, newInterval),
      ]).catch(() => {});
    },
    [ownedPlan],
  );

  /**
   * Turn test mode on/off. Switching OFF re-syncs from the store so a plan
   * granted for free during testing cannot linger as a real entitlement.
   */
  const setTestMode = useCallback(
    async (on: boolean) => {
      if (!IS_TEST_MODE_ALLOWED) return;

      setTestModeStored(on);
      await AsyncStorage.setItem(STORAGE_KEYS.TEST_MODE, String(on)).catch(() => {});

      if (!on) {
        const info = await RevenueCat.getCustomerInfo();
        if (info) {
          const plan = RevenueCat.planFromCustomerInfo(info);
          await setPlanLocally(plan, interval);
        } else {
          // No store to fall back on — drop the test grant rather than keep it.
          await setPlanLocally('free', interval);
        }
      }
    },
    [interval, setPlanLocally],
  );

  const purchasePlan = useCallback(
    async (planId: PlanId, newInterval: BillingInterval = 'month') => {
      // TEST MODE: grant locally, no store call. The confirmation prompt is the
      // caller's responsibility (see the subscription screen).
      if (isTestMode) {
        await setPlanLocally(planId, newInterval);
        return { success: true };
      }

      // Downgrading to Free is not a store transaction — real cancellation
      // happens in the Play/App Store subscription settings.
      if (planId === 'free' || !isStoreActive) {
        await setPlanLocally(planId, newInterval);
        return { success: true };
      }

      setIsPurchasing(true);
      try {
        const result = await RevenueCat.purchase(planId, newInterval);

        if (result.success) {
          // Normally the store's entitlement is authoritative. But a SUCCESSFUL
          // purchase that maps to `free` means the entitlement exists under a
          // name we don't recognise (e.g. a legacy dashboard entitlement like
          // "Lifewise-app Pro" instead of "pro"). Writing `free` there charges
          // the user and then locks them out of everything — strictly worse
          // than trusting what they bought. Fall back to the requested plan and
          // make the misconfiguration loud instead of silent.
          const granted = result.plan && result.plan !== 'free' ? result.plan : planId;
          if (__DEV__ && granted !== result.plan) {
            console.warn(
              `[LifeWise/RevenueCat] Purchase of "${planId}" returned no recognised ` +
                `entitlement. Check the dashboard: entitlement IDs must be exactly ` +
                `"starter" / "family" / "pro" (lowercase). Falling back to "${planId}".`,
            );
          }
          await setPlanLocally(granted, newInterval);
          return { success: true };
        }
        // Cancellation is a normal outcome — the caller shows no error.
        return { success: false, cancelled: result.cancelled, error: result.error };
      } finally {
        setIsPurchasing(false);
      }
    },
    [isStoreActive, isTestMode, setPlanLocally],
  );

  const restore = useCallback(async () => {
    if (!isStoreActive) return { success: true };

    setIsPurchasing(true);
    try {
      const result = await RevenueCat.restorePurchases();
      if (result.success && result.plan) {
        await setPlanLocally(result.plan, interval);
        return { success: true };
      }
      return { success: false, error: result.error };
    } finally {
      setIsPurchasing(false);
    }
  }, [isStoreActive, interval, setPlanLocally]);

  /**
   * Hand the user off to the store to cancel or change their subscription.
   *
   * Deliberately not gated on `isStoreActive`: a user whose plan came from the
   * store still needs this after the SDK fails to configure, and the generic
   * fallback URL is always valid.
   */
  const openManageSubscription = useCallback(async () => {
    const url = await RevenueCat.getManagementUrl();
    try {
      await Linking.openURL(url);
    } catch {
      // Nothing sensible to do — the caller surfaces the URL instead.
    }
  }, []);

  const value = useMemo(
    () => ({
      currentPlan,
      ownedPlan,
      interval,
      isLoading,
      isTrialActive,
      trialDaysLeft,
      canStartTrial,
      isTrialProvidingPlan,
      getLimit,
      isFeatureEnabled,
      usage,
      checkLimit,
      checkFlag,
      incrementUsage,
      startTrial,
      purchasePlan,
      restore,
      openManageSubscription,
      isStoreActive,
      storePrices,
      isPurchasing,
      isTestMode,
      setTestMode,
      isTestModeAllowed: IS_TEST_MODE_ALLOWED,
    }),
    [
      currentPlan,
      ownedPlan,
      interval,
      isLoading,
      isTrialActive,
      trialDaysLeft,
      canStartTrial,
      isTrialProvidingPlan,
      getLimit,
      isFeatureEnabled,
      usage,
      checkLimit,
      checkFlag,
      incrementUsage,
      startTrial,
      purchasePlan,
      restore,
      openManageSubscription,
      isStoreActive,
      storePrices,
      isPurchasing,
      isTestMode,
      setTestMode,
    ],
  );

  return <SubscriptionContext.Provider value={value}>{children}</SubscriptionContext.Provider>;
}

export function useSubscription() {
  const context = useContext(SubscriptionContext);
  if (!context) {
    throw new Error('useSubscription must be used within a SubscriptionProvider');
  }
  return context;
}
