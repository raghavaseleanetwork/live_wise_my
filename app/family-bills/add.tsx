import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View, ScrollView, Pressable, TextInput, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import DateTimePicker from '@react-native-community/datetimepicker';
import { useTranslation } from 'react-i18next';

import { useTheme } from '@/lib/theme-context';
import { useCurrency } from '@/lib/currency-context';
import { FamilyBill, FamilyBillCategory, BillPaymentMethod, addFamilyBill, loadFamilyBills, updateFamilyBill } from '@/lib/family-records';

const CATEGORY_LABELS: Record<FamilyBillCategory, { labelKey: string; icon: string }> = {
  electricity: { labelKey: 'familyBills.categoryElectricity', icon: 'flash' },
  gas: { labelKey: 'familyBills.categoryGas', icon: 'flame' },
  water: { labelKey: 'familyBills.categoryWater', icon: 'water' },
  internet: { labelKey: 'familyBills.categoryInternet', icon: 'wifi' },
  mobile_postpaid: { labelKey: 'familyBills.categoryMobilePostpaid', icon: 'phone-portrait' },
  cable_tv: { labelKey: 'familyBills.categoryCableTv', icon: 'tv' },
  society_maintenance: { labelKey: 'familyBills.categorySocietyMaintenance', icon: 'business' },
  rent: { labelKey: 'familyBills.categoryRent', icon: 'home' },
  loan_emi: { labelKey: 'familyBills.categoryLoanEmi', icon: 'cash' },
  credit_card: { labelKey: 'familyBills.categoryCreditCard', icon: 'card' },
  medical: { labelKey: 'familyBills.categoryMedical', icon: 'medkit' },
  insurance: { labelKey: 'familyBills.categoryInsurance', icon: 'shield-checkmark' },
  other: { labelKey: 'familyBills.categoryOther', icon: 'receipt' },
};

/** Example bill name per category, so the hint matches the selected chip. */
const CATEGORY_PLACEHOLDER_KEYS: Record<FamilyBillCategory, string> = {
  electricity: 'familyBills.placeholderElectricity',
  gas: 'familyBills.placeholderGas',
  water: 'familyBills.placeholderWater',
  internet: 'familyBills.placeholderInternet',
  mobile_postpaid: 'familyBills.placeholderMobilePostpaid',
  cable_tv: 'familyBills.placeholderCableTv',
  society_maintenance: 'familyBills.placeholderSocietyMaintenance',
  rent: 'familyBills.placeholderRent',
  loan_emi: 'familyBills.placeholderLoanEmi',
  credit_card: 'familyBills.placeholderCreditCard',
  medical: 'familyBills.placeholderMedical',
  insurance: 'familyBills.placeholderInsurance',
  other: 'familyBills.placeholderOther',
};

const PAYMENT_METHODS: BillPaymentMethod[] = ['upi', 'net_banking', 'credit_card', 'auto_debit', 'cash'];
const REMINDER_DAYS_OPTIONS = [1, 3, 5, 7];

