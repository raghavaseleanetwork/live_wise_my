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
  WellnessReminder,
  MoodLog,
  MoodValue,
  loadWellnessReminders,
  toggleWellnessReminder,
  deleteWellnessReminder,
  loadMoodLogs,
  addMoodLog,
} from '@/lib/family-records';
import { useCaregiverPermissions } from '@/lib/use-caregiver-permissions';

const MOOD_EMOJI: Record<MoodValue, string> = { 1: '😞', 2: '🙁', 3: '😐', 4: '🙂', 5: '😄' };
const KIND_ICONS: Record<WellnessReminder['kind'], string> = {
  meditation: 'leaf',
  breathing: 'cloud-outline',
  journal: 'book-outline',
  self_care: 'heart-outline',
  therapy: 'medkit-outline',
};

export default function FamilyWellnessScreen() {
  const router = useRouter();
  const { memberId, memberName } = useLocalSearchParams<{ memberId: string; memberName?: string }>();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const { t } = useTranslation();

  // Scoped caregiver access (PRD 5.5). The owner is unrestricted; a
  // caregiver only gets the actions their access level allows.
  const { canMarkDone, canEdit } = useCaregiverPermissions(memberId ? String(memberId) : null);

  const [reminders, setReminders] = useState<WellnessReminder[]>([]);
  const [moodLogs, setMoodLogs] = useState<MoodLog[]>([]);
  const [loggingMood, setLoggingMood] = useState(false);

  const load = useCallback(async () => {
    if (!memberId) return;
    const [r, m] = await Promise.all([loadWellnessReminders(String(memberId)), loadMoodLogs(String(memberId))]);
    setReminders(r);
    setMoodLogs(m.slice(0, 7));
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

  const logMood = async (mood: MoodValue) => {
    if (!memberId || loggingMood) return;
    setLoggingMood(true);
    await addMoodLog(String(memberId), mood);
    await load();
    setLoggingMood(false);
  };

  const openAdd = () => {
    router.push({ pathname: '/family-wellness/add', params: { memberId: String(memberId), memberName: memberName ? String(memberName) : '' } });
  };

  const headerHeight = 110 + insets.top;
  const todayLogged = moodLogs.some((m) => new Date(m.loggedAt).toDateString() === new Date().toDateString());

  return (
    <View style={[styles.container, { backgroundColor: colors.bg }]}>
      <LinearGradient colors={colors.heroGradient as any} style={[styles.header, { height: headerHeight, paddingTop: insets.top }]}>
        <View style={styles.headerTop}>
          <Pressable onPress={() => router.back()} style={styles.backBtn} hitSlop={12}>
            <Ionicons name="chevron-back" size={24} color={colors.text} />
          </Pressable>
          <Text style={[styles.headerTitle, { color: colors.text }]}>{t('familyWellness.headerTitle')}</Text>
          {canEdit ? (
            <Pressable onPress={openAdd} style={styles.addBtn} hitSlop={12}>
            <Ionicons name="add-circle" size={30} color={colors.accent} />
          </Pressable>
          ) : (
            <View style={styles.addBtn} />
          )}
        </View>
        {memberName ? <Text style={[styles.headerSubtitle, { color: colors.textSecondary }]}>{t('familyWellness.forMember', { name: memberName })}</Text> : null}
      </LinearGradient>

      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: insets.bottom + 40 }} showsVerticalScrollIndicator={false}>
        <Text style={[styles.sectionLabel, { color: colors.textSecondary }]}>{t('familyWellness.moodTodayLabel')}</Text>
        <View style={[styles.moodCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={styles.moodRow}>
            {([1, 2, 3, 4, 5] as MoodValue[]).map((m) => (
              <Pressable key={m} onPress={() => logMood(m)} disabled={loggingMood} style={styles.moodEmojiBtn}>
                <Text style={styles.moodEmoji}>{MOOD_EMOJI[m]}</Text>
              </Pressable>
            ))}
          </View>
          {todayLogged && <Text style={[styles.moodLoggedText, { color: colors.accentMint ?? colors.text }]}>{t('familyWellness.moodLoggedToday')}</Text>}
        </View>

        {moodLogs.length > 0 && (
          <View style={styles.moodTrendRow}>
            {moodLogs.slice().reverse().map((m) => (
              <Text key={m.id} style={styles.moodTrendEmoji}>{MOOD_EMOJI[m.mood]}</Text>
            ))}
          </View>
        )}

        <Text style={[styles.sectionLabel, { color: colors.textSecondary, marginTop: 24 }]}>{t('familyWellness.remindersLabel')}</Text>
        {reminders.length === 0 ? (
          <View style={styles.emptyState}>
            <Ionicons name="leaf-outline" size={40} color={colors.textTertiary} />
            <Text style={[styles.emptyDesc, { color: colors.textTertiary }]}>{t('familyWellness.emptyDesc')}</Text>
          </View>
        ) : (
          reminders.map((item) => (
            <Animated.View key={item.id} entering={FadeInDown.duration(300)} style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Pressable disabled={!canMarkDone} onPress={async () => { await toggleWellnessReminder(String(memberId), item.id); load(); }} style={styles.checkCircle}>
                <Ionicons name={item.enabled ? 'toggle' : 'toggle-outline'} size={26} color={item.enabled ? colors.accent : colors.textTertiary} />
              </Pressable>
              <View style={[styles.iconWrap, { backgroundColor: colors.accentDim }]}>
                <Ionicons name={KIND_ICONS[item.kind] as any} size={16} color={colors.accent} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.cardTitle, { color: colors.text }]} numberOfLines={1}>{item.title}</Text>
                <Text style={[styles.cardSub, { color: colors.textTertiary }]}>
                  {t(`familyWellness.kind.${item.kind}`)}{item.time ? ` · ${item.time}` : ''}
                </Text>
              </View>
              {canEdit && (<Pressable onPress={() => router.push({ pathname: '/family-wellness/add', params: { memberId: String(memberId), memberName: memberName ? String(memberName) : '', editId: item.id } })} hitSlop={10} style={styles.rowAction}>
                <Ionicons name="create-outline" size={18} color={colors.textTertiary} />
              </Pressable>)}
              {canEdit && (<Pressable onPress={async () => { await deleteWellnessReminder(String(memberId), item.id); load(); }} hitSlop={10}>
                <Ionicons name="trash-outline" size={18} color={colors.textTertiary} />
              </Pressable>)}
            </Animated.View>
          ))
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
  sectionLabel: { fontFamily: 'Inter_700Bold', fontSize: 12, letterSpacing: 1, marginBottom: 10 },
  moodCard: { borderRadius: 16, borderWidth: 1, padding: 16, alignItems: 'center', gap: 10 },
  moodRow: { flexDirection: 'row', gap: 14 },
  moodEmojiBtn: { padding: 6 },
  moodEmoji: { fontSize: 30 },
  moodLoggedText: { fontFamily: 'Inter_600SemiBold', fontSize: 12 },
  moodTrendRow: { flexDirection: 'row', gap: 8, marginTop: 12, justifyContent: 'center' },
  moodTrendEmoji: { fontSize: 18 },
  emptyState: { alignItems: 'center', paddingVertical: 30, gap: 8 },
  emptyDesc: { fontFamily: 'Inter_400Regular', fontSize: 13, textAlign: 'center', paddingHorizontal: 30 },
  card: { flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 16, borderWidth: 1, padding: 14, marginBottom: 10 },
  rowAction: { marginRight: 14 },
  checkCircle: { padding: 2 },
  iconWrap: { width: 32, height: 32, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  cardTitle: { fontFamily: 'Inter_600SemiBold', fontSize: 14 },
  cardSub: { fontFamily: 'Inter_400Regular', fontSize: 11, marginTop: 2 },
});
