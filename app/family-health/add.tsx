import React, { useState } from 'react';
import { StyleSheet, Text, View, ScrollView, Pressable, TextInput, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import DateTimePicker from '@react-native-community/datetimepicker';

import { useTheme } from '@/lib/theme-context';
import { HealthMetricType, HEALTH_METRIC_LABELS, addHealthLog } from '@/lib/family-records';

export default function AddHealthLogScreen() {
  const router = useRouter();
  const { memberId, memberName } = useLocalSearchParams<{ memberId: string; memberName?: string }>();
  const insets = useSafeAreaInsets();
  const { colors, isDark } = useTheme();

  const [showDatePicker, setShowDatePicker] = useState(false);
  const [logType, setLogType] = useState<HealthMetricType>('bp');
  const [value, setValue] = useState('');
  const [notes, setNotes] = useState('');
  const [logDate, setLogDate] = useState(new Date());
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!value.trim()) {
      setError(`Please enter a ${HEALTH_METRIC_LABELS[logType].label.toLowerCase()} value`);
      return;
    }
    if (!memberId || saving) return;
    setSaving(true);
    await addHealthLog(String(memberId), {
      type: logType,
      value: value.trim(),
      notes: notes.trim(),
      date: logDate.toISOString(),
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
          <Text style={[styles.headerTitle, { color: colors.text }]}>Log Reading</Text>
          <View style={styles.backBtn} />
        </View>
        {memberName ? <Text style={[styles.headerSubtitle, { color: colors.textSecondary }]}>For {memberName}</Text> : null}
      </LinearGradient>

      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: insets.bottom + 40 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        {!!error && <Text style={[styles.errorText, { color: colors.danger }]}>{error}</Text>}

        <View style={styles.typeRow}>
          {(['bp', 'sugar', 'weight'] as const).map((t) => (
            <Pressable
              key={t}
              onPress={() => setLogType(t)}
              style={[
                styles.typeChip,
                { backgroundColor: colors.inputBg, borderColor: colors.border },
                logType === t && { backgroundColor: colors.accent, borderColor: colors.accent },
              ]}
            >
              <Text style={[styles.typeChipText, { color: logType === t ? '#FFF' : colors.textSecondary }]}>{HEALTH_METRIC_LABELS[t].label}</Text>
            </Pressable>
          ))}
        </View>

        <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>
          {logType === 'bp' ? 'Reading (e.g. 120/80)' : `Value (${HEALTH_METRIC_LABELS[logType].unit})`}
        </Text>
        <TextInput
          style={[styles.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.inputBg }]}
          value={value}
          onChangeText={setValue}
          placeholder={logType === 'bp' ? '120/80' : logType === 'sugar' ? '98' : '72'}
          placeholderTextColor={colors.textTertiary}
          keyboardType={logType === 'bp' ? 'default' : 'numeric'}
          autoFocus
        />

        <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>Date</Text>
        <Pressable onPress={() => setShowDatePicker(true)} style={[styles.input, { borderColor: colors.border, backgroundColor: colors.inputBg, justifyContent: 'center' }]}>
          <Text style={{ color: colors.text }}>{logDate.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</Text>
        </Pressable>

        <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>Notes (optional)</Text>
        <TextInput
          style={[styles.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.inputBg }]}
          value={notes}
          onChangeText={setNotes}
          placeholder="e.g. After morning walk"
          placeholderTextColor={colors.textTertiary}
        />

        <Pressable onPress={handleSave} disabled={saving} style={[styles.primaryBtn, { backgroundColor: colors.accent, opacity: saving ? 0.6 : 1 }]}>
          <Text style={styles.primaryBtnLabel}>Save Reading</Text>
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
  typeRow: { flexDirection: 'row', gap: 8, marginBottom: 6 },
  typeChip: { flex: 1, paddingVertical: 10, borderRadius: 12, borderWidth: 1, alignItems: 'center' },
  typeChipText: { fontFamily: 'Inter_600SemiBold', fontSize: 12 },
  fieldLabel: { fontFamily: 'Inter_600SemiBold', fontSize: 12, marginBottom: 6, marginTop: 10, textTransform: 'uppercase', letterSpacing: 0.5 },
  input: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontFamily: 'Inter_500Medium', fontSize: 14 },
});
