import React, { useCallback, useState } from 'react';
import { StyleSheet, Text, View, ScrollView, Pressable, TextInput, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams, useFocusEffect } from 'expo-router';
import DateTimePicker from '@react-native-community/datetimepicker';
import Animated, { FadeInDown, FadeIn, FadeOut } from 'react-native-reanimated';

import { useTheme } from '@/lib/theme-context';
import {
  CheckinItem,
  loadCheckins,
  addCheckin,
  markCheckinDone,
  toggleCheckin,
  deleteCheckin,
} from '@/lib/family-records';

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export default function FamilyCheckinScreen() {
  const router = useRouter();
  const { memberId, memberName } = useLocalSearchParams<{ memberId: string; memberName?: string }>();
  const insets = useSafeAreaInsets();
  const { colors, isDark } = useTheme();

  const [items, setItems] = useState<CheckinItem[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [showTimePicker, setShowTimePicker] = useState(false);

  const [label, setLabel] = useState('');
  const [time, setTime] = useState(new Date());
  const [selectedDays, setSelectedDays] = useState<number[]>([]);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!memberId) return;
    setItems(await loadCheckins(String(memberId)));
  }, [memberId]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const resetForm = () => {
    setLabel('');
    setTime(new Date());
    setSelectedDays([]);
    setError('');
  };

  const toggleDay = (d: number) => {
    setSelectedDays((prev) => (prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d].sort()));
  };

  const handleAdd = async () => {
    if (!label.trim()) {
      setError('Please describe this check-in (e.g. "Daily call")');
      return;
    }
    if (!memberId) return;
    const timeStr = time.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
    await addCheckin(String(memberId), { label: label.trim(), time: timeStr, days: selectedDays });
    setShowAdd(false);
    resetForm();
    load();
  };

  const isDoneToday = (item: CheckinItem) => {
    if (!item.lastDoneAt) return false;
    const last = new Date(item.lastDoneAt);
    const now = new Date();
    return last.getDate() === now.getDate() && last.getMonth() === now.getMonth() && last.getFullYear() === now.getFullYear();
  };

  const headerHeight = 110 + insets.top;

  return (
    <View style={[styles.container, { backgroundColor: colors.bg }]}>
      <LinearGradient colors={colors.heroGradient as any} style={[styles.header, { height: headerHeight, paddingTop: insets.top }]}>
        <View style={styles.headerTop}>
          <Pressable onPress={() => router.back()} style={styles.backBtn} hitSlop={12}>
            <Ionicons name="chevron-back" size={24} color={colors.text} />
          </Pressable>
          <Text style={[styles.headerTitle, { color: colors.text }]}>📞 Call & Check-in</Text>
          <Pressable onPress={() => setShowAdd(true)} style={styles.addBtn} hitSlop={12}>
            <Ionicons name="add-circle" size={30} color={colors.accent} />
          </Pressable>
        </View>
        {memberName ? <Text style={[styles.headerSubtitle, { color: colors.textSecondary }]}>For {memberName}</Text> : null}
      </LinearGradient>

      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: insets.bottom + 40 }} showsVerticalScrollIndicator={false}>
        {showAdd && (
          <Animated.View entering={FadeIn.duration(200)} exiting={FadeOut.duration(150)} style={styles.formSection}>
            <Text style={[styles.sectionHeading, { color: colors.text }]}>New Check-in</Text>
            {!!error && <Text style={[styles.errorText, { color: colors.danger }]}>{error}</Text>}

            <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>Description</Text>
            <TextInput
              style={[styles.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.inputBg }]}
              value={label}
              onChangeText={setLabel}
              placeholder="e.g. Daily evening call"
              placeholderTextColor={colors.textTertiary}
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

            <Pressable onPress={handleAdd} style={[styles.primaryBtn, { backgroundColor: colors.accent }]}>
              <Text style={styles.primaryBtnLabel}>Save</Text>
            </Pressable>
            <Pressable onPress={() => { setShowAdd(false); resetForm(); }} style={styles.cancelBtn}>
              <Text style={[styles.cancelBtnLabel, { color: colors.textTertiary }]}>Cancel</Text>
            </Pressable>
          </Animated.View>
        )}

        {showAdd ? null : items.length === 0 ? (
          <View style={styles.emptyState}>
            <Ionicons name="call-outline" size={48} color={colors.textTertiary} />
            <Text style={[styles.emptyTitle, { color: colors.text }]}>No check-ins set yet</Text>
            <Text style={[styles.emptyDesc, { color: colors.textTertiary }]}>Tap + to add a call or check-in reminder.</Text>
          </View>
        ) : (
          items.map((item) => {
            const done = isDoneToday(item);
            return (
              <Animated.View key={item.id} entering={FadeInDown.duration(300)} style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <View style={[styles.iconWrap, { backgroundColor: colors.accentDim }]}>
                  <Ionicons name="call" size={18} color={colors.accent} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.cardTitle, { color: colors.text }, !item.enabled && { opacity: 0.4 }]}>{item.label}</Text>
                  <Text style={[styles.cardSub, { color: colors.textTertiary }]}>
                    {item.time}{item.days.length > 0 ? ` · ${item.days.map((d) => DAY_LABELS[d]).join(', ')}` : ' · Every day'}
                  </Text>
                </View>
                <Pressable
                  onPress={async () => { await markCheckinDone(String(memberId), item.id); load(); }}
                  style={[styles.doneBtn, { backgroundColor: done ? '#10B981' : colors.inputBg, borderColor: done ? '#10B981' : colors.border }]}
                >
                  <Ionicons name="checkmark" size={16} color={done ? '#FFF' : colors.textTertiary} />
                </Pressable>
                <Pressable onPress={async () => { await toggleCheckin(String(memberId), item.id); load(); }} hitSlop={10} style={{ marginLeft: 8 }}>
                  <Ionicons name={item.enabled ? 'toggle' : 'toggle-outline'} size={30} color={item.enabled ? colors.accent : colors.textTertiary} />
                </Pressable>
                <Pressable onPress={async () => { await deleteCheckin(String(memberId), item.id); load(); }} hitSlop={10} style={{ marginLeft: 8 }}>
                  <Ionicons name="trash-outline" size={18} color={colors.textTertiary} />
                </Pressable>
              </Animated.View>
            );
          })
        )}
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
  addBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontFamily: 'Inter_700Bold', fontSize: 18 },
  headerSubtitle: { fontFamily: 'Inter_500Medium', fontSize: 13, marginTop: 4, textAlign: 'center' },
  emptyState: { alignItems: 'center', paddingVertical: 60, gap: 10 },
  emptyTitle: { fontFamily: 'Inter_700Bold', fontSize: 17 },
  emptyDesc: { fontFamily: 'Inter_400Regular', fontSize: 13, textAlign: 'center', paddingHorizontal: 30 },
  card: { flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 18, borderWidth: 1, padding: 14, marginBottom: 10 },
  iconWrap: { width: 36, height: 36, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  cardTitle: { fontFamily: 'Inter_600SemiBold', fontSize: 14 },
  cardSub: { fontFamily: 'Inter_400Regular', fontSize: 11, marginTop: 2 },
  doneBtn: { width: 32, height: 32, borderRadius: 10, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  formSection: { marginBottom: 28 },
  sectionHeading: { fontFamily: 'Inter_700Bold', fontSize: 20, marginBottom: 12 },
  primaryBtn: { borderRadius: 14, paddingVertical: 15, alignItems: 'center', marginTop: 22 },
  primaryBtnLabel: { fontFamily: 'Inter_700Bold', fontSize: 15, color: '#FFF' },
  cancelBtn: { paddingVertical: 12, alignItems: 'center', marginTop: 4 },
  cancelBtnLabel: { fontFamily: 'Inter_500Medium', fontSize: 14 },
  errorText: { fontFamily: 'Inter_500Medium', fontSize: 13, marginBottom: 10, textAlign: 'center' },
  fieldLabel: { fontFamily: 'Inter_600SemiBold', fontSize: 12, marginBottom: 6, marginTop: 10, textTransform: 'uppercase', letterSpacing: 0.5 },
  input: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontFamily: 'Inter_500Medium', fontSize: 14 },
  dayRow: { flexDirection: 'row', gap: 6 },
  dayChip: { flex: 1, paddingVertical: 8, borderRadius: 10, borderWidth: 1, alignItems: 'center' },
  dayChipText: { fontFamily: 'Inter_600SemiBold', fontSize: 11 },
});
