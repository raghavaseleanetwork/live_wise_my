import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import CustomModal from '@/components/CustomModal';
import DatePickerModal from '@/components/DatePickerModal';
import { useTheme } from '@/lib/theme-context';
import {
  DATE_FILTER_CHIPS,
  MONTHS,
  endOfDay,
  startOfDay,
  type DateFilterKey,
  type DateRangeInfo,
  type DateRangeState,
} from '@/lib/date-range-filter';

/**
 * The date-range filter shared by Reports and Reminders.
 *
 * This is the UI half of `lib/date-range-filter.ts`: the trigger button showing
 * the active range, the sheet of range chips, and the custom start/end and year
 * pickers those chips reveal. Both screens render this same component so the
 * filter looks and behaves identically in each — the client asked for the
 * Reminders filter to match Reports exactly, and sharing the component is what
 * keeps that true as either screen changes.
 *
 * State is owned by the caller (`value` / `onChange`) because each screen needs
 * to derive its own filtered data from the same selection.
 */

/**
 * An optional second filter section rendered in the same sheet.
 *
 * Reminders filters by category as well as by date, and the client asked for a
 * single filter box rather than a date sheet plus a separate row of chips. This
 * is deliberately generic (`string` keys) so the component does not need to know
 * about `ReminderIntent` — Reports passes nothing and renders date-only.
 */
export interface FilterCategoryOption {
  key: string;
  label: string;
  icon: string;
}

interface DateRangeFilterProps {
  value: DateRangeState;
  onChange: (next: DateRangeState) => void;
  /** Text on the trigger button — the resolved range label. */
  label: string;
  /** Heading inside the sheet, e.g. "Filter Reminders". */
  title: string;
  /** Optional category chips shown below the time range. */
  categories?: FilterCategoryOption[];
  activeCategory?: string;
  onCategoryChange?: (key: string) => void;
  /** Section heading for the category chips. */
  categoryLabel?: string;
  /** Shown under the trigger button, e.g. the active category. */
  sublabel?: string;
  /** Resets every filter to its default. Hidden when omitted. */
  onReset?: () => void;
}

