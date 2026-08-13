import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
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
import * as ImagePicker from 'expo-image-picker';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '@/lib/theme-context';
import { useAuth } from '@/lib/auth-context';
import { useCurrency } from '@/lib/currency-context';
import { useAlert } from '@/lib/alert-context';
import { useExpenses } from '@/lib/expense-context';
import { apiRequest } from '@/lib/query-client';
import { uploadReceipt } from '@/lib/upload-receipt';
import { CATEGORIES, CategoryType, PaymentMode } from '@/lib/data';
import { LoadingIndicator } from '@/components/PremiumLoader';

/**
 * Add Expense — Method 1 in the product doc (iOS & Android). The fastest way to
 * log an expense: amount, category, member, save.
 *
 * This is a full page, not a sheet: per user instruction (2026-07-28) expense
 * entry must not open in a popup. It replaces the former `QuickAddSheet`.
 *
 * The doc asks for "3 taps / under 10 seconds" but also lists seven fields. Both
 * cannot be true, so the three that decide where the money went (amount,
 * category, member) are always visible and the rest — note, date, payment mode —
 * live behind "More" with smart defaults applied (date = today, payment mode =
 * last used, per the doc's own "remembers last used" note).
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

const PAYMENT_MODES: { id: PaymentMode; labelKey: string; icon: string }[] = [
  { id: 'upi', labelKey: 'addExpense.paymentModeUpi', icon: 'phone-portrait-outline' },
  { id: 'cash', labelKey: 'addExpense.paymentModeCash', icon: 'cash-outline' },
  { id: 'card', labelKey: 'addExpense.paymentModeCard', icon: 'card-outline' },
  { id: 'netbanking', labelKey: 'addExpense.paymentModeNetBanking', icon: 'business-outline' },
];

interface FamilyMemberLite {
  id: string;
  name: string;
  relationship: string;
  avatarUrl: string | null;
}

/**
 * Time-of-day category hint. The doc asks for "smart AI pre-selects last-used
 * category for that time of day" and note suggestions like "7 PM — Dinner?".
 * A local heuristic covers this without a model call.
 */
function suggestionForNow(): { category: CategoryType; noteKey: string } | null {
  const h = new Date().getHours();
  if (h >= 6 && h < 11) return { category: 'food', noteKey: 'addExpense.suggestionChaiCoffee' };
  if (h >= 12 && h < 15) return { category: 'food', noteKey: 'addExpense.suggestionLunch' };
  if (h >= 19 && h < 23) return { category: 'food', noteKey: 'addExpense.suggestionDinner' };
  return null;
}

