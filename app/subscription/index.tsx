import React, { useState } from 'react';
import {
  StyleSheet,
  Text,
  View,
  ScrollView,
  Pressable,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { useTheme } from '@/lib/theme-context';
import { useAlert } from '@/lib/alert-context';
import { useSubscription } from '@/lib/subscription-context';
import PlanBadge from '@/components/PlanBadge';
import {
  PlanId,
  BillingInterval,
  PLAN_ORDER,
  PLAN_META,
  formatPlanPrice,
} from '@/constants/plans';

/**
 * Manage Plan screen (doc §4). Current-plan card, trial banner, monthly/yearly
 * toggle, and one card per plan with a benefit list. Family is gold-highlighted
 * with a "Most Popular" badge. CTAs use the local `purchasePlan`/`startTrial`
 * seam — no payment gateway yet.
 */

/** A short, human benefit list per plan for the plan cards (marketing copy). */
const PLAN_BENEFITS: Record<PlanId, string[]> = {
  free: [
    '2 family members',
    '3 modules per member',
    '10 reminders • 7-day history',
    'Bill scan & voice entry (limited)',
    'No ads, ever',
  ],
  starter: [
    '4 family members',
    '8 modules per member',
    '50 reminders • 3-month history',
    'Bank PDF import • CSV import',
    '10 documents • 1 caregiver/member',
  ],
  family: [
    'Unlimited members & modules',
    'Unlimited reminders • 12-month history',
    'PDF reports • Money leak alerts',
    'Budget alerts • Location sharing (6)',
    'WiseAI 100 msgs/mo • 50 documents',
  ],
  pro: [
    'Everything in Family',
    'Unlimited documents & history',
    'WiseAI 300 msgs/mo',
    'Medicine interaction & pill ID',
    'Data export • Priority support',
  ],
};

function PlanCard({
  planId,
  interval,
  isCurrent,
  onChoose,
  canStartTrial,
}: {
  planId: PlanId;
  interval: BillingInterval;
  isCurrent: boolean;
  onChoose: (plan: PlanId) => void;
  canStartTrial: boolean;
}) {
  const { colors } = useTheme();
  const meta = PLAN_META[planId];
  const isFamily = planId === 'family';
  const price = interval === 'year' ? meta.priceYearly : meta.priceMonthly;
  const per = meta.priceMonthly === 0 ? '' : interval === 'year' ? '/year' : '/month';

  const accent = isFamily ? colors.warning : colors.accent;
  const accentDim = isFamily ? colors.warningDim : colors.accentDim;

  const ctaLabel = isCurrent
    ? 'Current plan'
    : planId === 'free'
      ? 'Downgrade'
      : canStartTrial
        ? 'Start 7-Day Free Trial'
        : 'Choose plan';

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
          <Text style={styles.popularText}>Most Popular</Text>
        </View>
      )}

      <View style={styles.planHeader}>
        <View>
          <Text style={[styles.planName, { color: colors.text }]}>{meta.name}</Text>
          <Text style={[styles.planTagline, { color: colors.textSecondary }]}>{meta.tagline}</Text>
        </View>
        {isCurrent && <PlanBadge plan={planId} size="sm" />}
      </View>

      <View style={styles.priceRow}>
        <Text style={[styles.price, { color: colors.text }]}>{formatPlanPrice(price)}</Text>
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
        {PLAN_BENEFITS[planId].map((b) => (
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
        <Pressable onPress={() => onChoose(planId)} style={styles.planCtaWrap}>
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
            <Text style={[styles.planCtaText, { color: '#FFFFFF' }]}>{ctaLabel}</Text>
          </LinearGradient>
        </Pressable>
      )}
    </View>
  );
}

export default function SubscriptionScreen() {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const { showAlert } = useAlert();
  const {
    currentPlan,
    ownedPlan,
    isTrialActive,
    trialDaysLeft,
    canStartTrial,
    startTrial,
    purchasePlan,
  } = useSubscription();

  const [interval, setInterval] = useState<BillingInterval>('month');

  const topInset = Platform.OS === 'web' ? 67 : insets.top;
  const bottomInset = Platform.OS === 'web' ? 34 : Math.max(insets.bottom, 20);

  const handleBack = () => {
    if (router.canGoBack()) router.back();
    else router.replace('/(tabs)/settings');
  };

  const handleChoose = async (plan: PlanId) => {
    if (plan === currentPlan) return;

    const meta = PLAN_META[plan];
    if (canStartTrial && plan !== 'free') {
      await startTrial();
      showAlert({
        title: 'Trial started 🎉',
        message: 'Your 7-day Family trial is now active. Enjoy full access!',
        type: 'success',
        buttons: [{ text: 'Great' }],
      });
      return;
    }

    await purchasePlan(plan, interval);
    showAlert({
      title: plan === 'free' ? 'Plan changed' : `Welcome to ${meta.name}!`,
      message:
        plan === 'free'
          ? "You're now on the Free plan."
          : `You're now on the ${meta.name} plan. (Payment is added in a later update.)`,
      type: 'success',
      buttons: [{ text: 'Done' }],
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
          <Text style={[styles.screenTitle, { color: colors.text }]}>Subscription</Text>
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
                Current plan
              </Text>
              <PlanBadge plan={currentPlan} showStar trial={isTrialActive} />
            </View>
            <Text style={[styles.currentPlanName, { color: colors.text }]}>
              {PLAN_META[currentPlan].name}
            </Text>
            {isTrialActive ? (
              <View style={styles.trialBanner}>
                <Ionicons name="time" size={15} color={colors.warning} />
                <Text style={[styles.trialBannerText, { color: colors.warning }]}>
                  Your Family trial ends in {trialDaysLeft}{' '}
                  {trialDaysLeft === 1 ? 'day' : 'days'}
                  {ownedPlan === 'free' ? ' — then reverts to Free' : ''}
                </Text>
              </View>
            ) : (
              <Text style={[styles.currentSub, { color: colors.textSecondary }]}>
                {PLAN_META[currentPlan].tagline}
              </Text>
            )}
          </LinearGradient>
        </Animated.View>

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
                  {opt === 'month' ? 'Monthly' : 'Yearly'}
                </Text>
                {opt === 'year' && (
                  <Text style={[styles.toggleSave, { color: colors.accentMint }]}>Save up to 37%</Text>
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
              isCurrent={planId === currentPlan}
              onChoose={handleChoose}
              canStartTrial={canStartTrial}
            />
          </Animated.View>
        ))}

        <Pressable
          onPress={() => router.push('/subscription/compare' as any)}
          style={[styles.compareLink, { borderColor: colors.border }]}
        >
          <Ionicons name="list" size={18} color={colors.accent} />
          <Text style={[styles.compareLinkText, { color: colors.accent }]}>
            Compare all plan features
          </Text>
        </Pressable>

        <Text style={[styles.footnote, { color: colors.textTertiary }]}>
          Payment is added in a later update. Choosing a plan now activates it locally so you can
          explore the features.
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
    borderWidth: 1,
    borderRadius: 16,
    padding: 4,
    marginBottom: 20,
  },
  toggleOpt: {
    flex: 1,
    alignItems: 'center',
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
  footnote: {
    fontFamily: 'Inter_400Regular',
    fontSize: 12,
    lineHeight: 17,
    textAlign: 'center',
    marginTop: 16,
  },
});
