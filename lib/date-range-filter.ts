/**
 * The shared date-range filter used by Reports and Reminders.
 *
 * Both screens offer the same eight ranges (Today → Custom) and must agree on
 * exactly what each one means: if "Last 3 months" covered a different span in
 * one screen than the other, the same reminder would appear in one and not the
 * other with no way for the user to tell why. Keeping the range maths in one
 * module makes that agreement structural rather than a thing to remember.
 *
 * Extracted verbatim from `app/(tabs)/reports.tsx`, which was the original
 * implementation — the semantics below are unchanged from what Reports shipped.
 *
 * Reports additionally uses the `prev*` fields to draw period-over-period
 * comparisons. Reminders only needs `currStart`/`currEnd`, but the previous
 * period is computed here regardless so the two screens share one code path.
 */

export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export type DateFilterKey =
  | 'all'
  | 'today'
  | 'week'
  | 'month'
  | 'threeMonths'
  | 'sixMonths'
  | 'multiMonth'
  | 'year'
  | 'custom';

export interface DateRangeInfo {
  label: string;
  prevLabel: string;
  prevShortLabel: string;
  currStart: Date;
  currEnd: Date;
  prevStart: Date;
  prevEnd: Date;
}

export interface DateRangeState {
  filterKey: DateFilterKey;
  customStart: Date;
  customEnd: Date;
  selectedYear: number;
  selectedMonths: number[];
}

/**
 * Which way the relative ranges (Week, 3M, 6M) point.
 *
 * Reports analyses what already happened, so its ranges end today and look
 * back. Reminders are mostly *upcoming*, and a backward-looking "Week" there
 * selects nothing but overdue items — the filter reads as broken. Same chips,
 * same labels, direction chosen by the screen.
 *
 * `today`, `month`, `multiMonth` and `year` are absolute calendar periods and
 * are unaffected by this.
 */
export type RangeDirection = 'past' | 'future';

export const DAY_MS = 24 * 60 * 60 * 1000;

export const startOfDay = (d: Date): Date => {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
};

export const endOfDay = (d: Date): Date => {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
};

/** The chips shown in the filter sheet, in display order. */
export const DATE_FILTER_CHIPS: Array<{ key: DateFilterKey; label: string; icon: string }> = [
  { key: 'all', label: 'All time', icon: 'infinite' },
  { key: 'today', label: 'Today', icon: 'calendar' },
  { key: 'week', label: 'Week', icon: 'calendar' },
  { key: 'month', label: 'Month', icon: 'calendar' },
  { key: 'threeMonths', label: '3M', icon: 'calendar' },
  { key: 'sixMonths', label: '6M', icon: 'calendar' },
  { key: 'year', label: 'Year', icon: 'wallet' },
  { key: 'multiMonth', label: 'Multi-Month', icon: 'grid' },
  { key: 'custom', label: 'Custom', icon: 'apps' },
];

/**
 * Condenses a month selection into a short label. Spelling out every month
 * ("Jan, Feb, Mar, Jul 2026") wraps the header over multiple lines, and it also
 * overstates precision: the range covers the whole first→last span, so a gappy
 * selection is already reported as a range.
 */
export function formatMonthsLabel(months: number[], year: number): string {
  if (months.length === 0) return `${year}`;
  if (months.length === 1) return `${MONTHS[months[0]]} ${year}`;

  const first = months[0];
  const last = months[months.length - 1];
  const isContiguous = last - first + 1 === months.length;

  // Two adjacent months read better spelled out than as a range.
  if (isContiguous && months.length === 2) return `${MONTHS[first]}, ${MONTHS[last]} ${year}`;

  return `${MONTHS[first]} – ${MONTHS[last]} ${year}`;
}

/**
 * Resolves the filter state into concrete start/end instants.
 *
 * `now` is a parameter rather than being read inside so callers can memoise on
 * a stable value; passing a fresh `new Date()` on every render would recompute
 * the range needlessly.
 */
