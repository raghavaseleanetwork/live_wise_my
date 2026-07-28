import React, { useCallback, useEffect, useMemo, useState } from 'react';
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
import * as Haptics from 'expo-haptics';
import DateTimePicker from '@react-native-community/datetimepicker';
import { useRouter } from 'expo-router';
import { useTheme } from '@/lib/theme-context';
import { useAuth } from '@/lib/auth-context';
import { useCurrency } from '@/lib/currency-context';
import { useAlert } from '@/lib/alert-context';
import { useExpenses } from '@/lib/expense-context';
import { apiRequest } from '@/lib/query-client';
import { CATEGORIES, CategoryType, PaymentMode } from '@/lib/data';
import CustomModal from '@/components/CustomModal';

/**
 * Quick Add — Method 1 in the product doc (iOS & Android). The fastest way to log
 * an expense: amount, category, member, save.
 *
 * The doc asks for "3 taps / under 10 seconds" but also lists seven fields. Both
 * cannot be true, so the three that decide where the money went (amount,
 * category, member) are always visible and the rest — note, date, payment mode —
 * live behind "More" with smart defaults applied (date = today, payment mode =
 * last used, per the doc's own "remembers last used" note).
 *
 * Bulk import (Methods 4 & 5) is reachable from the footer rather than the home
 * screen: importing a statement is a once-a-month action and should not compete
 * with the several-times-a-day one.
 */

/** The subset of CATEGORIES offered as chips, in the order the doc lists them. */
const CHIP_CATEGORIES: CategoryType[] = [
  'food',
  'transport',
  'health',
  'bills',
  'shopping',
  'entertainment',
  'family',
  'travel',
  'education',
  'others',
];

const PAYMENT_MODES: { id: PaymentMode; label: string; icon: string }[] = [
  { id: 'upi', label: 'UPI', icon: 'phone-portrait-outline' },
  { id: 'cash', label: 'Cash', icon: 'cash-outline' },
  { id: 'card', label: 'Card', icon: 'card-outline' },
  { id: 'netbanking', label: 'Net Banking', icon: 'business-outline' },
];

interface FamilyMemberLite {
  id: string;
  name: string;
  relationship: string;
  avatarUrl: string | null;
}

interface QuickAddSheetProps {
  visible: boolean;
  onClose: () => void;
  /** Opens the statement/CSV import flow (Module 2). */
  onImport?: () => void;
}

/**
 * Time-of-day category hint. The doc asks for "smart AI pre-selects last-used
 * category for that time of day" and note suggestions like "7 PM — Dinner?".
 * A local heuristic covers this without a model call.
 */
function suggestionForNow(): { category: CategoryType; note: string } | null {
  const h = new Date().getHours();
  if (h >= 6 && h < 11) return { category: 'food', note: 'Chai / Coffee' };
  if (h >= 12 && h < 15) return { category: 'food', note: 'Lunch' };
  if (h >= 19 && h < 23) return { category: 'food', note: 'Dinner' };
  return null;
}

