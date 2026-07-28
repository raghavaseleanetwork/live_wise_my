import React, { useState } from 'react';
import { StyleSheet, Text, View, ScrollView, Pressable, TextInput } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';

import { useTheme } from '@/lib/theme-context';
import { FamilyExpense, addFamilyExpense } from '@/lib/family-records';

const CATEGORY_LABELS: Record<FamilyExpense['category'], { label: string; icon: string; color: string }> = {
  food: { label: 'Food', icon: 'fast-food', color: '#F97316' },
  shopping: { label: 'Shopping', icon: 'cart', color: '#EC4899' },
  transport: { label: 'Transport', icon: 'car', color: '#3B82F6' },
  health: { label: 'Health', icon: 'medkit', color: '#10B981' },
  other: { label: 'Other', icon: 'apps', color: '#6B7280' },
};

export default function AddFamilyExpenseScreen() {
  const router = useRouter();
  const { memberId, memberName } = useLocalSearchParams<{ memberId: string; memberName?: string }>();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();

  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [category, setCategory] = useState<FamilyExpense['category']>('food');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!description.trim()) {
      setError('Please enter what this expense was for');
      return;
    }
    const amt = parseFloat(amount);
    if (!amount.trim() || Number.isNaN(amt) || amt <= 0) {
      setError('Please enter a valid amount');
      return;
    }
    if (!memberId || saving) return;
    setSaving(true);
    await addFamilyExpense(String(memberId), {
      description: description.trim(),
      amount: amt,
      category,
      date: new Date().toISOString(),
    });
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
          <Text style={[styles.headerTitle, { color: colors.text }]}>Log Expense</Text>
          <View style={styles.backBtn} />
        </View>
        {memberName ? <Text style={[styles.headerSubtitle, { color: colors.textSecondary }]}>For {memberName}</Text> : null}
      </LinearGradient>

      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: insets.bottom + 40 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        {!!error && <Text style={[styles.errorText, { color: colors.danger }]}>{error}</Text>}

        <View style={styles.typeGrid}>
          {(Object.keys(CATEGORY_LABELS) as FamilyExpense['category'][]).map((c) => (
            <Pressable
              key={c}
              onPress={() => setCategory(c)}
              style={[styles.typeChip, { backgroundColor: colors.inputBg, borderColor: colors.border }, category === c && { backgroundColor: CATEGORY_LABELS[c].color, borderColor: CATEGORY_LABELS[c].color }]}
            >
              <Ionicons name={CATEGORY_LABELS[c].icon as any} size={14} color={category === c ? '#FFF' : colors.textSecondary} />
              <Text style={[styles.typeChipText, { color: category === c ? '#FFF' : colors.textSecondary }]}>{CATEGORY_LABELS[c].label}</Text>
            </Pressable>
          ))}
        </View>

        <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>Description</Text>
        <TextInput
          style={[styles.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.inputBg }]}
          value={description}
          onChangeText={setDescription}
          placeholder="e.g. Groceries"
          placeholderTextColor={colors.textTertiary}
          autoFocus
        />

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

        <Pressable onPress={handleSave} disabled={saving} style={[styles.primaryBtn, { backgroundColor: colors.accent, opacity: saving ? 0.6 : 1 }]}>
          <Text style={styles.primaryBtnLabel}>Save</Text>
        </Pressable>
      </ScrollView>
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
  typeGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 6 },
  typeChip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 8, paddingHorizontal: 12, borderRadius: 10, borderWidth: 1 },
  typeChipText: { fontFamily: 'Inter_600SemiBold', fontSize: 11 },
  fieldLabel: { fontFamily: 'Inter_600SemiBold', fontSize: 12, marginBottom: 6, marginTop: 10, textTransform: 'uppercase', letterSpacing: 0.5 },
  input: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontFamily: 'Inter_500Medium', fontSize: 14 },
  amountWrap: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, gap: 4 },
  amountPrefix: { fontFamily: 'Inter_600SemiBold', fontSize: 14 },
  amountInput: { flex: 1, fontFamily: 'Inter_500Medium', fontSize: 14, paddingVertical: 12 },
});
