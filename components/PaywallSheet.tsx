import React from 'react';
import { StyleSheet, Text, View, Pressable, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useTheme } from '@/lib/theme-context';
import CustomModal from '@/components/CustomModal';
import {
  PlanId,
  PaywallTrigger,
  PLAN_META,
  formatPlanPrice,
} from '@/constants/plans';

/**
 * Soft paywall — a bottom-sheet upsell shown the moment a user tries to cross a
 * limit (doc §5.2). Benefit-focused headline, three plan pills (Starter/Family/
 * Pro) with Family pre-selected + "Most Popular" gold badge, a feature-specific
 * checklist, and a trial/upgrade CTA. Non-punishing: a dimmed "Continue on Free"
 * lets the user dismiss.
 *
 * Presentation is driven by `usePaywall()`; this component is purely visual.
 */

const SHEET_PLANS: PlanId[] = ['starter', 'family', 'pro'];

interface PaywallSheetProps {
  visible: boolean;
  trigger: PaywallTrigger | null;
  /** Which plan pill is selected (defaults to the trigger's recommended plan). */
  selectedPlan: PlanId;
  onSelectPlan: (plan: PlanId) => void;
  /** True the first time ever — CTA reads "Start 7-Day Free Trial". */
  canStartTrial: boolean;
  onUpgrade: (plan: PlanId) => void;
  onSeeAllPlans: () => void;
  onDismiss: () => void;
}

export default function PaywallSheet({
  visible,
  trigger,
  selectedPlan,
  onSelectPlan,
  canStartTrial,
  onUpgrade,
  onSeeAllPlans,
  onDismiss,
}: PaywallSheetProps) {
  const { colors } = useTheme();

  if (!trigger) return null;

  const ctaLabel = canStartTrial ? 'Start 7-Day Free Trial' : 'Upgrade Now';

  return (
    <CustomModal visible={visible} onClose={onDismiss} showCloseButton={false}>
      <ScrollView showsVerticalScrollIndicator={false} bounces={false}>
        {/* Feature illustration */}
        <View style={styles.illoWrap}>
          <LinearGradient
            colors={colors.buttonGradient as unknown as [string, string]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.illo}
          >
            <Ionicons name={trigger.icon as any} size={34} color="#FFFFFF" />
          </LinearGradient>
        </View>

        <Text style={[styles.headline, { color: colors.text }]}>{trigger.title}</Text>
        <Text style={[styles.message, { color: colors.textSecondary }]}>{trigger.message}</Text>

        {/* Plan pills */}
        <View style={styles.pillRow}>
          {SHEET_PLANS.map((planId) => {
            const meta = PLAN_META[planId];
            const selected = selectedPlan === planId;
            const isFamily = planId === 'family';
            return (
              <Pressable
                key={planId}
                onPress={() => onSelectPlan(planId)}
                style={[
                  styles.pill,
                  {
                    backgroundColor: selected
                      ? isFamily
                        ? colors.warningDim
                        : colors.accentDim
                      : colors.card,
                    borderColor: selected
                      ? isFamily
                        ? colors.warning
                        : colors.accent
                      : colors.border,
                  },
                ]}
              >
                {isFamily && (
                  <View style={[styles.popularBadge, { backgroundColor: colors.warning }]}>
                    <Text style={styles.popularText}>Most Popular</Text>
                  </View>
                )}
                <Text
                  style={[
                    styles.pillName,
                    { color: selected ? (isFamily ? colors.warning : colors.accent) : colors.text },
                  ]}
                >
                  {meta.name}
                </Text>
                <Text style={[styles.pillPrice, { color: colors.textSecondary }]}>
                  {formatPlanPrice(meta.priceMonthly)}
                  {meta.priceMonthly > 0 ? '/mo' : ''}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {/* Feature-specific benefits */}
        <View style={styles.benefits}>
          {trigger.benefits.map((b) => (
            <View key={b} style={styles.benefitRow}>
              <Ionicons name="checkmark-circle" size={18} color={colors.accentMint} />
              <Text style={[styles.benefitText, { color: colors.text }]}>{b}</Text>
            </View>
          ))}
        </View>

        {/* CTA */}
        <Pressable onPress={() => onUpgrade(selectedPlan)} style={styles.ctaWrap}>
          <LinearGradient
            colors={colors.buttonGradient as unknown as [string, string]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={styles.cta}
          >
            <Text style={styles.ctaText}>{ctaLabel}</Text>
          </LinearGradient>
        </Pressable>

        <Pressable onPress={onSeeAllPlans} style={styles.secondaryBtn} hitSlop={6}>
          <Text style={[styles.secondaryText, { color: colors.accent }]}>See all plan features</Text>
        </Pressable>

        <Pressable onPress={onDismiss} style={styles.dismissBtn} hitSlop={6}>
          <Text style={[styles.dismissText, { color: colors.textTertiary }]}>Continue on Free</Text>
        </Pressable>
      </ScrollView>
    </CustomModal>
  );
}

const styles = StyleSheet.create({
  illoWrap: {
    alignItems: 'center',
    marginBottom: 16,
  },
  illo: {
    width: 72,
    height: 72,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headline: {
    fontFamily: 'Inter_700Bold',
    fontSize: 20,
    textAlign: 'center',
    marginBottom: 8,
  },
  message: {
    fontFamily: 'Inter_400Regular',
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
    marginBottom: 20,
  },
  pillRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 20,
  },
  pill: {
    flex: 1,
    borderWidth: 1.5,
    borderRadius: 16,
    paddingVertical: 14,
    paddingHorizontal: 6,
    alignItems: 'center',
  },
  popularBadge: {
    position: 'absolute',
    top: -9,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 999,
  },
  popularText: {
    fontFamily: 'Inter_700Bold',
    fontSize: 9,
    color: '#FFFFFF',
    letterSpacing: 0.2,
  },
  pillName: {
    fontFamily: 'Inter_700Bold',
    fontSize: 14,
    marginTop: 2,
  },
  pillPrice: {
    fontFamily: 'Inter_500Medium',
    fontSize: 12,
    marginTop: 2,
  },
  benefits: {
    gap: 10,
    marginBottom: 22,
  },
  benefitRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  benefitText: {
    fontFamily: 'Inter_500Medium',
    fontSize: 14,
    flex: 1,
  },
  ctaWrap: {
    borderRadius: 16,
    overflow: 'hidden',
  },
  cta: {
    paddingVertical: 16,
    alignItems: 'center',
  },
  ctaText: {
    fontFamily: 'Inter_700Bold',
    fontSize: 16,
    color: '#FFFFFF',
  },
  secondaryBtn: {
    alignItems: 'center',
    paddingVertical: 14,
  },
  secondaryText: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 14,
  },
  dismissBtn: {
    alignItems: 'center',
    paddingVertical: 4,
  },
  dismissText: {
    fontFamily: 'Inter_500Medium',
    fontSize: 13,
  },
});
