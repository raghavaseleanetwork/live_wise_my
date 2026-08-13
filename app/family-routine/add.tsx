import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View, ScrollView, Pressable, TextInput, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import DateTimePicker from '@react-native-community/datetimepicker';
import { useTranslation } from 'react-i18next';

import { useTheme } from '@/lib/theme-context';
import { RoutineType, ROUTINE_TYPE_LABELS, addRoutine, loadRoutines, updateRoutine } from '@/lib/family-records';

export default function AddRoutineScreen() {
  const router = useRouter();
  const { memberId, memberName, editId } = useLocalSearchParams<{ memberId: string; memberName?: string; editId?: string }>();
  const insets = useSafeAreaInsets();
  const { colors, isDark } = useTheme();
  const { t } = useTranslation();

  const routineTypeLabel = (type: RoutineType) => t(`familyRoutine.type.${type}`);
  const DAY_LABELS = [t('common.dayShort.sun'), t('common.dayShort.mon'), t('common.dayShort.tue'), t('common.dayShort.wed'), t('common.dayShort.thu'), t('common.dayShort.fri'), t('common.dayShort.sat')];

  const [showTimePicker, setShowTimePicker] = useState(false);
  // Nothing preselected on a new routine; editing seeds it from the record.
  const [routineType, setRoutineType] = useState<RoutineType | null>(null);
  const [customLabel, setCustomLabel] = useState('');
  const [time, setTime] = useState(new Date());
  const [selectedDays, setSelectedDays] = useState<number[]>([]);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const toggleDay = (d: number) => {
    setSelectedDays((prev) => (prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d].sort()));
  };

  const isEditing = !!editId;

  // Seed the form from the record being edited.
  useEffect(() => {
    if (!editId || !memberId) return;
    let cancelled = false;
    (async () => {
      const items = await loadRoutines(String(memberId));
      const found = items.find((x) => x.id === String(editId));
      if (!found || cancelled) return;
      setRoutineType(found.type);
      if (found.type === 'custom') setCustomLabel(found.label);
      // Absent on routines saved before day selection existed; those mean
      // "every day", which is the empty array.
      setSelectedDays(found.days ?? []);
      // Stored as "HH:MM AM/PM"; the picker needs a Date, so parse it back
      // or editing would silently reset the time to now.
      const parts = /^(\d{1,2}):(\d{2})\s*(AM|PM)$/i.exec(found.time?.trim() ?? '');
      if (parts) {
        let hours = Number(parts[1]) % 12;
        if (parts[3].toUpperCase() === 'PM') hours += 12;
        const d = new Date();
        d.setHours(hours, Number(parts[2]), 0, 0);
        setTime(d);
      }
    })();
    return () => { cancelled = true; };
  }, [editId, memberId]);

  const handleSave = async () => {
    if (!routineType) {
      setError(t('familyRoutine.errorSelectType'));
      return;
    }
    if (routineType === 'custom' && !customLabel.trim()) {
      setError(t('familyRoutine.errorNameCustom'));
      return;
    }
    if (!memberId || saving) return;
    setSaving(true);
    const timeStr = time.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
    const data = {
      type: routineType,
      label: routineType === 'custom' ? customLabel.trim() : ROUTINE_TYPE_LABELS[routineType].label,
      time: timeStr,
      days: selectedDays,
    };
    if (isEditing) {
      await updateRoutine(String(memberId), String(editId), data);
    } else {
      await addRoutine(String(memberId), data);
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
          <Text style={[styles.headerTitle, { color: colors.text }]}>{isEditing ? t('familyRoutine.editHeaderTitle') : t('familyRoutine.newHeaderTitle')}</Text>
          <View style={styles.backBtn} />
        </View>
        {memberName ? <Text style={[styles.headerSubtitle, { color: colors.textSecondary }]}>{t('familyRoutine.forMember', { name: memberName })}</Text> : null}
      </LinearGradient>

      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: insets.bottom + 40 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        {!!error && <Text style={[styles.errorText, { color: colors.danger }]}>{error}</Text>}

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.typeScroll}
          contentContainerStyle={styles.typeGrid}
        >
          {(['wakeup', 'sleep', 'walk', 'custom'] as const).map((rt) => (
            <Pressable
              key={rt}
              onPress={() => setRoutineType(rt)}
              style={[
                styles.typeChip,
                { backgroundColor: colors.inputBg, borderColor: colors.border },
                routineType === rt && { backgroundColor: colors.accent, borderColor: colors.accent },
              ]}
            >
              <Ionicons name={ROUTINE_TYPE_LABELS[rt].icon as any} size={16} color={routineType === rt ? '#FFF' : colors.textSecondary} />
              <Text style={[styles.typeChipText, { color: routineType === rt ? '#FFF' : colors.textSecondary }]}>{routineTypeLabel(rt)}</Text>
            </Pressable>
          ))}
        </ScrollView>

        {routineType === 'custom' && (
          <>
            <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>{t('familyRoutine.routineNameLabel')}</Text>
            <TextInput
              style={[styles.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.inputBg }]}
              value={customLabel}
              onChangeText={setCustomLabel}
              placeholder={t('familyRoutine.routineNamePlaceholder')}
              placeholderTextColor={colors.textTertiary}
              autoFocus
            />
          </>
        )}

        <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>{t('familyRoutine.timeLabel')}</Text>
        <Pressable onPress={() => setShowTimePicker(true)} style={[styles.input, { borderColor: colors.border, backgroundColor: colors.inputBg, justifyContent: 'center' }]}>
          <Text style={{ color: colors.text }}>{time.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true })}</Text>
        </Pressable>

        <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>{t('familyRoutine.repeatOnLabel')}</Text>
        <View style={styles.dayRow}>
          {DAY_LABELS.map((d, idx) => (
            <Pressable
              key={d}
              onPress={() => toggleDay(idx)}
              style={[styles.dayChip, { backgroundColor: colors.inputBg, borderColor: colors.border }, selectedDays.includes(idx) && { backgroundColor: colors.accent, borderColor: colors.accent }]}
            >
              <Text style={[styles.dayChipText, { color: selectedDays.includes(idx) ? '#FFF' : colors.textSecondary }]}>{d}</Text>
            </Pressable>
          ))}
        </View>

        <Pressable onPress={handleSave} disabled={saving} style={[styles.primaryBtn, { backgroundColor: colors.accent, opacity: saving ? 0.6 : 1 }]}>
          <Text style={styles.primaryBtnLabel}>{isEditing ? t('familyRoutine.saveChanges') : t('common.save')}</Text>
        </Pressable>
      </ScrollView>

      {showTimePicker && (
        <DateTimePicker
          value={time}
          mode="time"
          display={Platform.OS === 'ios' ? 'spinner' : 'default'}
          themeVariant={isDark ? 'dark' : 'light'}
          onChange={(event, date) => {
            setShowTimePicker(false);
            if (date) setTime(date);
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
  // Horizontal rail; negative margin cancels the form's 20px padding so it
  // runs edge to edge, with matching content padding on the inside.
  typeScroll: { marginHorizontal: -20, marginBottom: 6 },
  typeGrid: { flexDirection: 'row', gap: 8, paddingHorizontal: 20 },
  typeChip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 10, paddingHorizontal: 14, borderRadius: 12, borderWidth: 1 },
  typeChipText: { fontFamily: 'Inter_600SemiBold', fontSize: 12 },
  fieldLabel: { fontFamily: 'Inter_600SemiBold', fontSize: 12, marginBottom: 6, marginTop: 10 },
  input: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontFamily: 'Inter_500Medium', fontSize: 14 },
  dayRow: { flexDirection: 'row', gap: 6 },
  dayChip: { flex: 1, paddingVertical: 8, borderRadius: 10, borderWidth: 1, alignItems: 'center' },
  dayChipText: { fontFamily: 'Inter_600SemiBold', fontSize: 11 },
});
