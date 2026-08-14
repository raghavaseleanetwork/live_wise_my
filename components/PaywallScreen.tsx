import React from 'react';
import {
  StyleSheet,
  Text,
  View,
  Pressable,
  ScrollView,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@/lib/theme-context';
import { useSubscription } from '@/lib/subscription-context';
import CustomModal from '@/components/CustomModal';
import PlanComparisonTable from '@/components/PlanComparisonTable';
import {
  PlanId,
  PaywallTrigger,
  PLAN_META,
  resolvePlanPrice,
} from '@/constants/plans';
import { LoadingIndicator } from '@/components/PremiumLoader';

/**
 * Hard paywall — full-screen, non-dismissible takeover shown only for CRITICAL
 * limits (member / reminder) after repeated soft dismissals (doc §5.2). The only
 * way out is the top-corner X. Shows the full plan comparison table.
 */

interface PaywallScreenProps {
  visible: boolean;
  trigger: PaywallTrigger | null;
  currentPlan: PlanId;
  canStartTrial: boolean;
  trialDaysLeft: number;
  isTrialActive: boolean;
  onUpgrade: (plan: PlanId) => void;
  onClose: () => void;
}

export default function PaywallScreen({
  visible,
  trigger,
  currentPlan,
  canStartTrial,
  trialDaysLeft,
  isTrialActive,
  onUpgrade,
  onClose,
}: PaywallScreenProps) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
  const { storePrices, isPurchasing } = useSubscription();

  if (!trigger) return null;

  const recommended = trigger.recommendedPlan;
  const meta = PLAN_META[recommended];
  const planName = t(`subscription.planNames.${recommended}`);
  const ctaLabel = canStartTrial ? t('paywall.startTrial') : t('paywall.upgradeTo', { plan: planName });
  const topInset = Platform.OS === 'web' ? 24 : insets.top;
  const bottomInset = Platform.OS === 'web' ? 24 : Math.max(insets.bottom, 20);

  return (
    <CustomModal visible={visible} onClose={onClose} fullScreen showCloseButton={false}>
      <View style={[styles.container, { paddingTop: topInset }]}>
        {/* Top-corner exit — the only dismissal path */}
        <Pressable
          onPress={onClose}
          hitSlop={12}
          style={[styles.closeBtn, { backgroundColor: colors.border }]}
        >
          <Ionicons name="close" size={22} color={colors.text} />
        </Pressable>

        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: bottomInset + 90 }}
        >
          <View style={styles.hero}>
            <LinearGradient
              colors={colors.buttonGradient as unknown as [string, string]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.heroIcon}
            >
              <Ionicons name={trigger.icon as any} size={38} color="#FFFFFF" />
            </LinearGradient>
            <Text style={[styles.title, { color: colors.text }]}>{t(`paywall.triggers.${trigger.key}.title`)}</Text>
            <Text style={[styles.message, { color: colors.textSecondary }]}>{t(`paywall.triggers.${trigger.key}.message`)}</Text>
            {isTrialActive && (
              <View style={[styles.trialChip, { backgroundColor: colors.warningDim }]}>
                <Ionicons name="time" size={14} color={colors.warning} />
                <Text style={[styles.trialText, { color: colors.warning }]}>
                  {t('paywall.trialExpiresIn', { count: trialDaysLeft })}
                </Text>
              </View>
            )}
          </View>

          <Text style={[styles.compareTitle, { color: colors.text }]}>{t('paywall.compareAllPlans')}</Text>
          <View style={[styles.tableCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <PlanComparisonTable currentPlan={currentPlan} />
          </View>
        </ScrollView>

        {/* Sticky CTA */}
        <View style={[styles.footer, { paddingBottom: bottomInset, backgroundColor: colors.bg, borderTopColor: colors.border }]}>
          <Pressable
            onPress={() => onUpgrade(recommended)}
            disabled={isPurchasing}
            style={[styles.ctaWrap, isPurchasing && { opacity: 0.6 }]}
          >
            <LinearGradient
              colors={colors.buttonGradient as unknown as [string, string]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={styles.cta}
            >
              {isPurchasing ? (
                <LoadingIndicator size="small" color="#FFFFFF" />
              ) : (
                <>
                  <Text style={styles.ctaText}>{ctaLabel}</Text>
                  <Text style={styles.ctaSub}>
                    {resolvePlanPrice(recommended, 'month', storePrices)}
                    {meta.priceMonthly > 0 ? t('paywall.perMonth') : ''}
                  </Text>
                </>
              )}
            </LinearGradient>
          </Pressable>
        </View>
      </View>
    </CustomModal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingHorizontal: 20,
  },
  closeBtn: {
    alignSelf: 'flex-end',
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  hero: {
    alignItems: 'center',
    marginBottom: 24,
  },
  heroIcon: {
    width: 80,
    height: 80,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  title: {
    fontFamily: 'Inter_700Bold',
    fontSize: 24,
    textAlign: 'center',
    marginBottom: 8,
  },
  message: {
    fontFamily: 'Inter_400Regular',
    fontSize: 15,
    lineHeight: 22,
    textAlign: 'center',
  },
  trialChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    marginTop: 14,
  },
  trialText: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 13,
  },
  compareTitle: {
    fontFamily: 'Inter_700Bold',
    fontSize: 18,
    marginBottom: 12,
  },
  tableCard: {
    borderWidth: 1,
    borderRadius: 16,
    padding: 16,
  },
  footer: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 20,
    paddingTop: 12,
    borderTopWidth: 1,
  },
  ctaWrap: {
    borderRadius: 16,
    overflow: 'hidden',
  },
  cta: {
    paddingVertical: 14,
    alignItems: 'center',
  },
  ctaText: {
    fontFamily: 'Inter_700Bold',
    fontSize: 16,
    color: '#FFFFFF',
  },
  ctaSub: {
    fontFamily: 'Inter_500Medium',
    fontSize: 12,
    color: 'rgba(255,255,255,0.85)',
    marginTop: 2,
  },
});
