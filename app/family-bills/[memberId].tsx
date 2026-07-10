import React, { useCallback, useState } from 'react';
import { StyleSheet, Text, View, ScrollView, Pressable, TextInput, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams, useFocusEffect } from 'expo-router';
import DateTimePicker from '@react-native-community/datetimepicker';
import Animated, { FadeInDown } from 'react-native-reanimated';

import { useTheme } from '@/lib/theme-context';
import { useCurrency } from '@/lib/currency-context';
import CustomModal from '@/components/CustomModal';
import {
  FamilyBill,
  loadFamilyBills,
  addFamilyBill,
  toggleFamilyBillPaid,
  deleteFamilyBill,
} from '@/lib/family-records';

const CATEGORY_LABELS: Record<FamilyBill['category'], { label: string; icon: string }> = {
  electricity: { label: 'Electricity', icon: 'flash' },
  medical: { label: 'Medical', icon: 'medkit' },
  insurance: { label: 'Insurance', icon: 'shield-checkmark' },
  other: { label: 'Other', icon: 'receipt' },
};

export default function FamilyBillsScreen() {
  const router = useRouter();
  const { memberId, memberName } = useLocalSearchParams<{ memberId: string; memberName?: string }>();
  const insets = useSafeAreaInsets();
  const { colors, isDark } = useTheme();
  const { formatAmount } = useCurrency();

  const [items, setItems] = useState<FamilyBill[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [showDatePicker, setShowDatePicker] = useState(false);

  const [name, setName] = useState('');
  const [amount, setAmount] = useState('');
  const [category, setCategory] = useState<FamilyBill['category']>('electricity');
  const [dueDate, setDueDate] = useState(new Date());
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!memberId) return;
    setItems(await loadFamilyBills(String(memberId)));
  }, [memberId]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const resetForm = () => {
    setName('');
    setAmount('');
    setCategory('electricity');
    setDueDate(new Date());
    setError('');
  };

  const handleAdd = async () => {
    if (!name.trim()) {
      setError('Please enter a bill name');
      return;
    }
    const amt = parseFloat(amount);
    if (!amount.trim() || Number.isNaN(amt) || amt <= 0) {
      setError('Please enter a valid amount');
      return;
    }
    if (!memberId) return;
    await addFamilyBill(String(memberId), {
      name: name.trim(),
      amount: amt,
      category,
      dueDate: dueDate.toISOString(),
    });
    setShowAdd(false);
    resetForm();
    load();
  };

  const unpaid = items.filter((b) => !b.isPaid).sort((a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime());
  const paid = items.filter((b) => b.isPaid);
  const headerHeight = 110 + insets.top;

  return (
    <View style={[styles.container, { backgroundColor: colors.bg }]}>
      <LinearGradient colors={colors.heroGradient as any} style={[styles.header, { height: headerHeight, paddingTop: insets.top }]}>
        <View style={styles.headerTop}>
          <Pressable onPress={() => router.back()} style={styles.backBtn} hitSlop={12}>
            <Ionicons name="chevron-back" size={24} color={colors.text} />
          </Pressable>
          <Text style={[styles.headerTitle, { color: colors.text }]}>💡 Bill Management</Text>
          <Pressable onPress={() => setShowAdd(true)} style={styles.addBtn} hitSlop={12}>
            <Ionicons name="add-circle" size={30} color={colors.accent} />
          </Pressable>
        </View>
        {memberName ? <Text style={[styles.headerSubtitle, { color: colors.textSecondary }]}>For {memberName}</Text> : null}
      </LinearGradient>

      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: insets.bottom + 40 }} showsVerticalScrollIndicator={false}>
        {items.length === 0 ? (
          <View style={styles.emptyState}>
            <Ionicons name="receipt-outline" size={48} color={colors.textTertiary} />
            <Text style={[styles.emptyTitle, { color: colors.text }]}>No bills yet</Text>
            <Text style={[styles.emptyDesc, { color: colors.textTertiary }]}>Tap + to track electricity, medical, or insurance bills.</Text>
          </View>
        ) : (
          <>
            {unpaid.length > 0 && (
              <>
                <Text style={[styles.sectionLabel, { color: colors.textSecondary }]}>DUE</Text>
                {unpaid.map((bill) => (
                  <BillCard key={bill.id} bill={bill} colors={colors} formatAmount={formatAmount}
                    onToggle={async () => { await toggleFamilyBillPaid(String(memberId), bill.id); load(); }}
                    onDelete={async () => { await deleteFamilyBill(String(memberId), bill.id); load(); }} />
                ))}
              </>
            )}
            {paid.length > 0 && (
              <>
                <Text style={[styles.sectionLabel, { color: colors.textSecondary, marginTop: 20 }]}>PAID</Text>
                {paid.map((bill) => (
                  <BillCard key={bill.id} bill={bill} colors={colors} formatAmount={formatAmount}
                    onToggle={async () => { await toggleFamilyBillPaid(String(memberId), bill.id); load(); }}
                    onDelete={async () => { await deleteFamilyBill(String(memberId), bill.id); load(); }} />
                ))}
              </>
            )}
          </>
        )}
      </ScrollView>

      <CustomModal visible={showAdd} onClose={() => { setShowAdd(false); resetForm(); }} showCloseButton={false}>
        <Text style={[styles.modalTitle, { color: colors.text }]}>New Bill</Text>
        {!!error && <Text style={[styles.errorText, { color: colors.danger }]}>{error}</Text>}

        <View style={styles.typeRow}>
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
        </View>

        <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>Bill Name</Text>
        <TextInput
          style={[styles.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.inputBg }]}
          value={name}
          onChangeText={setName}
          placeholder="e.g. Electricity Board"
          placeholderTextColor={colors.textTertiary}
        />

        <View style={styles.formRow}>
          <View style={{ flex: 1 }}>
            <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>Amount</Text>
            <View style={[styles.amountWrap, { borderColor: colors.border, backgroundColor: colors.inputBg }]}>
              <Text style={[styles.amountPrefix, { color: colors.textSecondary }]}>₹</Text>
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

        <View style={styles.modalActionsRow}>
          <Pressable onPress={() => { setShowAdd(false); resetForm(); }} style={styles.modalTextBtn}>
            <Text style={[styles.modalTextBtnLabel, { color: colors.textTertiary }]}>Cancel</Text>
          </Pressable>
          <Pressable onPress={handleAdd} style={[styles.modalPrimaryBtn, { backgroundColor: colors.accent }]}>
            <Text style={styles.modalPrimaryBtnLabel}>Save Bill</Text>
          </Pressable>
        </View>
      </CustomModal>

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

