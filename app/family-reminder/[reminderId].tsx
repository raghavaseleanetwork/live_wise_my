import React, { useMemo } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useTheme } from '@/lib/theme-context';
import { useCurrency } from '@/lib/currency-context';
import { useSeniorMode } from '@/lib/senior-context';
import { useFamilyReminders } from '@/lib/use-family-reminders';
import { familyReminderLabel, type FamilyReminderKind } from '@/lib/family-reminders';
import { CATEGORIES, getDaysUntil, REPEAT_OPTIONS, type RepeatType } from '@/lib/data';
import CategoryIcon from '@/components/CategoryIcon';
import Money from '@/components/Money';
import PremiumLoader from '@/components/PremiumLoader';

/**
 * Detail view for a Family Hub reminder.
 *
 * Tapping a reminder in the Reminders tab should stay in the reminders flow —
 * it previously jumped straight to the member's Family Hub page, which threw
 * the user out of the list they were working through and gave no sense of
 * having opened *that reminder*.
 *
 * This is deliberately a separate screen from `bill-details`: that one edits a
 * server-backed `Bill` in place, while a family reminder is a read-only
 * projection of a Family Hub record (see `lib/family-reminders.ts`). Editing
 * belongs to the record, not to its projection — so this screen shows the
 * detail and hands off to Family Hub for changes, rather than pretending to own
 * something it cannot save.
 */

/** Which Family Hub route owns each kind, for the "manage" hand-off. */
const KIND_ROUTE: Record<FamilyReminderKind, string> = {
  appointment: '/family-appointments',
  'medicine-stock': '/family-stock',
  'family-bill': '/family-bills',
  subscription: '/family-subscriptions',
  task: '/family-tasks',
  routine: '/family-routine',
  checkin: '/family-checkin',
  travel: '/family-travel',
};

function formatRepeat(r: RepeatType) {
  return REPEAT_OPTIONS.find((x) => x.key === r)?.label ?? 'One-time';
}

function dueLabel(dueDate: string): { text: string; urgent: boolean } {
  const days = getDaysUntil(dueDate);
  if (days < 0) return { text: `Overdue by ${Math.abs(days)} day${Math.abs(days) === 1 ? '' : 's'}`, urgent: true };
  if (days === 0) return { text: 'Due today', urgent: true };
  if (days === 1) return { text: 'Due tomorrow', urgent: false };
  return { text: `Due in ${days} days`, urgent: false };
}

export default function FamilyReminderDetailScreen() {
  const { reminderId } = useLocalSearchParams<{ reminderId: string }>();
  const insets = useSafeAreaInsets();
  const { colors, isDark } = useTheme();
  const { formatAmount } = useCurrency();
  const { isSeniorMode } = useSeniorMode();
  const { familyReminders } = useFamilyReminders();

  const reminder = useMemo(
    () => familyReminders.find((r) => r.id === String(reminderId)),
    [familyReminders, reminderId],
  );

  const topInset = Platform.OS === 'web' ? 67 : insets.top;

  if (!reminder) {
    // The list is loaded asynchronously, so a miss here is usually "not loaded
    // yet" rather than "gone". Showing the loader avoids flashing a
    // not-found state on every cold open of this screen.
    return (
      <View style={[styles.container, styles.centered, { backgroundColor: colors.bg }]}>
        <PremiumLoader size={80} text="Loading reminder..." />
      </View>
    );
  }

  const due = dueLabel(reminder.dueDate);
  const category = CATEGORIES[reminder.category] ?? CATEGORIES.others;
  // The stored name is "<title> · <member>"; the member is shown on its own row
  // below, so the heading uses just the title.
  const title = reminder.name.split(' · ')[0];
  const dueDate = new Date(reminder.dueDate);

  const openFamilyHub = () => {
    const base = KIND_ROUTE[reminder.sourceKind];
    router.push({
      pathname: `${base}/[memberId]`,
      params: { memberId: reminder.memberId, memberName: reminder.memberName },
    } as any);
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.bg }]}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[styles.scroll, { paddingTop: topInset + 8, paddingBottom: insets.bottom + 32 }]}
      >
        <View style={styles.headerRow}>
          <Pressable onPress={() => router.back()} hitSlop={12} testID="family-reminder-back">
            <Ionicons name="arrow-back" size={24} color={colors.text} />
          </Pressable>
          <Text style={[styles.headerTitle, { color: colors.text }]}>Reminder</Text>
          <View style={{ width: 24 }} />
        </View>

        <LinearGradient
          colors={colors.heroGradient as unknown as [string, string, ...string[]]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={[styles.hero, { borderColor: colors.accent + '20' }]}
        >
          <View style={[styles.heroIcon, { backgroundColor: category.color + '20' }]}>
            <CategoryIcon category={reminder.category} size={28} />
          </View>
          <Text style={[styles.heroTitle, { color: colors.text }, isSeniorMode && { fontSize: 24 }]}>
            {title}
          </Text>
          <View style={[styles.kindPill, { backgroundColor: colors.accentDim }]}>
            <Text style={[styles.kindPillText, { color: colors.accent }]}>
              {familyReminderLabel(reminder.sourceKind)}
            </Text>
          </View>
          {reminder.amount > 0 && (
            <Money style={[styles.heroAmount, { color: colors.text }]}>
              {formatAmount(reminder.amount)}
            </Money>
          )}
          <Text style={[styles.heroDue, { color: due.urgent ? colors.danger : colors.textSecondary }]}>
            {due.text}
          </Text>
        </LinearGradient>

        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <DetailRow
            icon="person-outline"
            label="For"
            value={reminder.memberName}
            colors={colors}
          />
          <DetailRow
            icon="calendar-outline"
            label="Due"
            value={dueDate.toLocaleDateString('en-IN', {
              weekday: 'short',
              day: 'numeric',
              month: 'short',
              year: 'numeric',
            })}
            colors={colors}
          />
          <DetailRow
            icon="repeat-outline"
            label="Repeats"
            value={formatRepeat(reminder.repeatType)}
            colors={colors}
          />
          <DetailRow
            icon="notifications-outline"
            label="Reminders"
            value={
              reminder.reminderDaysBefore.length
                ? reminder.reminderDaysBefore
                    .map((d) => (d === 0 ? 'on the day' : `${d}d before`))
                    .join(', ')
                : 'None'
            }
            colors={colors}
            isLast
          />
        </View>

        {/*
          The hand-off the user needs: this screen cannot save changes, because
          the reminder is derived from a Family Hub record. Rather than showing
          disabled edit/delete buttons, it points at the place where the record
          can actually be changed.
        */}
        <Pressable
          onPress={openFamilyHub}
          style={[styles.manageBtn, { backgroundColor: colors.accentDim, borderColor: colors.accent + '30' }]}
          testID="family-reminder-manage"
        >
          <Ionicons name="people-outline" size={20} color={colors.accent} />
          <View style={styles.manageTextWrap}>
            <Text style={[styles.manageTitle, { color: colors.accent }]}>
              Manage in Family Hub
            </Text>
            <Text style={[styles.manageSubtitle, { color: colors.textSecondary }]}>
              Edit or remove this from {reminder.memberName}’s {familyReminderLabel(reminder.sourceKind).toLowerCase()}s
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={colors.accent} />
        </Pressable>

        <Text style={[styles.footnote, { color: colors.textTertiary }]}>
          This reminder comes from Family Hub. It updates automatically when the
          original record changes.
        </Text>
      </ScrollView>
    </View>
  );
}

