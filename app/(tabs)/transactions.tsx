import React, { useState, useMemo } from 'react';
import {
  StyleSheet,
  Text,
  View,
  SectionList,
  Pressable,
  Platform,
  ScrollView,
  TextInput,
} from 'react-native';
import PremiumLoader from '@/components/PremiumLoader';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { router } from 'expo-router';
import DatePickerModal from '@/components/DatePickerModal';
import CustomModal from '@/components/CustomModal';
import { useTheme } from '@/lib/theme-context';
import { useCurrency } from '@/lib/currency-context';
import { useExpenses } from '@/lib/expense-context';
import { useTabBarContentInset } from '@/lib/tab-bar';

import { useSeniorMode } from '@/lib/senior-context';
import {
  CATEGORIES,
  formatTime,
  getDateLabel,
  CategoryType,
  Transaction,
} from '@/lib/data';
import { ThemeColors } from '@/constants/colors';
import CategoryIcon from '@/components/CategoryIcon';
import Money from '@/components/Money';

const FILTER_OPTIONS: { key: string; label: string; icon?: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'food', label: 'Food', icon: 'fast-food' },
  { key: 'shopping', label: 'Shopping', icon: 'cart' },
  { key: 'transport', label: 'Transport', icon: 'car' },
  { key: 'entertainment', label: 'Fun', icon: 'film' },
  { key: 'bills', label: 'Bills', icon: 'flash' },
  { key: 'health', label: 'Health', icon: 'medkit' },
  { key: 'education', label: 'Edu', icon: 'book' },
  { key: 'investment', label: 'Invest', icon: 'trending-up' },
  { key: 'others', label: 'Others', icon: 'ellipsis-horizontal' },
];

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

type TimeFilterKey = 'all' | 'today' | 'week' | 'month' | 'threeMonths' | 'sixMonths' | 'multiMonth' | 'year' | 'custom';

const TIME_FILTER_CHIPS: Array<{ key: TimeFilterKey; label: string; icon: string }> = [
  { key: 'all', label: 'All Time', icon: 'infinite' },
  { key: 'today', label: 'Today', icon: 'calendar' },
  { key: 'week', label: 'Week', icon: 'calendar' },
  { key: 'month', label: 'Month', icon: 'calendar' },
  { key: 'threeMonths', label: '3M', icon: 'calendar' },
  { key: 'sixMonths', label: '6M', icon: 'calendar' },
  { key: 'year', label: 'Year', icon: 'wallet' },
  { key: 'multiMonth', label: 'Multi-Month', icon: 'grid' },
  { key: 'custom', label: 'Custom', icon: 'apps' },
];

const TransactionItem = React.memo(({ item, colors, isDark, formatAmountOn, isSeniorMode }: { item: Transaction; colors: ThemeColors; isDark: boolean; formatAmountOn: (n: number, date: Date | string) => string; isSeniorMode: boolean }) => {
  const safeCat = (item.category || 'others').toLowerCase() as CategoryType;
  const cat = CATEGORIES[safeCat] || CATEGORIES.others;
  return (
    <View
      style={[
        styles.txCard,
        {
          backgroundColor: colors.card,
          borderColor: colors.border,
        },
      ]}
    >
      <View style={[styles.txIconWrap, { backgroundColor: cat.color + '18' }]}>
        <CategoryIcon category={item.category} size={20} />
      </View>
      <View style={styles.txInfo}>
        <Text style={[styles.txMerchant, { color: colors.text }, isSeniorMode && { fontSize: 18 }]} numberOfLines={1}>
          {item.merchant}
        </Text>
        <Text style={[styles.txUpi, { color: colors.textTertiary }, isSeniorMode && { fontSize: 14 }]} numberOfLines={1}>
          {item.upiId}
        </Text>
      </View>
      <View style={styles.txRight}>
        <Text style={[styles.txAmount, { color: item.isDebit ? colors.danger : (colors.accentMint || colors.text) }, isSeniorMode && { fontSize: 19 }]}>
          {/* Converted at the rate on the transaction's own date, so a past
              expense is not restated when the rupee moves. Sign/colour follow
              isDebit — this used to be hardcoded red/minus for every row,
              including credits (salary, refunds). */}
          {item.isDebit ? '-' : '+'}{formatAmountOn(item.amount, item.date)}
        </Text>
        <Text style={[styles.txTime, { color: colors.textTertiary }, isSeniorMode && { fontSize: 13 }]}>
          {formatTime(item.date)}
        </Text>
      </View>
    </View>
  );
});

