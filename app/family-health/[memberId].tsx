import React, { useCallback, useState } from 'react';
import { StyleSheet, Text, View, ScrollView, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams, useFocusEffect } from 'expo-router';
import Animated, { FadeInDown } from 'react-native-reanimated';

import { useTheme } from '@/lib/theme-context';
import {
  HealthLog,
  HealthMetricType,
  HEALTH_METRIC_LABELS,
  loadHealthLogs,
  deleteHealthLog,
} from '@/lib/family-records';

export default function HealthMonitoringScreen() {
  const router = useRouter();
  const { memberId, memberName } = useLocalSearchParams<{ memberId: string; memberName?: string }>();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();

  const [items, setItems] = useState<HealthLog[]>([]);
  const [filterType, setFilterType] = useState<HealthMetricType | 'all'>('all');

  const load = useCallback(async () => {
    if (!memberId) return;
    setItems(await loadHealthLogs(String(memberId)));
  }, [memberId]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const openAdd = () => {
    router.push({ pathname: '/family-health/add', params: { memberId: String(memberId), memberName: memberName ? String(memberName) : '' } });
  };

  const filtered = filterType === 'all' ? items : items.filter((h) => h.type === filterType);
  const headerHeight = 110 + insets.top;

  return (
    <View style={[styles.container, { backgroundColor: colors.bg }]}>
      <LinearGradient colors={colors.heroGradient as any} style={[styles.header, { height: headerHeight, paddingTop: insets.top }]}>
        <View style={styles.headerTop}>
          <Pressable onPress={() => router.back()} style={styles.backBtn} hitSlop={12}>
            <Ionicons name="chevron-back" size={24} color={colors.text} />
          </Pressable>
          <Text style={[styles.headerTitle, { color: colors.text }]}>Health Monitoring</Text>
          <Pressable onPress={openAdd} style={styles.addBtn} hitSlop={12}>
            <Ionicons name="add-circle" size={30} color={colors.accent} />
          </Pressable>
        </View>
        {memberName ? <Text style={[styles.headerSubtitle, { color: colors.textSecondary }]}>For {memberName}</Text> : null}
      </LinearGradient>

      <View style={styles.filterRow}>
        {(['all', 'bp', 'sugar', 'weight'] as const).map((f) => {
          const active = filterType === f;
          const label = f === 'all' ? 'All' : HEALTH_METRIC_LABELS[f].label;
          return (
            <Pressable
              key={f}
              onPress={() => setFilterType(f)}
              style={[
                styles.filterChip,
                { backgroundColor: colors.card, borderColor: colors.border },
                active && { backgroundColor: colors.accentDim, borderColor: colors.accent + '40' },
              ]}
            >
              <Text style={[styles.filterChipText, { color: active ? colors.accent : colors.textSecondary }]}>{label}</Text>
            </Pressable>
          );
        })}
      </View>

      <ScrollView contentContainerStyle={{ padding: 20, paddingTop: 8, paddingBottom: insets.bottom + 40 }} showsVerticalScrollIndicator={false}>
        {filtered.length === 0 ? (
          <View style={styles.emptyState}>
            <Ionicons name="heart-outline" size={48} color={colors.textTertiary} />
            <Text style={[styles.emptyTitle, { color: colors.text }]}>No entries yet</Text>
            <Text style={[styles.emptyDesc, { color: colors.textTertiary }]}>Tap + to log blood pressure, sugar, or weight.</Text>
          </View>
        ) : (
          filtered.map((log) => {
            const def = HEALTH_METRIC_LABELS[log.type];
            return (
              <Animated.View key={log.id} entering={FadeInDown.duration(300)} style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <View style={[styles.iconWrap, { backgroundColor: colors.accentDim }]}>
                  <Ionicons name={def.icon as any} size={20} color={colors.accent} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.cardTitle, { color: colors.text }]}>{log.value} <Text style={{ fontFamily: 'Inter_400Regular', fontSize: 12 }}>{def.unit}</Text></Text>
                  <Text style={[styles.cardSub, { color: colors.textTertiary }]}>
                    {def.label} · {new Date(log.date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                  </Text>
                  {!!log.notes && <Text style={[styles.cardNotes, { color: colors.textSecondary }]}>{log.notes}</Text>}
                </View>
                <Pressable onPress={async () => { await deleteHealthLog(String(memberId), log.id); load(); }} hitSlop={10}>
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
  filterRow: { flexDirection: 'row', gap: 8, paddingHorizontal: 20, paddingTop: 14, paddingBottom: 6 },
  filterChip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 12, borderWidth: 1 },
  filterChipText: { fontFamily: 'Inter_600SemiBold', fontSize: 12 },
  emptyState: { alignItems: 'center', paddingVertical: 60, gap: 10 },
  emptyTitle: { fontFamily: 'Inter_700Bold', fontSize: 17 },
  emptyDesc: { fontFamily: 'Inter_400Regular', fontSize: 13, textAlign: 'center', paddingHorizontal: 30 },
  card: { flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: 16, borderWidth: 1, padding: 14, marginBottom: 10 },
  iconWrap: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  cardTitle: { fontFamily: 'Inter_700Bold', fontSize: 16 },
  cardSub: { fontFamily: 'Inter_400Regular', fontSize: 12, marginTop: 2 },
  cardNotes: { fontFamily: 'Inter_400Regular', fontSize: 12, marginTop: 4, fontStyle: 'italic' },
});
