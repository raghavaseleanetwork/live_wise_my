import React, { useCallback, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@/lib/theme-context';
import { useAuth } from '@/lib/auth-context';
import { useCurrency } from '@/lib/currency-context';
import { useAlert } from '@/lib/alert-context';
import { useExpenses } from '@/lib/expense-context';
import { CATEGORIES } from '@/lib/data';
import Money from '@/components/Money';
import {
  DueRecurringExpense,
  RecurringExpense,
  deleteRecurringExpense,
  getDueRecurringExpenses,
  loadRecurringExpenses,
  markRecurringHandled,
} from '@/lib/recurring-expenses';
import { LoadingIndicator } from '@/components/PremiumLoader';

/**
 * Recurring Expenses — Method 6 in the product doc.
 *
 * Two jobs on one screen: confirm occurrences that have come due this month
 * (the top section, which is the part users actually interact with), and manage
 * the templates themselves (the list below).
 *
 * Templates sync via `/api/recurring`, so they survive reinstall and follow the
 * user across devices. Confirming a due occurrence writes a normal transaction;
 * nothing is ever added without the user's tap.
 */

export default function RecurringExpensesScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const { token } = useAuth();
  const { formatAmount } = useCurrency();
  const { showAlert } = useAlert();
  const { addTransaction } = useExpenses();
  const { t } = useTranslation();

  const [templates, setTemplates] = useState<RecurringExpense[]>([]);
  const [due, setDue] = useState<DueRecurringExpense[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const list = await loadRecurringExpenses(token);
    setTemplates(list);
    setDue(getDueRecurringExpenses(list));
    setIsLoading(false);
  }, [token]);

  // Refetch on focus so a template saved on the add page appears on return.
  useFocusEffect(useCallback(() => { refresh(); }, [refresh]));

  const openAddTemplate = useCallback(() => {
    router.push('/add-recurring-expense');
  }, [router]);

  /** Log the due occurrence as a real expense, then stop offering it this month. */
  const handleConfirmDue = useCallback(
    async (item: DueRecurringExpense) => {
      setConfirmingId(item.template.id);
      const created = await addTransaction({
        merchant: item.template.name,
        amount: item.template.amount,
        category: item.template.category,
        date: item.dueDate.toISOString(),
        memberId: item.template.memberId ?? null,
        paymentMode: item.template.paymentMode,
        description: 'Recurring expense',
        source: 'recurring',
      });
      setConfirmingId(null);

      if (!created) {
        showAlert({
          title: t('recurringExpenses.couldNotSaveTitle'),
          message: t('recurringExpenses.couldNotSaveMessage'),
          type: 'error',
        });
        return;
      }
      await markRecurringHandled(token, item.template.id, item.period);
      await refresh();
    },
    [addTransaction, showAlert, refresh, token, t],
  );

  /**
   * Record a template immediately, whether or not its due date has arrived.
   * Dated today rather than the template's dayOfMonth — the user is telling us
   * they spent it now, and back-dating to a day that hasn't happened would be
   * wrong. Does not touch lastHandledPeriod, so an upcoming due-date prompt
   * still appears as normal.
   */
  const handleLogNow = useCallback(
    async (template: RecurringExpense) => {
      setConfirmingId(template.id);
      const created = await addTransaction({
        merchant: template.name,
        amount: template.amount,
        category: template.category,
        date: new Date().toISOString(),
        memberId: template.memberId ?? null,
        paymentMode: template.paymentMode,
        description: 'Recurring expense',
        source: 'recurring',
      });
      setConfirmingId(null);

      if (!created) {
        showAlert({
          title: t('recurringExpenses.couldNotSaveTitle'),
          message: t('recurringExpenses.couldNotSaveConnectionMessage'),
          type: 'error',
        });
        return;
      }
      showAlert({
        title: t('recurringExpenses.expenseRecordedTitle'),
        message: `${formatAmount(template.amount)} · ${template.name}`,
        type: 'success',
      });
      await refresh();
    },
    [addTransaction, showAlert, formatAmount, refresh, t],
  );

  /** Dismiss this month's occurrence without recording an expense. */
  const handleSkipDue = useCallback(
    async (item: DueRecurringExpense) => {
      await markRecurringHandled(token, item.template.id, item.period);
      await refresh();
    },
    [refresh, token],
  );

  const handleDelete = useCallback(
    (template: RecurringExpense) => {
      showAlert({
        title: t('recurringExpenses.deleteTemplateTitle'),
        message: t('recurringExpenses.deleteTemplateMessage', { name: template.name }),
        type: 'warning',
        buttons: [
          { text: t('common.cancel'), style: 'cancel' },
          {
            text: t('common.delete'),
            style: 'destructive',
            onPress: async () => {
              await deleteRecurringExpense(token, template.id);
              await refresh();
            },
          },
        ],
      });
    },
    [showAlert, refresh, token, t],
  );

  return (
    <View style={[styles.root, { backgroundColor: colors.bg, paddingTop: insets.top }]}>
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <Pressable onPress={() => router.back()} hitSlop={12} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={24} color={colors.text} />
        </Pressable>
        <Text style={[styles.headerTitle, { color: colors.text }]}>{t('recurringExpenses.headerTitle')}</Text>
        <Pressable onPress={openAddTemplate} hitSlop={12} style={styles.backBtn}>
          <Ionicons name="add" size={24} color={colors.accent} />
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={[styles.body, { paddingBottom: insets.bottom + 32 }]}
        showsVerticalScrollIndicator={false}
      >
        {isLoading ? (
          <LoadingIndicator style={{ marginTop: 40 }} color={colors.accent} />
        ) : (
          <>
            {/* Due this month — the actionable part. */}
            {due.length > 0 && (
              <>
                <Text style={[styles.sectionTitle, { color: colors.text }]}>{t('recurringExpenses.dueNow')}</Text>
                {due.map((item) => (
                  <View
                    key={item.template.id}
                    style={[styles.dueCard, { backgroundColor: colors.card, borderColor: colors.warning + '55' }]}
                  >
                    <View style={styles.dueTop}>
                      <View
                        style={[
                          styles.iconWrap,
                          { backgroundColor: CATEGORIES[item.template.category].color + '1F' },
                        ]}
                      >
                        <Ionicons
                          name={CATEGORIES[item.template.category].icon as any}
                          size={18}
                          color={CATEGORIES[item.template.category].color}
                        />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={[styles.dueName, { color: colors.text }]} numberOfLines={1}>
                          {item.template.name}
                        </Text>
                        <Text style={[styles.dueMeta, { color: colors.textTertiary }]}>
                          {t('recurringExpenses.dueOn', { date: item.dueDate.toLocaleDateString('en-IN') })}
                        </Text>
                      </View>
                      <Money style={[styles.dueAmount, { color: colors.text }]}>
                        {formatAmount(item.template.amount)}
                      </Money>
                    </View>
                    <View style={styles.dueActions}>
                      <Pressable
                        onPress={() => handleSkipDue(item)}
                        style={[styles.skipBtn, { borderColor: colors.border }]}
                      >
                        <Text style={[styles.skipText, { color: colors.textSecondary }]}>{t('recurringExpenses.skip')}</Text>
                      </Pressable>
                      <Pressable
                        onPress={() => handleConfirmDue(item)}
                        disabled={confirmingId === item.template.id}
                        style={[styles.confirmBtn, { backgroundColor: colors.accent }]}
                      >
                        {confirmingId === item.template.id ? (
                          <LoadingIndicator size="small" color="#FFFFFF" />
                        ) : (
                          <Text style={styles.confirmText}>{t('recurringExpenses.confirm')}</Text>
                        )}
                      </Pressable>
                    </View>
                  </View>
                ))}
              </>
            )}

            <Text style={[styles.sectionTitle, { color: colors.text, marginTop: due.length ? 24 : 0 }]}>
              {t('recurringExpenses.templates')}
            </Text>

            {templates.length === 0 ? (
              <View style={[styles.empty, { borderColor: colors.border }]}>
                <Ionicons name="repeat" size={30} color={colors.textTertiary} />
                <Text style={[styles.emptyTitle, { color: colors.text }]}>{t('recurringExpenses.emptyTitle')}</Text>
                <Text style={[styles.emptyText, { color: colors.textTertiary }]}>
                  {t('recurringExpenses.emptyText')}
                </Text>
                <Pressable
                  onPress={openAddTemplate}
                  style={[styles.emptyBtn, { backgroundColor: colors.accent }]}
                >
                  <Text style={styles.emptyBtnText}>{t('recurringExpenses.addOne')}</Text>
                </Pressable>
              </View>
            ) : (
              templates.map((tpl) => (
                <View
                  key={tpl.id}
                  style={[styles.row, { backgroundColor: colors.card, borderColor: colors.border }]}
                >
                  <View style={[styles.iconWrap, { backgroundColor: CATEGORIES[tpl.category].color + '1F' }]}>
                    <Ionicons
                      name={CATEGORIES[tpl.category].icon as any}
                      size={18}
                      color={CATEGORIES[tpl.category].color}
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.rowName, { color: colors.text }]} numberOfLines={1}>
                      {tpl.name}
                    </Text>
                    <Text style={[styles.rowMeta, { color: colors.textTertiary }]}>
                      {t('recurringExpenses.dayOfMonth', { day: tpl.dayOfMonth })} · {CATEGORIES[tpl.category].label}
                    </Text>
                  </View>
                  <Money style={[styles.rowAmount, { color: colors.text }]}>{formatAmount(tpl.amount)}</Money>
                  {/*
                    Log on demand. "Due now" only lists templates whose day has
                    already passed this month, so without this a template due
                    later is un-actionable and looks broken.
                  */}
                  <Pressable
                    onPress={() => handleLogNow(tpl)}
                    disabled={confirmingId === tpl.id}
                    hitSlop={8}
                    style={{ marginLeft: 10 }}
                  >
                    {confirmingId === tpl.id ? (
                      <LoadingIndicator size="small" color={colors.accent} />
                    ) : (
                      <Ionicons name="add-circle-outline" size={19} color={colors.accent} />
                    )}
                  </Pressable>
                  <Pressable onPress={() => handleDelete(tpl)} hitSlop={8} style={{ marginLeft: 10 }}>
                    <Ionicons name="trash-outline" size={17} color={colors.danger} />
                  </Pressable>
                </View>
              ))
            )}

            <Text style={[styles.note, { color: colors.textTertiary }]}>
              {t('recurringExpenses.noteTapToRecord')}
            </Text>
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  backBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 16, fontWeight: '700' },
  body: { padding: 16 },
  sectionTitle: { fontSize: 14, fontWeight: '700', marginBottom: 10 },
  dueCard: { borderRadius: 14, borderWidth: 1, padding: 14, marginBottom: 10 },
  dueTop: { flexDirection: 'row', alignItems: 'center', gap: 11 },
  iconWrap: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  dueName: { fontSize: 14, fontWeight: '600' },
  dueMeta: { fontSize: 11, marginTop: 2 },
  dueAmount: { fontSize: 15, fontWeight: '700' },
  dueActions: { flexDirection: 'row', gap: 10, marginTop: 12 },
  skipBtn: {
    flex: 1,
    minHeight: 40,
    borderRadius: 11,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  skipText: { fontSize: 13, fontWeight: '600' },
  confirmBtn: {
    flex: 2,
    minHeight: 40,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  confirmText: { color: '#FFFFFF', fontSize: 13, fontWeight: '700' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    padding: 13,
    borderRadius: 13,
    borderWidth: 1,
    marginBottom: 9,
  },
  rowName: { fontSize: 14, fontWeight: '600' },
  rowMeta: { fontSize: 11, marginTop: 2 },
  rowAmount: { fontSize: 14, fontWeight: '700' },
  empty: { borderRadius: 14, borderWidth: 1, borderStyle: 'dashed', padding: 24, alignItems: 'center', gap: 8 },
  emptyTitle: { fontSize: 14, fontWeight: '700', marginTop: 4 },
  emptyText: { fontSize: 12, textAlign: 'center', lineHeight: 17 },
  emptyBtn: { paddingHorizontal: 20, paddingVertical: 10, borderRadius: 11, marginTop: 6 },
  emptyBtnText: { color: '#FFFFFF', fontSize: 13, fontWeight: '700' },
  note: { fontSize: 11, lineHeight: 16, marginTop: 18, textAlign: 'center' },
});