export default function DateRangeFilter({
  value,
  onChange,
  label,
  title,
  categories,
  activeCategory,
  onCategoryChange,
  categoryLabel,
  sublabel,
  onReset,
}: DateRangeFilterProps) {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const resolvedCategoryLabel = categoryLabel ?? t('dateRangeFilter.category');

  const [showFilterModal, setShowFilterModal] = React.useState(false);
  const [showYearPicker, setShowYearPicker] = React.useState(false);
  const [showCustomStartPicker, setShowCustomStartPicker] = React.useState(false);
  const [showCustomEndPicker, setShowCustomEndPicker] = React.useState(false);

  const { filterKey, customStart, customEnd, selectedYear, selectedMonths } = value;

  const patch = (next: Partial<DateRangeState>) => onChange({ ...value, ...next });

  const handleSelectFilterChip = (key: DateFilterKey) => {
    setShowCustomStartPicker(false);
    setShowCustomEndPicker(false);

    // Selecting a month-based range with nothing chosen yet would resolve to an
    // empty month list, so seed it with the current month.
    const months =
      (key === 'month' || key === 'multiMonth') && selectedMonths.length === 0
        ? [new Date().getMonth()]
        : key === 'month'
          ? [selectedMonths[0] ?? new Date().getMonth()]
          : selectedMonths;

    patch({ filterKey: key, selectedMonths: months });

    // Custom has no meaning until dates are given, so it opens its picker
    // straight away. Year does not — it already defaults to the current year,
    // and popping a picker over the sheet on every tap is intrusive. The year
    // pill below is there for changing it.
    if (key === 'custom') setShowCustomStartPicker(true);
  };

  return (
    <>
      <View style={styles.filterChipsRow}>
        <Pressable
          onPress={() => setShowFilterModal(true)}
          style={[styles.filterButton, { backgroundColor: colors.card, borderColor: colors.border }]}
        >
          <Ionicons name="options-outline" size={18} color={colors.accent} />
          <View style={{ flex: 1 }}>
            <Text style={[styles.filterButtonText, { color: colors.text }]} numberOfLines={1}>
              {label}
            </Text>
            {!!sublabel && (
              <Text style={[styles.filterButtonSublabel, { color: colors.textTertiary }]} numberOfLines={1}>
                {sublabel}
              </Text>
            )}
          </View>
          <Ionicons name="chevron-down" size={16} color={colors.textTertiary} />
        </Pressable>
      </View>

      <DatePickerModal
        visible={showCustomStartPicker}
        onClose={() => setShowCustomStartPicker(false)}
        title={t('dateRangeFilter.selectStartDate')}
        value={customStart}
        onConfirm={(d) => {
          const fixedStart = startOfDay(d);
          // Keep the range valid: a start after the current end would otherwise
          // produce an empty list with no explanation.
          patch({
            customStart: fixedStart,
            customEnd: fixedStart.getTime() > customEnd.getTime() ? endOfDay(fixedStart) : customEnd,
          });
        }}
      />

      <DatePickerModal
        visible={showCustomEndPicker}
        onClose={() => setShowCustomEndPicker(false)}
        title={t('dateRangeFilter.selectEndDate')}
        value={customEnd}
        onConfirm={(d) => {
          const fixedEnd = endOfDay(d);
          patch({
            customEnd: fixedEnd,
            customStart: customStart.getTime() > fixedEnd.getTime() ? startOfDay(fixedEnd) : customStart,
          });
        }}
      />

      <CustomModal visible={showFilterModal} onClose={() => setShowFilterModal(false)}>
        <Text style={[styles.modalTitle, { color: colors.text }]}>{title}</Text>

        <Text style={[styles.filterSectionLabel, { color: colors.textTertiary }]}>{t('dateRangeFilter.timeRange')}</Text>
        <View style={styles.filterModalChipsWrap}>
          {DATE_FILTER_CHIPS.map((chip) => {
            const active = filterKey === chip.key;
            return (
              <Pressable
                key={chip.key}
                onPress={() => handleSelectFilterChip(chip.key)}
                style={[
                  styles.filterChip,
                  { backgroundColor: colors.card, borderColor: colors.border },
                  active && { backgroundColor: colors.accentDim, borderColor: colors.accent + '40' },
                ]}
              >
                <Ionicons name={chip.icon as any} size={16} color={active ? colors.accent : colors.textTertiary} />
                <Text style={[styles.filterChipText, { color: active ? colors.accent : colors.textSecondary }]}>
                  {chip.label}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {filterKey === 'custom' && (
          <View style={styles.customChipWrap}>
            <Pressable
              style={[styles.customChip, { backgroundColor: colors.card, borderColor: colors.border }]}
              onPress={() => {
                setShowCustomEndPicker(false);
                setShowCustomStartPicker(true);
              }}
            >
              <View style={{ flex: 1 }}>
                <Text style={[styles.customChipLabel, { color: colors.textTertiary }]}>{t('dateRangeFilter.startDate')}</Text>
                <Text style={[styles.customChipValue, { color: colors.text }]}>
                  {customStart.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                </Text>
              </View>
            </Pressable>

            <Pressable
              style={[styles.customChip, { backgroundColor: colors.card, borderColor: colors.border }]}
              onPress={() => {
                setShowCustomStartPicker(false);
                setShowCustomEndPicker(true);
              }}
            >
              <View style={{ flex: 1 }}>
                <Text style={[styles.customChipLabel, { color: colors.textTertiary }]}>{t('dateRangeFilter.endDate')}</Text>
                <Text style={[styles.customChipValue, { color: colors.text }]}>
                  {customEnd.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                </Text>
              </View>
            </Pressable>
          </View>
        )}

        {(filterKey === 'month' || filterKey === 'multiMonth' || filterKey === 'year') && (
          <View style={{ marginTop: 12 }}>
            <Pressable
              onPress={() => setShowYearPicker(true)}
              style={[styles.yearPill, { backgroundColor: colors.card, borderColor: colors.border }]}
            >
              <Ionicons name="calendar-outline" size={14} color={colors.textSecondary} />
              <Text style={[styles.yearPillText, { color: colors.text }]}>{t('dateRangeFilter.yearLabel', { year: selectedYear })}</Text>
              <Ionicons name="chevron-down" size={14} color={colors.textTertiary} />
            </Pressable>
            {/* Year covers the whole year, so month chips would be meaningless
                under it — only the year pill above applies. */}
            {filterKey !== 'year' && (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.monthRow}>
              {MONTHS.map((m, idx) => {
                const isSelected = selectedMonths.includes(idx);
                return (
                  <Pressable
                    key={m}
                    onPress={() => {
                      if (filterKey === 'month') {
                        patch({ selectedMonths: [idx] });
                        return;
                      }
                      if (isSelected) {
                        const next = selectedMonths.filter((x) => x !== idx);
                        // Keep at least one month selected, or the range is empty.
                        patch({ selectedMonths: next.length ? next : selectedMonths });
                      } else {
                        patch({ selectedMonths: [...selectedMonths, idx].sort((a, b) => a - b) });
                      }
                    }}
                    style={[
                      styles.monthChip,
                      { backgroundColor: colors.card, borderColor: colors.border },
                      isSelected && { backgroundColor: colors.accentDim, borderColor: colors.accent + '40' },
                    ]}
                  >
                    <Text
                      style={[
                        styles.monthChipText,
                        { color: colors.textTertiary },
                        isSelected && { color: colors.accent, fontFamily: 'Inter_600SemiBold' },
                      ]}
                    >
                      {m}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>
            )}
          </View>
        )}

        {!!categories?.length && (
          <>
            <Text style={[styles.filterSectionLabel, { color: colors.textTertiary, marginTop: 18 }]}>
              {resolvedCategoryLabel}
            </Text>
            <View style={styles.filterModalChipsWrap}>
              {categories.map((cat) => {
                const active = activeCategory === cat.key;
                return (
                  <Pressable
                    key={cat.key}
                    onPress={() => onCategoryChange?.(cat.key)}
                    style={[
                      styles.filterChip,
                      { backgroundColor: colors.card, borderColor: colors.border },
                      active && { backgroundColor: colors.accentDim, borderColor: colors.accent + '40' },
                    ]}
                  >
                    <Ionicons name={cat.icon as any} size={16} color={active ? colors.accent : colors.textTertiary} />
                    <Text style={[styles.filterChipText, { color: active ? colors.accent : colors.textSecondary }]}>
                      {cat.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </>
        )}

        <View style={styles.filterActionsRow}>
          {!!onReset && (
            <Pressable
              onPress={onReset}
              style={[styles.filterResetBtn, { borderColor: colors.border }]}
            >
              <Text style={[styles.filterResetBtnText, { color: colors.textSecondary }]}>{t('dateRangeFilter.reset')}</Text>
            </Pressable>
          )}
          <Pressable
            onPress={() => setShowFilterModal(false)}
            style={[styles.filterDoneBtn, { backgroundColor: colors.accent, flex: 1 }]}
          >
            <Text style={styles.filterDoneBtnText}>{t('dateRangeFilter.apply')}</Text>
          </Pressable>
        </View>
      </CustomModal>

      <DatePickerModal
        visible={showYearPicker}
        onClose={() => setShowYearPicker(false)}
        title={t('dateRangeFilter.pickYear')}
        value={new Date(selectedYear, 0, 1)}
        onConfirm={(d) => patch({ selectedYear: d.getFullYear() })}
      />
    </>
  );
}

// Copied from the Reports stylesheet so both screens render identically.
const styles = StyleSheet.create({
  filterChipsRow: {
    marginBottom: 12,
  },
  filterButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 16,
    borderWidth: 1,
  },
  filterButtonText: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 14,
  },
  filterButtonSublabel: {
    fontFamily: 'Inter_500Medium',
    fontSize: 11,
    marginTop: 1,
  },
  modalTitle: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 15,
    textAlign: 'center',
    marginBottom: 8,
  },
  filterSectionLabel: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 12,
    letterSpacing: 0.5,
    marginTop: 4,
    marginBottom: 10,
  },
  filterModalChipsWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  filterChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 16,
    borderWidth: 1,
  },
  filterChipText: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 12,
  },
  customChipWrap: {
    marginTop: 0,
    gap: 6,
  },
  customChip: {
    borderRadius: 14,
    borderWidth: 0,
    paddingVertical: 9,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 2,
    minHeight: 40,
  },
  customChipLabel: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 11,
  },
  customChipValue: {
    fontFamily: 'Inter_500Medium',
    fontSize: 13,
    marginTop: 1,
  },
  yearPill: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 999,
    borderWidth: 1,
    marginBottom: 12,
  },
  yearPillText: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 13,
  },
  monthRow: {
    gap: 8,
    marginTop: 0,
    marginBottom: 18,
  },
  monthChip: {
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 24,
    borderWidth: 1,
  },
  monthChipText: {
    fontFamily: 'Inter_500Medium',
    fontSize: 13,
    borderRadius: 16,
  },
  filterActionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 20,
  },
  filterResetBtn: {
    borderRadius: 16,
    borderWidth: 1,
    paddingVertical: 14,
    paddingHorizontal: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  filterResetBtnText: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 15,
  },
  filterDoneBtn: {
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
});