export default function AddFamilyBillScreen() {
  const router = useRouter();
  const { memberId, memberName, editId } = useLocalSearchParams<{ memberId: string; memberName?: string; editId?: string }>();
  const insets = useSafeAreaInsets();
  const { colors, isDark } = useTheme();
  const { convertForStorage, convertForDisplay, symbol } = useCurrency();
  const { t } = useTranslation();

  const [showDatePicker, setShowDatePicker] = useState(false);
  const [name, setName] = useState('');
  const [amount, setAmount] = useState('');
  // Nothing preselected on a new bill; editing seeds it from the record below.
  const [category, setCategory] = useState<FamilyBillCategory | null>(null);
  const [dueDate, setDueDate] = useState(new Date());
  const [accountNumber, setAccountNumber] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<BillPaymentMethod | null>(null);
  const [reminderDaysBefore, setReminderDaysBefore] = useState<number>(3);
  const [dayOfReminderEnabled, setDayOfReminderEnabled] = useState(false);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const isEditing = !!editId;

  // Seed the form from the record being edited.
  useEffect(() => {
    if (!editId || !memberId) return;
    let cancelled = false;
    (async () => {
      const items = await loadFamilyBills(String(memberId));
      const found = items.find((x) => x.id === String(editId));
      if (!found || cancelled) return;
      setName(found.name);
      setAmount(String(Math.round(convertForDisplay(found.amount) * 100) / 100));
      setCategory(found.category);
      setDueDate(new Date(found.dueDate));
      setAccountNumber(found.accountNumber ?? '');
      setPaymentMethod(found.paymentMethod ?? null);
      setReminderDaysBefore(found.reminderDaysBefore ?? 3);
      setDayOfReminderEnabled(!!found.dayOfReminderEnabled);
    })();
    return () => { cancelled = true; };
  }, [editId, memberId]);

  const handleSave = async () => {
    if (!category) {
      setError(t('familyBills.errorSelectCategory'));
      return;
    }
    if (!name.trim()) {
      setError(t('familyBills.errorEnterName'));
      return;
    }
    const amt = parseFloat(amount);
    if (!amount.trim() || Number.isNaN(amt) || amt <= 0) {
      setError(t('familyBills.errorInvalidAmount'));
      return;
    }
    if (!memberId || saving) return;
    setSaving(true);
    const data = {
      name: name.trim(),
      // Typed in the user's display currency; stored in INR like every amount.
      amount: convertForStorage(amt),
      category,
      dueDate: dueDate.toISOString(),
      accountNumber: accountNumber.trim(),
      paymentMethod: paymentMethod ?? undefined,
      reminderDaysBefore,
      dayOfReminderEnabled,
    };
    if (isEditing) {
      await updateFamilyBill(String(memberId), String(editId), data);
    } else {
      await addFamilyBill(String(memberId), data);
    }
    router.back();
  };

  const headerHeight = 110 + insets.top;

  return (
    <View style={[styles.container, { backgroundColor: colors.bg }]}>
      <LinearGradient colors={colors.heroGradient as any} style={[styles.header, { height: headerHeight, paddingTop: insets.top }]}>
        <View style={styles.headerTop}>
          <Pressable onPress={() => router.back()} style={styles.backBtn} hitSlop={12}>
            <Ionicons name="chevron-back" size={24} color={colors.text} />
          </Pressable>
          <Text style={[styles.headerTitle, { color: colors.text }]}>{isEditing ? t('familyBills.editTitle') : t('familyBills.newTitle')}</Text>
          <View style={styles.backBtn} />
        </View>
        {memberName ? <Text style={[styles.headerSubtitle, { color: colors.textSecondary }]}>{t('familyBills.forMember', { memberName })}</Text> : null}
      </LinearGradient>

      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: insets.bottom + 40 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        {!!error && <Text style={[styles.errorText, { color: colors.danger }]}>{error}</Text>}

        {/* One scrolling row rather than a wrapping grid, so the chips keep
            their natural width and no short second row is left half-empty. */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.typeScroll}
          contentContainerStyle={styles.typeRow}
        >
          {(Object.keys(CATEGORY_LABELS) as FamilyBill['category'][]).map((c) => (
            <Pressable
              key={c}
              onPress={() => setCategory(c)}
              style={[styles.typeChip, { backgroundColor: colors.inputBg, borderColor: colors.border }, category === c && { backgroundColor: colors.accent, borderColor: colors.accent }]}
            >
              <Ionicons name={CATEGORY_LABELS[c].icon as any} size={14} color={category === c ? '#FFF' : colors.textSecondary} />
              <Text style={[styles.typeChipText, { color: category === c ? '#FFF' : colors.textSecondary }]}>{t(CATEGORY_LABELS[c].labelKey)}</Text>
            </Pressable>
          ))}
        </ScrollView>

        <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>{t('familyBills.fieldBillName')}</Text>
        <TextInput
          style={[styles.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.inputBg }]}
          value={name}
          onChangeText={setName}
          placeholder={category ? t(CATEGORY_PLACEHOLDER_KEYS[category]) : t('familyBills.placeholderDefault')}
          placeholderTextColor={colors.textTertiary}
          autoFocus
        />

        <View style={styles.formRow}>
          <View style={{ flex: 1 }}>
            <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>{t('familyBills.fieldAmount')}</Text>
            <View style={[styles.amountWrap, { borderColor: colors.border, backgroundColor: colors.inputBg }]}>
              <Text style={[styles.amountPrefix, { color: colors.textSecondary }]}>{symbol}</Text>
              <TextInput
                style={[styles.amountInput, { color: colors.text }]}
                value={amount}
                onChangeText={setAmount}
                placeholder="0"
                placeholderTextColor={colors.textTertiary}
                keyboardType="numeric"
              />
            </View>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>{t('familyBills.fieldDueDate')}</Text>
            <Pressable onPress={() => setShowDatePicker(true)} style={[styles.input, { borderColor: colors.border, backgroundColor: colors.inputBg, justifyContent: 'center' }]}>
              <Text style={{ color: colors.text }}>{dueDate.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</Text>
            </Pressable>
          </View>
        </View>

        <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>{t('familyBills.fieldAccountNumber')}</Text>
        <TextInput
          style={[styles.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.inputBg }]}
          value={accountNumber}
          onChangeText={setAccountNumber}
          placeholder={t('familyBills.accountNumberPlaceholder')}
          placeholderTextColor={colors.textTertiary}
        />

        <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>{t('familyBills.fieldPaymentMethod')}</Text>
        <View style={styles.chipGrid}>
          {PAYMENT_METHODS.map((pm) => (
            <Pressable
              key={pm}
              onPress={() => setPaymentMethod(paymentMethod === pm ? null : pm)}
              style={[styles.smallChip, { backgroundColor: colors.inputBg, borderColor: colors.border }, paymentMethod === pm && { backgroundColor: colors.accent, borderColor: colors.accent }]}
            >
              <Text style={[styles.smallChipText, { color: paymentMethod === pm ? '#FFF' : colors.textSecondary }]}>{t(`familyBills.paymentMethod.${pm}`)}</Text>
            </Pressable>
          ))}
        </View>

        <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>{t('familyBills.fieldReminderDaysBefore')}</Text>
        <View style={styles.chipGrid}>
          {REMINDER_DAYS_OPTIONS.map((d) => (
            <Pressable
              key={d}
              onPress={() => setReminderDaysBefore(d)}
              style={[styles.smallChip, { backgroundColor: colors.inputBg, borderColor: colors.border }, reminderDaysBefore === d && { backgroundColor: colors.accent, borderColor: colors.accent }]}
            >
              <Text style={[styles.smallChipText, { color: reminderDaysBefore === d ? '#FFF' : colors.textSecondary }]}>{t('familyBills.daysBefore', { count: d })}</Text>
            </Pressable>
          ))}
        </View>

        <Pressable onPress={() => setDayOfReminderEnabled(!dayOfReminderEnabled)} style={styles.toggleRow}>
          <Ionicons name={dayOfReminderEnabled ? 'checkbox' : 'square-outline'} size={22} color={dayOfReminderEnabled ? colors.accent : colors.textTertiary} />
          <Text style={[styles.toggleLabel, { color: colors.text }]}>{t('familyBills.dayOfReminderLabel')}</Text>
        </Pressable>

        <Pressable onPress={handleSave} disabled={saving} style={[styles.primaryBtn, { backgroundColor: colors.accent, opacity: saving ? 0.6 : 1 }]}>
          <Text style={styles.primaryBtnLabel}>{isEditing ? t('familyBills.saveChanges') : t('familyBills.saveBill')}</Text>
        </Pressable>
      </ScrollView>

      {showDatePicker && (
        <DateTimePicker
          value={dueDate}
          mode="date"
          display={Platform.OS === 'ios' ? 'spinner' : 'default'}
          themeVariant={isDark ? 'dark' : 'light'}
          onChange={(event, date) => { setShowDatePicker(false); if (date) setDueDate(date); }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { paddingHorizontal: 20, justifyContent: 'center', borderBottomLeftRadius: 32, borderBottomRightRadius: 32 },
  headerTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  backBtn: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontFamily: 'Inter_700Bold', fontSize: 17, flex: 1, textAlign: 'center' },
  headerSubtitle: { fontFamily: 'Inter_500Medium', fontSize: 13, marginTop: 4, textAlign: 'center' },
  primaryBtn: { borderRadius: 14, paddingVertical: 15, alignItems: 'center', marginTop: 28 },
  primaryBtnLabel: { fontFamily: 'Inter_700Bold', fontSize: 15, color: '#FFF' },
  errorText: { fontFamily: 'Inter_500Medium', fontSize: 13, marginBottom: 10, textAlign: 'center' },
  // Negative margins cancel the form's 20px padding so the rail runs edge to
  // edge; the matching content padding keeps the first and last chip clear.
  typeScroll: { marginHorizontal: -20, marginBottom: 6 },
  typeRow: { flexDirection: 'row', gap: 8, paddingHorizontal: 20 },
  typeChip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 8, paddingHorizontal: 12, borderRadius: 10, borderWidth: 1 },
  typeChipText: { fontFamily: 'Inter_600SemiBold', fontSize: 11 },
  fieldLabel: { fontFamily: 'Inter_600SemiBold', fontSize: 12, marginBottom: 6, marginTop: 10 },
  input: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontFamily: 'Inter_500Medium', fontSize: 14 },
  formRow: { flexDirection: 'row', gap: 12 },
  amountWrap: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, gap: 4 },
  amountPrefix: { fontFamily: 'Inter_600SemiBold', fontSize: 14 },
  amountInput: { flex: 1, fontFamily: 'Inter_500Medium', fontSize: 14, paddingVertical: 12 },
  chipGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  smallChip: { paddingVertical: 8, paddingHorizontal: 12, borderRadius: 10, borderWidth: 1 },
  smallChipText: { fontFamily: 'Inter_600SemiBold', fontSize: 12 },
  toggleRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 16 },
  toggleLabel: { fontFamily: 'Inter_500Medium', fontSize: 14 },
});
