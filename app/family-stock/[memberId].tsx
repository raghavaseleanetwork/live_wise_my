import React, { useCallback, useState } from 'react';
import { StyleSheet, Text, View, ScrollView, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams, useFocusEffect } from 'expo-router';
import Animated, { FadeInDown } from 'react-native-reanimated';

import { useTheme } from '@/lib/theme-context';
import {
  MedicationStockItem,
  loadStock,
  adjustStock,
  deleteStockItem,
  daysOfStockLeft,
  isLowStock,
} from '@/lib/family-records';

export default function MedicationStockScreen() {
  const router = useRouter();
  const { memberId, memberName } = useLocalSearchParams<{ memberId: string; memberName?: string }>();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();

  const [items, setItems] = useState<MedicationStockItem[]>([]);

  const load = useCallback(async () => {
    if (!memberId) return;
    setItems(await loadStock(String(memberId)));
  }, [memberId]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const openAdd = () => {
    router.push({ pathname: '/family-stock/add', params: { memberId: String(memberId), memberName: memberName ? String(memberName) : '' } });
  };

  const lowStockItems = items.filter(isLowStock);
  const headerHeight = 110 + insets.top;

  return (
    <View style={[styles.container, { backgroundColor: colors.bg }]}>
      <LinearGradient colors={colors.heroGradient as any} style={[styles.header, { height: headerHeight, paddingTop: insets.top }]}>
        <View style={styles.headerTop}>
          <Pressable onPress={() => router.back()} style={styles.backBtn} hitSlop={12}>
            <Ionicons name="chevron-back" size={24} color={colors.text} />
          </Pressable>
          <Text style={[styles.headerTitle, { color: colors.text }]}>Medication Stock</Text>
          <Pressable onPress={openAdd} style={styles.addBtn} hitSlop={12}>
            <Ionicons name="add-circle" size={30} color={colors.accent} />
          </Pressable>
        </View>
        {memberName ? <Text style={[styles.headerSubtitle, { color: colors.textSecondary }]}>For {memberName}</Text> : null}
      </LinearGradient>

      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: insets.bottom + 40 }} showsVerticalScrollIndicator={false}>
        {lowStockItems.length > 0 && (
          <View style={[styles.warningBanner, { backgroundColor: colors.warningDim, borderColor: colors.warning + '40' }]}>
            <Ionicons name="warning" size={18} color={colors.warning} />
            <Text style={[styles.warningText, { color: colors.warning }]}>
              {lowStockItems.length} medicine{lowStockItems.length > 1 ? 's' : ''} running low — refill soon
            </Text>
          </View>
        )}

        {items.length === 0 ? (
          <View style={styles.emptyState}>
            <Ionicons name="cube-outline" size={48} color={colors.textTertiary} />
            <Text style={[styles.emptyTitle, { color: colors.text }]}>No stock tracked yet</Text>
            <Text style={[styles.emptyDesc, { color: colors.textTertiary }]}>Tap + to track medicine quantity and get refill alerts.</Text>
          </View>
        ) : (
          items.map((item) => {
            const low = isLowStock(item);
            const daysLeft = daysOfStockLeft(item);
            return (
              <Animated.View key={item.id} entering={FadeInDown.duration(300)} style={[styles.card, { backgroundColor: colors.card, borderColor: low ? colors.warning + '50' : colors.border }]}>
                <View style={styles.cardTop}>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.cardTitle, { color: colors.text }]}>{item.medicineName}</Text>
                    <Text style={[styles.cardSub, { color: colors.textTertiary }]}>
                      {item.quantityRemaining} left{daysLeft !== null ? ` · ~${daysLeft} day${daysLeft === 1 ? '' : 's'} of stock` : ''}
                    </Text>
                  </View>
                  {low && (
                    <View style={[styles.lowBadge, { backgroundColor: colors.warningDim }]}>
                      <Text style={[styles.lowBadgeText, { color: colors.warning }]}>Low</Text>
                    </View>
                  )}
                  <Pressable onPress={async () => { await deleteStockItem(String(memberId), item.id); load(); }} hitSlop={10} style={{ marginLeft: 10 }}>
                    <Ionicons name="trash-outline" size={18} color={colors.textTertiary} />
                  </Pressable>
                </View>
                <View style={styles.stockControls}>
                  <Pressable
                    onPress={async () => { await adjustStock(String(memberId), item.id, -1); load(); }}
                    style={[styles.stockBtn, { backgroundColor: colors.inputBg, borderColor: colors.border }]}
                  >
                    <Ionicons name="remove" size={18} color={colors.text} />
                  </Pressable>
                  <Pressable
                    onPress={async () => { await adjustStock(String(memberId), item.id, 10); load(); }}
                    style={[styles.stockBtn, styles.stockBtnWide, { backgroundColor: colors.accentDim, borderColor: colors.accent + '40' }]}
                  >
                    <Ionicons name="refresh" size={16} color={colors.accent} />
                    <Text style={[styles.refillText, { color: colors.accent }]}>Refill +10</Text>
                  </Pressable>
                  <Pressable
                    onPress={async () => { await adjustStock(String(memberId), item.id, 1); load(); }}
                    style={[styles.stockBtn, { backgroundColor: colors.inputBg, borderColor: colors.border }]}
                  >
                    <Ionicons name="add" size={18} color={colors.text} />
                  </Pressable>
                </View>
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
  warningBanner: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 14, borderRadius: 16, borderWidth: 1, marginBottom: 16 },
  warningText: { fontFamily: 'Inter_600SemiBold', fontSize: 13, flex: 1 },
  emptyState: { alignItems: 'center', paddingVertical: 60, gap: 10 },
  emptyTitle: { fontFamily: 'Inter_700Bold', fontSize: 17 },
  emptyDesc: { fontFamily: 'Inter_400Regular', fontSize: 13, textAlign: 'center', paddingHorizontal: 30 },
  card: { borderRadius: 18, borderWidth: 1, padding: 14, marginBottom: 10 },
  cardTop: { flexDirection: 'row', alignItems: 'center' },
  cardTitle: { fontFamily: 'Inter_600SemiBold', fontSize: 15 },
  cardSub: { fontFamily: 'Inter_400Regular', fontSize: 12, marginTop: 2 },
  lowBadge: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8 },
  lowBadgeText: { fontFamily: 'Inter_700Bold', fontSize: 10, textTransform: 'uppercase' },
  stockControls: { flexDirection: 'row', gap: 8, marginTop: 12 },
  stockBtn: { width: 40, height: 36, borderRadius: 10, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  stockBtnWide: { flex: 1, flexDirection: 'row', gap: 6 },
  refillText: { fontFamily: 'Inter_600SemiBold', fontSize: 13 },
});
