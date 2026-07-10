import React, { useCallback, useState } from 'react';
import { StyleSheet, Text, View, ScrollView, Pressable, TextInput, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams, useFocusEffect } from 'expo-router';
import DateTimePicker from '@react-native-community/datetimepicker';
import Animated, { FadeInDown } from 'react-native-reanimated';

import { useTheme } from '@/lib/theme-context';
import CustomModal from '@/components/CustomModal';
import {
  RoutineItem,
  RoutineType,
  ROUTINE_TYPE_LABELS,
  loadRoutines,
  addRoutine,
  toggleRoutine,
  deleteRoutine,
} from '@/lib/family-records';

export default function DailyRoutineScreen() {
  const router = useRouter();
  const { memberId, memberName } = useLocalSearchParams<{ memberId: string; memberName?: string }>();
  const insets = useSafeAreaInsets();
  const { colors, isDark } = useTheme();

  const [items, setItems] = useState<RoutineItem[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [showTimePicker, setShowTimePicker] = useState(false);

  const [routineType, setRoutineType] = useState<RoutineType>('wakeup');
  const [customLabel, setCustomLabel] = useState('');
  const [time, setTime] = useState(new Date());
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!memberId) return;
    setItems(await loadRoutines(String(memberId)));
  }, [memberId]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const resetForm = () => {
    setRoutineType('wakeup');
    setCustomLabel('');
    setTime(new Date());
    setError('');
  };

  const handleAdd = async () => {
    if (routineType === 'custom' && !customLabel.trim()) {
      setError('Please name this custom routine');
      return;
    }
    if (!memberId) return;
    const timeStr = time.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
    await addRoutine(String(memberId), {
      type: routineType,
      label: routineType === 'custom' ? customLabel.trim() : ROUTINE_TYPE_LABELS[routineType].label,
      time: timeStr,
    });
    setShowAdd(false);
    resetForm();
    load();
  };

  const sorted = [...items].sort((a, b) => a.time.localeCompare(b.time));
  const headerHeight = 110 + insets.top;

  return (
    <View style={[styles.container, { backgroundColor: colors.bg }]}>
      <LinearGradient colors={colors.heroGradient as any} style={[styles.header, { height: headerHeight, paddingTop: insets.top }]}>
        <View style={styles.headerTop}>
          <Pressable onPress={() => router.back()} style={styles.backBtn} hitSlop={12}>
            <Ionicons name="chevron-back" size={24} color={colors.text} />
          </Pressable>
          <Text style={[styles.headerTitle, { color: colors.text }]}>🕒 Daily Routine</Text>
          <Pressable onPress={() => setShowAdd(true)} style={styles.addBtn} hitSlop={12}>
            <Ionicons name="add-circle" size={30} color={colors.accent} />
          </Pressable>
        </View>
        {memberName ? <Text style={[styles.headerSubtitle, { color: colors.textSecondary }]}>For {memberName}</Text> : null}
      </LinearGradient>

      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: insets.bottom + 40 }} showsVerticalScrollIndicator={false}>
        {sorted.length === 0 ? (
          <View style={styles.emptyState}>
            <Ionicons name="time-outline" size={48} color={colors.textTertiary} />
            <Text style={[styles.emptyTitle, { color: colors.text }]}>No routine set yet</Text>
            <Text style={[styles.emptyDesc, { color: colors.textTertiary }]}>Tap + to add wake-up, sleep, or walking reminders.</Text>
          </View>
        ) : (
          sorted.map((item) => {
            const def = ROUTINE_TYPE_LABELS[item.type];
            return (
              <Animated.View key={item.id} entering={FadeInDown.duration(300)} style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <View style={[styles.iconWrap, { backgroundColor: colors.accentDim }]}>
                  <Ionicons name={def.icon as any} size={20} color={colors.accent} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.cardTitle, { color: colors.text }, !item.enabled && { opacity: 0.4 }]}>{item.label}</Text>
                  <Text style={[styles.cardSub, { color: colors.textTertiary }]}>{item.time}</Text>
                </View>
                <Pressable onPress={async () => { await toggleRoutine(String(memberId), item.id); load(); }} hitSlop={10}>
                  <Ionicons name={item.enabled ? 'toggle' : 'toggle-outline'} size={32} color={item.enabled ? colors.accent : colors.textTertiary} />
                </Pressable>
                <Pressable onPress={async () => { await deleteRoutine(String(memberId), item.id); load(); }} hitSlop={10} style={{ marginLeft: 8 }}>
                  <Ionicons name="trash-outline" size={18} color={colors.textTertiary} />
                </Pressable>
              </Animated.View>
            );
          })
        )}
      </ScrollView>

      <CustomModal visible={showAdd} onClose={() => { setShowAdd(false); resetForm(); }} showCloseButton={false}>
        <Text style={[styles.modalTitle, { color: colors.text }]}>New Routine Reminder</Text>
        {!!error && <Text style={[styles.errorText, { color: colors.danger }]}>{error}</Text>}

        <View style={styles.typeGrid}>
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
        </View>

        {routineType === 'custom' && (
          <>
            <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>Routine Name</Text>
            <TextInput
              style={[styles.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.inputBg }]}
              value={customLabel}
              onChangeText={setCustomLabel}
              placeholder="e.g. Evening Prayer"
              placeholderTextColor={colors.textTertiary}
            />
          </>
        )}

        <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>Time</Text>
        <Pressable onPress={() => setShowTimePicker(true)} style={[styles.input, { borderColor: colors.border, backgroundColor: colors.inputBg, justifyContent: 'center' }]}>
          <Text style={{ color: colors.text }}>{time.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true })}</Text>
        </Pressable>

        <View style={styles.modalActionsRow}>
          <Pressable onPress={() => { setShowAdd(false); resetForm(); }} style={styles.modalTextBtn}>
            <Text style={[styles.modalTextBtnLabel, { color: colors.textTertiary }]}>Cancel</Text>
          </Pressable>
          <Pressable onPress={handleAdd} style={[styles.modalPrimaryBtn, { backgroundColor: colors.accent }]}>
            <Text style={styles.modalPrimaryBtnLabel}>Save</Text>
          </Pressable>
        </View>
      </CustomModal>

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
  addBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontFamily: 'Inter_700Bold', fontSize: 18 },
  headerSubtitle: { fontFamily: 'Inter_500Medium', fontSize: 13, marginTop: 4, textAlign: 'center' },
  emptyState: { alignItems: 'center', paddingVertical: 60, gap: 10 },
  emptyTitle: { fontFamily: 'Inter_700Bold', fontSize: 17 },
  emptyDesc: { fontFamily: 'Inter_400Regular', fontSize: 13, textAlign: 'center', paddingHorizontal: 30 },
  card: { flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: 18, borderWidth: 1, padding: 14, marginBottom: 10 },
  iconWrap: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  cardTitle: { fontFamily: 'Inter_600SemiBold', fontSize: 15 },
  cardSub: { fontFamily: 'Inter_400Regular', fontSize: 12, marginTop: 2 },
  modalTitle: { fontFamily: 'Inter_700Bold', fontSize: 18, marginBottom: 12, textAlign: 'center' },
  errorText: { fontFamily: 'Inter_500Medium', fontSize: 13, marginBottom: 10, textAlign: 'center' },
  typeGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 6 },
  typeChip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 10, paddingHorizontal: 14, borderRadius: 12, borderWidth: 1 },
  typeChipText: { fontFamily: 'Inter_600SemiBold', fontSize: 12 },
  fieldLabel: { fontFamily: 'Inter_600SemiBold', fontSize: 12, marginBottom: 6, marginTop: 10, textTransform: 'uppercase', letterSpacing: 0.5 },
  input: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontFamily: 'Inter_500Medium', fontSize: 14 },
  modalActionsRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 20 },
  modalTextBtn: { paddingVertical: 10, paddingHorizontal: 16 },
  modalTextBtnLabel: { fontFamily: 'Inter_500Medium', fontSize: 14 },
  modalPrimaryBtn: { paddingVertical: 12, paddingHorizontal: 20, borderRadius: 14 },
  modalPrimaryBtnLabel: { fontFamily: 'Inter_700Bold', fontSize: 14, color: '#FFF' },
});
