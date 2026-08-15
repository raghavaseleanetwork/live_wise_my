import React, {
  createContext,
  useContext,
  useState,
  useCallback,
  useMemo,
  useRef,
  ReactNode,
} from 'react';
import { router } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useTranslation } from 'react-i18next';
import {
  PlanId,
  PaywallTriggerKey,
  PAYWALL_TRIGGERS,
} from '@/constants/plans';
import { useSubscription } from '@/lib/subscription-context';
import { useAlert } from '@/lib/alert-context';
import { LIMITS_DISABLED } from '@/lib/entitlements';
import PaywallSheet from '@/components/PaywallSheet';
import PaywallScreen from '@/components/PaywallScreen';

/**
 * Paywall presentation layer. Any screen calls `presentPaywall(triggerKey)` at
 * the moment a user tries to cross a limit; this provider renders the correct
 * paywall (soft bottom sheet, or hard full-screen for critical limits after
 * repeated soft dismissals — doc §5.2) and handles the upgrade / trial actions.
 *
 * Mirrors `AlertProvider`: mounted once near the root, driven imperatively.
 */

const SOFT_DISMISS_LIMIT = 3; // after this many soft dismissals, criticals go hard.
const DISMISS_KEY = '@lifewise_paywall_dismissals';

interface PaywallContextValue {
  presentPaywall: (triggerKey: PaywallTriggerKey) => void;
  hidePaywall: () => void;
}

const PaywallContext = createContext<PaywallContextValue | null>(null);

export function PaywallProvider({ children }: { children: ReactNode }) {
  const {
    currentPlan,
    canStartTrial,
    isTrialProvidingPlan,
    trialDaysLeft,
    startTrial,
    purchasePlan,
    isTestMode,
  } = useSubscription();
  const { showAlert } = useAlert();
  const { t } = useTranslation();

  const [triggerKey, setTriggerKey] = useState<PaywallTriggerKey | null>(null);
  const [mode, setMode] = useState<'soft' | 'hard' | null>(null);
  const [selectedPlan, setSelectedPlan] = useState<PlanId>('family');
  const dismissCount = useRef(0);

  const trigger = triggerKey ? PAYWALL_TRIGGERS[triggerKey] : null;

  const presentPaywall = useCallback(
    (key: PaywallTriggerKey) => {
      // Final backstop for the LIMITS_DISABLED demo switch. The engine already
      // returns `allowed: true` everywhere, but a screen that calls
      // presentPaywall() directly — e.g. off a server 403 — would bypass it.
      if (LIMITS_DISABLED) return;

      const triggerMeta = PAYWALL_TRIGGERS[key];
      setTriggerKey(key);
      setSelectedPlan(triggerMeta.recommendedPlan);
      // Critical limits escalate to the hard paywall once the user has already
      // brushed off enough soft ones.
      const goHard = triggerMeta.critical && dismissCount.current >= SOFT_DISMISS_LIMIT;
      setMode(goHard ? 'hard' : 'soft');
    },
    [],
  );

  const close = useCallback(() => {
    setMode(null);
    setTriggerKey(null);
  }, []);

  const handleSoftDismiss = useCallback(() => {
    dismissCount.current += 1;
    AsyncStorage.setItem(DISMISS_KEY, String(dismissCount.current)).catch(() => {});
    close();
  }, [close]);

  const handleUpgrade = useCallback(
    async (plan: PlanId) => {
      // TEST MODE: confirm, then grant directly. Checked first so a tester can
      // unlock the exact tier the paywall is asking for, rather than being
      // diverted into the one-time trial.
      if (isTestMode) {
        const planName = t(`subscription.planNames.${plan}`);
        showAlert({
          title: t('paywall.testActivateTitle', { planName }),
          message: t('paywall.testActivateMessage', { planName }),
          type: 'warning',
          buttons: [
            { text: t('common.cancel'), style: 'cancel' },
            {
              text: t('paywall.testActivateButton', { planName }),
              onPress: async () => {
                await purchasePlan(plan);
                close();
              },
            },
          ],
        });
        return;
      }

      // Trial first when eligible (no payment), otherwise run the real store
      // purchase through RevenueCat.
      if (canStartTrial) {
        await startTrial();
        close();
        return;
      }

      const result = await purchasePlan(plan);

      // Keep the paywall open if the purchase did not go through, so the user
      // isn't dropped back into a blocked action with no explanation.
      if (result.success) close();
    },
    [isTestMode, showAlert, canStartTrial, startTrial, purchasePlan, close, t],
  );

  const handleSeeAllPlans = useCallback(() => {
    close();
    router.push('/subscription/compare' as any);
  }, [close]);

  const value = useMemo(
    () => ({ presentPaywall, hidePaywall: close }),
    [presentPaywall, close],
  );

  return (
    <PaywallContext.Provider value={value}>
      {children}
      <PaywallSheet
        visible={mode === 'soft'}
        trigger={trigger}
        selectedPlan={selectedPlan}
        onSelectPlan={setSelectedPlan}
        canStartTrial={canStartTrial}
        onUpgrade={handleUpgrade}
        onSeeAllPlans={handleSeeAllPlans}
        onDismiss={handleSoftDismiss}
      />
      <PaywallScreen
        visible={mode === 'hard'}
        trigger={trigger}
        currentPlan={currentPlan}
        canStartTrial={canStartTrial}
        trialDaysLeft={trialDaysLeft}
        isTrialActive={isTrialProvidingPlan}
        onUpgrade={handleUpgrade}
        onClose={close}
      />
    </PaywallContext.Provider>
  );
}

export function usePaywall() {
  const context = useContext(PaywallContext);
  if (!context) {
    throw new Error('usePaywall must be used within a PaywallProvider');
  }
  return context;
}
