import React, { useCallback, useState } from 'react';
import { StyleSheet, Text, View, ScrollView, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams, useFocusEffect } from 'expo-router';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { useTranslation } from 'react-i18next';

import { useTheme } from '@/lib/theme-context';
import { useCurrency } from '@/lib/currency-context';
import Money from '@/components/Money';
import {
  FamilyExpense,
  loadFamilyExpenses,
  deleteFamilyExpense,
  totalThisMonth,
} from '@/lib/family-records';

const CATEGORY_META: Record<FamilyExpense['category'], { labelKey: string; icon: string; color: string }> = {
  food: { labelKey: 'familyExpenses.categoryFood', icon: 'fast-food', color: '#F97316' },
  shopping: { labelKey: 'familyExpenses.categoryShopping', icon: 'cart', color: '#EC4899' },
  transport: { labelKey: 'familyExpenses.categoryTransport', icon: 'car', color: '#3B82F6' },
  health: { labelKey: 'familyExpenses.categoryHealth', icon: 'medkit', color: '#10B981' },
  other: { labelKey: 'familyExpenses.categoryOther', icon: 'apps', color: '#6B7280' },
};

export default function FamilyExpensesScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const { memberId, memberName } = useLocalSearchParams<{ memberId: string; memberName?: string }>();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const { formatAmount } = useCurrency();

  const [items, setItems] = useState<FamilyExpense[]>([]);

  const load = useCallback(async () => {
    if (!memberId) return;
    setItems(await loadFamilyExpenses(String(memberId)));
  }, [memberId]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const openAdd = () => {
    router.push({ pathname: '/family-expenses/add', params: { memberId: String(memberId), memberName: memberName ? String(memberName) : '' } });
  };

  const monthTotal = totalThisMonth(items);
  const headerHeight = 110 + insets.top;

  return (
    <View style={[styles.container, { backgroundColor: colors.bg }]}>
      <LinearGradient colors={colors.heroGradient as any} style={[styles.header, { height: headerHeight, paddingTop: insets.top }]}>
        <View style={styles.headerTop}>
          <Pressable onPress={() => router.back()} style={styles.backBtn} hitSlop={12}>
            <Ionicons name="chevron-back" size={24} color={colors.text} />
          </Pressable>
          <Text style={[styles.headerTitle, { color: colors.text }]}>{t('familyExpenses.title')}</Text>
          <Pressable onPress={openAdd} style={styles.addBtn} hitSlop={12}>
            <Ionicons name="add-circle" size={30} color={colors.accent} />
          </Pressable>
        </View>
        {memberName ? <Text style={[styles.headerSubtitle, { color: colors.textSecondary }]}>{t('familyExpenses.forMember', { memberName })}</Text> : null}
      </LinearGradient>

      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: insets.bottom + 40 }} showsVerticalScrollIndicator={false}>
        {items.length > 0 && (
          <View style={[styles.summaryBanner, { backgroundColor: colors.accentDim, borderColor: colors.accent + '30' }]}>
            <Text style={[styles.summaryLabel, { color: colors.textSecondary }]}>{t('familyExpenses.thisMonth')}</Text>
            <Money style={[styles.summaryAmount, { color: colors.accent }]}>{formatAmount(monthTotal)}</Money>
          </View>
        )}

        {items.length === 0 ? (
          <View style={styles.emptyState}>
            <Ionicons name="wallet-outline" size={48} color={colors.textTertiary} />
            <Text style={[styles.emptyTitle, { color: colors.text }]}>{t('familyExpenses.emptyTitle')}</Text>
            <Text style={[styles.emptyDesc, { color: colors.textTertiary }]}>{t('familyExpenses.emptyDesc')}</Text>
          </View>
        ) : (
          items.map((exp) => {
            const def = CATEGORY_META[exp.category];
            return (
              <Animated.View key={exp.id} entering={FadeInDown.duration(300)} style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <View style={[styles.iconWrap, { backgroundColor: def.color + '20' }]}>
                  <Ionicons name={def.icon as any} size={18} color={def.color} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.cardTitle, { color: colors.text }]} numberOfLines={1}>{exp.description}</Text>
                  <Text style={[styles.cardSub, { color: colors.textTertiary }]}>
                    {t(def.labelKey)} · {new Date(exp.date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                  </Text>
                </View>
                <Money style={[styles.cardAmount, { color: colors.text }]}>{formatAmount(exp.amount)}</Money>
                <Pressable onPress={() => router.push({ pathname: '/family-expenses/add', params: { memberId: String(memberId), memberName: memberName ? String(memberName) : '', editId: exp.id } })} hitSlop={10} style={{ marginLeft: 8 }}>
                  <Ionicons name="create-outline" size={18} color={colors.textTertiary} />
                </Pressable>
                <Pressable onPress={async () => { await deleteFamilyExpense(String(memberId), exp.id); load(); }} hitSlop={10} style={{ marginLeft: 10 }}>
                  <Ionicons name="trash-outline" size={18} color={colors.textTertiary} />
                </Pressable>
              </Animated.View>
            );
          })
        )}
      </ScrollView>

    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { paddingHorizontal: 20, justifyContent: 'center', borderBottomLeftRadius: 32, borderBottomRightRadius: 32 },
  headerTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  backBtn: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  addBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontFamily: 'Inter_700Bold', fontSize: 18 },
  headerSubtitle: { fontFamily: 'Inter_500Medium', fontSize: 13, marginTop: 4, textAlign: 'center' },
  summaryBanner: { padding: 16, borderRadius: 16, borderWidth: 1, marginBottom: 16 },
  summaryLabel: { fontFamily: 'Inter_500Medium', fontSize: 12, marginBottom: 4 },
  summaryAmount: { fontFamily: 'Inter_700Bold', fontSize: 26 },
  emptyState: { alignItems: 'center', paddingVertical: 60, gap: 10 },
  emptyTitle: { fontFamily: 'Inter_700Bold', fontSize: 17 },
  emptyDesc: { fontFamily: 'Inter_400Regular', fontSize: 13, textAlign: 'center', paddingHorizontal: 30 },
  card: { flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: 16, borderWidth: 1, padding: 14, marginBottom: 10 },
  iconWrap: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  cardTitle: { fontFamily: 'Inter_600SemiBold', fontSize: 15 },
  cardSub: { fontFamily: 'Inter_400Regular', fontSize: 12, marginTop: 2 },
  cardAmount: { fontFamily: 'Inter_700Bold', fontSize: 15 },
});
