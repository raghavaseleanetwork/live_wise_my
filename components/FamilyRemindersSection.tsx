import React from 'react';
import { StyleSheet, Text, View, ScrollView, Pressable, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { useTheme } from '@/lib/theme-context';
import { Avatar } from '@/components/Avatar';
import { familyReminderLabel, type FamilyReminder } from '@/lib/family-reminders';

/**
 * Family Reminders on the Home dashboard.
 *
 * Renders the client-specified card: member photo, member name, reminder-type
 * icon, title, time, and status — plus a "View All" that jumps to the Reminders
 * tab.
 *
 * Data comes from `useFamilyReminders()`, which prefers the server projection
 * (`GET /api/reminders/family`) and falls back to rebuilding from on-device
 * records. That endpoint is not implemented server-side yet, so today this
 * always renders the local projection — see
 * `backend-team/FAMILY-REMINDERS-HOME-backend-requirements.md`.
 */

const MAX_CARDS = 5;

/** Strips the " · MemberName" suffix `project()` appends for the flat Bills list. */
function reminderTitle(reminder: FamilyReminder): string {
  const suffix = ` · ${reminder.memberName}`;
  return reminder.name.endsWith(suffix) ? reminder.name.slice(0, -suffix.length) : reminder.name;
}

type StatusTone = 'overdue' | 'today' | 'upcoming' | 'done';

function statusFor(reminder: FamilyReminder): StatusTone {
  if (reminder.isPaid || reminder.status === 'paid') return 'done';
  const due = new Date(reminder.dueDate);
  const now = new Date();
  if (due.toDateString() === now.toDateString()) return 'today';
  return due.getTime() < now.getTime() ? 'overdue' : 'upcoming';
}

export default function FamilyRemindersSection({
  reminders,
  seniorMode = false,
}: {
  reminders: FamilyReminder[];
  seniorMode?: boolean;
}) {
  const router = useRouter();
  const { colors } = useTheme();
  const { t } = useTranslation();

  // Not-yet-done first, soonest first. Completed rows are excluded outright —
  // Home is a "what needs attention" surface, unlike the Reminders tab which
  // keeps a Completed section.
  const visible = reminders
    .filter((r) => !r.isPaid && r.status !== 'paid' && r.status !== 'cancelled')
    .sort((a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime())
    .slice(0, MAX_CARDS);

  if (visible.length === 0) return null;

  const toneColor = (tone: StatusTone): string => {
    if (tone === 'overdue') return colors.danger;
    if (tone === 'today') return colors.warning;
    if (tone === 'done') return colors.accentMint ?? colors.accent;
    return colors.accent;
  };

  return (
    <Animated.View entering={Platform.OS !== 'web' ? FadeInDown.delay(140).duration(500) : undefined}>
      <View style={styles.headerRow}>
        <Text style={[styles.sectionTitle, { color: colors.text }, seniorMode && styles.sectionTitleSenior]}>
          {t('home.familyReminders')}
        </Text>
        <Pressable
          onPress={() => router.push('/(tabs)/bills')}
          hitSlop={10}
          style={styles.viewAllBtn}
          accessibilityRole="button"
        >
          <Text style={[styles.viewAllText, { color: colors.accent }]}>{t('home.viewAll')}</Text>
          <Ionicons name="chevron-forward" size={14} color={colors.accent} />
        </Pressable>
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        {visible.map((reminder) => {
          const tone = statusFor(reminder);
          const color = toneColor(tone);
          const due = new Date(reminder.dueDate);
          const timeText = due.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
          const dateText = due.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });

          return (
            <Pressable
              key={reminder.id}
              onPress={() =>
                router.push({
                  pathname: '/family-member-detail/[memberId]',
                  params: { memberId: reminder.memberId, memberName: reminder.memberName },
                })
              }
              style={[
                styles.card,
                { backgroundColor: colors.card, borderColor: colors.border },
                seniorMode && styles.cardSenior,
              ]}
            >
              <View style={styles.cardTop}>
                <Avatar name={reminder.memberName} uri={reminder.memberAvatarUrl} size={seniorMode ? 40 : 32} />
                <View style={{ flex: 1 }}>
                  <Text
                    style={[styles.memberName, { color: colors.text }, seniorMode && styles.memberNameSenior]}
                    numberOfLines={1}
                  >
                    {reminder.memberName}
                  </Text>
                  <Text style={[styles.kindLabel, { color: colors.textTertiary }]} numberOfLines={1}>
                    {familyReminderLabel(reminder.sourceKind)}
                  </Text>
                </View>
                <View style={[styles.kindIconWrap, { backgroundColor: color + '1F' }]}>
                  <Ionicons name={reminder.icon as any} size={seniorMode ? 18 : 16} color={color} />
                </View>
              </View>

              <Text
                style={[styles.title, { color: colors.text }, seniorMode && styles.titleSenior]}
                numberOfLines={2}
              >
                {reminderTitle(reminder)}
              </Text>

              <View style={styles.footerRow}>
                <Ionicons name="time-outline" size={12} color={colors.textTertiary} />
                <Text style={[styles.timeText, { color: colors.textSecondary }]} numberOfLines={1}>
                  {dateText} · {timeText}
                </Text>
                <View style={[styles.statusPill, { backgroundColor: color + '1F' }]}>
                  <Text style={[styles.statusText, { color }]}>{t(`home.familyReminderStatus.${tone}`)}</Text>
                </View>
              </View>
            </Pressable>
          );
        })}
      </ScrollView>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 },
  sectionTitle: { fontFamily: 'Inter_600SemiBold', fontSize: 17 },
  sectionTitleSenior: { fontSize: 20 },
  viewAllBtn: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  viewAllText: { fontFamily: 'Inter_600SemiBold', fontSize: 13 },
  scroll: { paddingRight: 20, gap: 12, paddingBottom: 20 },
  card: { width: 230, borderRadius: 18, borderWidth: 1, padding: 14, gap: 10 },
  cardSenior: { width: 260, padding: 16 },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  memberName: { fontFamily: 'Inter_600SemiBold', fontSize: 13 },
  memberNameSenior: { fontSize: 15 },
  kindLabel: { fontFamily: 'Inter_400Regular', fontSize: 11, marginTop: 1 },
  kindIconWrap: { width: 30, height: 30, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  title: { fontFamily: 'Inter_600SemiBold', fontSize: 14, lineHeight: 19 },
  titleSenior: { fontSize: 16, lineHeight: 22 },
  footerRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  timeText: { fontFamily: 'Inter_500Medium', fontSize: 11, flex: 1 },
  statusPill: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  statusText: { fontFamily: 'Inter_700Bold', fontSize: 10 },
});
