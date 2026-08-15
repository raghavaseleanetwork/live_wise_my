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
  RoutineItem,
  RoutineType,
  ROUTINE_TYPE_LABELS,
  loadRoutines,
  toggleRoutine,
  deleteRoutine,
  markRoutineDoneToday,
  routineWeeklyCompliance,
} from '@/lib/family-records';

function isRoutineDoneToday(item: RoutineItem): boolean {
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  return (item.completedDates ?? []).includes(today);
}

export default function DailyRoutineScreen() {
  const router = useRouter();
  const { memberId, memberName } = useLocalSearchParams<{ memberId: string; memberName?: string }>();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const { t } = useTranslation();

  const routineTypeLabel = (type: RoutineType) => t(`familyRoutine.type.${type}`);
  const DAY_LABELS = [t('common.dayShort.sun'), t('common.dayShort.mon'), t('common.dayShort.tue'), t('common.dayShort.wed'), t('common.dayShort.thu'), t('common.dayShort.fri'), t('common.dayShort.sat')];

  const [items, setItems] = useState<RoutineItem[]>([]);

  const load = useCallback(async () => {
    if (!memberId) return;
    setItems(await loadRoutines(String(memberId)));
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
    router.push({ pathname: '/family-routine/add', params: { memberId: String(memberId), memberName: memberName ? String(memberName) : '' } });
  };

  const sorted = [...items].sort((a, b) => a.time.localeCompare(b.time));
  const headerHeight = 110 + insets.top;

  return (
    <View style={[styles.container, { backgroundColor: colors.bg }]}>
      <LinearGradient colors={colors.heroGradient as any} style={[styles.header, { height: headerHeight, paddingTop: insets.top }]}>
        <View style={styles.headerTop}>
          <Pressable onPress={() => router.back()} style={styles.backBtn} hitSlop={12}>
            <Ionicons name="chevron-back" size={24} color={colors.text} />
          </Pressable>
          <Text style={[styles.headerTitle, { color: colors.text }]}>{t('familyRoutine.headerTitle')}</Text>
          <Pressable onPress={openAdd} style={styles.addBtn} hitSlop={12}>
            <Ionicons name="add-circle" size={30} color={colors.accent} />
          </Pressable>
        </View>
        {memberName ? <Text style={[styles.headerSubtitle, { color: colors.textSecondary }]}>{t('familyRoutine.forMember', { name: memberName })}</Text> : null}
      </LinearGradient>

      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: insets.bottom + 40 }} showsVerticalScrollIndicator={false}>
        {sorted.length === 0 ? (
          <View style={styles.emptyState}>
            <Ionicons name="time-outline" size={48} color={colors.textTertiary} />
            <Text style={[styles.emptyTitle, { color: colors.text }]}>{t('familyRoutine.emptyTitle')}</Text>
            <Text style={[styles.emptyDesc, { color: colors.textTertiary }]}>{t('familyRoutine.emptyDesc')}</Text>
          </View>
        ) : (
          sorted.map((item) => {
            const def = ROUTINE_TYPE_LABELS[item.type];
            const doneToday = isRoutineDoneToday(item);
            const compliance = routineWeeklyCompliance(item);
            return (
              <Animated.View key={item.id} entering={FadeInDown.duration(300)} style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <Pressable onPress={async () => { await markRoutineDoneToday(String(memberId), item.id); load(); }} style={styles.checkCircle}>
                  <Ionicons name={doneToday ? 'checkmark-circle' : 'ellipse-outline'} size={24} color={doneToday ? '#10B981' : colors.textTertiary} />
                </Pressable>
                <View style={[styles.iconWrap, { backgroundColor: colors.accentDim }]}>
                  <Ionicons name={def.icon as any} size={20} color={colors.accent} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.cardTitle, { color: colors.text }, !item.enabled && { opacity: 0.4 }]}>{item.type === 'custom' ? item.label : routineTypeLabel(item.type)}</Text>
                  <Text style={[styles.cardSub, { color: colors.textTertiary }]}>
                    {item.time}{item.days && item.days.length > 0 ? ` · ${item.days.map((d) => DAY_LABELS[d]).join(', ')}` : ` · ${t('familyRoutine.everyDay')}`}
                    {compliance > 0 ? ` · ${t('familyRoutine.weeklyCompliance', { percent: compliance })}` : ''}
                  </Text>
                </View>
                <Pressable onPress={async () => { await toggleRoutine(String(memberId), item.id); load(); }} hitSlop={10}>
                  <Ionicons name={item.enabled ? 'toggle' : 'toggle-outline'} size={32} color={item.enabled ? colors.accent : colors.textTertiary} />
                </Pressable>
                <Pressable onPress={() => router.push({ pathname: '/family-routine/add', params: { memberId: String(memberId), memberName: memberName ? String(memberName) : '', editId: item.id } })} hitSlop={10} style={{ marginLeft: 8 }}>
                  <Ionicons name="create-outline" size={18} color={colors.textTertiary} />
                </Pressable>
                <Pressable onPress={async () => { await deleteRoutine(String(memberId), item.id); load(); }} hitSlop={10} style={{ marginLeft: 8 }}>
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
  emptyState: { alignItems: 'center', paddingVertical: 60, gap: 10 },
  emptyTitle: { fontFamily: 'Inter_700Bold', fontSize: 17 },
  emptyDesc: { fontFamily: 'Inter_400Regular', fontSize: 13, textAlign: 'center', paddingHorizontal: 30 },
  card: { flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: 16, borderWidth: 1, padding: 14, marginBottom: 10 },
  checkCircle: { padding: 2 },
  iconWrap: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  cardTitle: { fontFamily: 'Inter_600SemiBold', fontSize: 15 },
  cardSub: { fontFamily: 'Inter_400Regular', fontSize: 12, marginTop: 2 },
});
