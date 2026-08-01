import React, { useCallback, useState } from 'react';
import {
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
import { useAlert } from '@/lib/alert-context';
import { useCurrency } from '@/lib/currency-context';
import { CATEGORIES, CategoryType } from '@/lib/data';
import { saveRecurringExpense } from '@/lib/recurring-expenses';
import { LoadingIndicator } from '@/components/PremiumLoader';

/**
 * New recurring expense template — Method 6 in the product doc.
 *
 * A full page rather than a modal, per user instruction (2026-07-28): expense
 * entry must not open in a popup. Saving returns to the templates list, which
 * refreshes on focus.
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

export default function AddRecurringExpenseScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const { token } = useAuth();
  const { showAlert } = useAlert();
  const { convertForStorage } = useCurrency();

  const [name, setName] = useState('');
  const [amount, setAmount] = useState('');
  const [day, setDay] = useState('1');
  // Nothing preselected — the user chooses the category.
  const [category, setCategory] = useState<CategoryType | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const handleSave = useCallback(async () => {
    if (isSaving) return;
    const amountValue = Number(amount);
    const dayValue = Number(day);
    if (!category) {
      showAlert({ title: 'Category needed', message: 'Pick a category for this expense.', type: 'warning' });
      return;
    }
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
      // Typed in the user's display currency; stored in INR like every amount.
      amount: convertForStorage(amountValue),
      category,
      dayOfMonth: dayValue,
      memberId: null,
    });

    if (!created) {
      setIsSaving(false);
      showAlert({
        title: 'Could not save',
        message: 'The template was not saved. Please check your connection and try again.',
        type: 'error',
      });
      return;
    }

    router.back();
  }, [isSaving, name, amount, day, category, showAlert, token, router, convertForStorage]);

  return (
    <View style={[styles.root, { backgroundColor: colors.bg, paddingTop: insets.top }]}>
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <Pressable onPress={() => router.back()} hitSlop={12} style={styles.headerBtn}>
          <Ionicons name="chevron-back" size={24} color={colors.text} />
        </Pressable>
        <Text style={[styles.headerTitle, { color: colors.text }]}>New Recurring Expense</Text>
        <View style={styles.headerBtn} />
      </View>

      <ScrollView
        contentContainerStyle={[styles.body, { paddingBottom: insets.bottom + 32 }]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>Name</Text>
        <TextInput
          value={name}
          onChangeText={setName}
          placeholder="e.g. House Rent"
          placeholderTextColor={colors.textTertiary}
          style={[
            styles.input,
            { backgroundColor: colors.inputBg, borderColor: colors.inputBorder, color: colors.text },
          ]}
          maxLength={60}
          autoFocus
        />

        <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>Amount</Text>
        <TextInput
          value={amount}
          onChangeText={setAmount}
          placeholder="0"
          placeholderTextColor={colors.textTertiary}
          keyboardType="numeric"
          style={[
            styles.input,
            { backgroundColor: colors.inputBg, borderColor: colors.inputBorder, color: colors.text },
          ]}
        />

        <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>Day of month (1-31)</Text>
        <TextInput
          value={day}
          onChangeText={setDay}
          placeholder="1"
          placeholderTextColor={colors.textTertiary}
          keyboardType="number-pad"
          style={[
            styles.input,
            { backgroundColor: colors.inputBg, borderColor: colors.inputBorder, color: colors.text },
          ]}
          maxLength={2}
        />

        <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>Category</Text>
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

        <Pressable
          onPress={handleSave}
          disabled={isSaving}
          style={[styles.saveBtn, { backgroundColor: colors.accent, opacity: isSaving ? 0.6 : 1 }]}
        >
          {isSaving ? (
            <LoadingIndicator size="small" color="#FFFFFF" />
          ) : (
            <Text style={styles.saveText}>Save</Text>
          )}
        </Pressable>

        <Text style={[styles.note, { color: colors.textTertiary }]}>
          Nothing is added automatically. Each month you'll be asked to confirm this expense with one
          tap.
        </Text>
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
  headerBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 16, fontWeight: '700' },
  body: { padding: 16 },
  fieldLabel: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.6,
    marginBottom: 8,
    marginTop: 14,
  },
  input: { borderRadius: 12, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 12, fontSize: 14 },
  chipRow: { gap: 8, paddingVertical: 4, paddingRight: 8 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 11,
    paddingVertical: 7,
    borderRadius: 16,
    borderWidth: 1,
  },
  chipText: { fontSize: 12, fontWeight: '600' },
  saveBtn: {
    height: 50,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 28,
  },
  saveText: { color: '#FFFFFF', fontSize: 15, fontWeight: '700' },
  note: { fontSize: 11, lineHeight: 16, marginTop: 18, textAlign: 'center' },
});