function BillCard({
  bill, colors, formatAmount, onToggle, onDelete,
}: { bill: FamilyBill; colors: any; formatAmount: (n: number) => string; onToggle: () => void; onDelete: () => void }) {
  const def = CATEGORY_LABELS[bill.category];
  return (
    <Animated.View entering={FadeInDown.duration(300)} style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <Pressable onPress={onToggle} style={styles.checkCircle}>
        <Ionicons name={bill.isPaid ? 'checkmark-circle' : 'ellipse-outline'} size={26} color={bill.isPaid ? '#10B981' : colors.textTertiary} />
      </Pressable>
      <View style={[styles.iconWrap, { backgroundColor: colors.accentDim }]}>
        <Ionicons name={def.icon as any} size={16} color={colors.accent} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[styles.cardTitle, { color: colors.text }, bill.isPaid && { textDecorationLine: 'line-through', opacity: 0.5 }]} numberOfLines={1}>{bill.name}</Text>
        <Text style={[styles.cardSub, { color: colors.textTertiary }]}>
          Due {new Date(bill.dueDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
        </Text>
      </View>
      <Text style={[styles.cardAmount, { color: colors.text }]}>{formatAmount(bill.amount)}</Text>
      <Pressable onPress={onDelete} hitSlop={10} style={{ marginLeft: 10 }}>
        <Ionicons name="trash-outline" size={18} color={colors.textTertiary} />
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { paddingHorizontal: 20, justifyContent: 'center', borderBottomLeftRadius: 32, borderBottomRightRadius: 32 },
  headerTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  backBtn: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  addBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontFamily: 'Inter_700Bold', fontSize: 18 },
  headerSubtitle: { fontFamily: 'Inter_500Medium', fontSize: 13, marginTop: 4, textAlign: 'center' },
  emptyState: { alignItems: 'center', paddingVertical: 60, gap: 10 },
  emptyTitle: { fontFamily: 'Inter_700Bold', fontSize: 17 },
  emptyDesc: { fontFamily: 'Inter_400Regular', fontSize: 13, textAlign: 'center', paddingHorizontal: 30 },
  sectionLabel: { fontFamily: 'Inter_700Bold', fontSize: 12, letterSpacing: 1, marginBottom: 10 },
  card: { flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 18, borderWidth: 1, padding: 14, marginBottom: 10 },
  checkCircle: { padding: 2 },
  iconWrap: { width: 32, height: 32, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  cardTitle: { fontFamily: 'Inter_600SemiBold', fontSize: 14 },
  cardSub: { fontFamily: 'Inter_400Regular', fontSize: 11, marginTop: 2 },
  cardAmount: { fontFamily: 'Inter_700Bold', fontSize: 14 },
  modalTitle: { fontFamily: 'Inter_700Bold', fontSize: 18, marginBottom: 12, textAlign: 'center' },
  errorText: { fontFamily: 'Inter_500Medium', fontSize: 13, marginBottom: 10, textAlign: 'center' },
  typeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 6 },
  typeChip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 8, paddingHorizontal: 12, borderRadius: 10, borderWidth: 1 },
  typeChipText: { fontFamily: 'Inter_600SemiBold', fontSize: 11 },
  fieldLabel: { fontFamily: 'Inter_600SemiBold', fontSize: 12, marginBottom: 6, marginTop: 10, textTransform: 'uppercase', letterSpacing: 0.5 },
  input: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontFamily: 'Inter_500Medium', fontSize: 14 },
  formRow: { flexDirection: 'row', gap: 12 },
  amountWrap: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, gap: 4 },
  amountPrefix: { fontFamily: 'Inter_600SemiBold', fontSize: 14 },
  amountInput: { flex: 1, fontFamily: 'Inter_500Medium', fontSize: 14, paddingVertical: 12 },
  modalActionsRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 20 },
  modalTextBtn: { paddingVertical: 10, paddingHorizontal: 16 },
  modalTextBtnLabel: { fontFamily: 'Inter_500Medium', fontSize: 14 },
  modalPrimaryBtn: { paddingVertical: 12, paddingHorizontal: 20, borderRadius: 14 },
  modalPrimaryBtnLabel: { fontFamily: 'Inter_700Bold', fontSize: 14, color: '#FFF' },
});