export function resolveDateRange(
  state: DateRangeState,
  now: Date = new Date(),
  direction: RangeDirection = 'past',
): DateRangeInfo {
  const { filterKey, customStart, customEnd, selectedYear, selectedMonths } = state;
  const sortedMonths = [...selectedMonths].sort((a, b) => a - b);
  const nowDay = startOfDay(now);
  const forward = direction === 'future';

  if (filterKey === 'all') {
    // Deliberately unbounded rather than "this year": a reminder due next
    // January is still a reminder, and an "All time" filter that hides it
    // would be lying. The bounds are far enough out that no real record
    // falls outside them, so this behaves as no date filter at all.
    return {
      label: 'All time',
      prevLabel: 'All time',
      prevShortLabel: 'all time',
      currStart: new Date(1970, 0, 1),
      currEnd: new Date(2999, 11, 31, 23, 59, 59, 999),
      prevStart: new Date(1970, 0, 1),
      prevEnd: new Date(1970, 0, 1),
    };
  }

  if (filterKey === 'today') {
    const prevDay = new Date(nowDay.getTime() - DAY_MS);
    return {
      label: 'Today',
      prevLabel: 'Yesterday',
      prevShortLabel: 'yesterday',
      currStart: nowDay,
      currEnd: endOfDay(nowDay),
      prevStart: startOfDay(prevDay),
      prevEnd: endOfDay(prevDay),
    };
  }

  if (filterKey === 'week') {
    // 7 days: ending today when looking back, starting today when looking ahead.
    const currStart = forward ? nowDay : startOfDay(new Date(nowDay.getTime() - 6 * DAY_MS));
    const currEnd = forward ? endOfDay(new Date(nowDay.getTime() + 6 * DAY_MS)) : endOfDay(nowDay);
    const days = 7;
    return {
      label: forward ? 'Next 7 days' : 'Last 7 days',
      prevLabel: forward ? 'Previous 7 days' : 'Previous 7 days',
      prevShortLabel: 'prev 7 days',
      currStart,
      currEnd,
      prevStart: startOfDay(new Date(currStart.getTime() - days * DAY_MS)),
      prevEnd: endOfDay(new Date(currEnd.getTime() - days * DAY_MS)),
    };
  }

  if (filterKey === 'threeMonths' || filterKey === 'sixMonths') {
    const monthSpan = filterKey === 'threeMonths' ? 3 : 6;
    const edge = new Date(nowDay);
    edge.setMonth(edge.getMonth() + (forward ? monthSpan : -monthSpan));
    const currStart = forward ? nowDay : startOfDay(edge);
    const currEnd = forward ? endOfDay(edge) : endOfDay(nowDay);
    const days = Math.max(1, Math.round((currEnd.getTime() - currStart.getTime()) / DAY_MS) + 1);
    return {
      label: `${forward ? 'Next' : 'Last'} ${monthSpan} months`,
      prevLabel: `Previous ${monthSpan} months`,
      prevShortLabel: `prev ${monthSpan} months`,
      currStart,
      currEnd,
      prevStart: startOfDay(new Date(currStart.getTime() - days * DAY_MS)),
      prevEnd: endOfDay(new Date(currEnd.getTime() - days * DAY_MS)),
    };
  }

  if (filterKey === 'custom') {
    const currStart = startOfDay(customStart);
    const currEnd = endOfDay(customEnd);
    const days = Math.max(1, Math.round((currEnd.getTime() - currStart.getTime()) / DAY_MS) + 1);
    const prevStart = new Date(currStart.getTime() - days * DAY_MS);
    const prevEnd = new Date(currEnd.getTime() - days * DAY_MS);
    const short = (d: Date) => d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
    return {
      label: `${short(currStart)} - ${short(currEnd)}`,
      prevLabel: `${short(prevStart)} - ${short(prevEnd)}`,
      prevShortLabel: 'prev period',
      currStart,
      currEnd,
      prevStart,
      prevEnd,
    };
  }

  if (filterKey === 'month') {
    const m = sortedMonths[0] ?? now.getMonth();
    const currStart = new Date(selectedYear, m, 1);
    const currEnd = new Date(selectedYear, m + 1, 0);

    const prevDate = new Date(selectedYear, m, 1);
    prevDate.setMonth(prevDate.getMonth() - 1);

    return {
      label: `${MONTHS[m]} ${selectedYear}`,
      prevLabel: `${MONTHS[prevDate.getMonth()]} ${prevDate.getFullYear()}`,
      prevShortLabel: `${MONTHS[prevDate.getMonth()]} ${prevDate.getFullYear()}`,
      currStart,
      currEnd,
      prevStart: new Date(prevDate.getFullYear(), prevDate.getMonth(), 1),
      prevEnd: new Date(prevDate.getFullYear(), prevDate.getMonth() + 1, 0),
    };
  }

  if (filterKey === 'multiMonth') {
    const months = sortedMonths.length ? sortedMonths : [now.getMonth()];
    const minM = months[0];
    const maxM = months[months.length - 1];
    const prevYear = selectedYear - 1;
    return {
      label: formatMonthsLabel(months, selectedYear),
      prevLabel: formatMonthsLabel(months, prevYear),
      prevShortLabel: `${prevYear}`,
      currStart: new Date(selectedYear, minM, 1),
      currEnd: new Date(selectedYear, maxM + 1, 0),
      prevStart: new Date(prevYear, minM, 1),
      prevEnd: new Date(prevYear, maxM + 1, 0),
    };
  }

  // year
  const prevYear = selectedYear - 1;
  return {
    label: `${selectedYear}`,
    prevLabel: `${prevYear}`,
    prevShortLabel: `${prevYear}`,
    currStart: new Date(selectedYear, 0, 1),
    currEnd: new Date(selectedYear, 11, 31),
    prevStart: new Date(prevYear, 0, 1),
    prevEnd: new Date(prevYear, 11, 31),
  };
}

/** True when `date` falls inside the resolved range. */
export function isWithinRange(date: Date, range: DateRangeInfo): boolean {
  const t = date.getTime();
  if (Number.isNaN(t)) return false;
  return t >= startOfDay(range.currStart).getTime() && t <= endOfDay(range.currEnd).getTime();
}