export default function AddExpenseScreen() {
  const { colors } = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { token } = useAuth();
  const { currentCurrency, convertForStorage } = useCurrency();
  const { showAlert } = useAlert();
  const { addTransaction } = useExpenses();
  const { t } = useTranslation();

  const suggestion = useMemo(() => suggestionForNow(), []);

  const [amount, setAmount] = useState('');
  // Expense (debit) is the default — matches every existing entry point's prior
  // behaviour. Income only became selectable here; it did not exist before.
  const [isDebit, setIsDebit] = useState(true);
  // Nothing preselected. The time-of-day suggestion still hints the note
  // placeholder ("e.g. Lunch"), but no longer picks a category for the user.
  const [category, setCategory] = useState<CategoryType | null>(null);
  const [memberId, setMemberId] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [date, setDate] = useState(new Date());
  // Keeps a default, deliberately: payment mode lives inside the collapsed
  // "More options" section, so requiring it would disable Save on open with
  // the reason hidden from view. UPI is the common case in India and is one
  // tap to change.
  const [paymentMode, setPaymentMode] = useState<PaymentMode>('upi');
  const [showMore, setShowMore] = useState(false);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [members, setMembers] = useState<FamilyMemberLite[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [receiptUri, setReceiptUri] = useState<string | null>(null);
  const [isUploadingReceipt, setIsUploadingReceipt] = useState(false);

  // Family members for the "who spent this?" selector.
  useEffect(() => {
    if (!token) return;
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
  }, [token]);

  const amountValue = Number(amount);
  // Category is not preselected, so Save stays disabled until one is picked.
  // The chips are on the main screen, so the reason is visible.
  const canSave =
    Number.isFinite(amountValue) &&
    amountValue > 0 &&
    !!category &&
    !isSaving &&
    !isUploadingReceipt;

  const tap = useCallback(() => {
    if (Platform.OS !== 'web') Haptics.selectionAsync().catch(() => {});
  }, []);

  /**
   * Attach a receipt photo — the "Receipt Photo" field the doc lists as
   * optional on Quick Add. Uploads immediately on pick rather than deferring to
   * Save, so an upload failure surfaces right away instead of at the moment the
   * expense would otherwise be committed.
   */
  const handleAttachReceipt = useCallback(async () => {
    if (!token) return;
    tap();
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.7,
      allowsEditing: false,
    });
    if (result.canceled || !result.assets?.length) return;

    const asset = result.assets[0];
    setIsUploadingReceipt(true);
    try {
      const url = await uploadReceipt(token, asset.uri, asset.fileSize);
      setReceiptUri(url);
    } catch (e: any) {
      showAlert({
        title: t('addExpense.couldNotAttachReceipt'),
        message: e?.message || t('addExpense.couldNotAttachReceiptFallback'),
        type: 'error',
      });
    } finally {
      setIsUploadingReceipt(false);
    }
  }, [token, tap, showAlert]);

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
    // `canSave` already covers this, but narrowing here is what lets the
    // non-null uses below typecheck.
    if (!canSave || !category) return;
    setIsSaving(true);

    const selectedMember = members.find((m) => m.id === memberId);
    // `merchant` is what the transaction list renders as the title. Prefer the
    // user's note, fall back to the category label so a row is never blank.
    const merchant = note.trim() || CATEGORIES[category].label;

    const created = await addTransaction({
      merchant,
      // The field is in the user's display currency; storage is always INR.
      amount: convertForStorage(amountValue),
      category,
      date: date.toISOString(),
      memberId,
      paymentMode,
      description: note.trim(),
      receiptUrl: receiptUri || undefined,
      source: 'manual',
      isDebit,
    });

    if (!created) {
      setIsSaving(false);
      showAlert({
        title: t('addExpense.couldNotSave'),
        message: t('addExpense.couldNotSaveMessage'),
        type: 'error',
      });
      return;
    }

    if (Platform.OS !== 'web') {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    }
    showAlert({
      title: isDebit ? t('addExpense.expenseSaved') : t('addExpense.incomeSaved'),
      message: `${currentCurrency.symbol}${amountValue.toLocaleString('en-IN')} · ${
        CATEGORIES[category].label
      }${selectedMember ? ` · ${selectedMember.name}` : ''}`,
      type: 'success',
    });
    router.back();
  }, [
    canSave,
    members,
    memberId,
    note,
    category,
    amountValue,
    date,
    paymentMode,
    receiptUri,
    addTransaction,
    showAlert,
    currentCurrency.symbol,
    convertForStorage,
    router,
    isDebit,
    t,
  ]);

  const isToday = new Date().toDateString() === date.toDateString();

  return (
    <View style={[styles.root, { backgroundColor: colors.bg, paddingTop: insets.top }]}>
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <Pressable onPress={() => router.back()} hitSlop={12} style={styles.headerBtn}>
          <Ionicons name="chevron-back" size={24} color={colors.text} />
        </Pressable>
        <Text style={[styles.headerTitle, { color: colors.text }]}>{t('addExpense.title')}</Text>
        <View style={styles.headerBtn} />
      </View>

      <ScrollView
        contentContainerStyle={[styles.body, { paddingBottom: insets.bottom + 32 }]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* Expense / Income */}
        <View style={[styles.typeToggle, { backgroundColor: colors.bgSecondary, borderColor: colors.border }]}>
          <Pressable
            onPress={() => {
              tap();
              setIsDebit(true);
            }}
            style={[
              styles.typeOption,
              isDebit && { backgroundColor: colors.danger + '22' },
            ]}
          >
            <Text style={[styles.typeText, { color: isDebit ? colors.danger : colors.textSecondary }]}>
              {t('addExpense.expense')}
            </Text>
          </Pressable>
          <Pressable
            onPress={() => {
              tap();
              setIsDebit(false);
            }}
            style={[
              styles.typeOption,
              !isDebit && { backgroundColor: (colors.accentMint || colors.text) + '22' },
            ]}
          >
            <Text style={[styles.typeText, { color: !isDebit ? (colors.accentMint || colors.text) : colors.textSecondary }]}>
              {t('addExpense.income')}
            </Text>
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
        <Text style={[styles.sectionLabel, { color: colors.textSecondary }]}>{t('addExpense.category')}</Text>
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
            <Text style={[styles.sectionLabel, { color: colors.textSecondary }]}>{t('addExpense.for')}</Text>
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
                  {t('addExpense.me')}
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
            {showMore ? t('addExpense.less') : t('addExpense.moreOptions')}
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
              placeholder={
                suggestion
                  ? t('addExpense.notePlaceholderSuggestion', { suggestion: t(suggestion.noteKey) })
                  : t('addExpense.notePlaceholder')
              }
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
                {isToday ? t('home.today') : date.toLocaleDateString('en-IN')}
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
                <Text style={[styles.moreText, { color: colors.accent }]}>{t('common.done')}</Text>
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
                      {t(mode.labelKey)}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            <Pressable
              onPress={handleAttachReceipt}
              disabled={isUploadingReceipt}
              style={[
                styles.receiptRow,
                {
                  backgroundColor: receiptUri ? colors.accent + '14' : colors.bgSecondary,
                  borderColor: receiptUri ? colors.accent + '55' : colors.border,
                },
              ]}
            >
              {isUploadingReceipt ? (
                <LoadingIndicator size="small" color={colors.accent} />
              ) : (
                <Ionicons
                  name={receiptUri ? 'checkmark-circle' : 'camera-outline'}
                  size={16}
                  color={receiptUri ? colors.accent : colors.textSecondary}
                />
              )}
              <Text
                style={[
                  styles.receiptText,
                  { color: receiptUri ? colors.accent : colors.textSecondary },
                ]}
              >
                {isUploadingReceipt
                  ? t('addExpense.uploadingReceipt')
                  : receiptUri
                    ? t('addExpense.receiptAttached')
                    : t('addExpense.attachReceipt')}
              </Text>
              {receiptUri && !isUploadingReceipt && (
                <Pressable
                  onPress={() => setReceiptUri(null)}
                  hitSlop={8}
                  style={{ marginLeft: 'auto' }}
                >
                  <Ionicons name="close-circle" size={16} color={colors.textTertiary} />
                </Pressable>
              )}
            </Pressable>
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
            <LoadingIndicator size="small" color="#FFFFFF" />
          ) : (
            <Text style={styles.saveText}>{t('addExpense.saveExpense')}</Text>
          )}
        </Pressable>

        {/* Bulk import — Methods 4 & 5, deliberately low-prominence. */}
        <Pressable
          onPress={() => router.replace('/import-statement')}
          style={[styles.importRow, { borderTopColor: colors.border }]}
        >
          <Ionicons name="document-text-outline" size={15} color={colors.textSecondary} />
          <Text style={[styles.importText, { color: colors.textSecondary }]}>
            {t('addExpense.importBankStatement')}
          </Text>
          <Ionicons name="chevron-forward" size={14} color={colors.textTertiary} />
        </Pressable>

        {/* Recurring templates — Method 6. Setup, not entry, so it lives here. */}
        <Pressable
          onPress={() => router.replace('/recurring-expenses')}
          style={[styles.importRow, { borderTopColor: colors.border }]}
        >
          <Ionicons name="repeat" size={15} color={colors.textSecondary} />
          <Text style={[styles.importText, { color: colors.textSecondary }]}>
            {t('addExpense.recurringExpenses')}
          </Text>
          <Ionicons name="chevron-forward" size={14} color={colors.textTertiary} />
        </Pressable>
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
  typeToggle: {
    flexDirection: 'row',
    borderRadius: 12,
    borderWidth: 1,
    padding: 4,
    marginBottom: 12,
  },
  typeOption: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
    borderRadius: 9,
  },
  typeText: { fontSize: 13, fontWeight: '700' },
  currency: { fontSize: 22, fontWeight: '600' },
  amountText: { fontSize: 40, fontWeight: '700', letterSpacing: -1 },
  sectionLabel: {
    fontSize: 11,
    fontWeight: '700',
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
    borderRadius: 16,
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
  receiptRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minHeight: 44,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: 1,
  },
  receiptText: { fontSize: 13, fontWeight: '600' },
  payChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 11,
    paddingVertical: 7,
    borderRadius: 16,
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
