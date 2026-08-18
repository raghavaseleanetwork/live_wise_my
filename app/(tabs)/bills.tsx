import React, { useState, useMemo, useCallback } from 'react';
import {
  StyleSheet,
  Text,
  View,
  ScrollView,
  Pressable,
  Platform,
  TextInput,
  Switch,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import Colors, { ThemeColors } from '@/constants/colors';
import { useTheme } from '@/lib/theme-context';
import { useCurrency } from '@/lib/currency-context';
import { useExpenses } from '@/lib/expense-context';
import { useTabBarContentInset } from '@/lib/tab-bar';
import { useSeniorMode } from '@/lib/senior-context';
import { useAlert } from '@/lib/alert-context';
import PremiumLoader from '@/components/PremiumLoader';
import CustomModal from '@/components/CustomModal';
import { getIntentPolicy, getReminderIntentFromBill, type ReminderIntent } from '@/lib/reminder-intent';
import { useFamilyReminders } from '@/lib/use-family-reminders';
import { isFamilyReminderId } from '@/lib/family-reminders';
import DateRangeFilter from '@/components/DateRangeFilter';
import {
  endOfDay,
  isWithinRange,
  resolveDateRange,
  startOfDay,
  type DateRangeState,
} from '@/lib/date-range-filter';
import {
  Bill,
  ReminderType,
  RepeatType,
  REMINDER_TYPE_CONFIG,
  REPEAT_OPTIONS,
  ICON_OPTIONS,
  CATEGORIES,
  CategoryType,
  getDaysUntil,
} from '@/lib/data';

type FilterType = ReminderIntent;

/** The two switchable lists at the top of the screen. */
type SectionKey = 'today' | 'upcoming';

const FILTER_TABS: { key: FilterType; labelKey: string; icon: string }[] = [
  { key: 'all', labelKey: 'bills.filterAll', icon: 'apps' },
  { key: 'bills', labelKey: 'bills.filterBills', icon: 'receipt' },
  { key: 'health', labelKey: 'bills.filterHealth', icon: 'medkit' },
  { key: 'family', labelKey: 'bills.filterFamily', icon: 'people' },
  { key: 'work', labelKey: 'bills.filterWork', icon: 'newspaper' },
  { key: 'tasks', labelKey: 'bills.filterTasks', icon: 'shield-checkmark' },
  { key: 'subscriptions', labelKey: 'bills.filterSubs', icon: 'refresh' },
  { key: 'finance', labelKey: 'bills.filterFinance', icon: 'trending-up' },
  { key: 'habits', labelKey: 'bills.filterHabits', icon: 'water' },
  { key: 'travel', labelKey: 'bills.filterTravel', icon: 'globe' },
  { key: 'events', labelKey: 'bills.filterEvents', icon: 'film' },
  { key: 'custom', labelKey: 'bills.filterCustom', icon: 'create' },
];

/**
 * Default date range for this screen.
 *
 * "All time" rather than Reports' "Today": a reminder list scoped to a date
 * range hides everything outside it, and on first open the user has no idea a
 * filter is even applied — an empty screen reads as "I have no reminders"
 * rather than "none are due today". The default must show everything; the
 * user narrows down from there.
 */
function makeDefaultRange(): DateRangeState {
  const now = new Date();
  return {
    filterKey: 'all',
    customStart: startOfDay(now),
    customEnd: endOfDay(now),
    selectedYear: now.getFullYear(),
    selectedMonths: [now.getMonth()],
  };
}

const CATEGORY_OPTIONS: { key: CategoryType; label: string }[] = [
  { key: 'bills', label: 'Bills & Utilities' },
  { key: 'entertainment', label: 'Entertainment' },
  { key: 'food', label: 'Food & Dining' },
  { key: 'health', label: 'Healthcare' },
  { key: 'shopping', label: 'Shopping' },
  { key: 'education', label: 'Education' },
  { key: 'investment', label: 'Investment' },
  { key: 'transport', label: 'Transport' },
  { key: 'others', label: 'Others' },
];

function getUrgencyColor(days: number, colors: ThemeColors): string {
  if (days <= 1) return colors.danger;
  if (days <= 5) return colors.warning;
  return colors.accentMint;
}

function ReminderCard({
  bill,
  onMarkPaid,
  onSnooze,
  onEdit,
  onDelete,
  index,
  onPress,
  isSeniorMode,
}: {
  bill: Bill;
  onMarkPaid: () => void;
  onSnooze: () => void;
  onEdit: () => void;
  onDelete: () => void;
  index: number;
  onPress?: () => void;
  isSeniorMode: boolean;
}) {
  const { colors, isDark } = useTheme();
  const { formatAmount } = useCurrency();
  const router = useRouter();
  const { t } = useTranslation();
  const [showActions, setShowActions] = useState(false);
  const effectiveDate = (bill.status === 'snoozed' && bill.snoozedUntil) ? bill.snoozedUntil : bill.dueDate;
  const daysLeft = getDaysUntil(effectiveDate);
  const urgencyColor = bill.status === 'paid' ? colors.accentMint : bill.status === 'snoozed' ? colors.accentBlue : getUrgencyColor(daysLeft, colors);
  const dueDate = new Date(bill.dueDate);
  const isPaid = bill.status === 'paid' || bill.isPaid;
  const isSnoozed = bill.status === 'snoozed';

  const repeatLabel = REPEAT_OPTIONS.find(r => r.key === bill.repeatType)?.label || '';
  const intent = getReminderIntentFromBill(bill);
  const policy = getIntentPolicy(intent);
  const showAmount = policy.shouldHaveAmount && bill.amount > 0;
  const intentMeta = (() => {
    switch (intent) {
      case 'bills':
        return { label: t('bills.intentBills'), color: '#F59E0B' };
      case 'subscriptions':
        return { label: t('bills.intentSubscriptions'), color: '#3B82F6' };
      case 'health':
        return { label: t('bills.intentHealth'), color: '#10B981' };
      case 'habits':
        return { label: t('bills.intentHabits'), color: '#22C55E' };
      case 'family':
        return { label: t('bills.intentFamily'), color: '#EC4899' };
      case 'work':
        return { label: t('bills.intentWork'), color: '#3B82F6' };
      case 'tasks':
        return { label: t('bills.intentTasks'), color: '#F59E0B' };
      case 'finance':
        return { label: t('bills.intentFinance'), color: '#4F46E5' };
      case 'travel':
        return { label: t('bills.intentTravel'), color: '#60A5FA' };
      case 'events':
        return { label: t('bills.intentEvents'), color: '#6366F1' };
      case 'custom':
      default:
        return { label: t('bills.intentCustom'), color: '#4F46E5' };
    }
  })();

  return (
    <Animated.View entering={Platform.OS !== 'web' ? FadeInDown.delay(150 + index * 60).duration(400) : undefined}>
      <Pressable onPress={onPress} disabled={!onPress}>
        <View style={[styles.reminderCard, { backgroundColor: colors.card, borderColor: colors.border }, isPaid && styles.reminderCardPaid]}>
          <View style={styles.reminderTop}>
            <View style={[styles.reminderIcon, { backgroundColor: urgencyColor + '15' }]}>
              <Ionicons name={bill.icon as any} size={isSeniorMode ? 28 : 22} color={urgencyColor} />
            </View>
            <View style={styles.reminderInfo}>
              <Text style={[styles.reminderName, { color: colors.text }, isPaid && { textDecorationLine: 'line-through' as const, color: colors.textTertiary }, isSeniorMode && { fontSize: 18 }]} numberOfLines={1}>
                {bill.name}
              </Text>
              <View style={styles.reminderMetaRow}>
                <View style={[styles.typeBadge, { backgroundColor: intentMeta.color + '15' }]}>
                  <Text style={[styles.typeBadgeText, { color: intentMeta.color }, isSeniorMode && { fontSize: 13 }]}>{intentMeta.label}</Text>
                </View>
                {policy.showRepeat && (
                  <View style={styles.repeatBadge}>
                    <Ionicons name="refresh" size={10} color={colors.textTertiary} />
                    <Text style={[styles.repeatText, { color: colors.textTertiary }, isSeniorMode && { fontSize: 13 }]}>{repeatLabel}</Text>
                  </View>
                )}
              </View>
              {policy.showDue ? (
                <Text style={[styles.reminderDue, { color: urgencyColor }, isSeniorMode && { fontSize: 15 }]}>
                  {isPaid ? t('bills.statusPaid') : isSnoozed ? t('bills.statusSnoozed') : daysLeft <= 0 ? t('bills.statusOverdue') : daysLeft === 1 ? t('bills.statusDueTomorrow') : t('bills.statusDueInDays', { count: daysLeft })}
                  <Text style={[styles.reminderDate, { color: colors.textTertiary }, isSeniorMode && { fontSize: 14 }]}>
                    {'  '}
                    {dueDate.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                  </Text>
                </Text>
              ) : null}
            </View>
            <View style={[styles.reminderRight, isSeniorMode && { justifyContent: 'center' }]}>
              <Text
                style={[
                  styles.reminderAmount,
                  { color: colors.text, opacity: showAmount ? 1 : 0 },
                  isPaid && { color: colors.textTertiary, textDecorationLine: 'line-through' as const },
                  isSeniorMode && { fontSize: 22 },
                ]}
              >
                {formatAmount(bill.amount)}
              </Text>
            </View>
          </View>

          <View style={[styles.cardActions, { borderTopColor: colors.border }, isSeniorMode && { paddingVertical: 12, gap: 12 }]}>
            <Pressable
              onPress={() => {
                try { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); } catch { }
                onMarkPaid();
              }}
              style={[styles.cardActionBtn, { backgroundColor: isPaid ? colors.warningDim : colors.accentMintDim }, isSeniorMode && { height: 60, borderRadius: 16 }]}
              testID={`mark-paid-${bill.id}`}
            >
              <Ionicons name={isPaid ? 'close' : 'checkmark'} size={isSeniorMode ? 28 : 18} color={isPaid ? colors.warning : colors.accentMint} />
            </Pressable>
            {!isPaid && (
              <Pressable
                onPress={() => {
                  try { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); } catch { }
                  onSnooze();
                }}
                style={[styles.cardActionBtn, { backgroundColor: colors.accentBlueDim }, isSeniorMode && { height: 60, borderRadius: 16 }]}
              >
                <Ionicons name="time" size={isSeniorMode ? 28 : 18} color={colors.accentBlue} />
              </Pressable>
            )}
            <Pressable
              onPress={() => {
                try { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); } catch { }
                router.push({ pathname: '/edit-reminder', params: { id: bill.id } });
              }}
              style={[styles.cardActionBtn, { backgroundColor: colors.accentDim }, isSeniorMode && { height: 60, borderRadius: 16 }]}
            >
              <Ionicons name="pencil" size={isSeniorMode ? 24 : 16} color={colors.accent} />
            </Pressable>
            <Pressable
              onPress={() => {
                try { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); } catch { }
                onDelete();
              }}
              style={[styles.cardActionBtn, { backgroundColor: colors.dangerDim }, isSeniorMode && { height: 60, borderRadius: 16 }]}
              testID={`delete-${bill.id}`}
            >
              <Ionicons name="trash" size={isSeniorMode ? 24 : 16} color={colors.danger} />
            </Pressable>
          </View>

          {isSnoozed && bill.snoozedUntil && (
            <View style={[styles.snoozeInfo, { backgroundColor: colors.accentBlueDim }]}>
              <Ionicons name="time" size={12} color={colors.accentBlue} />
              <Text style={[styles.snoozeInfoText, { color: colors.accentBlue }, isSeniorMode && { fontSize: 13 }]}>
                {t('bills.snoozedUntil', { date: new Date(bill.snoozedUntil).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) })}
              </Text>
            </View>
          )}
        </View>
      </Pressable>
    </Animated.View>
  );
}

