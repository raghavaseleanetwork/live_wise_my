import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View, ScrollView, Pressable, TextInput } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { useTheme } from '@/lib/theme-context';
import { useAuth } from '@/lib/auth-context';
import { apiRequest } from '@/lib/query-client';
import { addStockItem, loadStock, updateStockItem } from '@/lib/family-records';

interface LinkableMedicine {
  id: string;
  name: string;
}

export default function AddStockItemScreen() {
  const router = useRouter();
  const { memberId, memberName, editId } = useLocalSearchParams<{ memberId: string; memberName?: string; editId?: string }>();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const { token } = useAuth();
  const { t } = useTranslation();

  const [medicineName, setMedicineName] = useState('');
  const [linkedMedicineId, setLinkedMedicineId] = useState<string | null>(null);
  const [linkableMedicines, setLinkableMedicines] = useState<LinkableMedicine[]>([]);
  const [quantity, setQuantity] = useState('');
  const [threshold, setThreshold] = useState('5');
  const [dailyUsage, setDailyUsage] = useState('1');
  const [pharmacyName, setPharmacyName] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const isEditing = !!editId;

  // The PRD's stock tracker is meant to link to the member's actual Medicine
  // Tracking entries — fetch those so the user picks one instead of retyping
  // a name that can drift from the real medicine record.
  useEffect(() => {
    if (!token || !memberId) return;
    (async () => {
      try {
        const res = await apiRequest('GET', '/api/family', undefined, token);
        const data = (await res.json()) as { id: string; medicines?: LinkableMedicine[] }[];
        const member = data.find((m) => String(m.id) === String(memberId));
        setLinkableMedicines(Array.isArray(member?.medicines) ? member!.medicines! : []);
      } catch {
        // Free-text entry still works if this fails.
      }
    })();
  }, [token, memberId]);

  // Seed the form from the record being edited.
  useEffect(() => {
    if (!editId || !memberId) return;
    let cancelled = false;
    (async () => {
      const items = await loadStock(String(memberId));
      const found = items.find((x) => x.id === String(editId));
      if (!found || cancelled) return;
      setMedicineName(found.medicineName);
      setLinkedMedicineId(found.linkedMedicineId ?? null);
      setQuantity(String(found.quantityRemaining));
      setThreshold(String(found.lowStockThreshold));
      setDailyUsage(String(found.dailyUsage));
      setPharmacyName(found.pharmacyName ?? '');
    })();
    return () => { cancelled = true; };
  }, [editId, memberId]);

  const selectLinkedMedicine = (med: LinkableMedicine) => {
    setLinkedMedicineId(med.id);
    setMedicineName(med.name);
  };

  const handleSave = async () => {
    if (!medicineName.trim()) {
      setError(t('familyStock.errorEnterName'));
      return;
    }
    const qty = parseInt(quantity, 10);
    if (!quantity.trim() || Number.isNaN(qty) || qty < 0) {
      setError(t('familyStock.errorInvalidQuantity'));
      return;
    }
    if (!memberId || saving) return;
    setSaving(true);
    const data = {
      medicineName: medicineName.trim(),
      linkedMedicineId,
      quantityRemaining: qty,
      lowStockThreshold: parseInt(threshold, 10) || 5,
      dailyUsage: parseInt(dailyUsage, 10) || 1,
      pharmacyName: pharmacyName.trim(),
    };
    if (isEditing) {
      await updateStockItem(String(memberId), String(editId), data);
    } else {
      await addStockItem(String(memberId), data);
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
          <Text style={[styles.headerTitle, { color: colors.text }]}>{isEditing ? t('familyStock.editHeaderTitle') : t('familyStock.newHeaderTitle')}</Text>
          <View style={styles.backBtn} />
        </View>
        {memberName ? <Text style={[styles.headerSubtitle, { color: colors.textSecondary }]}>{t('familyStock.forMember', { name: memberName })}</Text> : null}
      </LinearGradient>

      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: insets.bottom + 40 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        {!!error && <Text style={[styles.errorText, { color: colors.danger }]}>{error}</Text>}

        {linkableMedicines.length > 0 && (
          <>
            <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>{t('familyStock.linkMedicineLabel')}</Text>
            <View style={styles.chipRow}>
              {linkableMedicines.map((med) => (
                <Pressable
                  key={med.id}
                  onPress={() => selectLinkedMedicine(med)}
                  style={[styles.smallChip, { backgroundColor: colors.inputBg, borderColor: colors.border }, linkedMedicineId === med.id && { backgroundColor: colors.accent, borderColor: colors.accent }]}
                >
                  <Text style={[styles.smallChipText, { color: linkedMedicineId === med.id ? '#FFF' : colors.textSecondary }]}>{med.name}</Text>
                </Pressable>
              ))}
            </View>
          </>
        )}

        <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>{t('familyStock.medicineNameLabel')}</Text>
        <TextInput
          style={[styles.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.inputBg }]}
          value={medicineName}
          onChangeText={(v) => { setMedicineName(v); setLinkedMedicineId(null); }}
          placeholder={t('familyStock.medicineNamePlaceholder')}
          placeholderTextColor={colors.textTertiary}
          autoFocus
        />

        <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>{t('familyStock.pharmacyNameLabel')}</Text>
        <TextInput
          style={[styles.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.inputBg }]}
          value={pharmacyName}
          onChangeText={setPharmacyName}
          placeholder={t('familyStock.pharmacyNamePlaceholder')}
          placeholderTextColor={colors.textTertiary}
        />

        <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>{t('familyStock.quantityRemainingLabel')}</Text>
        <TextInput
          style={[styles.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.inputBg }]}
          value={quantity}
          onChangeText={setQuantity}
          placeholder={t('familyStock.quantityPlaceholder')}
          placeholderTextColor={colors.textTertiary}
          keyboardType="numeric"
        />

        <View style={styles.formRow}>
          <View style={{ flex: 1 }}>
            <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>{t('familyStock.dailyUsageLabel')}</Text>
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
            <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>{t('familyStock.lowStockAlertLabel')}</Text>
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
          <Text style={styles.primaryBtnLabel}>{isEditing ? t('familyStock.saveChanges') : t('common.save')}</Text>
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
  fieldLabel: { fontFamily: 'Inter_600SemiBold', fontSize: 12, marginBottom: 6, marginTop: 10 },
  input: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontFamily: 'Inter_500Medium', fontSize: 14 },
  formRow: { flexDirection: 'row', gap: 12 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  smallChip: { paddingVertical: 8, paddingHorizontal: 12, borderRadius: 10, borderWidth: 1 },
  smallChipText: { fontFamily: 'Inter_600SemiBold', fontSize: 12 },
});
