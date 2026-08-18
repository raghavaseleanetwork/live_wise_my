import React, { useState } from 'react';
import {
  StyleSheet,
  Text,
  View,
  ScrollView,
  Pressable,
  Platform,
  Switch,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@/lib/theme-context';
import { useAlert } from '@/lib/alert-context';
import { useSubscription } from '@/lib/subscription-context';
import PlanBadge from '@/components/PlanBadge';
import {
  PlanId,
  BillingInterval,
  PLAN_ORDER,
  PLAN_META,
  resolvePlanPrice,
} from '@/constants/plans';
import { LoadingIndicator } from '@/components/PremiumLoader';

/**
 * Manage Plan screen (doc §4). Current-plan card, trial banner, monthly/yearly
 * toggle, and one card per plan with a benefit list. Family is gold-highlighted
 * with a "Most Popular" badge. CTAs use the local `purchasePlan`/`startTrial`
 * seam — no payment gateway yet.
 */

/**
 * A short, human benefit list per plan for the plan cards (marketing copy).
 * Labels live in `subscription.planBenefits.<plan>` (an array in the locale
 * files) and are resolved via `t(key, { returnObjects: true })` at render time.
 */
function usePlanBenefits(planId: PlanId, t: (key: string, opts?: any) => any): string[] {
  const list = t(`subscription.planBenefits.${planId}`, { returnObjects: true });
  return Array.isArray(list) ? list : [];
}

function PlanCard({
  planId,
  interval,
  isCurrent,
  onChoose,
  canStartTrial,
  storePrices,
  isPurchasing,
}: {
  planId: PlanId;
  interval: BillingInterval;
  isCurrent: boolean;
  onChoose: (plan: PlanId) => void;
  canStartTrial: boolean;
  storePrices: Record<string, string>;
  isPurchasing: boolean;
}) {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const meta = PLAN_META[planId];
  const isFamily = planId === 'family';
  const price = resolvePlanPrice(planId, interval, storePrices);
  const per = meta.priceMonthly === 0 ? '' : interval === 'year' ? t('subscription.perYear') : t('subscription.perMonth');
  const benefits = usePlanBenefits(planId, t);

  const accent = isFamily ? colors.warning : colors.accent;
  const accentDim = isFamily ? colors.warningDim : colors.accentDim;

  const ctaLabel = isCurrent
    ? t('subscription.currentPlanCta')
    : planId === 'free'
      ? t('subscription.downgrade')
      : canStartTrial
        ? t('subscription.startTrial')
        : t('subscription.choosePlan');

  return (
    <View
      style={[
        styles.planCard,
        {
          backgroundColor: colors.card,
          borderColor: isCurrent ? accent : isFamily ? colors.warning : colors.border,
          borderWidth: isCurrent || isFamily ? 1.5 : 1,
        },
      ]}
    >
      {isFamily && (
        <View style={[styles.popularBadge, { backgroundColor: colors.warning }]}>
          <Ionicons name="star" size={11} color="#FFFFFF" />
          <Text style={styles.popularText}>{t('subscription.mostPopular')}</Text>
        </View>
      )}

      <View style={styles.planHeader}>
        <View>
          <Text style={[styles.planName, { color: colors.text }]}>{t(`subscription.planNames.${planId}`)}</Text>
          <Text style={[styles.planTagline, { color: colors.textSecondary }]}>{t(`subscription.planTaglines.${planId}`)}</Text>
        </View>
        {isCurrent && <PlanBadge plan={planId} size="sm" />}
      </View>

      <View style={styles.priceRow}>
        <Text style={[styles.price, { color: colors.text }]}>{price}</Text>
        {per ? <Text style={[styles.pricePer, { color: colors.textSecondary }]}>{per}</Text> : null}
        {interval === 'year' && meta.yearlyDiscountLabel ? (
          <View style={[styles.discountChip, { backgroundColor: colors.accentMintDim }]}>
            <Text style={[styles.discountText, { color: colors.accentMint }]}>
              {meta.yearlyDiscountLabel}
            </Text>
          </View>
        ) : null}
      </View>

      <View style={styles.benefitList}>
        {benefits.map((b) => (
          <View key={b} style={styles.benefitRow}>
            <Ionicons name="checkmark-circle" size={16} color={accent} />
            <Text style={[styles.benefitText, { color: colors.text }]}>{b}</Text>
          </View>
        ))}
      </View>

      {isCurrent || planId === 'free' ? (
        <Pressable
          onPress={() => onChoose(planId)}
          disabled={isCurrent}
          style={[
            styles.planCta,
            { backgroundColor: isCurrent ? accentDim : colors.border },
          ]}
        >
          <Text
            style={[styles.planCtaText, { color: isCurrent ? accent : colors.textSecondary }]}
          >
            {ctaLabel}
          </Text>
        </Pressable>
      ) : (
        <Pressable
          onPress={() => onChoose(planId)}
          disabled={isPurchasing}
          style={[styles.planCtaWrap, isPurchasing && { opacity: 0.6 }]}
        >
          <LinearGradient
            colors={
              (isFamily
                ? [colors.warning, '#D97706']
                : colors.buttonGradient) as unknown as [string, string]
            }
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={styles.planCta}
          >
            {isPurchasing ? (
              <LoadingIndicator size="small" color="#FFFFFF" />
            ) : (
              <Text style={[styles.planCtaText, { color: '#FFFFFF' }]}>{ctaLabel}</Text>
            )}
          </LinearGradient>
        </Pressable>
      )}
    </View>
  );
}

export default function SubscriptionScreen() {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const { t } = useTranslation();
  const { showAlert } = useAlert();
  const {
    currentPlan,
    ownedPlan,
    isTrialProvidingPlan,
    trialDaysLeft,
    canStartTrial,
    startTrial,
    purchasePlan,
    restore,
    openManageSubscription,
    isStoreActive,
    storePrices,
    isPurchasing,
    isTestMode,
    setTestMode,
    isTestModeAllowed,
  } = useSubscription();

  const [interval, setInterval] = useState<BillingInterval>('month');

  const topInset = Platform.OS === 'web' ? 67 : insets.top;
  const bottomInset = Platform.OS === 'web' ? 34 : Math.max(insets.bottom, 20);

  const handleBack = () => {
    if (router.canGoBack()) router.back();
    else router.replace('/(tabs)/settings');
  };

  /** Apply a plan without the store, after the tester confirms. */
  const applyTestPlan = async (plan: PlanId) => {
    const planName = t(`subscription.planNames.${plan}`);
    await purchasePlan(plan, interval);
    showAlert({
      title: t('subscription.alerts.testActivatedTitle', { plan: planName }),
      message: t('subscription.alerts.testActivatedMsg', { plan: planName }),
      type: 'success',
      buttons: [{ text: t('common.done') }],
    });
  };

  const handleChoose = async (plan: PlanId) => {
    // Compare against the OWNED plan, not the effective one: during a trial the
    // effective plan is Family, which would otherwise make the Family card
    // unselectable even though the user doesn't own it yet.
    if (plan === ownedPlan) return;

    const planName = t(`subscription.planNames.${plan}`);

    // TEST MODE: confirm, then grant directly — no store, no payment.
    // Checked before the trial branch so testers can reach any tier on demand
    // rather than being redirected into the one-time Family trial.
    if (isTestMode && plan !== 'free') {
      showAlert({
        title: t('subscription.alerts.testConfirmTitle', { plan: planName }),
        message: t('subscription.alerts.testConfirmMsg', { plan: planName }),
        type: 'warning',
        buttons: [
          { text: t('common.cancel'), style: 'cancel' },
          { text: t('subscription.alerts.activateBtn', { plan: planName }), onPress: () => applyTestPlan(plan) },
        ],
      });
      return;
    }

    // DOWNGRADE TO FREE with a live store subscription. The app cannot cancel
    // on the user's behalf — only Google/Apple can. Flipping local state here
    // would hide a subscription that keeps billing, so send them to the store
    // instead of pretending we cancelled anything.
    if (plan === 'free' && isStoreActive && !isTestMode) {
      showAlert({
        title: t('subscription.alerts.cancelInStoreTitle'),
        message: t('subscription.alerts.cancelInStoreMsg'),
        type: 'info',
        buttons: [
          { text: t('common.cancel'), style: 'cancel' },
          {
            text: t('subscription.alerts.openStoreBtn'),
            onPress: () => { void openManageSubscription(); },
          },
        ],
      });
      return;
    }

    if (canStartTrial && plan !== 'free') {
      await startTrial();
      showAlert({
        title: t('subscription.alerts.trialStartedTitle'),
        message: t('subscription.alerts.trialStartedMsg'),
        type: 'success',
        buttons: [{ text: t('subscription.alerts.great') }],
      });
      return;
    }

    const result = await purchasePlan(plan, interval);

    // Backing out of the store sheet is normal — say nothing.
    if (result.cancelled) return;

    if (!result.success) {
      showAlert({
        title: t('subscription.alerts.purchaseFailedTitle'),
        message:
          result.error === 'product_not_found' || result.error === 'no_offerings'
            ? t('subscription.alerts.purchaseFailedProductMsg')
            : t('subscription.alerts.purchaseFailedGenericMsg'),
        type: 'error',
        buttons: [{ text: t('common.ok') }],
      });
      return;
    }

    showAlert({
      title: plan === 'free' ? t('subscription.alerts.planChangedTitle') : t('subscription.alerts.welcomeTitle', { plan: planName }),
      message:
        plan === 'free'
          ? t('subscription.alerts.planChangedFreeMsg')
          : t('subscription.alerts.welcomeMsg', { plan: planName }),
      type: 'success',
      buttons: [{ text: t('common.done') }],
    });
  };

  const handleRestore = async () => {
    const result = await restore();
    showAlert({
      title: result.success ? t('subscription.alerts.restoredTitle') : t('subscription.alerts.notRestoredTitle'),
      message: result.success
        ? t('subscription.alerts.restoredMsg')
        : t('subscription.alerts.notRestoredMsg'),
      type: result.success ? 'success' : 'info',
      buttons: [{ text: t('common.ok') }],
    });
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.bg }]}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[
          styles.scrollContent,
          { paddingTop: topInset + 16, paddingBottom: bottomInset + 20 },
        ]}
      >
        <View style={styles.headerRow}>
          <Pressable onPress={handleBack} hitSlop={10}>
            <Ionicons name="arrow-back" size={24} color={colors.text} />
          </Pressable>
          <Text style={[styles.screenTitle, { color: colors.text }]}>{t('subscription.title')}</Text>
          <View style={{ width: 24 }} />
        </View>

        {/* Current plan card */}
        <Animated.View entering={FadeInDown.duration(300)}>
          <LinearGradient
            colors={colors.heroGradient as unknown as [string, string, ...string[]]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={[styles.currentCard, { borderColor: colors.border }]}
          >
            <View style={styles.currentTop}>
              <Text style={[styles.currentLabel, { color: colors.textSecondary }]}>
                {t('subscription.currentPlan')}
              </Text>
              <PlanBadge plan={currentPlan} showStar trial={isTrialProvidingPlan} />
            </View>
            <Text style={[styles.currentPlanName, { color: colors.text }]}>
              {t(`subscription.planNames.${currentPlan}`)}
            </Text>
            {isTrialProvidingPlan ? (
              <View style={styles.trialBanner}>
                <Ionicons name="time" size={15} color={colors.warning} />
                <Text style={[styles.trialBannerText, { color: colors.warning }]}>
                  {t('subscription.trialEndsIn', { count: trialDaysLeft })}
                  {ownedPlan === 'free' ? t('subscription.thenRevertsToFree') : ''}
                </Text>
              </View>
            ) : (
              <Text style={[styles.currentSub, { color: colors.textSecondary }]}>
                {t(`subscription.planTaglines.${currentPlan}`)}
              </Text>
            )}
          </LinearGradient>
        </Animated.View>

        {/*
          TEST PAYMENT MODE — dev builds only (`__DEV__`), never in a release
          binary. Lets testers exercise every paid tier while the real gateway
          is still being set up.
        */}
        {isTestModeAllowed && (
          <View
            style={[
              styles.testModeCard,
              {
                backgroundColor: isTestMode ? colors.warningDim : colors.card,
                borderColor: isTestMode ? colors.warning : colors.border,
              },
            ]}
          >
            <View style={styles.testModeRow}>
              <Ionicons
                name={isTestMode ? 'flask' : 'flask-outline'}
                size={20}
                color={isTestMode ? colors.warning : colors.textSecondary}
              />
              <View style={styles.testModeTextWrap}>
                <Text style={[styles.testModeTitle, { color: colors.text }]}>
                  {t('subscription.testPayment.title')}
                </Text>
                <Text style={[styles.testModeSub, { color: colors.textSecondary }]}>
                  {isTestMode
                    ? t('subscription.testPayment.onSub')
                    : t('subscription.testPayment.offSub')}
                </Text>
              </View>
              <Switch
                value={isTestMode}
                onValueChange={setTestMode}
                trackColor={{ false: colors.border, true: colors.warning }}
                thumbColor="#FFFFFF"
              />
            </View>
            {isTestMode && (
              <Text style={[styles.testModeWarn, { color: colors.warning }]}>
                {t('subscription.testPayment.warning')}
              </Text>
            )}
          </View>
        )}

        {/* Billing interval toggle */}
        <View style={[styles.toggle, { backgroundColor: colors.card, borderColor: colors.border }]}>
          {(['month', 'year'] as BillingInterval[]).map((opt) => {
            const active = interval === opt;
            return (
              <Pressable
                key={opt}
                onPress={() => setInterval(opt)}
                style={[styles.toggleOpt, active && { backgroundColor: colors.accentDim }]}
              >
                <Text
                  style={[
                    styles.toggleText,
                    { color: active ? colors.accent : colors.textSecondary },
                  ]}
                >
                  {opt === 'month' ? t('subscription.monthly') : t('subscription.yearly')}
                </Text>
                {opt === 'year' && (
                  <Text style={[styles.toggleSave, { color: colors.accentMint }]}>{t('subscription.saveUpTo')}</Text>
                )}
              </Pressable>
            );
          })}
        </View>

        {/* Plan cards */}
        {PLAN_ORDER.map((planId, i) => (
          <Animated.View key={planId} entering={FadeInDown.duration(300).delay(80 * (i + 1))}>
            <PlanCard
              planId={planId}
              interval={interval}
              // Owned, not effective: during a trial the user hasn't bought
              // Family, so its card must stay selectable.
              isCurrent={planId === ownedPlan}
              onChoose={handleChoose}
              canStartTrial={canStartTrial}
              storePrices={storePrices}
              isPurchasing={isPurchasing}
            />
          </Animated.View>
        ))}

        <Pressable
          onPress={() => router.push('/subscription/compare' as any)}
          style={[styles.compareLink, { borderColor: colors.border }]}
        >
          <Ionicons name="list" size={18} color={colors.accent} />
          <Text style={[styles.compareLinkText, { color: colors.accent }]}>
            {t('subscription.compareAllPlans')}
          </Text>
        </Pressable>

        {/* Restore is required by App Store review and expected on Play. */}
        {isStoreActive && !isTestMode && (
          <Pressable onPress={handleRestore} disabled={isPurchasing} style={styles.restoreLink}>
            <Text
              style={[
                styles.restoreLinkText,
                { color: colors.textSecondary, opacity: isPurchasing ? 0.5 : 1 },
              ]}
            >
              {t('subscription.restorePurchases')}
            </Text>
          </Pressable>
        )}

        {/*
          Cancellation and payment-method changes live in the store, not here.
          Shown only to users who actually hold a paid plan — there is nothing
          to manage on Free.
        */}
        {isStoreActive && !isTestMode && ownedPlan !== 'free' && (
          <Pressable onPress={() => { void openManageSubscription(); }} style={styles.restoreLink}>
            <Text style={[styles.restoreLinkText, { color: colors.textSecondary }]}>
              {t('subscription.manageSubscription')}
            </Text>
          </Pressable>
        )}

        <Text style={[styles.footnote, { color: colors.textTertiary }]}>
          {isTestMode
            ? t('subscription.footnoteTestMode')
            : isStoreActive
              ? t('subscription.footnoteStore')
              : t('subscription.footnoteNoStore')}
        </Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scrollContent: { paddingHorizontal: 20 },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 20,
  },
  screenTitle: {
    fontFamily: 'Inter_700Bold',
    fontSize: 20,
  },
  currentCard: {
    borderRadius: 24,
    borderWidth: 1,
    padding: 20,
    marginBottom: 20,
  },
  currentTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  currentLabel: {
    fontFamily: 'Inter_500Medium',
    fontSize: 13,
  },
  currentPlanName: {
    fontFamily: 'Inter_800ExtraBold',
    fontSize: 28,
  },
  currentSub: {
    fontFamily: 'Inter_400Regular',
    fontSize: 14,
    marginTop: 4,
  },
  trialBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 8,
  },
  trialBannerText: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 13,
    flex: 1,
  },
  toggle: {
    flexDirection: 'row',
    // Stretch both halves to the tallest one, so the single-line "Monthly" pill
    // is the same height as the two-line "Yearly · Save up to 37%" pill.
    alignItems: 'stretch',
    borderWidth: 1,
    borderRadius: 16,
    padding: 4,
    marginBottom: 20,
  },
  toggleOpt: {
    flex: 1,
    alignItems: 'center',
    // Vertical centring is what puts "Monthly" in the middle of its pill —
    // without it the label sits at the top, misaligned with "Yearly" opposite.
    justifyContent: 'center',
    paddingVertical: 10,
    borderRadius: 12,
  },
  toggleText: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 14,
  },
  toggleSave: {
    fontFamily: 'Inter_500Medium',
    fontSize: 11,
    marginTop: 2,
  },
  planCard: {
    borderRadius: 24,
    padding: 20,
    marginBottom: 16,
  },
  popularBadge: {
    position: 'absolute',
    top: -10,
    right: 20,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
  },
  popularText: {
    fontFamily: 'Inter_700Bold',
    fontSize: 10,
    color: '#FFFFFF',
    letterSpacing: 0.2,
  },
  planHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  planName: {
    fontFamily: 'Inter_700Bold',
    fontSize: 20,
  },
  planTagline: {
    fontFamily: 'Inter_400Regular',
    fontSize: 13,
    marginTop: 2,
    maxWidth: 200,
  },
  priceRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 6,
    marginBottom: 16,
  },
  price: {
    fontFamily: 'Inter_800ExtraBold',
    fontSize: 26,
  },
  pricePer: {
    fontFamily: 'Inter_500Medium',
    fontSize: 14,
  },
  discountChip: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    marginLeft: 4,
  },
  discountText: {
    fontFamily: 'Inter_700Bold',
    fontSize: 11,
  },
  benefitList: {
    gap: 9,
    marginBottom: 18,
  },
  benefitRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
  },
  benefitText: {
    fontFamily: 'Inter_500Medium',
    fontSize: 14,
    flex: 1,
  },
  planCtaWrap: {
    borderRadius: 14,
    overflow: 'hidden',
  },
  planCta: {
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  planCtaText: {
    fontFamily: 'Inter_700Bold',
    fontSize: 15,
    textAlign: 'center',
  },
  compareLink: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderWidth: 1,
    borderRadius: 14,
    paddingVertical: 14,
    marginTop: 4,
  },
  compareLinkText: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 14,
  },
  testModeCard: {
    borderWidth: 1.5,
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
  },
  testModeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  testModeTextWrap: {
    flex: 1,
  },
  testModeTitle: {
    fontFamily: 'Inter_700Bold',
    fontSize: 15,
  },
  testModeSub: {
    fontFamily: 'Inter_400Regular',
    fontSize: 12,
    marginTop: 2,
  },
  testModeWarn: {
    fontFamily: 'Inter_500Medium',
    fontSize: 12,
    lineHeight: 17,
    marginTop: 10,
  },
  restoreLink: {
    alignItems: 'center',
    paddingVertical: 14,
    marginTop: 8,
  },
  restoreLinkText: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 14,
  },
  footnote: {
    fontFamily: 'Inter_400Regular',
    fontSize: 12,
    lineHeight: 17,
    textAlign: 'center',
    marginTop: 16,
  },
});
