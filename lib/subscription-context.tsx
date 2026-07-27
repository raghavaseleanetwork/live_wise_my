import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useMemo,
  ReactNode,
} from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  PlanId,
  BillingInterval,
  LimitKey,
  FlagKey,
  TRIAL,
  MONTHLY_LIMIT_KEYS,
} from '@/constants/plans';
import {
  getLimit as getPlanLimit,
  isFlagEnabled,
  checkLimit as engineCheckLimit,
  checkFlag as engineCheckFlag,
  LimitCheck,
  FlagCheck,
} from '@/lib/entitlements';

/**
 * Subscription state — the client-side source of the user's current plan, trial
 * status, and monthly usage counters.
 *
 * PHASE 1 (this file): everything is LOCAL (AsyncStorage). There is no payment
 * gateway yet, so `purchasePlan()` simply sets the local plan — this is the
 * clean seam where IAP / RevenueCat will plug in later. Gates already work
 * against this state so the paywall and screens can be built and demoed.
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
   * Set the owned plan locally. PLACEHOLDER for the future payment gateway —
   * today it just persists the chosen plan so gates/screens reflect it.
   */
  purchasePlan: (planId: PlanId, interval?: BillingInterval) => Promise<{ success: boolean }>;
  /** Restore purchases — stub until IAP lands. */
  restore: () => Promise<{ success: boolean }>;
}

const SubscriptionContext = createContext<SubscriptionContextValue | null>(null);

const STORAGE_KEYS = {
  PLAN: '@lifewise_plan',
  INTERVAL: '@lifewise_plan_interval',
  TRIAL: '@lifewise_trial',
};

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
  const [ownedPlan, setOwnedPlan] = useState<PlanId>('free');
  const [interval, setInterval] = useState<BillingInterval>('month');
  const [trial, setTrial] = useState<TrialState>({ startedAt: null, used: false });
  const [usageMap, setUsageMap] = useState<UsageMap>({});
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const [storedPlan, storedInterval, storedTrial, storedUsage] = await Promise.all([
          AsyncStorage.getItem(STORAGE_KEYS.PLAN),
          AsyncStorage.getItem(STORAGE_KEYS.INTERVAL),
          AsyncStorage.getItem(STORAGE_KEYS.TRIAL),
          AsyncStorage.getItem(usageKeyForMonth()),
        ]);
        if (storedPlan) setOwnedPlan(storedPlan as PlanId);
        if (storedInterval === 'month' || storedInterval === 'year') setInterval(storedInterval);
        if (storedTrial) setTrial(JSON.parse(storedTrial));
        if (storedUsage) setUsageMap(JSON.parse(storedUsage));
      } catch {
        // Non-fatal: fall back to Free defaults.
      } finally {
        setIsLoading(false);
      }
    })();
  }, []);

  const trialDaysLeft = useMemo(() => computeTrialDaysLeft(trial), [trial]);
  const isTrialActive = trialDaysLeft > 0;
  const canStartTrial = !trial.used && !trial.startedAt;

  /** Effective plan = Family while the trial runs, otherwise the owned plan. */
  const currentPlan: PlanId = isTrialActive ? TRIAL.planId : ownedPlan;

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

  const incrementUsage = useCallback(async (key: LimitKey) => {
    setUsageMap((prev) => {
      const next = { ...prev, [key]: (prev[key] ?? 0) + 1 };
      AsyncStorage.setItem(usageKeyForMonth(), JSON.stringify(next)).catch(() => {});
      return next;
    });
  }, []);

  const startTrial = useCallback(async () => {
    if (trial.used || trial.startedAt) return;
    const next: TrialState = { startedAt: new Date().toISOString(), used: true };
    setTrial(next);
    await AsyncStorage.setItem(STORAGE_KEYS.TRIAL, JSON.stringify(next)).catch(() => {});
  }, [trial]);

  const purchasePlan = useCallback(
    async (planId: PlanId, newInterval: BillingInterval = 'month') => {
      // PLACEHOLDER: no payment gateway yet. Persist the chosen plan locally so
      // the app reflects it. Later this calls the store / RevenueCat and only
      // commits on a verified receipt.
      setOwnedPlan(planId);
      setInterval(newInterval);
      await Promise.all([
        AsyncStorage.setItem(STORAGE_KEYS.PLAN, planId),
        AsyncStorage.setItem(STORAGE_KEYS.INTERVAL, newInterval),
      ]).catch(() => {});
      return { success: true };
    },
    [],
  );

  const restore = useCallback(async () => {
    // Stub until IAP / RevenueCat restore is implemented.
    return { success: true };
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
      getLimit,
      isFeatureEnabled,
      usage,
      checkLimit,
      checkFlag,
      incrementUsage,
      startTrial,
      purchasePlan,
      restore,
    }),
    [
      currentPlan,
      ownedPlan,
      interval,
      isLoading,
      isTrialActive,
      trialDaysLeft,
      canStartTrial,
      getLimit,
      isFeatureEnabled,
      usage,
      checkLimit,
      checkFlag,
      incrementUsage,
      startTrial,
      purchasePlan,
      restore,
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
