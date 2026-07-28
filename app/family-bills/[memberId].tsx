import React, { useCallback, useState } from 'react';
import { StyleSheet, Text, View, ScrollView, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams, useFocusEffect } from 'expo-router';
import Animated, { FadeInDown } from 'react-native-reanimated';

import { useTheme } from '@/lib/theme-context';
import { useCurrency } from '@/lib/currency-context';
import {
  FamilyBill,
  loadFamilyBills,
  toggleFamilyBillPaid,
  deleteFamilyBill,
} from '@/lib/family-records';

const CATEGORY_LABELS: Record<FamilyBill['category'], { label: string; icon: string }> = {
  electricity: { label: 'Electricity', icon: 'flash' },
  medical: { label: 'Medical', icon: 'medkit' },
  insurance: { label: 'Insurance', icon: 'shield-checkmark' },
  other: { label: 'Other', icon: 'receipt' },
};

export default function FamilyBillsScreen() {
  const router = useRouter();
  const { memberId, memberName } = useLocalSearchParams<{ memberId: string; memberName?: string }>();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const { formatAmount } = useCurrency();

  const [items, setItems] = useState<FamilyBill[]>([]);

  const load = useCallback(async () => {
    if (!memberId) return;
    setItems(await loadFamilyBills(String(memberId)));
  }, [memberId]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const openAdd = () => {
    router.push({ pathname: '/family-bills/add', params: { memberId: String(memberId), memberName: memberName ? String(memberName) : '' } });
  };

  const unpaid = items.filter((b) => !b.isPaid).sort((a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime());
  const paid = items.filter((b) => b.isPaid);
  const headerHeight = 110 + insets.top;

  return (
    <View style={[styles.container, { backgroundColor: colors.bg }]}>
      <LinearGradient colors={colors.heroGradient as any} style={[styles.header, { height: headerHeight, paddingTop: insets.top }]}>
        <View style={styles.headerTop}>
          <Pressable onPress={() => router.back()} style={styles.backBtn} hitSlop={12}>
            <Ionicons name="chevron-back" size={24} color={colors.text} />
          </Pressable>
          <Text style={[styles.headerTitle, { color: colors.text }]}>Bill Management</Text>
          <Pressable onPress={openAdd} style={styles.addBtn} hitSlop={12}>
            <Ionicons name="add-circle" size={30} color={colors.accent} />
          </Pressable>
        </View>
        {memberName ? <Text style={[styles.headerSubtitle, { color: colors.textSecondary }]}>For {memberName}</Text> : null}
      </LinearGradient>

      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: insets.bottom + 40 }} showsVerticalScrollIndicator={false}>
        {items.length === 0 ? (
          <View style={styles.emptyState}>
            <Ionicons name="receipt-outline" size={48} color={colors.textTertiary} />
            <Text style={[styles.emptyTitle, { color: colors.text }]}>No bills yet</Text>
            <Text style={[styles.emptyDesc, { color: colors.textTertiary }]}>Tap + to track electricity, medical, or insurance bills.</Text>
          </View>
        ) : (
          <>
            {unpaid.length > 0 && (
              <>
                <Text style={[styles.sectionLabel, { color: colors.textSecondary }]}>DUE</Text>
                {unpaid.map((bill) => (
                  <BillCard key={bill.id} bill={bill} colors={colors} formatAmount={formatAmount}
                    onToggle={async () => { await toggleFamilyBillPaid(String(memberId), bill.id); load(); }}
                    onDelete={async () => { await deleteFamilyBill(String(memberId), bill.id); load(); }} />
                ))}
              </>
            )}
            {paid.length > 0 && (
              <>
                <Text style={[styles.sectionLabel, { color: colors.textSecondary, marginTop: 20 }]}>PAID</Text>
                {paid.map((bill) => (
                  <BillCard key={bill.id} bill={bill} colors={colors} formatAmount={formatAmount}
                    onToggle={async () => { await toggleFamilyBillPaid(String(memberId), bill.id); load(); }}
                    onDelete={async () => { await deleteFamilyBill(String(memberId), bill.id); load(); }} />
                ))}
              </>
            )}
          </>
        )}
      </ScrollView>
    </View>
  );
}

function BillCard({
  bill, colors, formatAmount, onToggle, onDelete,
}: { bill: FamilyBill; colors: any; formatAmount: (n: number) => string; onToggle: () => void; onDelete: () => void }) {
  const def = CATEGORY_LABELS[bill.category];
  return (
    <Animated.View entering={FadeInDown.duration(300)} style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <Pressable onPress={onToggle} style={styles.checkCircle}>
        <Ionicons name={bill.isPaid ? 'checkmark-circle' : 'ellipse-outline'} size={26} color={bill.isPaid ? '#10B981' : colors.textTertiary} />
      </Pressable>
      <View style={[styles.iconWrap, { backgroundColor: colors.accentDim }]}>
        <Ionicons name={def.icon as any} size={16} color={colors.accent} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[styles.cardTitle, { color: colors.text }, bill.isPaid && { textDecorationLine: 'line-through', opacity: 0.5 }]} numberOfLines={1}>{bill.name}</Text>
        <Text style={[styles.cardSub, { color: colors.textTertiary }]}>
          Due {new Date(bill.dueDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
        </Text>
      </View>
      <Text style={[styles.cardAmount, { color: colors.text }]}>{formatAmount(bill.amount)}</Text>
      <Pressable onPress={onDelete} hitSlop={10} style={{ marginLeft: 10 }}>
        <Ionicons name="trash-outline" size={18} color={colors.textTertiary} />
      </Pressable>
    </Animated.View>
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
  emptyState: { alignItems: 'center', paddingVertical: 60, gap: 10 },
  emptyTitle: { fontFamily: 'Inter_700Bold', fontSize: 17 },
  emptyDesc: { fontFamily: 'Inter_400Regular', fontSize: 13, textAlign: 'center', paddingHorizontal: 30 },
  sectionLabel: { fontFamily: 'Inter_700Bold', fontSize: 12, letterSpacing: 1, marginBottom: 10 },
  card: { flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 18, borderWidth: 1, padding: 14, marginBottom: 10 },
  checkCircle: { padding: 2 },
  iconWrap: { width: 32, height: 32, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  cardTitle: { fontFamily: 'Inter_600SemiBold', fontSize: 14 },
  cardSub: { fontFamily: 'Inter_400Regular', fontSize: 11, marginTop: 2 },
  cardAmount: { fontFamily: 'Inter_700Bold', fontSize: 14 },
});
