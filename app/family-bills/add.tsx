import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View, ScrollView, Pressable, TextInput, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import DateTimePicker from '@react-native-community/datetimepicker';

import { useTheme } from '@/lib/theme-context';
import { useCurrency } from '@/lib/currency-context';
import { FamilyBill, addFamilyBill, loadFamilyBills, updateFamilyBill } from '@/lib/family-records';

const CATEGORY_LABELS: Record<FamilyBill['category'], { label: string; icon: string }> = {
  electricity: { label: 'Electricity', icon: 'flash' },
  medical: { label: 'Medical', icon: 'medkit' },
  insurance: { label: 'Insurance', icon: 'shield-checkmark' },
  other: { label: 'Other', icon: 'receipt' },
};

/** Example bill name per category, so the hint matches the selected chip. */
const CATEGORY_PLACEHOLDERS: Record<FamilyBill['category'], string> = {
  electricity: 'e.g. Electricity Board',
  medical: 'e.g. Apollo Pharmacy',
  insurance: 'e.g. LIC Premium',
  other: 'e.g. Bill name',
};

export default function AddFamilyBillScreen() {
  const router = useRouter();
  const { memberId, memberName, editId } = useLocalSearchParams<{ memberId: string; memberName?: string; editId?: string }>();
  const insets = useSafeAreaInsets();
  const { colors, isDark } = useTheme();
  const { convertForStorage, convertForDisplay, symbol } = useCurrency();

  const [showDatePicker, setShowDatePicker] = useState(false);
  const [name, setName] = useState('');
  const [amount, setAmount] = useState('');
  // Nothing preselected on a new bill; editing seeds it from the record below.
  const [category, setCategory] = useState<FamilyBill['category'] | null>(null);
  const [dueDate, setDueDate] = useState(new Date());
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
    })();
    return () => { cancelled = true; };
  }, [editId, memberId]);

  const handleSave = async () => {
    if (!category) {
      setError('Please select a category');
      return;
    }
    if (!name.trim()) {
      setError('Please enter a bill name');
      return;
    }
    const amt = parseFloat(amount);
    if (!amount.trim() || Number.isNaN(amt) || amt <= 0) {
      setError('Please enter a valid amount');
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
          <Text style={[styles.headerTitle, { color: colors.text }]}>{isEditing ? 'Edit Bill' : 'New Bill'}</Text>
          <View style={styles.backBtn} />
        </View>
        {memberName ? <Text style={[styles.headerSubtitle, { color: colors.textSecondary }]}>For {memberName}</Text> : null}
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
              <Text style={[styles.typeChipText, { color: category === c ? '#FFF' : colors.textSecondary }]}>{CATEGORY_LABELS[c].label}</Text>
            </Pressable>
          ))}
        </ScrollView>

        <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>Bill Name</Text>
        <TextInput
          style={[styles.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.inputBg }]}
          value={name}
          onChangeText={setName}
          placeholder={category ? CATEGORY_PLACEHOLDERS[category] : 'e.g. Bill name'}
          placeholderTextColor={colors.textTertiary}
          autoFocus
        />

        <View style={styles.formRow}>
          <View style={{ flex: 1 }}>
            <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>Amount</Text>
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
            <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>Due Date</Text>
            <Pressable onPress={() => setShowDatePicker(true)} style={[styles.input, { borderColor: colors.border, backgroundColor: colors.inputBg, justifyContent: 'center' }]}>
              <Text style={{ color: colors.text }}>{dueDate.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</Text>
            </Pressable>
          </View>
        </View>

        <Pressable onPress={handleSave} disabled={saving} style={[styles.primaryBtn, { backgroundColor: colors.accent, opacity: saving ? 0.6 : 1 }]}>
          <Text style={styles.primaryBtnLabel}>{isEditing ? 'Save Changes' : 'Save Bill'}</Text>
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
});
