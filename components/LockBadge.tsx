import React from 'react';
import { View, StyleSheet, ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/lib/theme-context';

/**
 * Reusable "premium lock" indicator for gated UI — a small circular lock chip
 * that can be dropped onto a locked card, row, or feature. Purely presentational;
 * the calling screen decides when to show it (usually `!isFeatureEnabled(...)`)
 * and what happens on press (usually presenting the paywall).
 */

interface LockBadgeProps {
  size?: number;
  /** Use the gold "premium" accent instead of the neutral muted look. */
  gold?: boolean;
  style?: ViewStyle;
}

export default function LockBadge({ size = 22, gold = true, style }: LockBadgeProps) {
  const { colors } = useTheme();
  const fg = gold ? colors.warning : colors.textSecondary;
  const bg = gold ? colors.warningDim : colors.border;

  return (
    <View
      style={[
        styles.chip,
        { width: size, height: size, borderRadius: size / 2, backgroundColor: bg },
        style,
      ]}
    >
      <Ionicons name="lock-closed" size={Math.round(size * 0.55)} color={fg} />
    </View>
  );
}

const styles = StyleSheet.create({
  chip: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});