// Combined AddEditModal removed in favor of full screen app/edit-reminder.tsx

function SnoozeModal({ visible, onClose, onSnooze }: { visible: boolean; onClose: () => void; onSnooze: (days: number) => void }) {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const SNOOZE_OPTIONS = [
    { days: 1, label: t('bills.snooze1Day'), icon: 'sunny' as const },
    { days: 2, label: t('bills.snooze2Days'), icon: 'partly-sunny' as const },
    { days: 3, label: t('bills.snooze3Days'), icon: 'cloud' as const },
    { days: 7, label: t('bills.snooze1Week'), icon: 'calendar' as const },
  ];

  return (
    <CustomModal visible={visible} onClose={onClose}>
      <Text style={[styles.snoozeTitle, { color: colors.text }]}>{t('bills.snoozeModalTitle')}</Text>
      <Text style={[styles.snoozeSubtitle, { color: colors.textSecondary }]}>{t('bills.snoozeModalSubtitle')}</Text>
      {SNOOZE_OPTIONS.map(opt => (
        <Pressable
          key={opt.days}
          onPress={() => { onSnooze(opt.days); onClose(); }}
          style={[styles.snoozeOption, { backgroundColor: colors.inputBg, borderColor: colors.inputBorder }]}
        >
          <View style={[styles.snoozeOptionIcon, { backgroundColor: colors.accentBlueDim }]}>
            <Ionicons name={opt.icon} size={18} color={colors.accentBlue} />
          </View>
          <Text style={[styles.snoozeOptionText, { color: colors.text }]}>{opt.label}</Text>
          <Ionicons name="chevron-forward" size={16} color={colors.textTertiary} />
        </Pressable>
      ))}
    </CustomModal>
  );
}

