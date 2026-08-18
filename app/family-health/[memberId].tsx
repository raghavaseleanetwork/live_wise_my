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
import {
  HealthLog,
  HealthMetricType,
  HEALTH_METRIC_LABELS,
  loadHealthLogs,
  deleteHealthLog,
  isHealthLogOutOfRange,
} from '@/lib/family-records';
import { useCaregiverPermissions } from '@/lib/use-caregiver-permissions';

const ALL_METRICS: HealthMetricType[] = ['bp', 'sugar', 'weight', 'temperature', 'oxygen', 'heart_rate', 'cholesterol'];

export default function HealthMonitoringScreen() {
  const router = useRouter();
  const { memberId, memberName } = useLocalSearchParams<{ memberId: string; memberName?: string }>();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const { t } = useTranslation();

  const metricLabel = (type: HealthMetricType) => t(`familyHealth.metric.${type}`);

  // Scoped caregiver access (PRD 5.5). The owner is unrestricted; a
  // caregiver only gets the actions their access level allows.
  const { canMarkDone, canEdit } = useCaregiverPermissions(memberId ? String(memberId) : null);

  const [items, setItems] = useState<HealthLog[]>([]);
  const [filterType, setFilterType] = useState<HealthMetricType | 'all'>('all');

  const load = useCallback(async () => {
    if (!memberId) return;
    setItems(await loadHealthLogs(String(memberId)));
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
          <Text style={[styles.headerTitle, { color: colors.text }]}>{t('familyHealth.headerTitle')}</Text>
          {canEdit ? (
            <Pressable onPress={openAdd} style={styles.addBtn} hitSlop={12}>
            <Ionicons name="add-circle" size={30} color={colors.accent} />
          </Pressable>
          ) : (
            <View style={styles.addBtn} />
          )}
        </View>
        {memberName ? <Text style={[styles.headerSubtitle, { color: colors.textSecondary }]}>{t('familyHealth.forMember', { name: memberName })}</Text> : null}
      </LinearGradient>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filterScroll} contentContainerStyle={styles.filterRow}>
        {(['all', ...ALL_METRICS] as const).map((f) => {
          const active = filterType === f;
          const label = f === 'all' ? t('common.all') : metricLabel(f);
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
      </ScrollView>

      <ScrollView contentContainerStyle={{ padding: 20, paddingTop: 8, paddingBottom: insets.bottom + 40 }} showsVerticalScrollIndicator={false}>
        {filtered.length === 0 ? (
          <View style={styles.emptyState}>
            <Ionicons name="heart-outline" size={48} color={colors.textTertiary} />
            <Text style={[styles.emptyTitle, { color: colors.text }]}>{t('familyHealth.emptyTitle')}</Text>
            <Text style={[styles.emptyDesc, { color: colors.textTertiary }]}>{t('familyHealth.emptyDesc')}</Text>
          </View>
        ) : (
          filtered.map((log) => {
            const def = HEALTH_METRIC_LABELS[log.type];
            const outOfRange = isHealthLogOutOfRange(log);
            return (
              <Animated.View key={log.id} entering={FadeInDown.duration(300)} style={[styles.card, { backgroundColor: colors.card, borderColor: outOfRange ? colors.warning : colors.border }]}>
                <View style={[styles.iconWrap, { backgroundColor: outOfRange ? colors.warningDim : colors.accentDim }]}>
                  <Ionicons name={outOfRange ? 'alert' : (def.icon as any)} size={20} color={outOfRange ? colors.warning : colors.accent} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.cardTitle, { color: colors.text }]}>{log.value} <Text style={{ fontFamily: 'Inter_400Regular', fontSize: 12 }}>{def.unit}</Text></Text>
                  <Text style={[styles.cardSub, { color: colors.textTertiary }]}>
                    {metricLabel(log.type)} · {new Date(log.date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                    {log.type === 'sugar' && log.sugarReadingType ? ` · ${t(`familyHealth.sugarReadingType.${log.sugarReadingType}`)}` : ''}
                  </Text>
                  {!!log.notes && <Text style={[styles.cardNotes, { color: colors.textSecondary }]}>{log.notes}</Text>}
                  {outOfRange && <Text style={[styles.outOfRangeText, { color: colors.warning }]}>{t('familyHealth.outOfRangeWarning')}</Text>}
                </View>
                {canEdit && (<Pressable onPress={async () => { await deleteHealthLog(String(memberId), log.id); load(); }} hitSlop={10}>
                  <Ionicons name="trash-outline" size={18} color={colors.textTertiary} />
                </Pressable>)}
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
  filterScroll: { flexGrow: 0, flexShrink: 0, paddingTop: 14, paddingBottom: 6 },
  filterRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 20 },
  filterChip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 12, borderWidth: 1 },
  outOfRangeText: { fontFamily: 'Inter_600SemiBold', fontSize: 11, marginTop: 4 },
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
