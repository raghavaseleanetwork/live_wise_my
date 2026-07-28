import React, { useState } from 'react';
import { StyleSheet, Text, View, ScrollView, Pressable, TextInput, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import DateTimePicker from '@react-native-community/datetimepicker';

import { useTheme } from '@/lib/theme-context';
import { FamilySubscription, addSubscription } from '@/lib/family-records';

export default function AddSubscriptionScreen() {
  const router = useRouter();
  const { memberId, memberName } = useLocalSearchParams<{ memberId: string; memberName?: string }>();
  const insets = useSafeAreaInsets();
  const { colors, isDark } = useTheme();

  const [showDatePicker, setShowDatePicker] = useState(false);
  const [serviceName, setServiceName] = useState('');
  const [amount, setAmount] = useState('');
  const [cycle, setCycle] = useState<FamilySubscription['cycle']>('monthly');
  const [category] = useState<FamilySubscription['category']>('ott');
  const [renewalDate, setRenewalDate] = useState(new Date());
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!serviceName.trim()) {
      setError('Please enter a service name');
      return;
    }
    const amt = parseFloat(amount);
    if (!amount.trim() || Number.isNaN(amt) || amt <= 0) {
      setError('Please enter a valid amount');
      return;
    }
    if (!memberId || saving) return;
    setSaving(true);
    await addSubscription(String(memberId), {
      serviceName: serviceName.trim(),
      amount: amt,
      cycle,
      category,
      renewalDate: renewalDate.toISOString(),
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
          <Text style={[styles.headerTitle, { color: colors.text }]}>New Subscription</Text>
          <View style={styles.backBtn} />
        </View>
        {memberName ? <Text style={[styles.headerSubtitle, { color: colors.textSecondary }]}>For {memberName}</Text> : null}
      </LinearGradient>

      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: insets.bottom + 40 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        {!!error && <Text style={[styles.errorText, { color: colors.danger }]}>{error}</Text>}

        <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>Service Name</Text>
        <TextInput
          style={[styles.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.inputBg }]}
          value={serviceName}
          onChangeText={setServiceName}
          placeholder="e.g. Netflix"
          placeholderTextColor={colors.textTertiary}
          autoFocus
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
            <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>Renewal Date</Text>
            <Pressable onPress={() => setShowDatePicker(true)} style={[styles.input, { borderColor: colors.border, backgroundColor: colors.inputBg, justifyContent: 'center' }]}>
              <Text style={{ color: colors.text }}>{renewalDate.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</Text>
            </Pressable>
          </View>
        </View>

        <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>Billing Cycle</Text>
        <View style={styles.typeRow}>
          {(['monthly', 'yearly'] as const).map((c) => (
            <Pressable key={c} onPress={() => setCycle(c)} style={[styles.typeChip, { backgroundColor: colors.inputBg, borderColor: colors.border }, cycle === c && { backgroundColor: colors.accent, borderColor: colors.accent }]}>
              <Text style={[styles.typeChipText, { color: cycle === c ? '#FFF' : colors.textSecondary }]}>{c === 'monthly' ? 'Monthly' : 'Yearly'}</Text>
            </Pressable>
          ))}
        </View>

        <Pressable onPress={handleSave} disabled={saving} style={[styles.primaryBtn, { backgroundColor: colors.accent, opacity: saving ? 0.6 : 1 }]}>
          <Text style={styles.primaryBtnLabel}>Save</Text>
        </Pressable>
      </ScrollView>

      {showDatePicker && (
        <DateTimePicker
          value={renewalDate}
          mode="date"
          display={Platform.OS === 'ios' ? 'spinner' : 'default'}
          themeVariant={isDark ? 'dark' : 'light'}
          onChange={(event, date) => { setShowDatePicker(false); if (date) setRenewalDate(date); }}
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
  fieldLabel: { fontFamily: 'Inter_600SemiBold', fontSize: 12, marginBottom: 6, marginTop: 10, textTransform: 'uppercase', letterSpacing: 0.5 },
  input: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontFamily: 'Inter_500Medium', fontSize: 14 },
  formRow: { flexDirection: 'row', gap: 12 },
  amountWrap: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, gap: 4 },
  amountPrefix: { fontFamily: 'Inter_600SemiBold', fontSize: 14 },
  amountInput: { flex: 1, fontFamily: 'Inter_500Medium', fontSize: 14, paddingVertical: 12 },
  typeRow: { flexDirection: 'row', gap: 8 },
  typeChip: { flex: 1, paddingVertical: 10, borderRadius: 12, borderWidth: 1, alignItems: 'center' },
  typeChipText: { fontFamily: 'Inter_600SemiBold', fontSize: 12 },
});