function DetailRow({
  icon,
  label,
  value,
  colors,
  isLast,
}: {
  icon: string;
  label: string;
  value: string;
  colors: any;
  isLast?: boolean;
}) {
  return (
    <View style={[styles.detailRow, !isLast && { borderBottomWidth: 1, borderBottomColor: colors.border }]}>
      <View style={[styles.detailIcon, { backgroundColor: colors.accentDim }]}>
        <Ionicons name={icon as any} size={16} color={colors.accent} />
      </View>
      <Text style={[styles.detailLabel, { color: colors.textSecondary }]}>{label}</Text>
      <Text style={[styles.detailValue, { color: colors.text }]} numberOfLines={2}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  centered: { alignItems: 'center', justifyContent: 'center' },
  scroll: { paddingHorizontal: 20 },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 20,
  },
  headerTitle: { fontFamily: 'Inter_700Bold', fontSize: 18 },
  hero: {
    alignItems: 'center',
    borderRadius: 16,
    borderWidth: 1,
    paddingVertical: 28,
    paddingHorizontal: 20,
    gap: 10,
  },
  heroIcon: {
    width: 60,
    height: 60,
    borderRadius: 30,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroTitle: { fontFamily: 'Inter_700Bold', fontSize: 20, textAlign: 'center' },
  kindPill: { paddingHorizontal: 12, paddingVertical: 5, borderRadius: 999 },
  kindPillText: { fontFamily: 'Inter_600SemiBold', fontSize: 12 },
  heroAmount: { fontFamily: 'Inter_700Bold', fontSize: 30 },
  heroDue: { fontFamily: 'Inter_600SemiBold', fontSize: 14 },
  card: {
    marginTop: 20,
    borderRadius: 16,
    borderWidth: 1,
    paddingHorizontal: 16,
  },
  detailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    gap: 12,
  },
  detailIcon: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
  detailLabel: { fontFamily: 'Inter_400Regular', fontSize: 14, flex: 1 },
  detailValue: { fontFamily: 'Inter_600SemiBold', fontSize: 14, flexShrink: 1, textAlign: 'right' },
  manageBtn: {
    marginTop: 20,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderRadius: 16,
    borderWidth: 1,
    paddingVertical: 16,
    paddingHorizontal: 16,
  },
  manageTextWrap: { flex: 1 },
  manageTitle: { fontFamily: 'Inter_700Bold', fontSize: 15 },
  manageSubtitle: { fontFamily: 'Inter_400Regular', fontSize: 12, marginTop: 2 },
  footnote: {
    fontFamily: 'Inter_400Regular',
    fontSize: 12,
    textAlign: 'center',
    marginTop: 20,
    lineHeight: 18,
  },
});
