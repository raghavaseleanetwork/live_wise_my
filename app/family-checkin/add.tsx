import React, { useState } from 'react';
import { StyleSheet, Text, View, ScrollView, Pressable, TextInput, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import DateTimePicker from '@react-native-community/datetimepicker';

import { useTheme } from '@/lib/theme-context';
import { addCheckin } from '@/lib/family-records';

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export default function AddCheckinScreen() {
  const router = useRouter();
  const { memberId, memberName } = useLocalSearchParams<{ memberId: string; memberName?: string }>();
  const insets = useSafeAreaInsets();
  const { colors, isDark } = useTheme();

  const [showTimePicker, setShowTimePicker] = useState(false);
  const [label, setLabel] = useState('');
  const [time, setTime] = useState(new Date());
  const [selectedDays, setSelectedDays] = useState<number[]>([]);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const toggleDay = (d: number) => {
    setSelectedDays((prev) => (prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d].sort()));
  };

  const handleSave = async () => {
    if (!label.trim()) {
      setError('Please describe this check-in (e.g. "Daily call")');
      return;
    }
    if (!memberId || saving) return;
    setSaving(true);
    const timeStr = time.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
    await addCheckin(String(memberId), { label: label.trim(), time: timeStr, days: selectedDays });
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
          <Text style={[styles.headerTitle, { color: colors.text }]}>New Check-in</Text>
          <View style={styles.backBtn} />
        </View>
        {memberName ? <Text style={[styles.headerSubtitle, { color: colors.textSecondary }]}>For {memberName}</Text> : null}
      </LinearGradient>

      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: insets.bottom + 40 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        {!!error && <Text style={[styles.errorText, { color: colors.danger }]}>{error}</Text>}

        <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>Description</Text>
        <TextInput
          style={[styles.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.inputBg }]}
          value={label}
          onChangeText={setLabel}
          placeholder="e.g. Daily evening call"
          placeholderTextColor={colors.textTertiary}
          autoFocus
        />

        <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>Time</Text>
        <Pressable onPress={() => setShowTimePicker(true)} style={[styles.input, { borderColor: colors.border, backgroundColor: colors.inputBg, justifyContent: 'center' }]}>
          <Text style={{ color: colors.text }}>{time.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true })}</Text>
        </Pressable>

        <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>Repeat on (leave blank for every day)</Text>
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
          <Text style={styles.primaryBtnLabel}>Save</Text>
        </Pressable>
      </ScrollView>

      {showTimePicker && (
        <DateTimePicker
          value={time}
          mode="time"
          display={Platform.OS === 'ios' ? 'spinner' : 'default'}
          themeVariant={isDark ? 'dark' : 'light'}
          onChange={(event, date) => { setShowTimePicker(false); if (date) setTime(date); }}
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
  dayRow: { flexDirection: 'row', gap: 6 },
  dayChip: { flex: 1, paddingVertical: 8, borderRadius: 10, borderWidth: 1, alignItems: 'center' },
  dayChipText: { fontFamily: 'Inter_600SemiBold', fontSize: 11 },
});
