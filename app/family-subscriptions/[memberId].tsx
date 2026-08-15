import React, { useCallback, useEffect, useState } from 'react';
import { StyleSheet, Text, View, ScrollView, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams, useFocusEffect } from 'expo-router';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { useTranslation } from 'react-i18next';

import { useTheme } from '@/lib/theme-context';
import { onCaregiverSync } from '@/lib/caregiver-sync';
import { useCurrency } from '@/lib/currency-context';
import Money from '@/components/Money';
import {
  FamilySubscription,
  loadSubscriptions,
  deleteSubscription,
  daysUntilRenewal,
} from '@/lib/family-records';

export default function FamilySubscriptionsScreen() {
  const router = useRouter();
  const { memberId, memberName } = useLocalSearchParams<{ memberId: string; memberName?: string }>();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const { formatAmount } = useCurrency();
  const { t } = useTranslation();

  const [items, setItems] = useState<FamilySubscription[]>([]);

  const load = useCallback(async () => {
    if (!memberId) return;
    setItems(await loadSubscriptions(String(memberId)));
  }, [memberId]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  // A connected caregiver marking something done elsewhere pushes a silent
  // { type: 'sync', memberId } notification. Refetch on receipt so an open
  // list updates live instead of waiting for the next focus.
  useEffect(() => {
    const sub = onCaregiverSync((syncedMemberId) => {
      if (memberId && syncedMemberId === String(memberId)) load();
    });
    return () => sub.remove();
  }, [memberId, load]);

  const openAdd = () => {
    router.push({ pathname: '/family-subscriptions/add', params: { memberId: String(memberId), memberName: memberName ? String(memberName) : '' } });
  };

  const sorted = [...items].sort((a, b) => new Date(a.renewalDate).getTime() - new Date(b.renewalDate).getTime());
  const monthlyTotal = items.reduce((sum, s) => sum + (s.cycle === 'monthly' ? s.amount : s.cycle === 'quarterly' ? s.amount / 3 : s.amount / 12), 0);
  const headerHeight = 110 + insets.top;

  return (
    <View style={[styles.container, { backgroundColor: colors.bg }]}>
      <LinearGradient colors={colors.heroGradient as any} style={[styles.header, { height: headerHeight, paddingTop: insets.top }]}>
        <View style={styles.headerTop}>
          <Pressable onPress={() => router.back()} style={styles.backBtn} hitSlop={12}>
            <Ionicons name="chevron-back" size={24} color={colors.text} />
          </Pressable>
          <Text style={[styles.headerTitle, { color: colors.text }]}>{t('familySubscriptions.headerTitle')}</Text>
          <Pressable onPress={openAdd} style={styles.addBtn} hitSlop={12}>
            <Ionicons name="add-circle" size={30} color={colors.accent} />
          </Pressable>
        </View>
        {memberName ? <Text style={[styles.headerSubtitle, { color: colors.textSecondary }]}>{t('familySubscriptions.forMember', { name: memberName })}</Text> : null}
      </LinearGradient>

      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: insets.bottom + 40 }} showsVerticalScrollIndicator={false}>
        {items.length > 0 && (
          <View style={[styles.summaryBanner, { backgroundColor: colors.accentDim, borderColor: colors.accent + '30' }]}>
            <Ionicons name="wallet" size={18} color={colors.accent} />
            <Text style={[styles.summaryText, { color: colors.accent }]}>{t('familySubscriptions.monthlySummary', { amount: formatAmount(Math.round(monthlyTotal)), count: items.length })}</Text>
          </View>
        )}

        {items.length === 0 ? (
          <View style={styles.emptyState}>
            <Ionicons name="tv-outline" size={48} color={colors.textTertiary} />
            <Text style={[styles.emptyTitle, { color: colors.text }]}>{t('familySubscriptions.emptyTitle')}</Text>
            <Text style={[styles.emptyDesc, { color: colors.textTertiary }]}>{t('familySubscriptions.emptyDesc')}</Text>
          </View>
        ) : (
          sorted.map((sub) => {
            const days = daysUntilRenewal(sub);
            const overdue = days < 0;
            return (
              <Animated.View key={sub.id} entering={FadeInDown.duration(300)} style={[styles.card, { backgroundColor: colors.card, borderColor: overdue ? colors.danger + '40' : colors.border }]}>
                <View style={[styles.iconWrap, { backgroundColor: colors.accentDim }]}>
                  <Ionicons name="tv" size={18} color={colors.accent} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.cardTitle, { color: colors.text }]} numberOfLines={1}>{sub.serviceName}</Text>
                  <Text style={[styles.cardSub, { color: overdue ? colors.danger : colors.textTertiary }]}>
                    {overdue ? t('familySubscriptions.overdueBy', { count: Math.abs(days) }) : t('familySubscriptions.renewsIn', { count: days })} · {t(`familySubscriptions.cycle.${sub.cycle}`)}
                  </Text>
                </View>
                <Money style={[styles.cardAmount, { color: colors.text }]}>{formatAmount(sub.amount)}</Money>
                <Pressable onPress={() => router.push({ pathname: '/family-subscriptions/add', params: { memberId: String(memberId), memberName: memberName ? String(memberName) : '', editId: sub.id } })} hitSlop={10} style={{ marginLeft: 8 }}>
                  <Ionicons name="create-outline" size={18} color={colors.textTertiary} />
                </Pressable>
                <Pressable onPress={async () => { await deleteSubscription(String(memberId), sub.id); load(); }} hitSlop={10} style={{ marginLeft: 10 }}>
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
  summaryBanner: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 14, borderRadius: 16, borderWidth: 1, marginBottom: 16 },
  summaryText: { fontFamily: 'Inter_600SemiBold', fontSize: 13, flex: 1 },
  emptyState: { alignItems: 'center', paddingVertical: 60, gap: 10 },
  emptyTitle: { fontFamily: 'Inter_700Bold', fontSize: 17 },
  emptyDesc: { fontFamily: 'Inter_400Regular', fontSize: 13, textAlign: 'center', paddingHorizontal: 30 },
  card: { flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: 16, borderWidth: 1, padding: 14, marginBottom: 10 },
  iconWrap: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  cardTitle: { fontFamily: 'Inter_600SemiBold', fontSize: 15 },
  cardSub: { fontFamily: 'Inter_400Regular', fontSize: 12, marginTop: 2, textTransform: 'capitalize' },
  cardAmount: { fontFamily: 'Inter_700Bold', fontSize: 15 },
});
