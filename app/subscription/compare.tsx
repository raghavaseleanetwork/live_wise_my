import React from 'react';
import { StyleSheet, Text, View, ScrollView, Pressable, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useTheme } from '@/lib/theme-context';
import { useSubscription } from '@/lib/subscription-context';
import PlanComparisonTable from '@/components/PlanComparisonTable';
import PlanBadge from '@/components/PlanBadge';

/**
 * Full plan comparison screen (doc §1.2 + Section 6 matrix). Pushed from the
 * Manage Plan screen and the paywall's "See all plan features" link.
 */
export default function CompareScreen() {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const { currentPlan } = useSubscription();

  const topInset = Platform.OS === 'web' ? 67 : insets.top;
  const bottomInset = Platform.OS === 'web' ? 34 : Math.max(insets.bottom, 20);

  const handleBack = () => {
    if (router.canGoBack()) router.back();
    else router.replace('/subscription' as any);
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
          <Text style={[styles.screenTitle, { color: colors.text }]}>Compare Plans</Text>
          <View style={{ width: 24 }} />
        </View>

        <View style={styles.currentRow}>
          <Text style={[styles.currentLabel, { color: colors.textSecondary }]}>Your plan</Text>
          <PlanBadge plan={currentPlan} showStar />
        </View>

        <View style={[styles.tableCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <PlanComparisonTable currentPlan={currentPlan} />
        </View>

        <Pressable
          onPress={() => router.push('/subscription' as any)}
          style={[styles.manageBtn, { borderColor: colors.border }]}
        >
          <Ionicons name="pricetags" size={18} color={colors.accent} />
          <Text style={[styles.manageText, { color: colors.accent }]}>Manage my plan</Text>
        </Pressable>
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
  currentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 12,
  },
  currentLabel: {
    fontFamily: 'Inter_500Medium',
    fontSize: 13,
  },
  tableCard: {
    borderWidth: 1,
    borderRadius: 16,
    padding: 16,
  },
  manageBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderWidth: 1,
    borderRadius: 14,
    paddingVertical: 14,
    marginTop: 20,
  },
  manageText: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 14,
  },
});
