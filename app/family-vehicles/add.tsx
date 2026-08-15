import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View, ScrollView, Pressable, TextInput, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import DateTimePicker from '@react-native-community/datetimepicker';
import { useTranslation } from 'react-i18next';

import { useTheme } from '@/lib/theme-context';
import { VehicleType, VEHICLE_TYPE_LABELS, addVehicle, loadVehicles, updateVehicle } from '@/lib/family-records';

type DateField = 'insuranceExpiry' | 'pucExpiry' | 'serviceDueDate' | 'loanEmiDueDate';

export default function AddVehicleScreen() {
  const router = useRouter();
  const { memberId, memberName, editId } = useLocalSearchParams<{ memberId: string; memberName?: string; editId?: string }>();
  const insets = useSafeAreaInsets();
  const { colors, isDark } = useTheme();
  const { t } = useTranslation();

  const [vehicleType, setVehicleType] = useState<VehicleType>('car');
  const [name, setName] = useState('');
  const [registrationNumber, setRegistrationNumber] = useState('');
  const [insuranceExpiry, setInsuranceExpiry] = useState<Date | null>(null);
  const [pucExpiry, setPucExpiry] = useState<Date | null>(null);
  const [serviceDueDate, setServiceDueDate] = useState<Date | null>(null);
  const [serviceDueNote, setServiceDueNote] = useState('');
  const [loanEmiAmount, setLoanEmiAmount] = useState('');
  const [loanEmiDueDate, setLoanEmiDueDate] = useState<Date | null>(null);
  const [datePickerField, setDatePickerField] = useState<DateField | null>(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const isEditing = !!editId;

  useEffect(() => {
    if (!editId || !memberId) return;
    let cancelled = false;
    (async () => {
      const items = await loadVehicles(String(memberId));
      const found = items.find((x) => x.id === String(editId));
      if (!found || cancelled) return;
      setVehicleType(found.vehicleType);
      setName(found.name);
      setRegistrationNumber(found.registrationNumber ?? '');
      setInsuranceExpiry(found.insuranceExpiry ? new Date(found.insuranceExpiry) : null);
      setPucExpiry(found.pucExpiry ? new Date(found.pucExpiry) : null);
      setServiceDueDate(found.serviceDueDate ? new Date(found.serviceDueDate) : null);
      setServiceDueNote(found.serviceDueNote ?? '');
      setLoanEmiAmount(found.loanEmiAmount != null ? String(found.loanEmiAmount) : '');
      setLoanEmiDueDate(found.loanEmiDueDate ? new Date(found.loanEmiDueDate) : null);
    })();
    return () => { cancelled = true; };
  }, [editId, memberId]);

  const dateFieldValue = (field: DateField): Date | null => {
    if (field === 'insuranceExpiry') return insuranceExpiry;
    if (field === 'pucExpiry') return pucExpiry;
    if (field === 'serviceDueDate') return serviceDueDate;
    return loanEmiDueDate;
  };

  const setDateFieldValue = (field: DateField, date: Date) => {
    if (field === 'insuranceExpiry') setInsuranceExpiry(date);
    else if (field === 'pucExpiry') setPucExpiry(date);
    else if (field === 'serviceDueDate') setServiceDueDate(date);
    else setLoanEmiDueDate(date);
  };

  const handleSave = async () => {
    if (!name.trim()) {
      setError(t('familyVehicles.errorEnterName'));
      return;
    }
    if (!memberId || saving) return;
    setSaving(true);
    const data = {
      vehicleType,
      name: name.trim(),
      registrationNumber: registrationNumber.trim(),
      insuranceExpiry: insuranceExpiry ? insuranceExpiry.toISOString() : null,
      pucExpiry: pucExpiry ? pucExpiry.toISOString() : null,
      serviceDueDate: serviceDueDate ? serviceDueDate.toISOString() : null,
      serviceDueNote: serviceDueNote.trim(),
      loanEmiAmount: loanEmiAmount.trim() ? Number(loanEmiAmount) : null,
      loanEmiDueDate: loanEmiDueDate ? loanEmiDueDate.toISOString() : null,
    };
    if (isEditing) {
      await updateVehicle(String(memberId), String(editId), data);
    } else {
      await addVehicle(String(memberId), data);
    }
    router.back();
  };

  const headerHeight = 110 + insets.top;

  const dateRow = (field: DateField, label: string) => {
    const value = dateFieldValue(field);
    return (
      <View style={{ flex: 1 }}>
        <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>{label}</Text>
        <Pressable onPress={() => setDatePickerField(field)} style={[styles.input, { borderColor: colors.border, backgroundColor: colors.inputBg, justifyContent: 'center' }]}>
          <Text style={{ color: value ? colors.text : colors.textTertiary }}>
            {value ? value.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : t('familyVehicles.notSet')}
          </Text>
        </Pressable>
      </View>
    );
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.bg }]}>
      <LinearGradient colors={colors.heroGradient as any} style={[styles.header, { height: headerHeight, paddingTop: insets.top }]}>
        <View style={styles.headerTop}>
          <Pressable onPress={() => router.back()} style={styles.backBtn} hitSlop={12}>
            <Ionicons name="chevron-back" size={24} color={colors.text} />
          </Pressable>
          <Text style={[styles.headerTitle, { color: colors.text }]}>{isEditing ? t('familyVehicles.editHeaderTitle') : t('familyVehicles.newHeaderTitle')}</Text>
          <View style={styles.backBtn} />
        </View>
        {memberName ? <Text style={[styles.headerSubtitle, { color: colors.textSecondary }]}>{t('familyVehicles.forMember', { name: memberName })}</Text> : null}
      </LinearGradient>

      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: insets.bottom + 40 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        {!!error && <Text style={[styles.errorText, { color: colors.danger }]}>{error}</Text>}

        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.typeScroll} contentContainerStyle={styles.typeRow}>
          {(Object.keys(VEHICLE_TYPE_LABELS) as VehicleType[]).map((vt) => (
            <Pressable
              key={vt}
              onPress={() => setVehicleType(vt)}
              style={[styles.typeChip, { backgroundColor: colors.inputBg, borderColor: colors.border }, vehicleType === vt && { backgroundColor: colors.accent, borderColor: colors.accent }]}
            >
              <Ionicons name={VEHICLE_TYPE_LABELS[vt].icon as any} size={14} color={vehicleType === vt ? '#FFF' : colors.textSecondary} />
              <Text style={[styles.typeChipText, { color: vehicleType === vt ? '#FFF' : colors.textSecondary }]}>{t(`familyVehicles.type.${vt}`)}</Text>
            </Pressable>
          ))}
        </ScrollView>

        <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>{t('familyVehicles.nameLabel')}</Text>
        <TextInput
          style={[styles.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.inputBg }]}
          value={name}
          onChangeText={setName}
          placeholder={t('familyVehicles.namePlaceholder')}
          placeholderTextColor={colors.textTertiary}
          autoFocus
        />

        <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>{t('familyVehicles.registrationLabel')}</Text>
        <TextInput
          style={[styles.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.inputBg }]}
          value={registrationNumber}
          onChangeText={setRegistrationNumber}
          placeholder={t('familyVehicles.registrationPlaceholder')}
          placeholderTextColor={colors.textTertiary}
          autoCapitalize="characters"
        />

        <View style={styles.formRow}>
          {dateRow('insuranceExpiry', t('familyVehicles.insuranceExpiryLabel'))}
          {dateRow('pucExpiry', t('familyVehicles.pucExpiryLabel'))}
        </View>

        <View style={styles.formRow}>
          {dateRow('serviceDueDate', t('familyVehicles.serviceDueDateLabel'))}
        </View>
        <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>{t('familyVehicles.serviceDueNoteLabel')}</Text>
        <TextInput
          style={[styles.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.inputBg }]}
          value={serviceDueNote}
          onChangeText={setServiceDueNote}
          placeholder={t('familyVehicles.serviceDueNotePlaceholder')}
          placeholderTextColor={colors.textTertiary}
        />

        <View style={styles.formRow}>
          <View style={{ flex: 1 }}>
            <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>{t('familyVehicles.loanEmiAmountLabel')}</Text>
            <TextInput
              style={[styles.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.inputBg }]}
              value={loanEmiAmount}
              onChangeText={setLoanEmiAmount}
              placeholder={t('familyVehicles.loanEmiAmountPlaceholder')}
              placeholderTextColor={colors.textTertiary}
              keyboardType="numeric"
            />
          </View>
          {dateRow('loanEmiDueDate', t('familyVehicles.loanEmiDueDateLabel'))}
        </View>

        <Pressable onPress={handleSave} disabled={saving} style={[styles.primaryBtn, { backgroundColor: colors.accent, opacity: saving ? 0.6 : 1 }]}>
          <Text style={styles.primaryBtnLabel}>{isEditing ? t('familyVehicles.saveChanges') : t('common.save')}</Text>
        </Pressable>
      </ScrollView>

      {datePickerField && (
        <DateTimePicker
          value={dateFieldValue(datePickerField) ?? new Date()}
          mode="date"
          display={Platform.OS === 'ios' ? 'spinner' : 'default'}
          themeVariant={isDark ? 'dark' : 'light'}
          onChange={(event, d) => {
            const field = datePickerField;
            setDatePickerField(null);
            if (d && field) setDateFieldValue(field, d);
          }}
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
  typeScroll: { marginHorizontal: -20, marginBottom: 6 },
  typeRow: { flexDirection: 'row', gap: 8, paddingHorizontal: 20 },
  typeChip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 8, paddingHorizontal: 12, borderRadius: 10, borderWidth: 1 },
  typeChipText: { fontFamily: 'Inter_600SemiBold', fontSize: 11 },
  fieldLabel: { fontFamily: 'Inter_600SemiBold', fontSize: 12, marginBottom: 6, marginTop: 10 },
  input: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontFamily: 'Inter_500Medium', fontSize: 14 },
  formRow: { flexDirection: 'row', gap: 12 },
});
