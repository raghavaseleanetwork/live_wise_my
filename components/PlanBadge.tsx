import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@/lib/theme-context';
import { PlanId, PLAN_META } from '@/constants/plans';

/**
 * Small pill that shows a plan's name. Used in Settings (current plan), on plan
 * cards, and anywhere a compact plan indicator is needed. Family uses the gold
 * "Most Popular" accent; other tiers use the app's violet accent; Free is muted.
 */

interface PlanBadgeProps {
  plan: PlanId;
  /** Show a small star for the Family (recommended) plan. */
  showStar?: boolean;
  /** Prefix "Trial" wording when the plan is active via free trial. */
  trial?: boolean;
  size?: 'sm' | 'md';
}

export default function PlanBadge({ plan, showStar = false, trial = false, size = 'md' }: PlanBadgeProps) {
  const { colors } = useTheme();
  const { t } = useTranslation();

  const isFamily = plan === 'family';
  const isFree = plan === 'free';

  const fg = isFamily ? colors.warning : isFree ? colors.textSecondary : colors.accent;
  const bg = isFamily ? colors.warningDim : isFree ? colors.border : colors.accentDim;

  const small = size === 'sm';
  const label = `${trial ? t('planBadge.trialPrefix') : ''}${t(`subscription.planNames.${plan}`)}`;

  return (
    <View
      style={[
        styles.badge,
        { backgroundColor: bg },
        small ? styles.badgeSm : styles.badgeMd,
      ]}
    >
      {showStar && isFamily && (
        <Ionicons name="star" size={small ? 10 : 12} color={fg} style={styles.star} />
      )}
      <Text
        style={[
          styles.label,
          { color: fg, fontSize: small ? 11 : 12 },
        ]}
      >
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 999,
    alignSelf: 'flex-start',
  },
  badgeMd: {
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  badgeSm: {
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  star: {
    marginRight: 4,
  },
  label: {
    fontFamily: 'Inter_700Bold',
    letterSpacing: 0.3,
  },
});