function SettingsModal({
  visible,
  onClose,
  settings,
  onSave,
}: {
  visible: boolean;
  onClose: () => void;
  settings: { soundEnabled: boolean; vibrationEnabled: boolean; defaultReminderDays: number[] };
  onSave: (s: { soundEnabled: boolean; vibrationEnabled: boolean; defaultReminderDays: number[] }) => void;
}) {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const [sound, setSound] = useState(settings.soundEnabled);
  const [vibration, setVibration] = useState(settings.vibrationEnabled);
  const [days, setDays] = useState<number[]>(settings.defaultReminderDays);

  React.useEffect(() => {
    setSound(settings.soundEnabled);
    setVibration(settings.vibrationEnabled);
    setDays(settings.defaultReminderDays);
  }, [settings, visible]);

  const toggleDay = (d: number) => {
    setDays(prev => prev.includes(d) ? prev.filter(x => x !== d) : [...prev, d].sort((a, b) => b - a));
  };

  return (
    <CustomModal visible={visible} onClose={onClose}>
      {/* The negative top margin that used to sit here compensated for
          CustomModal's old 32px top padding; that padding is now 20, so the
          offset would pull the title under the close button. */}
      <View style={styles.modalHeader}>
        <Text style={[styles.modalTitle, { color: colors.text }]}>{t('bills.settingsModalTitle')}</Text>
      </View>

      <View>
        <Text style={[styles.settingsSectionTitle, { color: colors.textSecondary }]}>{t('bills.notifyBeforeDue')}</Text>
        <View style={styles.dayChipsRow}>
          {[7, 3, 2, 1, 0].map(d => (
            <Pressable
              key={d}
              onPress={() => toggleDay(d)}
              style={[
                styles.chip,
                styles.dayChip,
                { backgroundColor: colors.inputBg, borderColor: colors.border + '40' },
                days.includes(d) && { backgroundColor: colors.accentDim, borderColor: colors.accent + '60' }
              ]}
            >
              <Text
                numberOfLines={1}
                style={[styles.chipText, { color: colors.textSecondary }, days.includes(d) && { color: colors.accent, fontFamily: 'Inter_600SemiBold' }]}
              >
                {d === 0 ? t('bills.dueDay') : t('bills.daysBeforeCount', { count: d })}
              </Text>
            </Pressable>
          ))}
        </View>

        <View style={[styles.settingRow, { borderTopColor: colors.border + '40' }]}>
          <View style={styles.settingInfo}>
            <View style={[styles.settingIconWrap, { backgroundColor: colors.accentDim }]}>
              <Ionicons name="volume-high" size={20} color={colors.accent} />
            </View>
            <Text style={[styles.settingLabel, { color: colors.text }]}>{t('bills.soundNotifications')}</Text>
          </View>
          <Switch
            value={sound}
            onValueChange={setSound}
            trackColor={{ false: colors.inputBg, true: colors.accent + '40' }}
            thumbColor={sound ? colors.accent : colors.textTertiary}
          />
        </View>

        <View style={[styles.settingRow, { borderTopColor: colors.border + '40' }]}>
          <View style={styles.settingInfo}>
            <View style={[styles.settingIconWrap, { backgroundColor: colors.accentBlueDim }]}>
              <Ionicons name="pulse-outline" size={20} color={colors.accentBlue} />
            </View>
            <Text style={[styles.settingLabel, { color: colors.text }]}>{t('bills.hapticFeedback')}</Text>
          </View>
          <Switch
            value={vibration}
            onValueChange={setVibration}
            trackColor={{ false: colors.inputBg, true: colors.accentBlue + '40' }}
            thumbColor={vibration ? colors.accentBlue : colors.textTertiary}
          />
        </View>
      </View>

      <Pressable
        onPress={() => { onSave({ soundEnabled: sound, vibrationEnabled: vibration, defaultReminderDays: days }); onClose(); }}
        style={({ pressed }) => [styles.saveBtn, { opacity: pressed ? 0.9 : 1, marginTop: 4 }]}
      >
        <LinearGradient
          colors={colors.buttonGradient as unknown as [string, string]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={styles.saveBtnGradient}
        >
          <Ionicons name="checkmark-circle" size={20} color="#FFFFFF" />
          <Text style={[styles.saveBtnText, { color: '#FFFFFF' }]}>{t('bills.saveSettings')}</Text>
        </LinearGradient>
      </Pressable>
    </CustomModal>
  );
}

export default function BillsScreen() {
  const { colors, isDark } = useTheme();
  const { formatAmount, formatCompactAmount } = useCurrency();
  const { isSeniorMode } = useSeniorMode();
  const { showAlert } = useAlert();
  const { t } = useTranslation();

  const insets = useSafeAreaInsets();
  const tabBarInset = useTabBarContentInset();
  const router = useRouter();
  const {
    bills: ownBills, isLoading, toggleBillPaid, addReminder, editReminder, deleteReminder,
    snoozeReminder, reminderSettings, updateReminderSettings, refreshData,
  } = useExpenses();

  // Family Hub records surface here as reminders too, so the user has one list
  // to check rather than having to open each member's page. They are projected
  // read-only views of records owned by Family Hub — see lib/family-reminders.ts.
  const { familyReminders } = useFamilyReminders();

  // Merged by id, not concatenated. The rows below key on `bill.id`, so any
  // repeated id — a duplicated source record, or a family reminder that also
  // exists as an own bill — would trigger React's duplicate-key error and can
  // silently drop rows. Own bills win when an id appears in both lists.
  const bills = useMemo(() => {
    const byId = new Map<string, (typeof ownBills)[number]>();
    for (const bill of [...ownBills, ...familyReminders]) {
      if (!byId.has(bill.id)) byId.set(bill.id, bill);
    }
    return [...byId.values()];
  }, [ownBills, familyReminders]);

  const [activeFilter, setActiveFilter] = useState<FilterType>('all');

  // Today vs Upcoming are now switchable sections rather than two lists stacked
  // on one scrolling page, so a user looking for what's due today doesn't have
  // to scroll past it to find out there's more below.
  const [activeSection, setActiveSection] = useState<SectionKey>('today');

  // Same range filter as Reports — see `lib/date-range-filter.ts`.
  const [dateRange, setDateRange] = useState<DateRangeState>(makeDefaultRange);

  // 'future': reminders are mostly upcoming, so Week/3M/6M look ahead from
  // today rather than back as they do in Reports. See `RangeDirection`.
  const rangeInfo = useMemo(() => resolveDateRange(dateRange, new Date(), 'future'), [dateRange]);

  const resetFilters = useCallback(() => {
    setActiveFilter('all');
    setActiveSection('today');
    setDateRange(makeDefaultRange());
  }, []);

  // Shown under the range on the filter button, so an active category filter is
  // visible without opening the sheet — otherwise a filtered-down list looks
  // like missing data.
  const activeCategoryLabel = useMemo(() => {
    if (activeFilter === 'all') return undefined;
    const tab = FILTER_TABS.find((tab) => tab.key === activeFilter);
    return tab ? t(tab.labelKey) : undefined;
  }, [activeFilter, t]);

  const [showAddModal, setShowAddModal] = useState(false);
  const [showSnoozeModal, setShowSnoozeModal] = useState(false);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [snoozeBillId, setSnoozeBillId] = useState<string | null>(null);

  const topInset = Platform.OS === 'web' ? 67 : insets.top;

  const filteredBills = useMemo(() => {
    const byCategory =
      activeFilter === 'all'
        ? bills
        : bills.filter(b => getReminderIntentFromBill(b) === activeFilter);

    // A reminder with an unparseable due date is kept rather than dropped —
    // hiding it entirely would leave no way to find and fix it.
    return byCategory.filter(b => {
      const due = new Date(b.dueDate);
      if (Number.isNaN(due.getTime())) return true;
      return isWithinRange(due, rangeInfo);
    });
  }, [bills, activeFilter, rangeInfo]);

  // Sorted on a copy: `.sort()` mutates in place, and `filteredBills` is a
  // memoised array that `paidBills` and the totals below also read from.
  //
  // Within a due date, newest first. `bills` comes from the context with the
  // most recently created reminder at the head, so a stable sort leaves a
  // just-added reminder above others sharing its date instead of at the
  // bottom of the group — which read as "it wasn't saved".
  const activeBills = filteredBills
    .filter(b => b.status !== 'paid' && !b.isPaid)
    .slice()
    .sort((a, b) => getDaysUntil(a.dueDate) - getDaysUntil(b.dueDate));
  const paidBills = filteredBills.filter(b => b.status === 'paid' || b.isPaid);

  const totalPending = activeBills.reduce((s, b) => s + b.amount, 0);
  const urgentCount = activeBills.filter(b => getDaysUntil(b.dueDate) <= 3).length;
  // Derived from the filtered list like the other two stats beside it — reading
  // from `bills` here made one number in the overview card ignore the filter.
  const subscriptionTotal = activeBills
    .filter(b => b.reminderType === 'subscription')
    .reduce((s, b) => s + b.amount, 0);

  /**
   * Outstanding reminders split into what needs doing today and what is still
   * ahead. Both derive from `activeBills` so the two sections are disjoint —
   * previously "Today" was built from the unfiltered `bills` while "Upcoming"
   * used the filtered list, so anything due today rendered in BOTH sections and
   * ignored the active category filter.
   *
   * Overdue items count as today's: they need action now, and burying them in a
   * list headed "Upcoming" reads as though they are still ahead of you.
   */
  const { todayBills, upcomingBills } = useMemo(() => {
    const endOfToday = new Date();
    endOfToday.setHours(23, 59, 59, 999);

    const today: Bill[] = [];
    const upcoming: Bill[] = [];
    for (const bill of activeBills) {
      const due = new Date(bill.dueDate);
      if (Number.isNaN(due.getTime()) || due.getTime() <= endOfToday.getTime()) {
        today.push(bill);
      } else {
        upcoming.push(bill);
      }
    }
    return { todayBills: today, upcomingBills: upcoming };
  }, [activeBills]);

  const handleDelete = (billId: string) => {
    // Family rows are projections; the record lives in Family Hub and deleting
    // it here would delete nothing and silently reappear on the next refresh.
    if (isFamilyReminderId(billId)) {
      showAlert({
        title: t('bills.managedInFamilyHubTitle'),
        message: t('bills.managedInFamilyHubMessage'),
        type: 'info',
        buttons: [
          { text: t('common.cancel'), style: 'cancel' },
          {
            // Telling the user where to go without taking them there is a dead
            // end — the detail screen carries the Family Hub hand-off.
            text: t('bills.viewReminder'),
            onPress: () =>
              router.push({
                pathname: '/family-reminder/[reminderId]',
                params: { reminderId: billId },
              } as any),
          },
        ],
      });
      return;
    }
    showAlert({
      title: t('bills.deleteReminderTitle'),
      message: t('bills.deleteReminderMessage'),
      type: 'confirm',
      buttons: [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('common.delete'),
          style: 'destructive',
          onPress: () => deleteReminder(billId),
        },
      ],
    });
  };

  /**
   * Opening a reminder keeps the user in the reminders flow.
   *
   * Family reminders get their own detail screen rather than jumping to the
   * member's Family Hub page — that jump threw the user out of the list they
   * were working through. `/family-reminder/[reminderId]` shows the detail and
   * offers a "Manage in Family Hub" hand-off for the edit/delete that only the
   * underlying record can perform.
   *
   * Own bills keep going to `/bill-details`, which a projected `fam:...` id
   * would 404 against since it looks the id up in the server bill list.
   */
  const handleOpen = (bill: Bill) => {
    if (isFamilyReminderId(bill.id)) {
      router.push({
        pathname: '/family-reminder/[reminderId]',
        params: { reminderId: bill.id },
      } as any);
      return;
    }
    router.push(`/bill-details/${bill.id}`);
  };

  const handleEdit = (bill: Bill) => {
    // Same destination as tapping the row: the detail screen is where the
    // Family Hub hand-off lives, so the pencil is not a dead end either.
    if (isFamilyReminderId(bill.id)) {
      router.push({
        pathname: '/family-reminder/[reminderId]',
        params: { reminderId: bill.id },
      } as any);
      return;
    }
    router.push({ pathname: '/edit-reminder', params: { id: bill.id } });
  };

  const handleMarkPaid = (bill: Bill) => {
    if (isFamilyReminderId(bill.id)) {
      handleDelete(bill.id);
      return;
    }
    toggleBillPaid(bill.id);
  };

  const handleSave = async (billData: Omit<Bill, 'id'> | Bill) => {
    if ('id' in billData) {
      await editReminder(billData as Bill);
    } else {
      await addReminder(billData);
      setActiveFilter('all');
      await refreshData();
    }
  };

  if (isLoading) {
    return (
      <View style={[styles.container, styles.centered, { backgroundColor: colors.bg }]}>
        <PremiumLoader size={80} text={t('bills.loadingReminders')} />
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.bg }]}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[
          styles.scrollContent,
          { paddingTop: topInset + 16, paddingBottom: tabBarInset.bottom },
        ]}
      >
        <Animated.View entering={Platform.OS !== 'web' ? FadeInDown.duration(500) : undefined}>
          <View style={styles.headerRow}>
            <View>
              <Text style={[styles.screenTitle, { color: colors.text }]}>{t('bills.screenTitle')}</Text>
              <Text style={[styles.screenSubtitle, { color: colors.textSecondary }]}>{t('bills.screenSubtitle')}</Text>
            </View>
            <View style={styles.headerActions}>
              <Pressable
                onPress={() => setShowSettingsModal(true)}
                style={[styles.headerIconBtn, { backgroundColor: colors.card, borderColor: colors.border }]}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                testID="settings-btn"
                accessibilityLabel={t('bills.settingsA11y')}
              >
                <Ionicons name="settings-outline" size={20} color={colors.textSecondary} />
              </Pressable>
              <Pressable
                onPress={() => router.push('/edit-reminder')}
                testID="add-reminder-btn"
                accessibilityLabel={t('bills.addReminderA11y')}
              >
                <LinearGradient
                  colors={colors.buttonGradient as unknown as [string, string]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 0 }}
                  style={styles.addBtnGradient}
                >
                  <Ionicons name="add" size={22} color="#FFFFFF" />
                </LinearGradient>
              </Pressable>
            </View>
          </View>
        </Animated.View>

        <Animated.View entering={Platform.OS !== 'web' ? FadeInDown.delay(80).duration(500) : undefined}>
          <LinearGradient
            colors={colors.heroGradient as unknown as [string, string, string]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={[styles.overviewCard, { borderColor: colors.border }]}
          >
            <View style={styles.overviewRow}>
              <View style={styles.overviewStat}>
                <Text style={[styles.overviewLabel, { color: colors.textTertiary }, isSeniorMode && { fontSize: 16 }]}>{t('bills.overviewPending')}</Text>
                <Text 
                  style={[styles.overviewAmount, { color: colors.text }, isSeniorMode && { fontSize: 36 }]}
                  numberOfLines={1}
                  adjustsFontSizeToFit
                >
                  {formatCompactAmount(totalPending)}
                </Text>
              </View>
              <View style={[styles.overviewDivider, { backgroundColor: colors.border }]} />
              <View style={styles.overviewStat}>
                <Text style={[styles.overviewLabel, { color: colors.textTertiary }]}>{t('bills.overviewUrgent')}</Text>
                <View style={styles.urgentWrap}>
                  <Text style={[styles.overviewAmountLarge, { color: colors.text }, urgentCount > 0 && { color: colors.danger }]}>
                    {urgentCount}
                  </Text>
                  {urgentCount > 0 && (
                    <View style={[styles.urgentDot, { backgroundColor: colors.danger }]} />
                  )}
                </View>
              </View>
              <View style={[styles.overviewDivider, { backgroundColor: colors.border }]} />
              <View style={styles.overviewStat}>
                <Text style={[styles.overviewLabel, { color: colors.textTertiary }]}>{t('bills.overviewSubs')}</Text>
                <Text 
                  style={[styles.overviewAmount, { color: colors.text }]}
                  numberOfLines={1}
                  adjustsFontSizeToFit
                >
                  {formatCompactAmount(subscriptionTotal)}
                </Text>
              </View>
            </View>
          </LinearGradient>
        </Animated.View>

        {/* Time range only. Category chips used to live inside this sheet; the
            client asked for them out of the box and laid out below it. */}
        <Animated.View entering={Platform.OS !== 'web' ? FadeInDown.delay(100).duration(500) : undefined}>
          <DateRangeFilter
            value={dateRange}
            onChange={setDateRange}
            label={rangeInfo.label}
            title={t('bills.filterRemindersTitle')}
            sublabel={activeCategoryLabel}
            onReset={resetFilters}
          />
        </Animated.View>

        {/* Category filters: a horizontal scrolling chip row under the
            time-range box, matching the Recurrence row on Edit Reminder. */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          // Negative margins cancel the parent's 20px inset so the rail runs
          // edge to edge; the matching content padding keeps the first and last
          // chip clear of the screen edges.
          style={styles.categoryScrollView}
          contentContainerStyle={styles.categoryScroll}
        >
          {FILTER_TABS.map((cat) => {
            const active = activeFilter === cat.key;
            return (
              <Pressable
                key={cat.key}
                onPress={() => setActiveFilter(cat.key)}
                style={[
                  styles.categoryChip,
                  { backgroundColor: colors.card, borderColor: colors.border },
                  active && { backgroundColor: colors.accent, borderColor: colors.accent },
                ]}
              >
                <Ionicons
                  name={cat.icon as any}
                  size={15}
                  color={active ? '#FFFFFF' : colors.textTertiary}
                />
                <Text
                  style={[
                    styles.categoryChipText,
                    { color: active ? '#FFFFFF' : colors.textSecondary },
                  ]}
                >
                  {t(cat.labelKey)}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>

        {/* Today / Upcoming switcher — only one list renders at a time. */}
        <View style={[styles.segmentWrap, { backgroundColor: colors.card, borderColor: colors.border }]}>
          {([
            { key: 'today' as SectionKey, label: t('bills.segmentToday'), count: todayBills.length },
            { key: 'upcoming' as SectionKey, label: t('bills.segmentUpcoming'), count: upcomingBills.length },
          ]).map((seg) => {
            const active = activeSection === seg.key;
            return (
              <Pressable
                key={seg.key}
                onPress={() => setActiveSection(seg.key)}
                style={[styles.segmentBtn, active && { backgroundColor: colors.accent }]}
              >
                <Text
                  style={[
                    styles.segmentText,
                    { color: active ? '#FFFFFF' : colors.textSecondary },
                  ]}
                >
                  {seg.label} ({seg.count})
                </Text>
              </Pressable>
            );
          })}
        </View>

        {activeSection === 'today' && todayBills.length > 0 && (
          <>
            {todayBills.map((bill, idx) => (
              <ReminderCard
                key={bill.id}
                bill={bill}
                index={idx}
                isSeniorMode={isSeniorMode}
                onPress={() => handleOpen(bill)}
                onMarkPaid={() => handleMarkPaid(bill)}
                onSnooze={() => {
                  setSnoozeBillId(bill.id);
                  setShowSnoozeModal(true);
                }}
                onEdit={() => handleEdit(bill)}
                onDelete={() => handleDelete(bill.id)}
              />
            ))}
          </>
        )}

        {activeSection === 'upcoming' && upcomingBills.length > 0 && (
          <>
            {upcomingBills.map((bill, idx) => (
              <ReminderCard
                key={bill.id}
                bill={bill}
                onPress={() => handleOpen(bill)}
                onMarkPaid={() => handleMarkPaid(bill)}
                onSnooze={() => { setSnoozeBillId(bill.id); setShowSnoozeModal(true); }}
                onEdit={() => handleEdit(bill)}
                onDelete={() => handleDelete(bill.id)}
                index={idx}
                isSeniorMode={isSeniorMode}
              />
            ))}
          </>
        )}

        {paidBills.length > 0 && (
          <>
            <Text style={[styles.sectionTitle, { color: colors.textSecondary, marginTop: 28 }]}>
              {t('bills.completedCount', { count: paidBills.length })}
            </Text>
            {paidBills.map((bill, idx) => (
              <ReminderCard
                key={bill.id}
                bill={bill}
                onPress={() => handleOpen(bill)}
                onMarkPaid={() => handleMarkPaid(bill)}
                onSnooze={() => { }}
                onEdit={() => handleEdit(bill)}
                onDelete={() => handleDelete(bill.id)}
                index={idx}
                isSeniorMode={isSeniorMode}
              />
            ))}
          </>
        )}

        {/* The selected section is empty but others aren't — without this the
            switcher would just show a blank page with no explanation. */}
        {filteredBills.length > 0 &&
          (activeSection === 'today' ? todayBills.length === 0 : upcomingBills.length === 0) && (
            <View style={styles.emptyState}>
              <View style={[styles.emptyIconWrap, { backgroundColor: colors.accentDim }]}>
                <Ionicons name="checkmark-done" size={32} color={colors.accent} />
              </View>
              <Text style={[styles.emptyTitle, { color: colors.text }]}>
                {activeSection === 'today' ? t('bills.emptyNothingDueToday') : t('bills.emptyNothingUpcoming')}
              </Text>
              <Text style={[styles.emptySubtitle, { color: colors.textSecondary }]}>
                {activeSection === 'today'
                  ? upcomingBills.length > 0
                    ? t('bills.remindersComingUp', { count: upcomingBills.length })
                    : t('bills.allCaughtUp')
                  : todayBills.length > 0
                    ? t('bills.remindersDueToday', { count: todayBills.length })
                    : t('bills.nothingScheduledAhead')}
              </Text>
            </View>
          )}

        {filteredBills.length === 0 && (
          <View style={styles.emptyState}>
            <View style={[styles.emptyIconWrap, { backgroundColor: colors.accentDim }]}>
              <Ionicons name="notifications-off" size={32} color={colors.accent} />
            </View>
            <Text style={[styles.emptyTitle, { color: colors.text }]}>
              {bills.length > 0
                ? t('bills.emptyNothingInRange')
                : activeFilter === 'all'
                  ? t('bills.emptyNoRemindersYet')
                  : t('bills.emptyNoCategoryReminders', { category: activeCategoryLabel ?? activeFilter })}
            </Text>
            {/* When reminders exist but none match, the filter is what is hiding
                them — "Tap + to add" would send the user to create a duplicate. */}
            <Text style={[styles.emptySubtitle, { color: colors.textSecondary }]}>
              {bills.length === 0
                ? t('bills.emptyTapToAdd')
                : dateRange.filterKey === 'all'
                  ? // Already the widest range, so the category filter is what
                    // is hiding things — telling the user to widen the dates
                    // would send them in circles.
                    t('bills.emptyNoCategoryMatch')
                  : t('bills.emptyNoRemindersInRange', { range: rangeInfo.label })}
            </Text>
          </View>
        )}
      </ScrollView>

        {/* Modals removed in favor of full screen app/edit-reminder.tsx */}

      <SnoozeModal
        visible={showSnoozeModal}
        onClose={() => setShowSnoozeModal(false)}
        onSnooze={(days) => {
          if (snoozeBillId) snoozeReminder(snoozeBillId, days);
        }}
      />

      <SettingsModal
        visible={showSettingsModal}
        onClose={() => setShowSettingsModal(false)}
        settings={reminderSettings}
        onSave={(partial) => updateReminderSettings({ ...reminderSettings, ...partial })}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  centered: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  scrollContent: {
    paddingHorizontal: 20,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 24,
  },
  screenTitle: {
    fontFamily: 'Inter_700Bold',
    fontSize: 30,
    letterSpacing: -0.5,
  },
  screenSubtitle: {
    fontFamily: 'Inter_400Regular',
    fontSize: 14,
    marginTop: 4,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  headerIconBtn: {
    width: 42,
    height: 42,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  addBtnGradient: {
    width: 42,
    height: 42,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  overviewCard: {
    borderRadius: 22,
    padding: 24,
    marginBottom: 20,
    borderWidth: 1,
  },
  overviewRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  overviewStat: {
    flex: 1,
    alignItems: 'center',
    paddingHorizontal: 4,
  },
  overviewDivider: {
    width: 1,
    height: 40,
  },
  overviewLabel: {
    fontFamily: 'Inter_500Medium',
    fontSize: 11,
    letterSpacing: 0.8,
  },
  overviewAmount: {
    fontFamily: 'Inter_700Bold',
    fontSize: 18,
  },
  overviewAmountLarge: {
    fontFamily: 'Inter_700Bold',
    fontSize: 24,
  },
  urgentWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 2,
  },
  urgentDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  sectionTitle: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 13,
    marginBottom: 14,
    letterSpacing: 0.8,
  },
  // Horizontal chip row, mirroring the Recurrence row on Edit Reminder.
  categoryScrollView: {
    marginHorizontal: -20,
    marginBottom: 18,
  },
  categoryScroll: {
    gap: 10,
    paddingHorizontal: 20,
  },
  categoryChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 14,
    borderWidth: 1,
    height: 40,
  },
  categoryChipText: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 14,
  },
  segmentWrap: {
    flexDirection: 'row',
    padding: 4,
    borderRadius: 16,
    borderWidth: 1,
    marginBottom: 18,
    gap: 4,
  },
  segmentBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  segmentText: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 13,
  },
  reminderCard: {
    borderRadius: 16,
    padding: 18,
    marginBottom: 12,
    borderWidth: 1,
  },
  reminderCardPaid: {
    opacity: 0.5,
  },
  reminderTop: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  reminderIcon: {
    width: 48,
    height: 48,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 14,
  },
  reminderInfo: {
    flex: 1,
  },
  reminderName: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 16,
    marginBottom: 5,
  },
  typeBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
  },
  typeBadgeText: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 9,
    letterSpacing: 0.4,
  },
  reminderMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 4,
  },
  reminderDue: {
    fontFamily: 'Inter_500Medium',
    fontSize: 12,
  },
  repeatBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  repeatText: {
    fontFamily: 'Inter_400Regular',
    fontSize: 10,
  },
  reminderDate: {
    fontFamily: 'Inter_400Regular',
    fontSize: 11,
  },
  reminderRight: {
    alignItems: 'flex-end',
    marginLeft: 8,
  },
  reminderAmount: {
    fontFamily: 'Inter_700Bold',
    fontSize: 20,
    letterSpacing: -0.3,
  },
  cardActions: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 14,
    paddingTop: 14,
    borderTopWidth: 1,
  },
  cardActionBtn: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  snoozeInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 10,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 10,
  },
  snoozeInfoText: {
    fontFamily: 'Inter_500Medium',
    fontSize: 11,
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: 60,
    gap: 12,
  },
  emptyIconWrap: {
    width: 72,
    height: 72,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  emptyTitle: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 18,
  },
  emptySubtitle: {
    fontFamily: 'Inter_400Regular',
    fontSize: 14,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'flex-end',
  },
  modalContainer: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: '90%',
  },
  modalGrabber: {
    width: 40,
    height: 4,
    borderRadius: 2,
    alignSelf: 'center',
    marginTop: 12,
    marginBottom: 8,
  },
  modalGrabberCentered: {
    width: 40,
    height: 4,
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: 16,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    // No horizontal padding: CustomModal's `content` already supplies the
    // gutter, and adding 20 here stacked on top of it, double-insetting
    // everything in the sheet.
    paddingBottom: 8,
  },
  modalTitle: {
    fontFamily: 'Inter_700Bold',
    fontSize: 19,
    letterSpacing: -0.3,
  },
  modalScroll: {
    // Gutter comes from CustomModal's `content` — see `modalHeader` above.
    paddingBottom: 12,
  },
  errorBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 12,
    borderRadius: 12,
    marginTop: 4,
    marginBottom: 4,
  },
  errorText: {
    fontFamily: 'Inter_500Medium',
    fontSize: 13,
    flex: 1,
  },
  fieldLabel: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 11,
    letterSpacing: 0.8,
    marginBottom: 8,
    marginTop: 18,
  },
  typeRow: {
    flexDirection: 'row',
    gap: 8,
  },
  typeChip: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 12,
    borderRadius: 14,
    borderWidth: 1,
  },
  typeChipText: {
    fontFamily: 'Inter_500Medium',
    fontSize: 13,
  },
  input: {
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontFamily: 'Inter_400Regular',
    fontSize: 15,
    borderWidth: 1,
  },
  rowFields: {
    flexDirection: 'row',
    gap: 12,
  },
  halfField: {
    flex: 1,
  },
  chipRow: {
    flexDirection: 'row',
    gap: 8,
    flexWrap: 'wrap',
  },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 16,
    borderWidth: 1,
  },
  chipText: {
    fontFamily: 'Inter_500Medium',
    fontSize: 12,
  },
  iconPickerToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderRadius: 14,
    padding: 12,
    borderWidth: 1,
  },
  selectedIconWrap: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconPickerText: {
    fontFamily: 'Inter_400Regular',
    fontSize: 14,
    flex: 1,
  },
  iconGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 10,
  },
  iconOption: {
    width: 46,
    height: 46,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  saveBtn: {
    marginHorizontal: 20,
    marginBottom: 8,
    borderRadius: 16,
    overflow: 'hidden',
  },
  saveBtnDisabled: {
    opacity: 0.45,
  },
  saveBtnGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 13,
  },
  saveBtnText: {
    fontFamily: 'Inter_700Bold',
    fontSize: 15,
    textAlign: 'center',
    lineHeight: 20,
    includeFontPadding: false,
  },
  dateLikeInput: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  dateLikeText: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 14,
  },
  snoozeOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
  },
  snoozeSheet: {
    borderRadius: 24,
    padding: 24,
    width: '100%',
    maxWidth: 340,
  },
  snoozeTitle: {
    fontFamily: 'Inter_700Bold',
    fontSize: 20,
    marginBottom: 4,
    textAlign: 'center',
  },
  snoozeSubtitle: {
    fontFamily: 'Inter_400Regular',
    fontSize: 13,
    marginBottom: 20,
    textAlign: 'center',
  },
  snoozeOption: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: 14,
    paddingHorizontal: 14,
    borderRadius: 14,
    borderWidth: 1,
    marginBottom: 8,
  },
  snoozeOptionIcon: {
    width: 36,
    height: 36,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  snoozeOptionText: {
    fontFamily: 'Inter_500Medium',
    fontSize: 15,
    flex: 1,
  },
  settingsContainer: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
  },
  settingsSectionTitle: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 11,
    letterSpacing: 0.8,
    marginBottom: 8,
    marginTop: 0,
  },
  dayChipsRow: {
    flexDirection: 'row',
    gap: 8,
    flexWrap: 'wrap',
    marginBottom: 12,
  },
  // Chips are laid out on a fixed 3-up grid rather than sized to their text.
  // Text-width chips ("7d before" vs "3d before") made every wrapped row end
  // at a different point, leaving a ragged gap on the right.
  // 30.5% keeps 3 chips + two 8px gaps inside the content width down to a
  // 320dp screen; 31.5% overflows and silently collapses the row to 2-up.
  dayChip: {
    flexBasis: '30.5%',
    flexGrow: 0,
    alignItems: 'center',
    paddingHorizontal: 4,
  },
  settingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
    borderTopWidth: 1,
  },
  settingInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  settingIconWrap: {
    width: 32,
    height: 32,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  settingLabel: {
    fontFamily: 'Inter_500Medium',
    fontSize: 14,
  },
  deleteIconWrap: {
    width: 56,
    height: 56,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
    marginBottom: 16,
  },
  deleteActions: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 20,
  },
  deleteActionBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 14,
    borderRadius: 14,
    borderWidth: 1,
  },
  deleteActionText: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 14,
  },
});
