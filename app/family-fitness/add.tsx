import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View, ScrollView, Pressable, TextInput, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import DateTimePicker from '@react-native-community/datetimepicker';
import { useTranslation } from 'react-i18next';

import { useTheme } from '@/lib/theme-context';
import { WorkoutType, WORKOUT_TYPE_LABELS, addFitnessItem, loadFitnessItems, updateFitnessItem } from '@/lib/family-records';

export default function AddFitnessScreen() {
  const router = useRouter();
  const { memberId, memberName, editId } = useLocalSearchParams<{ memberId: string; memberName?: string; editId?: string }>();
  const insets = useSafeAreaInsets();
  const { colors, isDark } = useTheme();
  const { t } = useTranslation();

  const DAY_LABELS = [t('common.dayShort.sun'), t('common.dayShort.mon'), t('common.dayShort.tue'), t('common.dayShort.wed'), t('common.dayShort.thu'), t('common.dayShort.fri'), t('common.dayShort.sat')];

  const [showTimePicker, setShowTimePicker] = useState(false);
  const [workoutType, setWorkoutType] = useState<WorkoutType | null>(null);
  const [time, setTime] = useState(new Date());
  const [selectedDays, setSelectedDays] = useState<number[]>([]);
  const [durationGoalMinutes, setDurationGoalMinutes] = useState('');
  const [stepCountGoal, setStepCountGoal] = useState('');
  const [isRestDay, setIsRestDay] = useState(false);
  const [notes, setNotes] = useState('');
  const [reminderEnabled, setReminderEnabled] = useState(true);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const isEditing = !!editId;

  const toggleDay = (d: number) => {
    setSelectedDays((prev) => (prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d].sort()));
  };

  useEffect(() => {
    if (!editId || !memberId) return;
    let cancelled = false;
    (async () => {
      const items = await loadFitnessItems(String(memberId));
      const found = items.find((x) => x.id === String(editId));
      if (!found || cancelled) return;
      setWorkoutType(found.workoutType);
      setSelectedDays(found.days ?? []);
      setDurationGoalMinutes(found.durationGoalMinutes != null ? String(found.durationGoalMinutes) : '');
      setStepCountGoal(found.stepCountGoal != null ? String(found.stepCountGoal) : '');
      setIsRestDay(!!found.isRestDay);
      setNotes(found.notes ?? '');
      setReminderEnabled(found.reminderEnabled);
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
    if (!workoutType) {
      setError(t('familyFitness.errorSelectType'));
      return;
    }
    if (!memberId || saving) return;
    setSaving(true);
    const timeStr = time.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
    const data = {
      workoutType,
      days: selectedDays,
      time: timeStr,
      durationGoalMinutes: durationGoalMinutes.trim() ? Number(durationGoalMinutes) : null,
      stepCountGoal: stepCountGoal.trim() ? Number(stepCountGoal) : null,
      isRestDay,
      notes: notes.trim(),
      reminderEnabled,
    };
    if (isEditing) {
      await updateFitnessItem(String(memberId), String(editId), data);
    } else {
      await addFitnessItem(String(memberId), data);
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
          <Text style={[styles.headerTitle, { color: colors.text }]}>{isEditing ? t('familyFitness.editHeaderTitle') : t('familyFitness.newHeaderTitle')}</Text>
          <View style={styles.backBtn} />
        </View>
        {memberName ? <Text style={[styles.headerSubtitle, { color: colors.textSecondary }]}>{t('familyFitness.forMember', { name: memberName })}</Text> : null}
      </LinearGradient>

      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: insets.bottom + 40 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        {!!error && <Text style={[styles.errorText, { color: colors.danger }]}>{error}</Text>}

        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.typeScroll} contentContainerStyle={styles.typeGrid}>
          {(Object.keys(WORKOUT_TYPE_LABELS) as WorkoutType[]).map((wt) => (
            <Pressable
              key={wt}
              onPress={() => setWorkoutType(wt)}
              style={[styles.typeChip, { backgroundColor: colors.inputBg, borderColor: colors.border }, workoutType === wt && { backgroundColor: colors.accent, borderColor: colors.accent }]}
            >
              <Ionicons name={WORKOUT_TYPE_LABELS[wt].icon as any} size={16} color={workoutType === wt ? '#FFF' : colors.textSecondary} />
              <Text style={[styles.typeChipText, { color: workoutType === wt ? '#FFF' : colors.textSecondary }]}>{t(`familyFitness.type.${wt}`)}</Text>
            </Pressable>
          ))}
        </ScrollView>

        <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>{t('familyFitness.timeLabel')}</Text>
        <Pressable onPress={() => setShowTimePicker(true)} style={[styles.input, { borderColor: colors.border, backgroundColor: colors.inputBg, justifyContent: 'center' }]}>
          <Text style={{ color: colors.text }}>{time.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true })}</Text>
        </Pressable>

        <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>{t('familyFitness.repeatOnLabel')}</Text>
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

        <View style={styles.formRow}>
          <View style={{ flex: 1 }}>
            <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>{t('familyFitness.durationGoalLabel')}</Text>
            <TextInput
              style={[styles.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.inputBg }]}
              value={durationGoalMinutes}
              onChangeText={setDurationGoalMinutes}
              placeholder={t('familyFitness.durationGoalPlaceholder')}
              placeholderTextColor={colors.textTertiary}
              keyboardType="numeric"
            />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>{t('familyFitness.stepGoalLabel')}</Text>
            <TextInput
              style={[styles.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.inputBg }]}
              value={stepCountGoal}
              onChangeText={setStepCountGoal}
              placeholder={t('familyFitness.stepGoalPlaceholder')}
              placeholderTextColor={colors.textTertiary}
              keyboardType="numeric"
            />
          </View>
        </View>

        <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>{t('familyFitness.notesLabel')}</Text>
        <TextInput
          style={[styles.input, styles.textArea, { color: colors.text, borderColor: colors.border, backgroundColor: colors.inputBg }]}
          value={notes}
          onChangeText={setNotes}
          placeholder={t('familyFitness.notesPlaceholder')}
          placeholderTextColor={colors.textTertiary}
          multiline
        />

        <Pressable onPress={() => setIsRestDay(!isRestDay)} style={styles.toggleRow}>
          <Ionicons name={isRestDay ? 'checkbox' : 'square-outline'} size={22} color={isRestDay ? colors.accent : colors.textTertiary} />
          <Text style={[styles.toggleLabel, { color: colors.text }]}>{t('familyFitness.isRestDayLabel')}</Text>
        </Pressable>

        <Pressable onPress={() => setReminderEnabled(!reminderEnabled)} style={styles.toggleRow}>
          <Ionicons name={reminderEnabled ? 'checkbox' : 'square-outline'} size={22} color={reminderEnabled ? colors.accent : colors.textTertiary} />
          <Text style={[styles.toggleLabel, { color: colors.text }]}>{t('familyFitness.reminderEnabledLabel')}</Text>
        </Pressable>

        <Pressable onPress={handleSave} disabled={saving} style={[styles.primaryBtn, { backgroundColor: colors.accent, opacity: saving ? 0.6 : 1 }]}>
          <Text style={styles.primaryBtnLabel}>{isEditing ? t('familyFitness.saveChanges') : t('common.save')}</Text>
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
  typeScroll: { marginHorizontal: -20, marginBottom: 6 },
  typeGrid: { flexDirection: 'row', gap: 8, paddingHorizontal: 20 },
  typeChip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 10, paddingHorizontal: 14, borderRadius: 12, borderWidth: 1 },
  typeChipText: { fontFamily: 'Inter_600SemiBold', fontSize: 12 },
  fieldLabel: { fontFamily: 'Inter_600SemiBold', fontSize: 12, marginBottom: 6, marginTop: 10 },
  input: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontFamily: 'Inter_500Medium', fontSize: 14 },
  textArea: { minHeight: 70, textAlignVertical: 'top' },
  formRow: { flexDirection: 'row', gap: 12 },
  dayRow: { flexDirection: 'row', gap: 6 },
  dayChip: { flex: 1, paddingVertical: 8, borderRadius: 10, borderWidth: 1, alignItems: 'center' },
  dayChipText: { fontFamily: 'Inter_600SemiBold', fontSize: 11 },
  toggleRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 16 },
  toggleLabel: { fontFamily: 'Inter_500Medium', fontSize: 14 },
});
