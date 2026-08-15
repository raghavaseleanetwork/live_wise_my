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
  FitnessItem,
  WORKOUT_TYPE_LABELS,
  loadFitnessItems,
  markFitnessDone,
  deleteFitnessItem,
} from '@/lib/family-records';

export default function FamilyFitnessScreen() {
  const router = useRouter();
  const { memberId, memberName } = useLocalSearchParams<{ memberId: string; memberName?: string }>();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const { t } = useTranslation();

  const [items, setItems] = useState<FitnessItem[]>([]);

  const load = useCallback(async () => {
    if (!memberId) return;
    setItems(await loadFitnessItems(String(memberId)));
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
    router.push({ pathname: '/family-fitness/add', params: { memberId: String(memberId), memberName: memberName ? String(memberName) : '' } });
  };

  const headerHeight = 110 + insets.top;
  const isDoneToday = (item: FitnessItem) => item.lastDoneAt && new Date(item.lastDoneAt).toDateString() === new Date().toDateString();

  return (
    <View style={[styles.container, { backgroundColor: colors.bg }]}>
      <LinearGradient colors={colors.heroGradient as any} style={[styles.header, { height: headerHeight, paddingTop: insets.top }]}>
        <View style={styles.headerTop}>
          <Pressable onPress={() => router.back()} style={styles.backBtn} hitSlop={12}>
            <Ionicons name="chevron-back" size={24} color={colors.text} />
          </Pressable>
          <Text style={[styles.headerTitle, { color: colors.text }]}>{t('familyFitness.headerTitle')}</Text>
          <Pressable onPress={openAdd} style={styles.addBtn} hitSlop={12}>
            <Ionicons name="add-circle" size={30} color={colors.accent} />
          </Pressable>
        </View>
        {memberName ? <Text style={[styles.headerSubtitle, { color: colors.textSecondary }]}>{t('familyFitness.forMember', { name: memberName })}</Text> : null}
      </LinearGradient>

      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: insets.bottom + 40 }} showsVerticalScrollIndicator={false}>
        {items.length === 0 ? (
          <View style={styles.emptyState}>
            <Ionicons name="barbell-outline" size={48} color={colors.textTertiary} />
            <Text style={[styles.emptyTitle, { color: colors.text }]}>{t('familyFitness.emptyTitle')}</Text>
            <Text style={[styles.emptyDesc, { color: colors.textTertiary }]}>{t('familyFitness.emptyDesc')}</Text>
          </View>
        ) : (
          items.map((item) => {
            const def = WORKOUT_TYPE_LABELS[item.workoutType];
            const done = isDoneToday(item);
            return (
              <Animated.View key={item.id} entering={FadeInDown.duration(300)} style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <Pressable
                  onPress={async () => { if (!done) { await markFitnessDone(String(memberId), item.id); load(); } }}
                  style={styles.checkCircle}
                >
                  <Ionicons name={done ? 'checkmark-circle' : 'ellipse-outline'} size={26} color={done ? '#10B981' : colors.textTertiary} />
                </Pressable>
                <View style={[styles.iconWrap, { backgroundColor: colors.accentDim }]}>
                  <Ionicons name={def.icon as any} size={16} color={colors.accent} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.cardTitle, { color: colors.text }]} numberOfLines={1}>{t(`familyFitness.type.${item.workoutType}`)}</Text>
                  <Text style={[styles.cardSub, { color: colors.textTertiary }]}>
                    {item.time}
                    {item.durationGoalMinutes ? ` · ${t('familyFitness.minutesGoal', { count: item.durationGoalMinutes })}` : ''}
                    {item.streak > 0 ? ` · ${t('familyFitness.streakDays', { count: item.streak })}` : ''}
                  </Text>
                </View>
                <Pressable onPress={() => router.push({ pathname: '/family-fitness/add', params: { memberId: String(memberId), memberName: memberName ? String(memberName) : '', editId: item.id } })} hitSlop={10} style={styles.rowAction}>
                  <Ionicons name="create-outline" size={18} color={colors.textTertiary} />
                </Pressable>
                <Pressable onPress={async () => { await deleteFitnessItem(String(memberId), item.id); load(); }} hitSlop={10}>
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
  card: { flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 16, borderWidth: 1, padding: 14, marginBottom: 10 },
  rowAction: { marginRight: 14 },
  checkCircle: { padding: 2 },
  iconWrap: { width: 32, height: 32, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  cardTitle: { fontFamily: 'Inter_600SemiBold', fontSize: 14 },
  cardSub: { fontFamily: 'Inter_400Regular', fontSize: 11, marginTop: 2 },
});
