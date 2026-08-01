import React, { useEffect, useMemo, useState } from 'react';
import {
  StyleSheet,
  Text,
  View,
  ScrollView,
  Pressable,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { FadeInDown } from 'react-native-reanimated';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import Colors, { ThemeColors } from '@/constants/colors';
import { useTheme } from '@/lib/theme-context';
import { useCurrency } from '@/lib/currency-context';
import { useExpenses } from '@/lib/expense-context';
import { useTabBarContentInset } from '@/lib/tab-bar';
import { useAuth } from '@/lib/auth-context';
import { useSubscription } from '@/lib/subscription-context';
import { usePaywall } from '@/lib/paywall-context';
import { apiRequest } from '@/lib/query-client';
import { getReminderIntentFromBill } from '@/lib/reminder-intent';
import { useFamilyReminders } from '@/lib/use-family-reminders';
import {
  DATE_FILTER_CHIPS,
  MONTHS,
  formatMonthsLabel,
  resolveDateRange,
  type DateFilterKey,
} from '@/lib/date-range-filter';
import DatePickerModal from '@/components/DatePickerModal';
import {
  CATEGORIES,
  getCategoryBreakdown,
  CategoryType,
} from '@/lib/data';
import CategoryIcon from '@/components/CategoryIcon';
import PremiumLoader from '@/components/PremiumLoader';
import CustomModal from '@/components/CustomModal';
import { useSeniorMode } from '@/lib/senior-context';
import Money from '@/components/Money';

function CategoryBar({ category, total, percentage, maxPercentage, colors, isDark, formatAmount, isSeniorMode }: { category: CategoryType; total: number; percentage: number; maxPercentage: number; colors: ThemeColors; isDark: boolean; formatAmount: (n: number) => string; isSeniorMode: boolean }) {
  const safeCat = (category as string || 'others').toLowerCase() as CategoryType;
  const cat = CATEGORIES[safeCat] || CATEGORIES.others;
  const barWidth = maxPercentage > 0 ? (percentage / maxPercentage) * 100 : 0;

  return (
    <View style={styles.catBarRow}>
      <View style={styles.catBarLeft}>
        <View style={[styles.catBarIcon, { backgroundColor: cat.color + '18' }]}>
          <CategoryIcon category={category} size={18} />
        </View>
        <View style={styles.catBarInfo}>
          <Text style={[styles.catBarName, { color: colors.text }, isSeniorMode && { fontSize: 16 }]} numberOfLines={1}>{cat.label}</Text>
          <Text style={[styles.catBarPercent, { color: colors.textTertiary }, isSeniorMode && { fontSize: 13 }]}>{Math.round(percentage)}%</Text>
        </View>
      </View>
      <View style={styles.catBarRight}>
        <View style={[styles.catBarTrack, { backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)' }]}>
          <LinearGradient
            colors={[cat.color, cat.color + 'BB']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={[styles.catBarFill, { width: `${barWidth}%` as any }]}
          />
        </View>
        <Money style={[styles.catBarAmount, { color: colors.text }, isSeniorMode && { fontSize: 15 }]}>{formatAmount(total)}</Money>
      </View>
    </View>
  );
}

export default function ReportsScreen() {
  const insets = useSafeAreaInsets();
  const tabBarInset = useTabBarContentInset();
  const { colors, isDark } = useTheme();
  const { formatAmount } = useCurrency();
  const { transactions, bills: ownBills, isLoading, monthlyBudget, lifeScore, getReports } = useExpenses();

  // Family Hub reminders count toward the report the same as the user's own —
  // an appointment kept or a family bill paid is real activity, and leaving it
  // out made the stat tiles read 0 for users who track everything in Family Hub.
  const { familyReminders } = useFamilyReminders();
  const bills = useMemo(
    () => [...ownBills, ...familyReminders],
    [ownBills, familyReminders],
  );
  const { isSeniorMode } = useSeniorMode();
  const { checkFlag } = useSubscription();
  const { presentPaywall } = usePaywall();
  const [backendReport, setBackendReport] = useState<any>(null);
  const [isReportsLoading, setIsReportsLoading] = useState(false);
  const { token } = useAuth();
  const now = new Date();
  type FilterKey = DateFilterKey;
  const [filterKey, setFilterKey] = useState<FilterKey>('today');
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

  const [showFilterModal, setShowFilterModal] = useState(false);
  const [showYearPicker, setShowYearPicker] = useState(false);
  const [showCustomStartPicker, setShowCustomStartPicker] = useState(false);
  const [showCustomEndPicker, setShowCustomEndPicker] = useState(false);
  const [draftCustomStart, setDraftCustomStart] = useState<Date>(customStart);
  const [draftCustomEnd, setDraftCustomEnd] = useState<Date>(customEnd);

  // Family medicines (for "Medicines Taken" metric).
  const [medicines, setMedicines] = useState<
    Array<{
      lastStatus?: string;
      lastTakenAt?: string | null;
    }>
  >([]);
  const [isMedicinesLoading, setIsMedicinesLoading] = useState(false);

  useEffect(() => {
    if (filterKey === 'month') {
      const m = selectedMonths[0] ?? now.getMonth();
      setSelectedMonths([m]);
    }
  }, [filterKey]);

  useEffect(() => {
    if (!token) return;
    let mounted = true;
    (async () => {
      try {
        setIsMedicinesLoading(true);
        const res = await apiRequest('GET', '/api/family', undefined, token);
        const data = (await res.json()) as Array<{
          medicines?: Array<{ lastStatus?: string; lastTakenAt?: string | null }>;
        }>;
        const flattened = data
          .flatMap((m) => (Array.isArray(m.medicines) ? m.medicines : []))
          .map((med) => ({
            lastStatus: med.lastStatus,
            lastTakenAt: med.lastTakenAt ?? null,
          }));
        if (mounted) setMedicines(flattened);
      } catch {
        if (mounted) setMedicines([]);
      } finally {
        if (mounted) setIsMedicinesLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [token]);

  const topInset = Platform.OS === 'web' ? 67 : insets.top;

  const DAY_MS = 24 * 60 * 60 * 1000;
  const startOfDay = (d: Date) => {
    const x = new Date(d);
    x.setHours(0, 0, 0, 0);
    return x;
  };
  const endOfDay = (d: Date) => {
    const x = new Date(d);
    x.setHours(23, 59, 59, 999);
    return x;
  };
  const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));

  const sortedSelectedMonths = useMemo(() => [...selectedMonths].sort((a, b) => a - b), [selectedMonths]);

  // Range maths lives in `lib/date-range-filter.ts` so the Reminders screen can
  // use the exact same definitions — see that file for why.
  const rangeInfo = useMemo(
    () =>
      resolveDateRange({
        filterKey,
        customStart,
        customEnd,
        selectedYear,
        selectedMonths: sortedSelectedMonths,
      }),
    [filterKey, customStart, customEnd, selectedYear, sortedSelectedMonths],
  );


  useEffect(() => {
    (async () => {
      if (!rangeInfo.currStart || !rangeInfo.currEnd) return;
      setIsReportsLoading(true);
      const data = await getReports(rangeInfo.currStart.toISOString(), rangeInfo.currEnd.toISOString());
      setBackendReport(data);
      setIsReportsLoading(false);
    })();
  }, [rangeInfo, getReports]);

  const currPredicate = useMemo(() => {
    return (d: Date) => {
      // multiMonth is the only key whose selection is not a contiguous span —
      // a gappy month picks (Mar + Jul) must match those months specifically,
      // not everything between them. Every other key, including 'all', is a
      // plain start/end range, so testing for multiMonth is what keeps new
      // keys working without being added to a whitelist.
      if (filterKey === 'multiMonth') {
        return d.getFullYear() === selectedYear && sortedSelectedMonths.includes(d.getMonth());
      }
      return d.getTime() >= rangeInfo.currStart.getTime() && d.getTime() <= rangeInfo.currEnd.getTime();
    };
  }, [filterKey, rangeInfo, selectedYear, sortedSelectedMonths]);

  const prevPredicate = useMemo(() => {
    return (d: Date) => {
      if (filterKey === 'multiMonth') {
        // Compare same months previous year.
        return d.getFullYear() === selectedYear - 1 && sortedSelectedMonths.includes(d.getMonth());
      }
      return d.getTime() >= rangeInfo.prevStart.getTime() && d.getTime() <= rangeInfo.prevEnd.getTime();
    };
  }, [filterKey, rangeInfo, selectedYear, sortedSelectedMonths]);

  const reportTxs = useMemo(() => {
    return transactions.filter((tx) => {
      const d = new Date(tx.date);
      return currPredicate(d);
    });
  }, [transactions, currPredicate]);

  const prevTxs = useMemo(() => {
    return transactions.filter((tx) => {
      const d = new Date(tx.date);
      return prevPredicate(d);
    });
  }, [transactions, prevPredicate]);

  const reportBills = useMemo(() => {
    return bills.filter((b) => {
      const d = new Date(b.dueDate);
      return currPredicate(d);
    });
  }, [bills, currPredicate]);

  const prevBills = useMemo(() => {
    return bills.filter((b) => {
      const d = new Date(b.dueDate);
      return prevPredicate(d);
    });
  }, [bills, prevPredicate]);

  const totalSpent = backendReport ? backendReport.expense : reportTxs.reduce((s, tx) => s + (tx.isDebit ? tx.amount : 0), 0);
  const prevTotalSpent = backendReport ? backendReport.previousExpense : prevTxs.reduce((s, tx) => s + (tx.isDebit ? tx.amount : 0), 0);
  const totalIncome = backendReport ? backendReport.income : reportTxs.reduce((s, tx) => s + (!tx.isDebit ? tx.amount : 0), 0);

  const breakdown = useMemo(() => {
    if (backendReport && backendReport.categories) {
      const cats = Object.entries(backendReport.categories as Record<string, { total: number; count: number }>)
        .map(([cat, data]) => ({
          category: cat as CategoryType,
          total: data.total,
          percentage: (data.total / (totalSpent || 1)) * 100
        }))
        .sort((a, b) => b.total - a.total);
      return cats;
    }
    return getCategoryBreakdown(reportTxs);
  }, [reportTxs, backendReport, totalSpent]);
  const maxPercentage = breakdown.length > 0 ? breakdown[0].percentage : 0;

  const merchantTotals = useMemo(() => {
    const map: Record<string, { total: number; count: number; category: CategoryType }> = {};
    reportTxs.forEach((tx) => {
      if (!map[tx.merchant]) map[tx.merchant] = { total: 0, count: 0, category: tx.category };
      map[tx.merchant].total += tx.amount;
      map[tx.merchant].count++;
    });
    return Object.entries(map).sort(([, a], [, b]) => b.total - a.total).slice(0, 5);
  }, [reportTxs]);

  const daysInPeriod = useMemo(() => {
    const days =
      Math.round((rangeInfo.currEnd.getTime() - rangeInfo.currStart.getTime()) / DAY_MS) + 1;
    return Math.max(1, days);
  }, [rangeInfo]);

  const paidBills = useMemo(() => reportBills.filter((b) => b.status === 'paid' || b.isPaid), [reportBills]);
  const prevPaidBills = useMemo(() => prevBills.filter((b) => b.status === 'paid' || b.isPaid), [prevBills]);

  const remindersCompleted = paidBills.length;
  const prevRemindersCompleted = prevPaidBills.length;

  const billsPaid = useMemo(() => paidBills.filter((b) => getReminderIntentFromBill(b) === 'bills').length, [paidBills]);
  const billsDue = useMemo(
    () => reportBills.filter((b) => !(b.status === 'paid' || b.isPaid) && getReminderIntentFromBill(b) === 'bills').length,
    [reportBills],
  );

  const habitsCompleted = useMemo(
    () => paidBills.filter((b) => getReminderIntentFromBill(b) === 'habits').length,
    [paidBills],
  );
  const habitsTotal = useMemo(
    () => reportBills.filter((b) => getReminderIntentFromBill(b) === 'habits').length,
    [reportBills],
  );

  const habitsConsistency = habitsTotal > 0 ? habitsCompleted / habitsTotal : 0;

  const medicinesTaken = useMemo(() => {
    const meds = medicines;
    return meds.filter((m) => {
      if (m.lastStatus !== 'taken') return false;
      if (!m.lastTakenAt) return false;
      const dt = new Date(m.lastTakenAt);
      return currPredicate(dt);
    }).length;
  }, [medicines, currPredicate]);

  const medicinesPointsTotal = medicines.length > 0 ? medicinesTaken / medicines.length : 0;
  const habitConsistencyPct = Math.round(habitsConsistency * 100);
  const medicinesTakenRatioPct = medicines.length > 0 ? Math.round((medicinesTaken / medicines.length) * 100) : 0;

  const billsPaidRatio = reportBills.filter((b) => getReminderIntentFromBill(b) === 'bills').length > 0
    ? billsPaid / Math.max(1, reportBills.filter((b) => getReminderIntentFromBill(b) === 'bills').length)
    : 0;

  const billsTimeline = useMemo(() => {
    const billsIntent = reportBills.filter((b) => getReminderIntentFromBill(b) === 'bills');

    const start = startOfDay(rangeInfo.currStart);
    const end = startOfDay(rangeInfo.currEnd);
    const daysCount = Math.round((end.getTime() - start.getTime()) / DAY_MS) + 1;
    const safeDays = Math.max(1, daysCount);

    const useDaily = safeDays <= 14;
    const bucketCount = useDaily ? safeDays : Math.ceil(safeDays / 7);

    const dueCounts = new Array(bucketCount).fill(0) as number[];
    const paidCounts = new Array(bucketCount).fill(0) as number[];

    billsIntent.forEach((b) => {
      const dueDt = new Date(b.dueDate);
      if (Number.isNaN(dueDt.getTime())) return;
      const d = startOfDay(dueDt);
      const dayIdx = Math.round((d.getTime() - start.getTime()) / DAY_MS);
      if (dayIdx < 0 || dayIdx >= safeDays) return;

      const idx = useDaily ? dayIdx : Math.floor(dayIdx / 7);
      if (idx < 0 || idx >= bucketCount) return;

      dueCounts[idx] += 1;
      if (b.status === 'paid' || b.isPaid) paidCounts[idx] += 1;
    });

    const maxDue = Math.max(1, ...dueCounts);
    const labels = dueCounts.map((_, i) => {
      if (useDaily) {
        const dd = new Date(start.getTime() + i * DAY_MS);
        return dd.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
      }
      return `W${i + 1}`;
    });

    return { labels, dueCounts, paidCounts, maxDue, useDaily };
  }, [reportBills, rangeInfo, DAY_MS]);

  const spendingScore = monthlyBudget > 0
    ? clamp(Math.round(100 - (totalSpent / Math.max(1, (monthlyBudget / 30) * daysInPeriod)) * 100), 0, 100)
    : 100;

  const billsScore = reportBills.length > 0
    ? Math.round((paidBills.length / reportBills.length) * 100)
    : 100;

  const healthScore = medicines.length > 0
    ? Math.round((medicinesTaken / medicines.length) * 100)
    : 100;

  // Weighted Dynamic Score: Spending 50%, Bills 30%, Health 20%
  const hasActivity = reportTxs.length > 0 || reportBills.length > 0 || medicines.length > 0;
  
  const dynamicScore = hasActivity ? Math.round(
    (monthlyBudget > 0 ? spendingScore : (reportTxs.length > 0 ? spendingScore : 100)) * 0.5 +
    (reportBills.length > 0 ? billsScore : 100) * 0.3 +
    (medicines.length > 0 ? healthScore : 100) * 0.2
  ) : 0;

  const lifeScoreDisplay = dynamicScore;
  const lifeScoreLabel = 'Estimated Score';
  const lifeScoreEstimate = lifeScoreDisplay;

  const lifeScorePrev = useMemo(() => {
    const prevBillsCount = prevBills.length;
    const prevPaidCount = prevPaidBills.length;

    const prevSpendingScore = monthlyBudget > 0
      ? clamp(Math.round(100 - (prevTotalSpent / Math.max(1, (monthlyBudget / 30) * daysInPeriod)) * 100), 0, 100)
      : 100;

    const prevBillsScore = prevBillsCount > 0
      ? Math.round((prevPaidCount / prevBillsCount) * 100)
      : 100;

    const prevMedicinesTaken = medicines.filter((m) => {
      if (m.lastStatus !== 'taken' || !m.lastTakenAt) return false;
      return prevPredicate(new Date(m.lastTakenAt));
    }).length;

    const prevHealthScore = medicines.length > 0
      ? Math.round((prevMedicinesTaken / medicines.length) * 100)
      : 100;

    const hasPrevActivity = prevTxs.length > 0 || prevBillsCount > 0 || medicines.length > 0;

    return hasPrevActivity ? Math.round(
      (monthlyBudget > 0 ? prevSpendingScore : (prevTxs.length > 0 ? prevSpendingScore : 100)) * 0.5 + 
      (prevBillsCount > 0 ? prevBillsScore : 100) * 0.3 + 
      (medicines.length > 0 ? prevHealthScore : 100) * 0.2
    ) : 0;
  }, [prevPaidBills, prevBills, medicines, prevPredicate, prevTotalSpent, monthlyBudget, daysInPeriod]);

  const comparison = useMemo(() => {
    const spentDelta = totalSpent - prevTotalSpent;
    const remindersDelta = remindersCompleted - prevRemindersCompleted;
    const lifeScoreDelta = dynamicScore - lifeScorePrev;
    return { spentDelta, remindersDelta, lifeScoreDelta };
  }, [totalSpent, prevTotalSpent, remindersCompleted, prevRemindersCompleted, dynamicScore, lifeScorePrev]);

  const trendBars = useMemo(() => {
    // Simple bar-style "chart" using Views (no extra chart libraries).
    if (filterKey === 'today' || (filterKey === 'custom' && daysInPeriod === 1)) {
      const hours = new Array(24).fill(0) as number[];
      reportTxs.forEach((tx) => {
        if (!tx.isDebit) return;
        const d = new Date(tx.date);
        if (!currPredicate(d)) return;
        hours[d.getHours()] += tx.amount;
      });
      const max = Math.max(1, ...hours);
      return {
        kind: 'hour' as const,
        labels: hours.map((_, i) => `${i}`),
        values: hours,
        max,
      };
    }

    const start = startOfDay(rangeInfo.currStart);
    const end = startOfDay(rangeInfo.currEnd);
    const daysCount = Math.round((end.getTime() - start.getTime()) / DAY_MS) + 1;

    if (daysCount <= 14) {
      const values = new Array(daysCount).fill(0) as number[];
      reportTxs.forEach((tx) => {
        if (!tx.isDebit) return;
        const d = new Date(tx.date);
        if (!currPredicate(d)) return;
        const dayIdx = Math.round((startOfDay(d).getTime() - start.getTime()) / DAY_MS);
        if (dayIdx >= 0 && dayIdx < values.length) values[dayIdx] += tx.amount;
      });
      const max = Math.max(1, ...values);
      return {
        kind: 'day' as const,
        labels: values.map((_, i) => {
          const dd = new Date(start.getTime() + i * DAY_MS);
          return dd.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
        }),
        values,
        max,
      };
    }

    // Weekly buckets
    const weeks = Math.ceil(daysCount / 7);
    const values = new Array(weeks).fill(0) as number[];
    reportTxs.forEach((tx) => {
      if (!tx.isDebit) return;
      const d = new Date(tx.date);
      if (!currPredicate(d)) return;
      const dayIdx = Math.round((startOfDay(d).getTime() - start.getTime()) / DAY_MS);
      if (dayIdx < 0) return;
      const weekIdx = Math.floor(dayIdx / 7);
      if (weekIdx >= 0 && weekIdx < values.length) values[weekIdx] += tx.amount;
    });
    const max = Math.max(1, ...values);
    return {
      kind: 'week' as const,
      labels: values.map((_, i) => `W${i + 1}`),
      values,
      max,
    };
  }, [filterKey, reportTxs, currPredicate, rangeInfo, DAY_MS, daysInPeriod]);

  const filterChips = DATE_FILTER_CHIPS;

  const handleSelectFilterChip = (key: FilterKey) => {
    setShowCustomStartPicker(false);
    setShowCustomEndPicker(false);
    if (key !== 'custom') {
      // Close pickers when switching away from custom.
      setDraftCustomStart(customStart);
      setDraftCustomEnd(customEnd);
    }
    setFilterKey(key);

    if (key === 'custom') {
      setDraftCustomStart(customStart);
      setDraftCustomEnd(customEnd);
      setShowCustomStartPicker(true);
    }

    if (key === 'year') {
      setShowYearPicker(true);
    }

    if (key === 'multiMonth' && selectedMonths.length === 0) {
      setSelectedMonths([now.getMonth()]);
    }
  };

  const handleExportPDF = async () => {
    // Gate: PDF export requires Family or above (doc §5.1 — "PDF export attempt").
    const gate = checkFlag('pdfReports');
    if (!gate.allowed) {
      presentPaywall(gate.triggerKey ?? 'pdfExport');
      return;
    }
    try {
      const html = `
        <!DOCTYPE html>
        <html>
          <head>
            <meta charset="utf-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;800&display=swap" rel="stylesheet">
            <style>
              :root {
                --primary: #6366F1;
                --primary-light: #EEF2FF;
                --text-main: #1E293B;
                --text-muted: #64748B;
                --bg: #F8FAFC;
                --card-bg: #FFFFFF;
                --border: #E2E8F0;
              }
              body {
                font-family: 'Inter', -apple-system, sans-serif;
                background-color: var(--bg);
                color: var(--text-main);
                margin: 0;
                padding: 40px 20px;
                line-height: 1.5;
              }
              .container { max-width: 800px; margin: 0 auto; }
              .header {
                display: flex;
                justify-content: space-between;
                align-items: flex-end;
                margin-bottom: 40px;
                padding-bottom: 20px;
                border-bottom: 1px solid var(--border);
              }
              .header-left h1 { margin: 0; font-size: 28px; font-weight: 800; color: var(--primary); letter-spacing: -0.5px; }
              .header-left p { margin: 4px 0 0; color: var(--text-muted); font-size: 14px; }
              .header-right { text-align: right; color: var(--text-muted); font-size: 12px; font-weight: 600; text-transform: uppercase; }

              .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 30px; }
              
              .score-card {
                grid-column: span 2;
                background: linear-gradient(135deg, #6366F1 0%, #4F46E5 100%);
                border-radius: 24px;
                padding: 30px;
                text-align: center;
                color: white;
                box-shadow: 0 10px 25px -5px rgba(79, 70, 229, 0.2);
              }
              .score-label { font-size: 14px; font-weight: 600; opacity: 0.9; text-transform: uppercase; letter-spacing: 1px; }
              .score-value { font-size: 64px; font-weight: 800; margin: 10px 0; }
              .score-desc { font-size: 14px; opacity: 0.8; max-width: 400px; margin: 0 auto; }

              .stat-card {
                background: var(--card-bg);
                padding: 24px;
                border-radius: 20px;
                border: 1px solid var(--border);
              }
              .stat-label { font-size: 12px; font-weight: 700; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 8px; }
              .stat-value { font-size: 24px; font-weight: 700; color: var(--text-main); }
              .stat-sub { font-size: 12px; color: var(--text-muted); margin-top: 4px; }

              .section { margin-top: 40px; }
              .section-header { display: flex; align-items: center; gap: 12px; margin-bottom: 20px; }
              .section-title { font-size: 18px; font-weight: 700; color: var(--text-main); }
              .section-line { flex: 1; height: 1px; background: var(--border); }

              .chart-container { background: var(--card-bg); padding: 24px; border-radius: 20px; border: 1px solid var(--border); }
              .chart-row { display: flex; align-items: center; margin-bottom: 16px; gap: 16px; }
              .chart-label { width: 120px; font-size: 13px; font-weight: 600; color: var(--text-main); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
              .chart-bar-wrap { flex: 1; height: 12px; background: var(--primary-light); border-radius: 6px; overflow: hidden; }
              .chart-bar-fill { height: 100%; border-radius: 6px; background: var(--primary); }
              .chart-value { width: 100px; text-align: right; font-size: 13px; font-weight: 700; color: var(--text-main); }

              table { width: 100%; border-collapse: separate; border-spacing: 0; }
              th { text-align: left; padding: 12px 16px; font-size: 11px; font-weight: 700; color: var(--text-muted); text-transform: uppercase; border-bottom: 1px solid var(--border); }
              td { padding: 16px; font-size: 14px; border-bottom: 1px solid var(--border); vertical-align: middle; }
              .tr-merchant { font-weight: 600; color: var(--text-main); }
              .tr-category { font-size: 12px; color: var(--text-muted); background: var(--primary-light); padding: 4px 8px; border-radius: 6px; }

              .footer { text-align: center; margin-top: 60px; padding-top: 30px; border-top: 1px solid var(--border); color: var(--text-muted); font-size: 12px; }
            </style>
          </head>
          <body>
            <div class="container">
              <div class="header">
                <div class="header-left">
                  <h1>LifeWise Intelligence</h1>
                  <p>Financial Experience Report • ${rangeInfo.label}</p>
                </div>
                <div class="header-right">
                  Generated ${new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
                </div>
              </div>

              <div class="grid">
                <div class="score-card">
                  <div class="score-label">Active Life Score</div>
                  <div class="score-value">${lifeScoreDisplay}</div>
                  <div class="score-desc">Based on spending patterns, bill compliance, and health habit consistency for the selected period.</div>
                </div>

                <div class="stat-card">
                  <div class="stat-label">Total Outflow</div>
                  <div class="stat-value">${formatAmount(totalSpent)}</div>
                  <div class="stat-sub">Across ${reportTxs.filter(t => t.isDebit).length} transactions</div>
                </div>

                <div class="stat-card">
                  <div class="stat-label">Total Inflow</div>
                  <div class="stat-value">${formatAmount(totalIncome)}</div>
                  <div class="stat-sub">From ${reportTxs.filter(t => !t.isDebit).length} sources</div>
                </div>

                <div class="stat-card">
                  <div class="stat-label">Bill Adherence</div>
                  <div class="stat-value">${paidBills.length} / ${reportBills.length}</div>
                  <div class="stat-sub">${reportBills.length > 0 ? Math.round((paidBills.length / reportBills.length) * 100) : 100}% compliance rate</div>
                </div>

                <div class="stat-card">
                  <div class="stat-label">Habit Consistency</div>
                  <div class="stat-value">${Math.round(habitsConsistency * 100)}%</div>
                  <div class="stat-sub">${medicinesTaken} medicines logged</div>
                </div>
              </div>

              <div class="section">
                <div class="section-header">
                  <div class="section-title">Spending Architecture</div>
                  <div class="section-line"></div>
                </div>
                <div class="chart-container">
                  ${breakdown.map(cat => `
                    <div class="chart-row">
                      <div class="chart-label">${cat.category.charAt(0).toUpperCase() + cat.category.slice(1)}</div>
                      <div class="chart-bar-wrap">
                        <div class="chart-bar-fill" style="width: ${cat.percentage}%"></div>
                      </div>
                      <div class="chart-value">${formatAmount(cat.total)}</div>
                    </div>
                  `).join('')}
                </div>
              </div>

              <div class="section">
                <div class="section-header">
                  <div class="section-title">Velocity Analysis (Top Merchants)</div>
                  <div class="section-line"></div>
                </div>
                <div class="stat-card" style="padding: 0; overflow: hidden;">
                  <table>
                    <thead>
                      <tr>
                        <th>Merchant / Service</th>
                        <th>Category</th>
                        <th style="text-align: center;">Frequency</th>
                        <th style="text-align: right;">Volume</th>
                      </tr>
                    </thead>
                    <tbody>
                      ${merchantTotals.map(([name, data]) => `
                        <tr>
                          <td class="tr-merchant">${name}</td>
                          <td><span class="tr-category">${data.category}</span></td>
                          <td style="text-align: center;">${data.count} tx</td>
                          <td style="text-align: right; font-weight: 700;">${formatAmount(data.total)}</td>
                        </tr>
                      `).join('')}
                    </tbody>
                  </table>
                </div>
              </div>

              <div class="footer">
                <p>This is a system-generated financial intelligence report from LifeWise App.</p>
                <p>© ${new Date().getFullYear()} LifeWise • Secure Financial Companion</p>
              </div>
            </div>
          </body>
        </html>
      `;

      const { uri } = await Print.printToFileAsync({ html });
      await Sharing.shareAsync(uri, { UTI: '.pdf', mimeType: 'application/pdf' });
    } catch (e) {
      console.error('PDF Export Error:', e);
    }
  };

  if (isLoading) {
    return (
      <View style={[styles.container, styles.centered, { backgroundColor: colors.bg }]}>
        <PremiumLoader size={60} text="Generating Report..." />
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
          <View style={styles.reportsTitleRow}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.screenTitle, { color: colors.text }]}>Reports</Text>
              <Text style={[styles.screenSubtitle, { color: colors.textTertiary }]} numberOfLines={2}>
                {rangeInfo.label} • vs {rangeInfo.prevShortLabel}
              </Text>
            </View>
            <Pressable 
              onPress={handleExportPDF}
              style={({ pressed }) => [
                styles.exportBtnHeader,
                pressed && { opacity: 0.8, transform: [{ scale: 0.97 }] }
              ]}
            >
              <LinearGradient
                colors={['#6366F1', '#4F46E5']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.exportBtnGradient}
              >
                <Ionicons name="document-text" size={18} color="#FFF" />
                <Text style={styles.exportBtnText}>PDF Report</Text>
              </LinearGradient>
            </Pressable>
          </View>

          <View style={styles.filterChipsRow}>
            <Pressable
              onPress={() => setShowFilterModal(true)}
              style={[styles.filterButton, { backgroundColor: colors.card, borderColor: colors.border }]}
            >
              <Ionicons name="options-outline" size={18} color={colors.accent} />
              <Text style={[styles.filterButtonText, { color: colors.text }]} numberOfLines={1}>
                {rangeInfo.label}
              </Text>
              <Ionicons name="chevron-down" size={16} color={colors.textTertiary} />
            </Pressable>
          </View>

          {/* Custom Date Start Picker */}
          <DatePickerModal
            visible={showCustomStartPicker}
            onClose={() => setShowCustomStartPicker(false)}
            title="Select Start Date"
            value={draftCustomStart}
            onConfirm={(d) => {
              const fixedStart = new Date(d);
              fixedStart.setHours(0, 0, 0, 0);
              setDraftCustomStart(fixedStart);
              setCustomStart(fixedStart);
              // Keep the range valid: a start after the current end would
              // otherwise produce an empty report with no explanation.
              if (fixedStart.getTime() > customEnd.getTime()) {
                setCustomEnd(endOfDay(fixedStart));
              }
            }}
          />

          {/* Custom Date End Picker */}
          <DatePickerModal
            visible={showCustomEndPicker}
            onClose={() => setShowCustomEndPicker(false)}
            title="Select End Date"
            value={draftCustomEnd}
            onConfirm={(d) => {
              const fixedEnd = new Date(d);
              fixedEnd.setHours(23, 59, 59, 999);
              setDraftCustomEnd(fixedEnd);
              setCustomEnd(fixedEnd);
              if (customStart.getTime() > fixedEnd.getTime()) {
                setCustomStart(startOfDay(fixedEnd));
              }
            }}
          />

        </Animated.View>

        {/* Filter popup — all range filters live here, opened by the Filter button */}
        <CustomModal visible={showFilterModal} onClose={() => setShowFilterModal(false)}>
          <Text style={[styles.modalTitle, { color: colors.text }]}>Filter Reports</Text>

          <Text style={[styles.filterSectionLabel, { color: colors.textTertiary }]}>Time range</Text>
          <View style={styles.filterModalChipsWrap}>
            {filterChips.map((chip) => {
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
                  <Ionicons
                    name={chip.icon as any}
                    size={16}
                    color={active ? colors.accent : colors.textTertiary}
                  />
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
                  setDraftCustomStart(customStart);
                  setDraftCustomEnd(customEnd);
                  setShowCustomEndPicker(false);
                  setShowCustomStartPicker(true);
                }}
              >
                <View style={{ flex: 1 }}>
                  <Text style={[styles.customChipLabel, { color: colors.textTertiary }]}>Start date</Text>
                  <Text style={[styles.customChipValue, { color: colors.text }]}>
                    {customStart.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                  </Text>
                </View>
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
                <View style={{ flex: 1 }}>
                  <Text style={[styles.customChipLabel, { color: colors.textTertiary }]}>End Date</Text>
                  <Text style={[styles.customChipValue, { color: colors.text }]}>
                    {customEnd.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                  </Text>
                </View>
              </Pressable>
            </View>
          )}

          {(filterKey === 'month' || filterKey === 'multiMonth') && (
            <View style={{ marginTop: 12 }}>
              <Pressable
                onPress={() => setShowYearPicker(true)}
                style={[styles.yearPill, { backgroundColor: colors.card, borderColor: colors.border }]}
              >
                <Ionicons name="calendar-outline" size={14} color={colors.textSecondary} />
                <Text style={[styles.yearPillText, { color: colors.text }]}>Year: {selectedYear}</Text>
                <Ionicons name="chevron-down" size={14} color={colors.textTertiary} />
              </Pressable>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.monthRow}
              >
                {MONTHS.map((m, idx) => {
                  const isSelected = selectedMonths.includes(idx);
                  return (
                    <Pressable
                      key={m}
                      onPress={() => {
                        if (filterKey === 'month') {
                          setSelectedMonths([idx]);
                          return;
                        }
                        setSelectedMonths((prev) => {
                          if (prev.includes(idx)) {
                            const next = prev.filter((x) => x !== idx);
                            return next.length ? next : prev; // keep at least one selected
                          }
                          const next = [...prev, idx].sort((a, b) => a - b);
                          return next;
                        });
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
            </View>
          )}

          <Pressable
            onPress={() => setShowFilterModal(false)}
            style={[styles.filterDoneBtn, { backgroundColor: colors.accent }]}
          >
            <Text style={styles.filterDoneBtnText}>Apply</Text>
          </Pressable>
        </CustomModal>

        <DatePickerModal
          visible={showYearPicker}
          onClose={() => setShowYearPicker(false)}
          title="Pick year"
          value={new Date(selectedYear, 0, 1)}
          onConfirm={(d) => setSelectedYear(d.getFullYear())}
        />

        <Animated.View entering={Platform.OS !== 'web' ? FadeInDown.delay(200).duration(500) : undefined}>
          <LinearGradient
            colors={colors.heroGradient as unknown as [string, string, ...string[]]}
            style={[styles.summaryCard, { borderColor: colors.accent + '15' }]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
          >
            <View style={styles.summaryTop }>
              <View style={{ flex: 1 }}>
                <Text style={[styles.summaryLabel, { color: isDark ? 'rgba(255,255,255,0.5)' : 'rgba(0,0,0,0.45)' }]}>Total Spending</Text>
                <Money style={[styles.summaryAmount, { color: colors.text }]}>{formatAmount(totalSpent)}</Money>
                <Text style={[styles.deltaText, { color: colors.textTertiary, lineHeight: 18 }]}>
                  Spent {comparison.spentDelta >= 0 ? '+' : '-'}
                  {formatAmount(Math.abs(comparison.spentDelta))} vs {rangeInfo.prevLabel}{'\n'}
                  Reminders {comparison.remindersDelta >= 0 ? '+' : ''}{comparison.remindersDelta} • 
                  LifeScore {comparison.lifeScoreDelta >= 0 ? '+' : ''}{comparison.lifeScoreDelta}
                </Text>
              </View>
              <View style={[styles.scoreCircle, { borderColor: colors.accentDim, backgroundColor: colors.accentDim }]}>
                <Text style={[styles.scoreValue, { color: colors.accent }]}>{lifeScoreDisplay}</Text>
                <Text style={[styles.scoreLabel, { color: colors.accent + 'AA' }]}>{lifeScoreLabel}</Text>
              </View>
            </View>

            <View style={[styles.summaryDivider, { backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)' }]} />

            <View style={styles.summaryStats}>
              <View style={styles.summaryStat}>
                <View style={[styles.statIconWrap, { backgroundColor: colors.accentBlueDim }]}>
                  <Ionicons name="checkmark-circle" size={16} color={colors.accentBlue} />
                </View>
                <Text style={[styles.summaryStatValue, { color: colors.text }]}>{remindersCompleted}</Text>
                <Text style={[styles.summaryStatLabel, { color: colors.textTertiary }]}>Reminders Done</Text>
              </View>
              <View style={styles.summaryStat}>
                <View style={[styles.statIconWrap, { backgroundColor: colors.accentMintDim }]}>
                  <Ionicons name="medkit" size={16} color={colors.accentMint} />
                </View>
                <Text style={[styles.summaryStatValue, { color: colors.text }]}>
                  {isMedicinesLoading ? '…' : medicinesTaken}
                </Text>
                <Text style={[styles.summaryStatLabel, { color: colors.textTertiary }]}>Medicines Taken</Text>
              </View>
              <View style={styles.summaryStat}>
                <View style={[styles.statIconWrap, { backgroundColor: colors.warningDim }]}>
                  <Ionicons name="notifications" size={16} color={colors.warning} />
                </View>
                <Text style={[styles.summaryStatValue, { color: colors.text }]}>{billsDue}</Text>
                <Text style={[styles.summaryStatLabel, { color: colors.textTertiary }]}>Bills Due</Text>
              </View>
              <View style={styles.summaryStat}>
                <View style={[styles.statIconWrap, { backgroundColor: colors.accentDim }]}>
                  <Ionicons name="water" size={16} color={colors.accent} />
                </View>
                <Text style={[styles.summaryStatValue, { color: colors.text }]}>{habitsCompleted}</Text>
                <Text style={[styles.summaryStatLabel, { color: colors.textTertiary }]}>Habits Done</Text>
              </View>
            </View>
          </LinearGradient>
        </Animated.View>

        <Animated.View entering={Platform.OS !== 'web' ? FadeInDown.delay(260).duration(500) : undefined}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>Trend</Text>
          <View style={[styles.trendCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.trendSubtitle, { color: colors.textTertiary }]}>
              {trendBars.kind === 'hour'
                ? 'Hourly activity'
                : trendBars.kind === 'day'
                  ? 'Daily spending'
                  : 'Weekly spending'}
            </Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.trendRow}>
                {trendBars.values.map((v, idx) => {
                  const height = Math.round((v / trendBars.max) * 92) || 4;
                  return (
                    <View key={`${idx}`} style={styles.trendBarWrap}>
                      <View style={[styles.trendBar, { height, backgroundColor: colors.accentDim, borderColor: colors.accent + '30' }]}>
                        {v > 0 && <LinearGradient colors={[colors.accent, colors.accentDim]} style={{ flex: 1, borderRadius: 10 }} />}
                      </View>
                      <Text style={[styles.trendBarLabel, { color: colors.textTertiary }]} numberOfLines={1}>
                        {trendBars.labels[idx]}
                      </Text>
                    </View>
                  );
                })}
            </ScrollView>
          </View>
        </Animated.View>

        <Animated.View entering={Platform.OS !== 'web' ? FadeInDown.delay(300).duration(500) : undefined}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>Habits Performance</Text>
          <View style={[styles.dataCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={styles.habitsHeaderRow}>
              <View style={[styles.statIconWrap, { backgroundColor: colors.accentDim }]}>
                <Ionicons name="water" size={16} color={colors.accent} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.habitsBigValue, { color: colors.text }]}>
                  {habitsCompleted}/{habitsTotal}
                </Text>
                <Text style={[styles.habitsSmallLabel, { color: colors.textTertiary }]}>
                  Consistency: {habitConsistencyPct}%
                </Text>
              </View>
              <Text style={[styles.habitsPctText, { color: colors.accent }]}>{habitConsistencyPct}%</Text>
            </View>
            <View style={[styles.habitsBarTrack, { backgroundColor: colors.border }]}>
              <View
                style={[
                  styles.habitsBarFill,
                  {
                    width: `${habitConsistencyPct}%`,
                    backgroundColor: colors.accent,
                  },
                ]}
              />
            </View>
            <Text style={[styles.habitsFootnote, { color: colors.textSecondary, marginTop: 10 }]}>
              Based on habit-type reminders completed in this selected period.
            </Text>
          </View>
        </Animated.View>

        <Animated.View entering={Platform.OS !== 'web' ? FadeInDown.delay(340).duration(500) : undefined}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>Bills Payment Timeline</Text>
          <View style={[styles.dataCard, { backgroundColor: colors.card, borderColor: colors.border, padding: 14 }]}>
            {billsTimeline.dueCounts.every((n) => n === 0) ? (
              <View style={styles.emptyState}>
                <Text style={[styles.emptyText, { color: colors.textTertiary }]}>No bills due in this period</Text>
              </View>
            ) : (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.timelineRow}>
                {billsTimeline.dueCounts.map((due, idx) => {
                  const paid = billsTimeline.paidCounts[idx] ?? 0;
                  const totalH = Math.round((due / billsTimeline.maxDue) * 92) || 4;
                  const paidH = due > 0 ? Math.round((paid / due) * totalH) : 0;
                  const unpaidH = totalH - paidH;
                  return (
                    <View key={`bills-t-${idx}`} style={styles.timelineBarWrap}>
                      <View style={[styles.timelineBarStack, { height: totalH }]}>
                        <View style={[styles.timelineBarUnpaid, { height: unpaidH, backgroundColor: colors.border }]} />
                        {paidH > 0 ? (
                          <View style={[styles.timelineBarPaid, { height: paidH, backgroundColor: colors.accentMint }]} />
                        ) : null}
                      </View>
                      <Text style={[styles.timelineLabel, { color: colors.textTertiary }]} numberOfLines={1}>
                        {billsTimeline.labels[idx]}
                      </Text>
                      <Text style={[styles.timelineCounts, { color: colors.textSecondary }]}>
                        {paid}/{due} paid
                      </Text>
                    </View>
                  );
                })}
              </ScrollView>
            )}
          </View>
        </Animated.View>

        <Animated.View entering={Platform.OS !== 'web' ? FadeInDown.delay(380).duration(500) : undefined}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>Medicines Metrics</Text>
          <View style={[styles.dataCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={styles.medsHeaderRow}>
              <View style={[styles.statIconWrap, { backgroundColor: colors.accentMintDim }]}>
                <Ionicons name="medkit" size={16} color={colors.accentMint} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.medsBigValue, { color: colors.text }]}>
                  {isMedicinesLoading ? 'Loading…' : `${medicinesTaken}/${medicines.length}`}
                </Text>
                <Text style={[styles.medsSmallLabel, { color: colors.textTertiary }]}>
                  Taken ratio: {medicinesTakenRatioPct}%
                </Text>
              </View>
              <Text style={[styles.medsPctText, { color: colors.accentMint }]}>
                {medicinesTakenRatioPct}%
              </Text>
            </View>
            <Text style={[styles.habitsFootnote, { color: colors.textSecondary, marginTop: 10 }]}>
              Intelligence-driven health adherence calculated from real-time medicine intake and status tracking.
            </Text>
          </View>
        </Animated.View>

        <Animated.View entering={Platform.OS !== 'web' ? FadeInDown.delay(300).duration(500) : undefined}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>Category Breakdown</Text>
          <View style={[styles.dataCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            {breakdown.length === 0 && (
              <View style={styles.emptyState}>
                <Text style={[styles.emptyText, { color: colors.textTertiary }]}>No transactions for this filter</Text>
              </View>
            )}
            {breakdown.map((item, idx) => (
              <React.Fragment key={item.category}>
                <CategoryBar
                  category={item.category}
                  total={item.total}
                    percentage={item.percentage}
                    maxPercentage={maxPercentage}
                    colors={colors}
                    isDark={isDark}
                    formatAmount={formatAmount}
                    isSeniorMode={isSeniorMode}
                  />
                {idx < breakdown.length - 1 && <View style={[styles.divider, { backgroundColor: colors.border }]} />}
              </React.Fragment>
            ))}
          </View>
        </Animated.View>

        <Animated.View entering={Platform.OS !== 'web' ? FadeInDown.delay(400).duration(500) : undefined}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>Top Merchants</Text>
          <View style={[styles.dataCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            {merchantTotals.length === 0 && (
              <View style={styles.emptyState}>
                <Text style={[styles.emptyText, { color: colors.textTertiary }]}>No merchants for this filter</Text>
              </View>
            )}
            {merchantTotals.map(([merchant, data], idx) => {
              const cat = CATEGORIES[data.category as CategoryType] || CATEGORIES.others;
              return (
                <React.Fragment key={merchant}>
                  <View style={styles.merchantRow}>
                    <View style={[styles.merchantIcon, { backgroundColor: cat.color + '15' }]}>
                      <Ionicons name={cat.icon as any} size={18} color={cat.color} />
                    </View>
                    <View style={styles.merchantInfo}>
                      <Text style={[styles.merchantName, { color: colors.text }]} numberOfLines={1}>{merchant}</Text>
                      <Text style={[styles.merchantCount, { color: colors.textTertiary }]}>{data.count} transactions</Text>
                    </View>
                    <Money style={[styles.merchantAmount, { color: colors.text }]}>{formatAmount(data.total)}</Money>
                  </View>
                  {idx < merchantTotals.length - 1 && <View style={[styles.divider, { backgroundColor: colors.border }]} />}
                </React.Fragment>
              );
            })}
          </View>
        </Animated.View>
      </ScrollView>
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
  screenTitle: {
    fontFamily: 'Inter_700Bold',
    fontSize: 30,
    letterSpacing: -0.5,
    marginBottom: 4,
  },
  screenSubtitle: {
    fontFamily: 'Inter_400Regular',
    fontSize: 14,
    marginBottom: 10,
  },
  monthRow: {
    gap: 8,
    marginTop: 0,
    marginBottom: 18,
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
  monthPickerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderWidth: 1,
    borderRadius: 16,
    paddingVertical: 10,
    paddingHorizontal: 14,
  },
  monthPickerHeaderText: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 13,
  },
  monthChip: {
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 24,
    borderWidth: 1,
  },
  monthChipDisabled: {
    opacity: 0.3,
  },
  monthChipText: {
    fontFamily: 'Inter_500Medium',
    fontSize: 13,
    borderRadius: 16,
  },
  summaryCard: {
    borderRadius: 24,
    padding: 24,
    marginBottom: 32,
    marginTop: 12,
    borderWidth: 1,
  },
  summaryTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  deltaText: {
    fontFamily: 'Inter_500Medium',
    fontSize: 12,
    marginTop: 8,
  },
  summaryLabel: {
    fontFamily: 'Inter_500Medium',
    fontSize: 12,
    letterSpacing: 1.2,
    marginBottom: 6,
  },
  summaryAmount: {
    fontFamily: 'Inter_700Bold',
    fontSize: 32,
    letterSpacing: -0.5,
  },
  savingsCircle: {
    width: 76,
    height: 76,
    borderRadius: 38,
    borderWidth: 2.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scoreCircle: {
    width: 88,
    height: 88,
    borderRadius: 44,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 2,
  },
  scoreValue: {
    fontFamily: 'Inter_800ExtraBold',
    fontSize: 24,
    lineHeight: 28,
  },
  scoreLabel: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 8,
    marginTop: 0,
    textAlign: 'center',
    paddingHorizontal: 2,
  },
  savingsValue: {
    fontFamily: 'Inter_700Bold',
    fontSize: 20,
  },
  savingsLabel: {
    fontFamily: 'Inter_400Regular',
    fontSize: 10,
    marginTop: 1,
  },
  summaryDivider: {
    height: 1,
    borderRadius: 1,
  },
  summaryStats: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingTop: 24,
    flexWrap: 'wrap',
    rowGap: 20,
    columnGap: 10,
  },
  summaryStat: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    width: '46%',
  },
  statIconWrap: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  summaryStatValue: {
    fontFamily: 'Inter_700Bold',
    fontSize: 18,
    textAlign: 'center',
  },
  summaryStatLabel: {
    fontFamily: 'Inter_500Medium',
    fontSize: 11,
    textAlign: 'center',
  },
  sectionTitle: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 18,
    marginBottom: 10,
    letterSpacing: -0.2,
  },
  dataCard: {
    borderRadius: 16,
    padding: 14,
    marginBottom: 18,
    borderWidth: 1,
  },
  trendCard: {
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    marginBottom: 18,
  },
  trendSubtitle: {
    fontFamily: 'Inter_500Medium',
    fontSize: 13,
    marginBottom: 12,
  },
  trendRow: {
    gap: 10,
    paddingBottom: 8,
  },
  trendBarWrap: {
    width: 26,
    alignItems: 'center',
    justifyContent: 'flex-end',
  },
  trendBar: {
    width: 12,
    borderRadius: 10,
    borderWidth: 1,
  },
  trendBarLabel: {
    fontFamily: 'Inter_400Regular',
    fontSize: 10,
    marginTop: 6,
    textAlign: 'center',
  },
  catBarRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    paddingHorizontal: 14,
  },
  catBarLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  catBarIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  catBarInfo: {
    flex: 1,
  },
  catBarName: {
    fontFamily: 'Inter_500Medium',
    fontSize: 14,
  },
  catBarPercent: {
    fontFamily: 'Inter_400Regular',
    fontSize: 11,
    marginTop: 3,
  },
  catBarRight: {
    flex: 1,
    alignItems: 'flex-end',
    gap: 8,
  },
  catBarTrack: {
    width: '85%',
    height: 6,
    borderRadius: 3,
    overflow: 'hidden',
  },
  catBarFill: {
    height: '100%',
    borderRadius: 3,
  },
  catBarAmount: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 14,
  },
  divider: {
    height: 1,
    marginHorizontal: 14,
  },
  merchantRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 14,
  },
  merchantIcon: {
    width: 42,
    height: 42,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  merchantInfo: {
    flex: 1,
  },
  merchantName: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 15,
  },
  merchantCount: {
    fontFamily: 'Inter_400Regular',
    fontSize: 11,
    marginTop: 3,
  },
  merchantAmount: {
    fontFamily: 'Inter_700Bold',
    fontSize: 16,
  },
  emptyState: {
    paddingVertical: 32,
    alignItems: 'center',
  },
  emptyText: {
    fontFamily: 'Inter_400Regular',
    fontSize: 14,
  },

  // --- Extra cards (Habits/Bills/Medicines) ---
  habitsHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  habitsBigValue: {
    fontFamily: 'Inter_800ExtraBold',
    fontSize: 20,
  },
  habitsSmallLabel: {
    fontFamily: 'Inter_500Medium',
    fontSize: 12,
    marginTop: 2,
  },
  habitsPctText: {
    fontFamily: 'Inter_800ExtraBold',
    fontSize: 16,
  },
  habitsBarTrack: {
    marginTop: 14,
    height: 10,
    borderRadius: 999,
    backgroundColor: '#E5E7EB',
    overflow: 'hidden',
  },
  habitsBarFill: {
    height: '100%',
    borderRadius: 999,
  },
  habitsFootnote: {
    fontFamily: 'Inter_400Regular',
    fontSize: 12,
    lineHeight: 16,
  },

  timelineRow: {
    gap: 12,
    paddingBottom: 6,
  },
  timelineBarWrap: {
    width: 46,
    alignItems: 'center',
  },
  timelineBarStack: {
    width: 14,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: 'rgba(229,231,235,0.5)',
    overflow: 'hidden',
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.03)',
  },
  timelineBarUnpaid: {
    width: '100%',
    borderTopLeftRadius: 10,
    borderTopRightRadius: 10,
  },
  timelineBarPaid: {
    width: '100%',
    borderTopLeftRadius: 10,
    borderTopRightRadius: 10,
  },
  timelineLabel: {
    fontFamily: 'Inter_400Regular',
    fontSize: 10,
    marginTop: 6,
  },
  timelineCounts: {
    fontFamily: 'Inter_500Medium',
    fontSize: 10,
    marginTop: 4,
  },

  medsHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  medsBigValue: {
    fontFamily: 'Inter_800ExtraBold',
    fontSize: 20,
  },
  medsSmallLabel: {
    fontFamily: 'Inter_500Medium',
    fontSize: 12,
    marginTop: 4,
    lineHeight: 16,
  },
  medsPctText: {
    fontFamily: 'Inter_800ExtraBold',
    fontSize: 16,
  },
  // --- Report filter UI ---
  modeRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 8,
  },
  modeChip: {
    flex: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 10,
    borderRadius: 16,
    borderWidth: 1,
    minWidth: 150,
  },
  modeChipText: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 12,
  },
  pickRow: {
    marginTop: 0,
    borderRadius: 16,
    paddingVertical: 12,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderWidth: 1,
  },
  pickRowText: {
    flex: 1,
    fontFamily: 'Inter_500Medium',
    fontSize: 13,
  },

  filterScrollRow: {
    gap: 10,
    paddingBottom: 8,
  },

  customRangeWrap: {
    marginTop: 6,
    gap: 8,
    paddingVertical: 0,
    borderRadius: 16,
    borderWidth: 0,
  },

  customRangeLabel: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 12,
    marginTop: 4,
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

  // --- Time Filter Selector ---
  reportsTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    marginBottom: 6,
  },
  filterChipsRow: {
    marginBottom: 8,
  },
  filterChipsScroll: {
    gap: 10,
    paddingVertical: 4,
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
    flex: 1,
    fontFamily: 'Inter_600SemiBold',
    fontSize: 14,
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
  exportBtnHeader: {
    borderRadius: 16,
    overflow: 'hidden',
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.2)',
  },
  exportBtnGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 16,
    gap: 8,
  },
  exportBtnText: {
    fontSize: 14,
    color: '#FFF',
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
  filterIconBtn: {
    width: 42,
    height: 42,
    borderRadius: 14,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  filterSelectorWrap: {
    marginTop: 8,
    marginBottom: 18,
  },
  filterSelectorLabel: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 12,
    marginBottom: 8,
    marginLeft: 4,
  },
  filterSelectorRow: {
    borderWidth: 1,
    borderRadius: 16,
    paddingVertical: 12,
    paddingHorizontal: 12,
  },
  filterSelectorLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
  },
  filterSelectorTitle: {
    fontFamily: 'Inter_700Bold',
    fontSize: 14,
  },
  filterSelectorValue: {
    fontFamily: 'Inter_500Medium',
    fontSize: 12,
    marginTop: 2,
  },

  modalBackdropBottom: {
    flex: 1,
    backgroundColor: 'rgba(15,23,42,0.35)',
    alignItems: 'center',
    justifyContent: 'flex-end',
  },
  filterMenuSheet: {
    width: '100%',
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    borderWidth: 1,
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 16,
  },
  filterMenuHandle: {
    width: 56,
    height: 4,
    borderRadius: 999,
    alignSelf: 'center',
    backgroundColor: 'rgba(148,163,184,0.9)',
    marginBottom: 10,
  },
  filterMenuTitle: {
    fontFamily: 'Inter_700Bold',
    fontSize: 14,
    marginBottom: 12,
  },
  filterMenuItem: {
    borderWidth: 1,
    borderRadius: 16,
    paddingVertical: 12,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 10,
  },
  filterMenuItemText: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 13,
  },

  // --- Modal helpers ---
  modalBackdropCentered: {
    flex: 1,
    backgroundColor: 'rgba(15,23,42,0.18)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 18,
  },
  modalCardCentered: {
    width: '100%',
    borderRadius: 22,
    borderWidth: 1,
    padding: 16,
  },
  modalTitle: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 15,
    textAlign: 'center',
    marginBottom: 8,
  },
  modalActionsRow: {
    marginTop: 10,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  modalTextBtn: {
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 999,
  },
  modalTextBtnLabel: {
    fontFamily: 'Inter_500Medium',
    fontSize: 14,
  },
  modalPrimaryBtn: {
    borderRadius: 999,
    paddingVertical: 10,
    paddingHorizontal: 18,
  },
  modalPrimaryBtnLabel: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 14,
  },
});
