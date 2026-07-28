import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '@/lib/theme-context';
import { useAuth } from '@/lib/auth-context';
import { useCurrency } from '@/lib/currency-context';
import { useAlert } from '@/lib/alert-context';
import { useExpenses } from '@/lib/expense-context';
import { CATEGORIES, CategoryType } from '@/lib/data';
import {
  DueRecurringExpense,
  RecurringExpense,
  deleteRecurringExpense,
  getDueRecurringExpenses,
  loadRecurringExpenses,
  markRecurringHandled,
  saveRecurringExpense,
} from '@/lib/recurring-expenses';
import CustomModal from '@/components/CustomModal';

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

const CHIP_CATEGORIES: CategoryType[] = [
  'bills',
  'subscriptions',
  'family',
  'health',
  'education',
  'transport',
  'others',
];

export default function RecurringExpensesScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const { token } = useAuth();
  const { formatAmount } = useCurrency();
  const { showAlert } = useAlert();
  const { addTransaction } = useExpenses();

  const [templates, setTemplates] = useState<RecurringExpense[]>([]);
  const [due, setDue] = useState<DueRecurringExpense[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);

  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState('');
  const [amount, setAmount] = useState('');
  const [day, setDay] = useState('1');
  const [category, setCategory] = useState<CategoryType>('bills');
  const [isSaving, setIsSaving] = useState(false);

  const refresh = useCallback(async () => {
    const list = await loadRecurringExpenses(token);
    setTemplates(list);
    setDue(getDueRecurringExpenses(list));
    setIsLoading(false);
  }, [token]);

  useEffect(() => {
    refresh();
  }, [refresh]);

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
          title: 'Could not save',
          message: 'The expense was not recorded. Please try again.',
          type: 'error',
        });
        return;
      }
      await markRecurringHandled(token, item.template.id, item.period);
      await refresh();
    },
    [addTransaction, showAlert, refresh, token],
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
          title: 'Could not save',
          message: 'The expense was not recorded. Please check your connection and try again.',
          type: 'error',
        });
        return;
      }
      showAlert({
        title: 'Expense recorded',
        message: `${formatAmount(template.amount)} · ${template.name}`,
        type: 'success',
      });
      await refresh();
    },
    [addTransaction, showAlert, formatAmount, refresh],
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
        title: 'Delete template?',
        message: `"${template.name}" will stop being offered each month. Expenses already recorded are not affected.`,
        type: 'warning',
        buttons: [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Delete',
            style: 'destructive',
            onPress: async () => {
              await deleteRecurringExpense(token, template.id);
              await refresh();
            },
          },
        ],
      });
    },
    [showAlert, refresh, token],
  );

  const resetForm = () => {
    setName('');
    setAmount('');
    setDay('1');
    setCategory('bills');
  };

  const handleSaveTemplate = useCallback(async () => {
    const amountValue = Number(amount);
    const dayValue = Number(day);
    if (!name.trim()) {
      showAlert({ title: 'Name needed', message: 'Give this expense a name.', type: 'warning' });
      return;
    }
    if (!Number.isFinite(amountValue) || amountValue <= 0) {
      showAlert({ title: 'Amount needed', message: 'Enter a valid amount.', type: 'warning' });
      return;
    }
    if (!Number.isFinite(dayValue) || dayValue < 1 || dayValue > 31) {
      showAlert({ title: 'Check the date', message: 'Enter a day between 1 and 31.', type: 'warning' });
      return;
    }

    setIsSaving(true);
    const created = await saveRecurringExpense(token, {
      name: name.trim(),
      amount: amountValue,
      category,
      dayOfMonth: dayValue,
      memberId: null,
    });
    setIsSaving(false);

    if (!created) {
      showAlert({
        title: 'Could not save',
        message: 'The template was not saved. Please check your connection and try again.',
        type: 'error',
      });
      return;
    }

    setShowForm(false);
    resetForm();
    await refresh();
  }, [name, amount, day, category, showAlert, refresh, token]);

  return (
    <View style={[styles.root, { backgroundColor: colors.bg, paddingTop: insets.top }]}>
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <Pressable onPress={() => router.back()} hitSlop={12} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={24} color={colors.text} />
        </Pressable>
        <Text style={[styles.headerTitle, { color: colors.text }]}>Recurring Expenses</Text>
        <Pressable onPress={() => setShowForm(true)} hitSlop={12} style={styles.backBtn}>
          <Ionicons name="add" size={24} color={colors.accent} />
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={[styles.body, { paddingBottom: insets.bottom + 32 }]}
        showsVerticalScrollIndicator={false}
      >
        {isLoading ? (
          <ActivityIndicator style={{ marginTop: 40 }} color={colors.accent} />
        ) : (
          <>
            {/* Due this month — the actionable part. */}
            {due.length > 0 && (
              <>
                <Text style={[styles.sectionTitle, { color: colors.text }]}>Due now</Text>
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
                          Due {item.dueDate.toLocaleDateString('en-IN')}
                        </Text>
                      </View>
                      <Text style={[styles.dueAmount, { color: colors.text }]}>
                        {formatAmount(item.template.amount)}
                      </Text>
                    </View>
                    <View style={styles.dueActions}>
                      <Pressable
                        onPress={() => handleSkipDue(item)}
                        style={[styles.skipBtn, { borderColor: colors.border }]}
                      >
                        <Text style={[styles.skipText, { color: colors.textSecondary }]}>Skip</Text>
                      </Pressable>
                      <Pressable
                        onPress={() => handleConfirmDue(item)}
                        disabled={confirmingId === item.template.id}
                        style={[styles.confirmBtn, { backgroundColor: colors.accent }]}
                      >
                        {confirmingId === item.template.id ? (
                          <ActivityIndicator size="small" color="#FFFFFF" />
                        ) : (
                          <Text style={styles.confirmText}>Confirm</Text>
                        )}
                      </Pressable>
                    </View>
                  </View>
                ))}
              </>
            )}

            <Text style={[styles.sectionTitle, { color: colors.text, marginTop: due.length ? 24 : 0 }]}>
              Templates
            </Text>

            {templates.length === 0 ? (
              <View style={[styles.empty, { borderColor: colors.border }]}>
                <Ionicons name="repeat" size={30} color={colors.textTertiary} />
                <Text style={[styles.emptyTitle, { color: colors.text }]}>No recurring expenses</Text>
                <Text style={[styles.emptyText, { color: colors.textTertiary }]}>
                  Add rent, EMI or a subscription once and confirm it with one tap each month.
                </Text>
                <Pressable
                  onPress={() => setShowForm(true)}
                  style={[styles.emptyBtn, { backgroundColor: colors.accent }]}
                >
                  <Text style={styles.emptyBtnText}>Add one</Text>
                </Pressable>
              </View>
            ) : (
              templates.map((t) => (
                <View
                  key={t.id}
                  style={[styles.row, { backgroundColor: colors.card, borderColor: colors.border }]}
                >
                  <View style={[styles.iconWrap, { backgroundColor: CATEGORIES[t.category].color + '1F' }]}>
                    <Ionicons
                      name={CATEGORIES[t.category].icon as any}
                      size={18}
                      color={CATEGORIES[t.category].color}
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.rowName, { color: colors.text }]} numberOfLines={1}>
                      {t.name}
                    </Text>
                    <Text style={[styles.rowMeta, { color: colors.textTertiary }]}>
                      Day {t.dayOfMonth} · {CATEGORIES[t.category].label}
                    </Text>
                  </View>
                  <Text style={[styles.rowAmount, { color: colors.text }]}>{formatAmount(t.amount)}</Text>
                  {/*
                    Log on demand. "Due now" only lists templates whose day has
                    already passed this month, so without this a template due
                    later is un-actionable and looks broken.
                  */}
                  <Pressable
                    onPress={() => handleLogNow(t)}
                    disabled={confirmingId === t.id}
                    hitSlop={8}
                    style={{ marginLeft: 10 }}
                  >
                    {confirmingId === t.id ? (
                      <ActivityIndicator size="small" color={colors.accent} />
                    ) : (
                      <Ionicons name="add-circle-outline" size={19} color={colors.accent} />
                    )}
                  </Pressable>
                  <Pressable onPress={() => handleDelete(t)} hitSlop={8} style={{ marginLeft: 10 }}>
                    <Ionicons name="trash-outline" size={17} color={colors.danger} />
                  </Pressable>
                </View>
              ))
            )}

            <Text style={[styles.note, { color: colors.textTertiary }]}>
              Tap + on any template to record it now. Nothing is ever added automatically without
              your tap.
            </Text>
          </>
        )}
      </ScrollView>

      {/* Add template */}
      <CustomModal visible={showForm} onClose={() => setShowForm(false)} showCloseButton={false}>
        <Text style={[styles.modalTitle, { color: colors.text }]}>New recurring expense</Text>

        <TextInput
          value={name}
          onChangeText={setName}
          placeholder="Name (e.g. House Rent)"
          placeholderTextColor={colors.textTertiary}
          style={[
            styles.input,
            { backgroundColor: colors.inputBg, borderColor: colors.inputBorder, color: colors.text },
          ]}
          maxLength={60}
        />
        <TextInput
          value={amount}
          onChangeText={setAmount}
          placeholder="Amount"
          placeholderTextColor={colors.textTertiary}
          keyboardType="numeric"
          style={[
            styles.input,
            { backgroundColor: colors.inputBg, borderColor: colors.inputBorder, color: colors.text },
          ]}
        />
        <TextInput
          value={day}
          onChangeText={setDay}
          placeholder="Day of month (1-31)"
          placeholderTextColor={colors.textTertiary}
          keyboardType="number-pad"
          style={[
            styles.input,
            { backgroundColor: colors.inputBg, borderColor: colors.inputBorder, color: colors.text },
          ]}
          maxLength={2}
        />

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
          {CHIP_CATEGORIES.map((cat) => {
            const meta = CATEGORIES[cat];
            const active = category === cat;
            return (
              <Pressable
                key={cat}
                onPress={() => setCategory(cat)}
                style={[
                  styles.chip,
                  {
                    backgroundColor: active ? meta.color + '22' : colors.bgSecondary,
                    borderColor: active ? meta.color : colors.border,
                  },
                ]}
              >
                <Ionicons name={meta.icon as any} size={13} color={active ? meta.color : colors.textTertiary} />
                <Text style={[styles.chipText, { color: active ? meta.color : colors.textSecondary }]}>
                  {meta.label}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>

        <View style={styles.modalActions}>
          <Pressable
            onPress={() => {
              setShowForm(false);
              resetForm();
            }}
            style={[styles.cancelBtn, { borderColor: colors.border }]}
          >
            <Text style={[styles.cancelText, { color: colors.textSecondary }]}>Cancel</Text>
          </Pressable>
          <Pressable
            onPress={handleSaveTemplate}
            disabled={isSaving}
            style={[styles.saveBtn, { backgroundColor: colors.accent }]}
          >
            {isSaving ? (
              <ActivityIndicator size="small" color="#FFFFFF" />
            ) : (
              <Text style={styles.saveText}>Save</Text>
            )}
          </Pressable>
        </View>
      </CustomModal>
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
  modalTitle: { fontSize: 16, fontWeight: '700', marginBottom: 14 },
  input: { borderRadius: 12, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 12, fontSize: 14, marginBottom: 10 },
  chipRow: { gap: 8, paddingVertical: 4 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 11,
    paddingVertical: 7,
    borderRadius: 18,
    borderWidth: 1,
  },
  chipText: { fontSize: 12, fontWeight: '600' },
  modalActions: { flexDirection: 'row', gap: 10, marginTop: 18 },
  cancelBtn: { flex: 1, minHeight: 46, borderRadius: 13, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  cancelText: { fontSize: 14, fontWeight: '600' },
  saveBtn: { flex: 1, minHeight: 46, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  saveText: { color: '#FFFFFF', fontSize: 14, fontWeight: '700' },
});
