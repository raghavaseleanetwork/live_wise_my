import React, { useState } from 'react';
import { StyleSheet, Text, View, ScrollView, Pressable, TextInput } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';

import { useTheme } from '@/lib/theme-context';
import { addStockItem } from '@/lib/family-records';

export default function AddStockItemScreen() {
  const router = useRouter();
  const { memberId, memberName } = useLocalSearchParams<{ memberId: string; memberName?: string }>();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();

  const [medicineName, setMedicineName] = useState('');
  const [quantity, setQuantity] = useState('');
  const [threshold, setThreshold] = useState('5');
  const [dailyUsage, setDailyUsage] = useState('1');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!medicineName.trim()) {
      setError('Please enter the medicine name');
      return;
    }
    const qty = parseInt(quantity, 10);
    if (!quantity.trim() || Number.isNaN(qty) || qty < 0) {
      setError('Please enter a valid quantity remaining');
      return;
    }
    if (!memberId || saving) return;
    setSaving(true);
    await addStockItem(String(memberId), {
      medicineName: medicineName.trim(),
      quantityRemaining: qty,
      lowStockThreshold: parseInt(threshold, 10) || 5,
      dailyUsage: parseInt(dailyUsage, 10) || 1,
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
          <Text style={[styles.headerTitle, { color: colors.text }]}>Track Medicine Stock</Text>
          <View style={styles.backBtn} />
        </View>
        {memberName ? <Text style={[styles.headerSubtitle, { color: colors.textSecondary }]}>For {memberName}</Text> : null}
      </LinearGradient>

      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: insets.bottom + 40 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        {!!error && <Text style={[styles.errorText, { color: colors.danger }]}>{error}</Text>}

        <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>Medicine Name</Text>
        <TextInput
          style={[styles.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.inputBg }]}
          value={medicineName}
          onChangeText={setMedicineName}
          placeholder="e.g. Metformin"
          placeholderTextColor={colors.textTertiary}
          autoFocus
        />

        <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>Quantity Remaining</Text>
        <TextInput
          style={[styles.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.inputBg }]}
          value={quantity}
          onChangeText={setQuantity}
          placeholder="e.g. 30"
          placeholderTextColor={colors.textTertiary}
          keyboardType="numeric"
        />

        <View style={styles.formRow}>
          <View style={{ flex: 1 }}>
            <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>Daily Usage</Text>
            <TextInput
              style={[styles.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.inputBg }]}
              value={dailyUsage}
              onChangeText={setDailyUsage}
              placeholder="1"
              placeholderTextColor={colors.textTertiary}
              keyboardType="numeric"
            />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>Low Stock Alert At</Text>
            <TextInput
              style={[styles.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.inputBg }]}
              value={threshold}
              onChangeText={setThreshold}
              placeholder="5"
              placeholderTextColor={colors.textTertiary}
              keyboardType="numeric"
            />
          </View>
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
  fieldLabel: { fontFamily: 'Inter_600SemiBold', fontSize: 12, marginBottom: 6, marginTop: 10, textTransform: 'uppercase', letterSpacing: 0.5 },
  input: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontFamily: 'Inter_500Medium', fontSize: 14 },
  formRow: { flexDirection: 'row', gap: 12 },
});