export default function TransactionsScreen() {
  const insets = useSafeAreaInsets();
  const tabBarInset = useTabBarContentInset();
  const { colors, isDark } = useTheme();
  const { formatAmountOn, convertForDisplayOn, formatConverted } = useCurrency();
  const { transactions, isLoading } = useExpenses();
  const { isSeniorMode } = useSeniorMode();
  const [activeFilter, setActiveFilter] = useState('all');
  const [showSearch, setShowSearch] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  const now = new Date();
  const [timeFilter, setTimeFilter] = useState<TimeFilterKey>('all');
  const [selectedYear, setSelectedYear] = useState<number>(now.getFullYear());
  const [selectedMonths, setSelectedMonths] = useState<number[]>(() => [now.getMonth()]);
  const selectedMonth = selectedMonths[0] ?? now.getMonth();
  const [customStart, setCustomStart] = useState<Date>(() => {
    const d = new Date(now);
    d.setHours(0, 0, 0, 0);
    return d;
  });
  const [customEnd, setCustomEnd] = useState<Date>(() => {
    const d = new Date(now);
    d.setHours(23, 59, 59, 999);
    return d;
  });
  const [draftCustomStart, setDraftCustomStart] = useState<Date>(customStart);
  const [draftCustomEnd, setDraftCustomEnd] = useState<Date>(customEnd);

  const [showFilterModal, setShowFilterModal] = useState(false);
  const [showYearPicker, setShowYearPicker] = useState(false);
  const [showCustomStartPicker, setShowCustomStartPicker] = useState(false);
  const [showCustomEndPicker, setShowCustomEndPicker] = useState(false);

  const topInset = Platform.OS === 'web' ? 67 : insets.top;

  const DAY_MS = 24 * 60 * 60 * 1000;
  const startOfDay = (d: Date) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
  const endOfDay = (d: Date) => { const x = new Date(d); x.setHours(23, 59, 59, 999); return x; };

  const sortedSelectedMonths = useMemo(() => [...selectedMonths].sort((a, b) => a - b), [selectedMonths]);

  // Current time range: label + a start/end window (null start/end for month-based modes).
  const range = useMemo(() => {
    const nowDay = startOfDay(now);
    if (timeFilter === 'all') {
      return { label: 'All Time', start: null as Date | null, end: null as Date | null };
    }
    if (timeFilter === 'today') {
      return { label: 'Today', start: nowDay, end: endOfDay(nowDay) };
    }
    if (timeFilter === 'week') {
      return { label: 'Last 7 days', start: startOfDay(new Date(nowDay.getTime() - 6 * DAY_MS)), end: endOfDay(nowDay) };
    }
    if (timeFilter === 'threeMonths') {
      const s = new Date(nowDay); s.setMonth(s.getMonth() - 3);
      return { label: 'Last 3 months', start: startOfDay(s), end: endOfDay(nowDay) };
    }
    if (timeFilter === 'sixMonths') {
      const s = new Date(nowDay); s.setMonth(s.getMonth() - 6);
      return { label: 'Last 6 months', start: startOfDay(s), end: endOfDay(nowDay) };
    }
    if (timeFilter === 'custom') {
      return { label: 'Custom', start: startOfDay(customStart), end: endOfDay(customEnd) };
    }
    if (timeFilter === 'year') {
      return { label: `Year ${selectedYear}`, start: null as Date | null, end: null as Date | null };
    }
    if (timeFilter === 'month') {
      return { label: `${MONTHS[selectedMonth]} ${selectedYear}`, start: null as Date | null, end: null as Date | null };
    }
    // multiMonth
    return { label: `${sortedSelectedMonths.map((m) => MONTHS[m]).join(', ')} ${selectedYear}`, start: null as Date | null, end: null as Date | null };
  }, [timeFilter, customStart, customEnd, selectedYear, selectedMonth, sortedSelectedMonths]);

  const matchesTime = useMemo(() => {
    return (dateStr: string) => {
      if (timeFilter === 'all') return true;
      const d = new Date(dateStr);
      if (range.start && range.end) {
        const t = d.getTime();
        return t >= range.start.getTime() && t <= range.end.getTime();
      }
      if (timeFilter === 'year') return d.getFullYear() === selectedYear;
      if (timeFilter === 'month') return d.getFullYear() === selectedYear && d.getMonth() === selectedMonth;
      // multiMonth
      return d.getFullYear() === selectedYear && sortedSelectedMonths.includes(d.getMonth());
    };
  }, [range, timeFilter, selectedYear, selectedMonth, sortedSelectedMonths]);

  const handleSelectTimeChip = (key: TimeFilterKey) => {
    setShowCustomStartPicker(false);
    setShowCustomEndPicker(false);
    setTimeFilter(key);
    if (key === 'custom') {
      setDraftCustomStart(customStart);
      setDraftCustomEnd(customEnd);
      setShowCustomStartPicker(true);
    }
    if (key === 'year') setShowYearPicker(true);
    if (key === 'multiMonth' && selectedMonths.length === 0) setSelectedMonths([now.getMonth()]);
  };

  const filtered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return transactions.filter(tx => {
      const catOk = activeFilter === 'all' || (tx.category || 'others').toLowerCase() === activeFilter.toLowerCase();
      if (!catOk || !matchesTime(tx.date)) return false;
      if (!q) return true;
      const merchant = (tx.merchant || '').toLowerCase();
      const upi = (tx.upiId || '').toLowerCase();
      const amount = String(tx.amount ?? '');
      return merchant.includes(q) || upi.includes(q) || amount.includes(q);
    });
  }, [transactions, activeFilter, matchesTime, searchQuery]);

  const sections = useMemo(() => {
    const grouped: Record<string, Transaction[]> = {};
    filtered.forEach(tx => {
      const label = getDateLabel(tx.date);
      if (!grouped[label]) grouped[label] = [];
      grouped[label].push(tx);
    });
    return Object.entries(grouped).map(([title, data]) => ({
      title,
      data,
      // Each transaction is converted at its OWN date's rate before summing.
      // Summing the INR values and converting the total once would apply
      // today's rate to every row and contradict the per-row amounts above it.
      total: data
        .filter(tx => tx.isDebit)
        .reduce((s, tx) => s + convertForDisplayOn(tx.amount, tx.date), 0),
    }));
  }, [filtered, convertForDisplayOn]);

  const totalFiltered = filtered
    .filter(tx => tx.isDebit)
    .reduce((s, tx) => s + convertForDisplayOn(tx.amount, tx.date), 0);
  const txCount = filtered.filter(tx => tx.isDebit).length;

  if (isLoading) {
    return (
      <View style={[styles.container, styles.centered, { backgroundColor: colors.bg }]}>
        <PremiumLoader size={60} />

      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.bg }]}>
      <View style={[styles.headerArea, { paddingTop: topInset + 20 }]}>
        <Animated.View entering={Platform.OS !== 'web' ? FadeInDown.duration(500) : undefined}>
          <View style={styles.topRow}>
            <Pressable
              onPress={() => (router.canGoBack() ? router.back() : router.replace('/(tabs)'))}
              hitSlop={12}
              style={[styles.backBtn, { backgroundColor: colors.card, borderColor: colors.border }]}
            >
              <Ionicons name="chevron-back" size={22} color={colors.text} />
            </Pressable>
            <Text style={[styles.screenTitle, { color: colors.text }]}>Activity</Text>
            <Pressable
              onPress={() => {
                setShowSearch((s) => {
                  if (s) setSearchQuery('');
                  return !s;
                });
              }}
              hitSlop={12}
              style={[styles.backBtn, { backgroundColor: showSearch ? colors.accentDim : colors.card, borderColor: showSearch ? colors.accent + '40' : colors.border }]}
            >
              <Ionicons name={showSearch ? 'close' : 'search'} size={20} color={showSearch ? colors.accent : colors.text} />
            </Pressable>
          </View>

          {showSearch && (
            <View style={[styles.searchBar, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Ionicons name="search" size={18} color={colors.textTertiary} />
              <TextInput
                value={searchQuery}
                onChangeText={setSearchQuery}
                placeholder="Search merchant, UPI or amount"
                placeholderTextColor={colors.textTertiary}
                style={[styles.searchInput, { color: colors.text }]}
                autoFocus
                returnKeyType="search"
              />
              {searchQuery.length > 0 && (
                <Pressable onPress={() => setSearchQuery('')} hitSlop={10}>
                  <Ionicons name="close-circle" size={18} color={colors.textTertiary} />
                </Pressable>
              )}
            </View>
          )}

          <View
            style={[
              styles.summaryCard,
              {
                backgroundColor: colors.card,
                borderColor: colors.border,
              },
            ]}
          >
            <View style={styles.summaryLeft}>
              <Text style={[styles.summaryLabel, { color: colors.textTertiary }, isSeniorMode && { fontSize: 15 }]}>
                Total Spent
              </Text>
              <Money style={[styles.summaryAmount, { color: colors.text }, isSeniorMode && { fontSize: 32 }]}>
                {formatConverted(totalFiltered)}
              </Money>
            </View>
            <View style={[styles.summaryDivider, { backgroundColor: colors.border }]} />
            <View style={styles.summaryRight}>
              <Text style={[styles.summaryLabel, { color: colors.textTertiary }]}>
                Transactions
              </Text>
              <Text style={[styles.summaryCount, { color: colors.accent }]}>
                {txCount}
              </Text>
            </View>
          </View>
        </Animated.View>

        <Animated.View entering={Platform.OS !== 'web' ? FadeInDown.delay(100).duration(500) : undefined}>
          <Pressable
            onPress={() => setShowFilterModal(true)}
            style={[styles.filterButton, { backgroundColor: colors.card, borderColor: colors.border }]}
          >
            <Ionicons name="options-outline" size={18} color={colors.accent} />
            <Text style={[styles.filterButtonText, { color: colors.text }]} numberOfLines={1}>
              {range.label}
              {activeFilter !== 'all' ? ` • ${FILTER_OPTIONS.find(o => o.key === activeFilter)?.label ?? ''}` : ''}
            </Text>
            <Ionicons name="chevron-down" size={16} color={colors.textTertiary} />
          </Pressable>
        </Animated.View>
      </View>

      <SectionList
        sections={sections}
        keyExtractor={item => item.id}
        renderItem={({ item }) => <TransactionItem item={item} colors={colors} isDark={isDark} formatAmountOn={formatAmountOn} isSeniorMode={isSeniorMode} />}
        renderSectionHeader={({ section }) => (
          <View style={styles.sectionHeader}>
            <Text style={[styles.sectionTitle, { color: colors.textSecondary }]}>
              {section.title}
            </Text>
            <View style={[styles.sectionBadge, { backgroundColor: colors.surfaceGlow }]}>
              <Money style={[styles.sectionTotal, { color: colors.accent }]}>
                {formatConverted((section as any).total)}
              </Money>
            </View>
          </View>
        )}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
        contentContainerStyle={{
          paddingHorizontal: 20,
          paddingBottom: tabBarInset.bottom,
        }}
        showsVerticalScrollIndicator={false}
        stickySectionHeadersEnabled={false}
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Ionicons name={searchQuery ? 'search-outline' : 'receipt-outline'} size={48} color={colors.textTertiary} />
            <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
              {searchQuery ? `No results for "${searchQuery.trim()}"` : 'No transactions found'}
            </Text>
            <Text style={[styles.emptySubtext, { color: colors.textTertiary }]}>
              {searchQuery ? 'Try a different search term' : 'Try adjusting your filters'}
            </Text>
          </View>
        }
      />

      {/* Combined filter popup: time range + category */}
      <CustomModal visible={showFilterModal} onClose={() => setShowFilterModal(false)}>
        <Text style={[styles.modalTitle, { color: colors.text }]}>Filter Activity</Text>

        <ScrollView style={{ maxHeight: 440 }} showsVerticalScrollIndicator={false}>
          <Text style={[styles.filterSectionLabel, { color: colors.textTertiary }]}>Time range</Text>
          <View style={styles.modalChipsWrap}>
            {TIME_FILTER_CHIPS.map((chip) => {
              const active = timeFilter === chip.key;
              return (
                <Pressable
                  key={chip.key}
                  onPress={() => handleSelectTimeChip(chip.key)}
                  style={[
                    styles.timeChip,
                    { backgroundColor: colors.card, borderColor: colors.border },
                    active && { backgroundColor: colors.accentDim, borderColor: colors.accent + '40' },
                  ]}
                >
                  <Ionicons name={chip.icon as any} size={16} color={active ? colors.accent : colors.textTertiary} />
                  <Text style={[styles.timeChipText, { color: active ? colors.accent : colors.textSecondary }]}>
                    {chip.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          {timeFilter === 'custom' && (
            <View style={styles.customChipWrap}>
              <Pressable
                style={[styles.customChip, { backgroundColor: colors.card, borderColor: colors.border }]}
                onPress={() => {
                  setDraftCustomStart(customStart);
                  setDraftCustomEnd(customEnd);
                  setShowCustomEndPicker(false);
                  setShowCustomStartPicker(true);
                }}
              >
                <Text style={[styles.customChipLabel, { color: colors.textTertiary }]}>Start date</Text>
                <Text style={[styles.customChipValue, { color: colors.text }]}>
                  {customStart.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                </Text>
              </Pressable>
              <Pressable
                style={[styles.customChip, { backgroundColor: colors.card, borderColor: colors.border }]}
                onPress={() => {
                  setDraftCustomStart(customStart);
                  setDraftCustomEnd(customEnd);
                  setShowCustomStartPicker(false);
                  setShowCustomEndPicker(true);
                }}
              >
                <Text style={[styles.customChipLabel, { color: colors.textTertiary }]}>End date</Text>
                <Text style={[styles.customChipValue, { color: colors.text }]}>
                  {customEnd.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                </Text>
              </Pressable>
            </View>
          )}

          {(timeFilter === 'month' || timeFilter === 'multiMonth') && (
            <View style={{ marginTop: 12 }}>
              <Pressable
                onPress={() => setShowYearPicker(true)}
                style={[styles.yearPill, { backgroundColor: colors.card, borderColor: colors.border }]}
              >
                <Ionicons name="calendar-outline" size={14} color={colors.textSecondary} />
                <Text style={[styles.yearPillText, { color: colors.text }]}>Year: {selectedYear}</Text>
                <Ionicons name="chevron-down" size={14} color={colors.textTertiary} />
              </Pressable>
              <View style={styles.monthGrid}>
                {MONTHS.map((m, idx) => {
                  const isSelected = selectedMonths.includes(idx);
                  return (
                    <Pressable
                      key={m}
                      onPress={() => {
                        if (timeFilter === 'month') { setSelectedMonths([idx]); return; }
                        setSelectedMonths((prev) => {
                          if (prev.includes(idx)) {
                            const next = prev.filter((x) => x !== idx);
                            return next.length ? next : prev;
                          }
                          return [...prev, idx].sort((a, b) => a - b);
                        });
                      }}
                      style={[
                        styles.monthChip,
                        { backgroundColor: colors.card, borderColor: colors.border },
                        isSelected && { backgroundColor: colors.accentDim, borderColor: colors.accent + '40' },
                      ]}
                    >
                      <Text style={[styles.monthChipText, { color: isSelected ? colors.accent : colors.textTertiary }, isSelected && { fontFamily: 'Inter_600SemiBold' }]}>
                        {m}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          )}

          <Text style={[styles.filterSectionLabel, { color: colors.textTertiary, marginTop: 20 }]}>Category</Text>
          <View style={styles.modalChipsWrap}>
            {FILTER_OPTIONS.map((opt) => {
              const active = activeFilter === opt.key;
              return (
                <Pressable
                  key={opt.key}
                  onPress={() => setActiveFilter(opt.key)}
                  style={[
                    styles.timeChip,
                    { backgroundColor: colors.card, borderColor: colors.border },
                    active && { backgroundColor: colors.accentDim, borderColor: colors.accent + '40' },
                  ]}
                >
                  {opt.icon ? (
                    <Ionicons name={opt.icon as any} size={15} color={active ? colors.accent : colors.textTertiary} />
                  ) : null}
                  <Text style={[styles.timeChipText, { color: active ? colors.accent : colors.textSecondary }]}>
                    {opt.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </ScrollView>

        <Pressable onPress={() => setShowFilterModal(false)} style={[styles.filterDoneBtn, { backgroundColor: colors.accent }]}>
          <Text style={styles.filterDoneBtnText}>Apply</Text>
        </Pressable>
      </CustomModal>

      {/* Year picker */}
      <DatePickerModal
        visible={showYearPicker}
        onClose={() => setShowYearPicker(false)}
        title="Pick year"
        value={new Date(selectedYear, 0, 1)}
        onConfirm={(d) => setSelectedYear(d.getFullYear())}
      />

      {/* Custom start date */}
      <DatePickerModal
        visible={showCustomStartPicker}
        onClose={() => setShowCustomStartPicker(false)}
        title="Select start date"
        value={draftCustomStart}
        onConfirm={(d) => {
          const fixedStart = new Date(d); fixedStart.setHours(0, 0, 0, 0);
          setDraftCustomStart(fixedStart);
          setCustomStart(fixedStart);
          if (fixedStart.getTime() > customEnd.getTime()) setCustomEnd(endOfDay(fixedStart));
        }}
      />

      {/* Custom end date */}
      <DatePickerModal
        visible={showCustomEndPicker}
        onClose={() => setShowCustomEndPicker(false)}
        title="Select end date"
        value={draftCustomEnd}
        onConfirm={(d) => {
          const fixedEnd = new Date(d); fixedEnd.setHours(23, 59, 59, 999);
          setDraftCustomEnd(fixedEnd);
          setCustomEnd(fixedEnd);
          if (customStart.getTime() > fixedEnd.getTime()) setCustomStart(startOfDay(fixedEnd));
        }}
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
  headerArea: {
    paddingHorizontal: 20,
    paddingBottom: 8,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'transparent',
  },
  screenTitle: {
    fontFamily: 'Inter_700Bold',
    fontSize: 24,
    letterSpacing: -0.4,
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: Platform.OS === 'ios' ? 12 : 6,
    paddingHorizontal: 14,
    borderRadius: 16,
    borderWidth: 1,
    marginBottom: 12,
  },
  searchInput: {
    flex: 1,
    fontFamily: 'Inter_500Medium',
    fontSize: 15,
    padding: 0,
  },
  filterButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 16,
    borderWidth: 1,
    marginBottom: 8,
  },
  filterButtonText: {
    flex: 1,
    fontFamily: 'Inter_600SemiBold',
    fontSize: 14,
  },
  modalTitle: {
    fontFamily: 'Inter_700Bold',
    fontSize: 18,
    textAlign: 'center',
    marginBottom: 16,
  },
  filterSectionLabel: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 12,
    letterSpacing: 0.5,
    marginBottom: 10,
  },
  modalChipsWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  timeChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 16,
    borderWidth: 1,
  },
  timeChipText: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 12,
  },
  customChipWrap: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 12,
  },
  customChip: {
    flex: 1,
    borderRadius: 14,
    borderWidth: 1,
    paddingVertical: 12,
    paddingHorizontal: 14,
  },
  customChipLabel: {
    fontFamily: 'Inter_500Medium',
    fontSize: 11,
    marginBottom: 4,
  },
  customChipValue: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 14,
  },
  yearPill: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 10,
  },
  yearPillText: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 13,
  },
  monthGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  monthChip: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 12,
    borderWidth: 1,
  },
  monthChipText: {
    fontFamily: 'Inter_500Medium',
    fontSize: 13,
  },
  filterDoneBtn: {
    marginTop: 20,
    borderRadius: 16,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  filterDoneBtnText: {
    fontFamily: 'Inter_700Bold',
    fontSize: 15,
    color: '#FFFFFF',
  },
  summaryCard: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 16,
    borderWidth: 1,
    padding: 20,
    marginBottom: 20,
  },
  summaryLeft: {
    flex: 1,
  },
  summaryRight: {
    flex: 1,
    alignItems: 'flex-end',
  },
  summaryDivider: {
    width: 1,
    height: 40,
    marginHorizontal: 16,
  },
  summaryLabel: {
    fontFamily: 'Inter_500Medium',
    fontSize: 12,
    letterSpacing: 0.5,
    marginBottom: 6,
  },
  summaryAmount: {
    fontFamily: 'Inter_700Bold',
    fontSize: 24,
    letterSpacing: -0.5,
  },
  summaryCount: {
    fontFamily: 'Inter_700Bold',
    fontSize: 24,
    letterSpacing: -0.5,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: 24,
    paddingBottom: 12,
  },
  sectionTitle: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 13,
    letterSpacing: 0.5,
  },
  sectionBadge: {
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
  },
  sectionTotal: {
    fontFamily: 'Inter_700Bold',
    fontSize: 13,
  },
  txCard: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 16,
    borderWidth: 1,
    padding: 16,
  },
  txIconWrap: {
    width: 48,
    height: 48,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 14,
  },
  txInfo: {
    flex: 1,
    marginRight: 8,
  },
  txMerchant: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 16,
    letterSpacing: -0.2,
  },
  txUpi: {
    fontFamily: 'Inter_400Regular',
    fontSize: 12,
    marginTop: 4,
    letterSpacing: 0.1,
  },
  txRight: {
    alignItems: 'flex-end',
  },
  txAmount: {
    fontFamily: 'Inter_700Bold',
    fontSize: 17,
    letterSpacing: -0.3,
  },
  txTime: {
    fontFamily: 'Inter_400Regular',
    fontSize: 11,
    marginTop: 4,
    letterSpacing: 0.2,
  },
  separator: {
    height: 10,
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 80,
    gap: 8,
  },
  emptyText: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 16,
    marginTop: 8,
  },
  emptySubtext: {
    fontFamily: 'Inter_400Regular',
    fontSize: 13,
  },
});
