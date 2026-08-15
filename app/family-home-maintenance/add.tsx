import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View, ScrollView, Pressable, TextInput, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import DateTimePicker from '@react-native-community/datetimepicker';
import { useTranslation } from 'react-i18next';

import { useTheme } from '@/lib/theme-context';
import {
  HomeTaskType,
  HOME_TASK_TYPE_LABELS,
  HomeTaskFrequency,
  addHomeMaintenanceItem,
  loadHomeMaintenanceItems,
  updateHomeMaintenanceItem,
} from '@/lib/family-records';

const FREQUENCIES: HomeTaskFrequency[] = ['monthly', 'quarterly', 'yearly', 'custom'];
type DateField = 'lastDoneDate' | 'nextDueDate' | 'amcExpiryDate';

export default function AddHomeMaintenanceScreen() {
  const router = useRouter();
  const { memberId, memberName, editId } = useLocalSearchParams<{ memberId: string; memberName?: string; editId?: string }>();
  const insets = useSafeAreaInsets();
  const { colors, isDark } = useTheme();
  const { t } = useTranslation();

  const [taskType, setTaskType] = useState<HomeTaskType>('ac_service');
  const [taskName, setTaskName] = useState('');
  const [vendorName, setVendorName] = useState('');
  const [vendorPhone, setVendorPhone] = useState('');
  const [lastDoneDate, setLastDoneDate] = useState<Date | null>(null);
  const [nextDueDate, setNextDueDate] = useState<Date | null>(null);
  const [frequency, setFrequency] = useState<HomeTaskFrequency | null>(null);
  const [hasAmc, setHasAmc] = useState(false);
  const [amcExpiryDate, setAmcExpiryDate] = useState<Date | null>(null);
  const [cost, setCost] = useState('');
  const [datePickerField, setDatePickerField] = useState<DateField | null>(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const isEditing = !!editId;

  useEffect(() => {
    if (!editId || !memberId) return;
    let cancelled = false;
    (async () => {
      const items = await loadHomeMaintenanceItems(String(memberId));
      const found = items.find((x) => x.id === String(editId));
      if (!found || cancelled) return;
      setTaskType(found.taskType);
      setTaskName(found.taskName);
      setVendorName(found.vendorName ?? '');
      setVendorPhone(found.vendorPhone ?? '');
      setLastDoneDate(found.lastDoneDate ? new Date(found.lastDoneDate) : null);
      setNextDueDate(found.nextDueDate ? new Date(found.nextDueDate) : null);
      setFrequency(found.frequency ?? null);
      setHasAmc(!!found.hasAmc);
      setAmcExpiryDate(found.amcExpiryDate ? new Date(found.amcExpiryDate) : null);
      setCost(found.cost != null ? String(found.cost) : '');
    })();
    return () => { cancelled = true; };
  }, [editId, memberId]);

  const dateFieldValue = (field: DateField): Date | null => {
    if (field === 'lastDoneDate') return lastDoneDate;
    if (field === 'nextDueDate') return nextDueDate;
    return amcExpiryDate;
  };
  const setDateFieldValue = (field: DateField, date: Date) => {
    if (field === 'lastDoneDate') setLastDoneDate(date);
    else if (field === 'nextDueDate') setNextDueDate(date);
    else setAmcExpiryDate(date);
  };

  const handleSave = async () => {
    if (!taskName.trim()) {
      setError(t('familyHomeMaintenance.errorEnterTaskName'));
      return;
    }
    if (!memberId || saving) return;
    setSaving(true);
    const data = {
      taskType,
      taskName: taskName.trim(),
      vendorName: vendorName.trim(),
      vendorPhone: vendorPhone.trim(),
      lastDoneDate: lastDoneDate ? lastDoneDate.toISOString() : null,
      nextDueDate: nextDueDate ? nextDueDate.toISOString() : null,
      frequency: frequency ?? undefined,
      hasAmc,
      amcExpiryDate: hasAmc && amcExpiryDate ? amcExpiryDate.toISOString() : null,
      cost: cost.trim() ? Number(cost) : null,
    };
    if (isEditing) {
      await updateHomeMaintenanceItem(String(memberId), String(editId), data);
    } else {
      await addHomeMaintenanceItem(String(memberId), data);
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
            {value ? value.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : t('familyHomeMaintenance.notSet')}
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
          <Text style={[styles.headerTitle, { color: colors.text }]}>{isEditing ? t('familyHomeMaintenance.editHeaderTitle') : t('familyHomeMaintenance.newHeaderTitle')}</Text>
          <View style={styles.backBtn} />
        </View>
        {memberName ? <Text style={[styles.headerSubtitle, { color: colors.textSecondary }]}>{t('familyHomeMaintenance.forMember', { name: memberName })}</Text> : null}
      </LinearGradient>

      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: insets.bottom + 40 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        {!!error && <Text style={[styles.errorText, { color: colors.danger }]}>{error}</Text>}

        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.typeScroll} contentContainerStyle={styles.typeRow}>
          {(Object.keys(HOME_TASK_TYPE_LABELS) as HomeTaskType[]).map((tt) => (
            <Pressable
              key={tt}
              onPress={() => setTaskType(tt)}
              style={[styles.typeChip, { backgroundColor: colors.inputBg, borderColor: colors.border }, taskType === tt && { backgroundColor: colors.accent, borderColor: colors.accent }]}
            >
              <Ionicons name={HOME_TASK_TYPE_LABELS[tt].icon as any} size={14} color={taskType === tt ? '#FFF' : colors.textSecondary} />
              <Text style={[styles.typeChipText, { color: taskType === tt ? '#FFF' : colors.textSecondary }]}>{t(`familyHomeMaintenance.type.${tt}`)}</Text>
            </Pressable>
          ))}
        </ScrollView>

        <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>{t('familyHomeMaintenance.taskNameLabel')}</Text>
        <TextInput
          style={[styles.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.inputBg }]}
          value={taskName}
          onChangeText={setTaskName}
          placeholder={t('familyHomeMaintenance.taskNamePlaceholder')}
          placeholderTextColor={colors.textTertiary}
          autoFocus
        />

        <View style={styles.formRow}>
          <View style={{ flex: 1 }}>
            <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>{t('familyHomeMaintenance.vendorNameLabel')}</Text>
            <TextInput
              style={[styles.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.inputBg }]}
              value={vendorName}
              onChangeText={setVendorName}
              placeholder={t('familyHomeMaintenance.vendorNamePlaceholder')}
              placeholderTextColor={colors.textTertiary}
            />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>{t('familyHomeMaintenance.vendorPhoneLabel')}</Text>
            <TextInput
              style={[styles.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.inputBg }]}
              value={vendorPhone}
              onChangeText={setVendorPhone}
              placeholder={t('familyHomeMaintenance.vendorPhonePlaceholder')}
              placeholderTextColor={colors.textTertiary}
              keyboardType="phone-pad"
            />
          </View>
        </View>

        <View style={styles.formRow}>
          {dateRow('lastDoneDate', t('familyHomeMaintenance.lastDoneDateLabel'))}
          {dateRow('nextDueDate', t('familyHomeMaintenance.nextDueDateLabel'))}
        </View>

        <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>{t('familyHomeMaintenance.frequencyLabel')}</Text>
        <View style={styles.freqRow}>
          {FREQUENCIES.map((f) => (
            <Pressable
              key={f}
              onPress={() => setFrequency(frequency === f ? null : f)}
              style={[styles.freqChip, { backgroundColor: colors.inputBg, borderColor: colors.border }, frequency === f && { backgroundColor: colors.accent, borderColor: colors.accent }]}
            >
              <Text style={[styles.freqChipText, { color: frequency === f ? '#FFF' : colors.textSecondary }]}>{t(`familyHomeMaintenance.frequency.${f}`)}</Text>
            </Pressable>
          ))}
        </View>

        <Pressable onPress={() => setHasAmc(!hasAmc)} style={styles.toggleRow}>
          <Ionicons name={hasAmc ? 'checkbox' : 'square-outline'} size={22} color={hasAmc ? colors.accent : colors.textTertiary} />
          <Text style={[styles.toggleLabel, { color: colors.text }]}>{t('familyHomeMaintenance.hasAmcLabel')}</Text>
        </Pressable>
        {hasAmc && (
          <View style={styles.formRow}>
            {dateRow('amcExpiryDate', t('familyHomeMaintenance.amcExpiryDateLabel'))}
          </View>
        )}

        <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>{t('familyHomeMaintenance.costLabel')}</Text>
        <TextInput
          style={[styles.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.inputBg }]}
          value={cost}
          onChangeText={setCost}
          placeholder={t('familyHomeMaintenance.costPlaceholder')}
          placeholderTextColor={colors.textTertiary}
          keyboardType="numeric"
        />

        <Pressable onPress={handleSave} disabled={saving} style={[styles.primaryBtn, { backgroundColor: colors.accent, opacity: saving ? 0.6 : 1 }]}>
          <Text style={styles.primaryBtnLabel}>{isEditing ? t('familyHomeMaintenance.saveChanges') : t('common.save')}</Text>
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
  freqRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  freqChip: { paddingVertical: 8, paddingHorizontal: 14, borderRadius: 10, borderWidth: 1 },
  freqChipText: { fontFamily: 'Inter_600SemiBold', fontSize: 12 },
  toggleRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 16 },
  toggleLabel: { fontFamily: 'Inter_500Medium', fontSize: 14 },
});
