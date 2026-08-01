import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View, ScrollView, Pressable, TextInput, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import DateTimePicker from '@react-native-community/datetimepicker';

import { useTheme } from '@/lib/theme-context';
import { RoutineType, ROUTINE_TYPE_LABELS, addRoutine, loadRoutines, updateRoutine } from '@/lib/family-records';

export default function AddRoutineScreen() {
  const router = useRouter();
  const { memberId, memberName, editId } = useLocalSearchParams<{ memberId: string; memberName?: string; editId?: string }>();
  const insets = useSafeAreaInsets();
  const { colors, isDark } = useTheme();

  const [showTimePicker, setShowTimePicker] = useState(false);
  // Nothing preselected on a new routine; editing seeds it from the record.
  const [routineType, setRoutineType] = useState<RoutineType | null>(null);
  const [customLabel, setCustomLabel] = useState('');
  const [time, setTime] = useState(new Date());
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

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
      setError('Please select a routine type');
      return;
    }
    if (routineType === 'custom' && !customLabel.trim()) {
      setError('Please name this custom routine');
      return;
    }
    if (!memberId || saving) return;
    setSaving(true);
    const timeStr = time.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
    const data = {
      type: routineType,
      label: routineType === 'custom' ? customLabel.trim() : ROUTINE_TYPE_LABELS[routineType].label,
      time: timeStr,
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
          <Text style={[styles.headerTitle, { color: colors.text }]}>{isEditing ? 'Edit Routine Reminder' : 'New Routine Reminder'}</Text>
          <View style={styles.backBtn} />
        </View>
        {memberName ? <Text style={[styles.headerSubtitle, { color: colors.textSecondary }]}>For {memberName}</Text> : null}
      </LinearGradient>

      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: insets.bottom + 40 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        {!!error && <Text style={[styles.errorText, { color: colors.danger }]}>{error}</Text>}

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.typeScroll}
          contentContainerStyle={styles.typeGrid}
        >
          {(['wakeup', 'sleep', 'walk', 'custom'] as const).map((t) => (
            <Pressable
              key={t}
              onPress={() => setRoutineType(t)}
              style={[
                styles.typeChip,
                { backgroundColor: colors.inputBg, borderColor: colors.border },
                routineType === t && { backgroundColor: colors.accent, borderColor: colors.accent },
              ]}
            >
              <Ionicons name={ROUTINE_TYPE_LABELS[t].icon as any} size={16} color={routineType === t ? '#FFF' : colors.textSecondary} />
              <Text style={[styles.typeChipText, { color: routineType === t ? '#FFF' : colors.textSecondary }]}>{ROUTINE_TYPE_LABELS[t].label}</Text>
            </Pressable>
          ))}
        </ScrollView>

        {routineType === 'custom' && (
          <>
            <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>Routine Name</Text>
            <TextInput
              style={[styles.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.inputBg }]}
              value={customLabel}
              onChangeText={setCustomLabel}
              placeholder="e.g. Evening Prayer"
              placeholderTextColor={colors.textTertiary}
              autoFocus
            />
          </>
        )}

        <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>Time</Text>
        <Pressable onPress={() => setShowTimePicker(true)} style={[styles.input, { borderColor: colors.border, backgroundColor: colors.inputBg, justifyContent: 'center' }]}>
          <Text style={{ color: colors.text }}>{time.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true })}</Text>
        </Pressable>

        <Pressable onPress={handleSave} disabled={saving} style={[styles.primaryBtn, { backgroundColor: colors.accent, opacity: saving ? 0.6 : 1 }]}>
          <Text style={styles.primaryBtnLabel}>{isEditing ? 'Save Changes' : 'Save'}</Text>
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
});