export default function QuickAddSheet({ visible, onClose, onImport }: QuickAddSheetProps) {
  const { colors } = useTheme();
  const router = useRouter();
  const { token } = useAuth();
  const { currentCurrency } = useCurrency();
  const { showAlert } = useAlert();
  const { addTransaction } = useExpenses();

  const suggestion = useMemo(() => suggestionForNow(), []);

  const [amount, setAmount] = useState('');
  const [category, setCategory] = useState<CategoryType>('food');
  const [memberId, setMemberId] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [date, setDate] = useState(new Date());
  const [paymentMode, setPaymentMode] = useState<PaymentMode>('upi');
  const [showMore, setShowMore] = useState(false);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [members, setMembers] = useState<FamilyMemberLite[]>([]);
  const [isSaving, setIsSaving] = useState(false);

  // Reset to a clean slate each time the sheet opens, applying the time-of-day
  // hint so the common case is a single tap on the amount.
  useEffect(() => {
    if (!visible) return;
    setAmount('');
    setCategory(suggestionForNow()?.category ?? 'food');
    setMemberId(null);
    setNote('');
    setDate(new Date());
    setShowMore(false);
    setShowDatePicker(false);
    setIsSaving(false);
  }, [visible]);

  // Family members for the "who spent this?" selector.
  useEffect(() => {
    if (!visible || !token) return;
    let mounted = true;
    (async () => {
      try {
        const res = await apiRequest('GET', '/api/family', undefined, token);
        if (!res.ok) return;
        const data = (await res.json()) as FamilyMemberLite[];
        if (mounted) setMembers(Array.isArray(data) ? data : []);
      } catch {
        if (mounted) setMembers([]);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [visible, token]);

  const amountValue = Number(amount);
  const canSave = Number.isFinite(amountValue) && amountValue > 0 && !isSaving;

  const tap = useCallback(() => {
    if (Platform.OS !== 'web') Haptics.selectionAsync().catch(() => {});
  }, []);

  /** Numeric keypad entry. Guards against multiple decimal points. */
  const pressKey = useCallback(
    (key: string) => {
      tap();
      setAmount((prev) => {
        if (key === 'del') return prev.slice(0, -1);
        if (key === '.') return prev.includes('.') ? prev : prev === '' ? '0.' : prev + '.';
        // Cap at 2 decimal places.
        if (prev.includes('.') && prev.split('.')[1]?.length >= 2) return prev;
        if (prev === '0' && key !== '.') return key;
        if (prev.replace('.', '').length >= 9) return prev;
        return prev + key;
      });
    },
    [tap],
  );

  const handleSave = useCallback(async () => {
    if (!canSave) return;
    setIsSaving(true);

    const selectedMember = members.find((m) => m.id === memberId);
    // `merchant` is what the transaction list renders as the title. Prefer the
    // user's note, fall back to the category label so a row is never blank.
    const merchant = note.trim() || CATEGORIES[category].label;

    const created = await addTransaction({
      merchant,
      amount: amountValue,
      category,
      date: date.toISOString(),
      memberId,
      paymentMode,
      description: note.trim(),
      source: 'manual',
    });

    setIsSaving(false);

    if (!created) {
      showAlert({
        title: 'Could not save',
        message: 'The expense was not saved. Please check your connection and try again.',
        type: 'error',
      });
      return;
    }

    if (Platform.OS !== 'web') {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    }
    showAlert({
      title: 'Expense saved',
      message: `${currentCurrency.symbol}${amountValue.toLocaleString('en-IN')} · ${
        CATEGORIES[category].label
      }${selectedMember ? ` · ${selectedMember.name}` : ''}`,
      type: 'success',
    });
    onClose();
  }, [
    canSave,
    members,
    memberId,
    note,
    category,
    amountValue,
    date,
    paymentMode,
    addTransaction,
    showAlert,
    currentCurrency.symbol,
    onClose,
  ]);

  const isToday = new Date().toDateString() === date.toDateString();

  return (
    <CustomModal visible={visible} onClose={onClose} showCloseButton={false}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        bounces={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* Header */}
        <View style={styles.header}>
          <Text style={[styles.title, { color: colors.text }]}>Add Expense</Text>
          <Pressable
            onPress={onClose}
            hitSlop={12}
            style={[styles.closeBtn, { backgroundColor: colors.bgSecondary }]}
          >
            <Ionicons name="close" size={18} color={colors.textSecondary} />
          </Pressable>
        </View>

        {/* Amount */}
        <View style={[styles.amountBox, { backgroundColor: colors.bgSecondary, borderColor: colors.border }]}>
          <Text style={[styles.currency, { color: colors.textTertiary }]}>
            {currentCurrency.symbol}
          </Text>
          <Text
            style={[styles.amountText, { color: amount ? colors.text : colors.textTertiary }]}
            numberOfLines={1}
            adjustsFontSizeToFit
          >
            {amount || '0'}
          </Text>
        </View>

        {/* Categories */}
        <Text style={[styles.sectionLabel, { color: colors.textSecondary }]}>Category</Text>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chipRow}
        >
          {CHIP_CATEGORIES.map((cat) => {
            const meta = CATEGORIES[cat];
            const active = category === cat;
            return (
              <Pressable
                key={cat}
                onPress={() => {
                  tap();
                  setCategory(cat);
                }}
                style={[
                  styles.chip,
                  {
                    backgroundColor: active ? meta.color + '22' : colors.bgSecondary,
                    borderColor: active ? meta.color : colors.border,
                  },
                ]}
              >
                <Ionicons
                  name={meta.icon as any}
                  size={14}
                  color={active ? meta.color : colors.textTertiary}
                />
                <Text
                  style={[
                    styles.chipText,
                    { color: active ? meta.color : colors.textSecondary },
                  ]}
                >
                  {meta.label}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>

        {/* Member selector — only meaningful once a family exists. */}
        {members.length > 0 && (
          <>
            <Text style={[styles.sectionLabel, { color: colors.textSecondary }]}>For</Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.chipRow}
            >
              <Pressable
                onPress={() => {
                  tap();
                  setMemberId(null);
                }}
                style={[
                  styles.chip,
                  {
                    backgroundColor: memberId === null ? colors.accent + '22' : colors.bgSecondary,
                    borderColor: memberId === null ? colors.accent : colors.border,
                  },
                ]}
              >
                <Ionicons
                  name="person"
                  size={14}
                  color={memberId === null ? colors.accent : colors.textTertiary}
                />
                <Text
                  style={[
                    styles.chipText,
                    { color: memberId === null ? colors.accent : colors.textSecondary },
                  ]}
                >
                  Me
                </Text>
              </Pressable>
              {members.map((m) => {
                const active = memberId === m.id;
                return (
                  <Pressable
                    key={m.id}
                    onPress={() => {
                      tap();
                      setMemberId(m.id);
                    }}
                    style={[
                      styles.chip,
                      {
                        backgroundColor: active ? colors.accent + '22' : colors.bgSecondary,
                        borderColor: active ? colors.accent : colors.border,
                      },
                    ]}
                  >
                    <Text
                      style={[
                        styles.chipText,
                        { color: active ? colors.accent : colors.textSecondary },
                      ]}
                    >
                      {m.name}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          </>
        )}

        {/* Keypad */}
        <View style={styles.keypad}>
          {['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', 'del'].map((key) => (
            <Pressable
              key={key}
              onPress={() => pressKey(key)}
              style={({ pressed }) => [
                styles.key,
                {
                  backgroundColor: pressed ? colors.border : colors.bgSecondary,
                  borderColor: colors.border,
                },
              ]}
            >
              {key === 'del' ? (
                <Ionicons name="backspace-outline" size={20} color={colors.textSecondary} />
              ) : (
                <Text style={[styles.keyText, { color: colors.text }]}>{key}</Text>
              )}
            </Pressable>
          ))}
        </View>

        {/* More — note, date, payment mode */}
        <Pressable
          onPress={() => {
            tap();
            setShowMore((v) => !v);
          }}
          style={styles.moreToggle}
        >
          <Text style={[styles.moreText, { color: colors.accent }]}>
            {showMore ? 'Less' : 'More options'}
          </Text>
          <Ionicons
            name={showMore ? 'chevron-up' : 'chevron-down'}
            size={14}
            color={colors.accent}
          />
        </Pressable>

        {showMore && (
          <View style={styles.moreBody}>
            <TextInput
              value={note}
              onChangeText={setNote}
              placeholder={suggestion ? `e.g. ${suggestion.note}` : 'Note (optional)'}
              placeholderTextColor={colors.textTertiary}
              style={[
                styles.input,
                { backgroundColor: colors.inputBg, borderColor: colors.inputBorder, color: colors.text },
              ]}
              maxLength={80}
            />

            <Pressable
              onPress={() => {
                tap();
                setShowDatePicker(true);
              }}
              style={[
                styles.input,
                styles.dateRow,
                { backgroundColor: colors.inputBg, borderColor: colors.inputBorder },
              ]}
            >
              <Ionicons name="calendar-outline" size={16} color={colors.textSecondary} />
              <Text style={[styles.dateText, { color: colors.text }]}>
                {isToday ? 'Today' : date.toLocaleDateString('en-IN')}
              </Text>
            </Pressable>

            {showDatePicker && (
              <DateTimePicker
                value={date}
                mode="date"
                maximumDate={new Date()}
                display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                onChange={(event, selected) => {
                  if (Platform.OS !== 'ios') setShowDatePicker(false);
                  if (event.type === 'dismissed') {
                    setShowDatePicker(false);
                    return;
                  }
                  if (selected) setDate(selected);
                }}
              />
            )}
            {showDatePicker && Platform.OS === 'ios' && (
              <Pressable onPress={() => setShowDatePicker(false)} style={styles.moreToggle}>
                <Text style={[styles.moreText, { color: colors.accent }]}>Done</Text>
              </Pressable>
            )}

            <View style={styles.payRow}>
              {PAYMENT_MODES.map((mode) => {
                const active = paymentMode === mode.id;
                return (
                  <Pressable
                    key={mode.id}
                    onPress={() => {
                      tap();
                      setPaymentMode(mode.id);
                    }}
                    style={[
                      styles.payChip,
                      {
                        backgroundColor: active ? colors.accent + '22' : colors.bgSecondary,
                        borderColor: active ? colors.accent : colors.border,
                      },
                    ]}
                  >
                    <Ionicons
                      name={mode.icon as any}
                      size={13}
                      color={active ? colors.accent : colors.textTertiary}
                    />
                    <Text
                      style={[
                        styles.payText,
                        { color: active ? colors.accent : colors.textSecondary },
                      ]}
                    >
                      {mode.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
        )}

        {/* Save */}
        <Pressable
          onPress={handleSave}
          disabled={!canSave}
          style={[
            styles.saveBtn,
            { backgroundColor: canSave ? colors.accent : colors.border },
          ]}
        >
          {isSaving ? (
            <ActivityIndicator size="small" color="#FFFFFF" />
          ) : (
            <Text style={styles.saveText}>Save Expense</Text>
          )}
        </Pressable>

        {/* Bulk import — Methods 4 & 5, deliberately low-prominence. */}
        {onImport && (
          <Pressable
            onPress={() => {
              onClose();
              onImport();
            }}
            style={[styles.importRow, { borderTopColor: colors.border }]}
          >
            <Ionicons name="document-text-outline" size={15} color={colors.textSecondary} />
            <Text style={[styles.importText, { color: colors.textSecondary }]}>
              Import bank statement or CSV
            </Text>
            <Ionicons name="chevron-forward" size={14} color={colors.textTertiary} />
          </Pressable>
        )}

        {/* Recurring templates — Method 6. Setup, not entry, so it lives here. */}
        <Pressable
          onPress={() => {
            onClose();
            router.push('/recurring-expenses');
          }}
          style={[styles.importRow, { borderTopColor: colors.border }]}
        >
          <Ionicons name="repeat" size={15} color={colors.textSecondary} />
          <Text style={[styles.importText, { color: colors.textSecondary }]}>
            Recurring expenses
          </Text>
          <Ionicons name="chevron-forward" size={14} color={colors.textTertiary} />
        </Pressable>
      </ScrollView>
    </CustomModal>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 14,
  },
  title: { fontSize: 19, fontWeight: '700', letterSpacing: -0.3 },
  closeBtn: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
  amountBox: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 18,
    borderRadius: 16,
    borderWidth: 1,
    marginBottom: 16,
  },
  currency: { fontSize: 22, fontWeight: '600' },
  amountText: { fontSize: 40, fontWeight: '700', letterSpacing: -1 },
  sectionLabel: {
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginBottom: 8,
  },
  chipRow: { gap: 8, paddingRight: 8, paddingBottom: 14 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
  },
  chipText: { fontSize: 13, fontWeight: '600' },
  keypad: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    rowGap: 8,
    marginBottom: 4,
  },
  key: {
    width: '31.5%',
    height: 48,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  keyText: { fontSize: 20, fontWeight: '600' },
  moreToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingVertical: 12,
  },
  moreText: { fontSize: 13, fontWeight: '600' },
  moreBody: { gap: 10, marginBottom: 6 },
  input: {
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 14,
  },
  dateRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  dateText: { fontSize: 14, fontWeight: '500' },
  payRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  payChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 11,
    paddingVertical: 7,
    borderRadius: 18,
    borderWidth: 1,
  },
  payText: { fontSize: 12, fontWeight: '600' },
  saveBtn: {
    height: 50,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
  },
  saveText: { color: '#FFFFFF', fontSize: 15, fontWeight: '700' },
  importRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingTop: 14,
    marginTop: 14,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  importText: { flex: 1, fontSize: 13, fontWeight: '500' },
});
