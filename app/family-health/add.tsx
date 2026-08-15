import React, { useState } from 'react';
import { StyleSheet, Text, View, ScrollView, Pressable, TextInput, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import DateTimePicker from '@react-native-community/datetimepicker';
import { useTranslation } from 'react-i18next';

import { useTheme } from '@/lib/theme-context';
import { HealthMetricType, HEALTH_METRIC_LABELS, SugarReadingType, WeightUnit, addHealthLog } from '@/lib/family-records';

const ALL_METRICS: HealthMetricType[] = ['bp', 'sugar', 'weight', 'temperature', 'oxygen', 'heart_rate', 'cholesterol'];

export default function AddHealthLogScreen() {
  const router = useRouter();
  const { memberId, memberName } = useLocalSearchParams<{ memberId: string; memberName?: string }>();
  const insets = useSafeAreaInsets();
  const { colors, isDark } = useTheme();
  const { t } = useTranslation();

  const metricLabel = (type: HealthMetricType) => t(`familyHealth.metric.${type}`);

  const [showDatePicker, setShowDatePicker] = useState(false);
  // Nothing preselected — the user picks which metric they are logging.
  const [logType, setLogType] = useState<HealthMetricType | null>(null);
  const [value, setValue] = useState('');
  const [systolic, setSystolic] = useState('');
  const [diastolic, setDiastolic] = useState('');
  const [pulse, setPulse] = useState('');
  const [sugarReadingType, setSugarReadingType] = useState<SugarReadingType>('fasting');
  const [weightUnit, setWeightUnit] = useState<WeightUnit>('kg');
  const [targetRangeLow, setTargetRangeLow] = useState('');
  const [targetRangeHigh, setTargetRangeHigh] = useState('');
  const [notes, setNotes] = useState('');
  const [logDate, setLogDate] = useState(new Date());
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!logType) {
      setError(t('familyHealth.errorSelectType'));
      return;
    }
    const finalValue =
      logType === 'bp' ? `${systolic}/${diastolic}` : value.trim();
    if (logType === 'bp' ? (!systolic.trim() || !diastolic.trim()) : !value.trim()) {
      setError(t('familyHealth.errorEnterValue', { metric: metricLabel(logType) }));
      return;
    }
    if (!memberId || saving) return;
    setSaving(true);
    await addHealthLog(String(memberId), {
      type: logType,
      value: finalValue,
      notes: notes.trim(),
      date: logDate.toISOString(),
      systolic: logType === 'bp' && systolic.trim() ? Number(systolic) : undefined,
      diastolic: logType === 'bp' && diastolic.trim() ? Number(diastolic) : undefined,
      pulse: logType === 'bp' && pulse.trim() ? Number(pulse) : undefined,
      sugarReadingType: logType === 'sugar' ? sugarReadingType : undefined,
      weightUnit: logType === 'weight' ? weightUnit : undefined,
      targetRangeLow: targetRangeLow.trim() ? Number(targetRangeLow) : undefined,
      targetRangeHigh: targetRangeHigh.trim() ? Number(targetRangeHigh) : undefined,
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
          <Text style={[styles.headerTitle, { color: colors.text }]}>{t('familyHealth.logReadingTitle')}</Text>
          <View style={styles.backBtn} />
        </View>
        {memberName ? <Text style={[styles.headerSubtitle, { color: colors.textSecondary }]}>{t('familyHealth.forMember', { name: memberName })}</Text> : null}
      </LinearGradient>

      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: insets.bottom + 40 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        {!!error && <Text style={[styles.errorText, { color: colors.danger }]}>{error}</Text>}

        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.typeScroll} contentContainerStyle={styles.typeRow}>
          {ALL_METRICS.map((mt) => (
            <Pressable
              key={mt}
              onPress={() => setLogType(mt)}
              style={[
                styles.typeChip,
                { backgroundColor: colors.inputBg, borderColor: colors.border },
                logType === mt && { backgroundColor: colors.accent, borderColor: colors.accent },
              ]}
            >
              <Ionicons name={HEALTH_METRIC_LABELS[mt].icon as any} size={14} color={logType === mt ? '#FFF' : colors.textSecondary} />
              <Text style={[styles.typeChipText, { color: logType === mt ? '#FFF' : colors.textSecondary }]}>{metricLabel(mt)}</Text>
            </Pressable>
          ))}
        </ScrollView>

        {logType === 'bp' ? (
          <>
            <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>{t('familyHealth.readingLabelBp')}</Text>
            <View style={styles.formRow}>
              <TextInput
                style={[styles.input, { flex: 1, color: colors.text, borderColor: colors.border, backgroundColor: colors.inputBg }]}
                value={systolic}
                onChangeText={setSystolic}
                placeholder={t('familyHealth.systolicPlaceholder')}
                placeholderTextColor={colors.textTertiary}
                keyboardType="numeric"
              />
              <TextInput
                style={[styles.input, { flex: 1, color: colors.text, borderColor: colors.border, backgroundColor: colors.inputBg }]}
                value={diastolic}
                onChangeText={setDiastolic}
                placeholder={t('familyHealth.diastolicPlaceholder')}
                placeholderTextColor={colors.textTertiary}
                keyboardType="numeric"
              />
              <TextInput
                style={[styles.input, { flex: 1, color: colors.text, borderColor: colors.border, backgroundColor: colors.inputBg }]}
                value={pulse}
                onChangeText={setPulse}
                placeholder={t('familyHealth.pulsePlaceholder')}
                placeholderTextColor={colors.textTertiary}
                keyboardType="numeric"
              />
            </View>
          </>
        ) : (
          <>
            <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>
              {!logType ? t('familyHealth.valueLabel') : t('familyHealth.valueLabelWithUnit', { unit: HEALTH_METRIC_LABELS[logType].unit })}
            </Text>
            <TextInput
              style={[styles.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.inputBg }]}
              value={value}
              onChangeText={setValue}
              placeholder={!logType ? t('familyHealth.selectMetricPrompt') : '98'}
              placeholderTextColor={colors.textTertiary}
              keyboardType={logType ? 'numeric' : 'default'}
              editable={!!logType}
            />
          </>
        )}

        {logType === 'sugar' && (
          <View style={[styles.formRow, { marginTop: 10 }]}>
            {(['fasting', 'post_meal'] as const).map((srt) => (
              <Pressable
                key={srt}
                onPress={() => setSugarReadingType(srt)}
                style={[styles.smallChip, { backgroundColor: colors.inputBg, borderColor: colors.border }, sugarReadingType === srt && { backgroundColor: colors.accent, borderColor: colors.accent }]}
              >
                <Text style={[styles.smallChipText, { color: sugarReadingType === srt ? '#FFF' : colors.textSecondary }]}>{t(`familyHealth.sugarReadingType.${srt}`)}</Text>
              </Pressable>
            ))}
          </View>
        )}

        {logType === 'weight' && (
          <View style={[styles.formRow, { marginTop: 10 }]}>
            {(['kg', 'lbs'] as const).map((wu) => (
              <Pressable
                key={wu}
                onPress={() => setWeightUnit(wu)}
                style={[styles.smallChip, { backgroundColor: colors.inputBg, borderColor: colors.border }, weightUnit === wu && { backgroundColor: colors.accent, borderColor: colors.accent }]}
              >
                <Text style={[styles.smallChipText, { color: weightUnit === wu ? '#FFF' : colors.textSecondary }]}>{wu}</Text>
              </Pressable>
            ))}
          </View>
        )}

        <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>{t('familyHealth.targetRangeLabel')}</Text>
        <View style={styles.formRow}>
          <TextInput
            style={[styles.input, { flex: 1, color: colors.text, borderColor: colors.border, backgroundColor: colors.inputBg }]}
            value={targetRangeLow}
            onChangeText={setTargetRangeLow}
            placeholder={t('familyHealth.targetRangeLowPlaceholder')}
            placeholderTextColor={colors.textTertiary}
            keyboardType="numeric"
          />
          <TextInput
            style={[styles.input, { flex: 1, color: colors.text, borderColor: colors.border, backgroundColor: colors.inputBg }]}
            value={targetRangeHigh}
            onChangeText={setTargetRangeHigh}
            placeholder={t('familyHealth.targetRangeHighPlaceholder')}
            placeholderTextColor={colors.textTertiary}
            keyboardType="numeric"
          />
        </View>

        <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>{t('familyHealth.dateLabel')}</Text>
        <Pressable onPress={() => setShowDatePicker(true)} style={[styles.input, { borderColor: colors.border, backgroundColor: colors.inputBg, justifyContent: 'center' }]}>
          <Text style={{ color: colors.text }}>{logDate.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</Text>
        </Pressable>

        <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>{t('familyHealth.notesLabel')}</Text>
        <TextInput
          style={[styles.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.inputBg }]}
          value={notes}
          onChangeText={setNotes}
          placeholder={t('familyHealth.notesPlaceholder')}
          placeholderTextColor={colors.textTertiary}
        />

        <Pressable onPress={handleSave} disabled={saving} style={[styles.primaryBtn, { backgroundColor: colors.accent, opacity: saving ? 0.6 : 1 }]}>
          <Text style={styles.primaryBtnLabel}>{t('familyHealth.saveReading')}</Text>
        </Pressable>
      </ScrollView>

      {showDatePicker && (
        <DateTimePicker
          value={logDate}
          mode="date"
          display={Platform.OS === 'ios' ? 'spinner' : 'default'}
          maximumDate={new Date()}
          themeVariant={isDark ? 'dark' : 'light'}
          onChange={(event, date) => {
            setShowDatePicker(false);
            if (date) setLogDate(date);
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
  typeChip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 10, paddingHorizontal: 14, borderRadius: 12, borderWidth: 1 },
  typeChipText: { fontFamily: 'Inter_600SemiBold', fontSize: 12 },
  fieldLabel: { fontFamily: 'Inter_600SemiBold', fontSize: 12, marginBottom: 6, marginTop: 10 },
  input: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontFamily: 'Inter_500Medium', fontSize: 14 },
  formRow: { flexDirection: 'row', gap: 10 },
  smallChip: { paddingVertical: 8, paddingHorizontal: 14, borderRadius: 10, borderWidth: 1 },
  smallChipText: { fontFamily: 'Inter_600SemiBold', fontSize: 12 },
});
