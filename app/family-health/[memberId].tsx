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
  HealthLog,
  HealthMetricType,
  HEALTH_METRIC_LABELS,
  loadHealthLogs,
  addHealthLog,
  deleteHealthLog,
} from '@/lib/family-records';

export default function HealthMonitoringScreen() {
  const router = useRouter();
  const { memberId, memberName } = useLocalSearchParams<{ memberId: string; memberName?: string }>();
  const insets = useSafeAreaInsets();
  const { colors, isDark } = useTheme();

  const [items, setItems] = useState<HealthLog[]>([]);
  const [filterType, setFilterType] = useState<HealthMetricType | 'all'>('all');
  const [showAdd, setShowAdd] = useState(false);
  const [showDatePicker, setShowDatePicker] = useState(false);

  const [logType, setLogType] = useState<HealthMetricType>('bp');
  const [value, setValue] = useState('');
  const [notes, setNotes] = useState('');
  const [logDate, setLogDate] = useState(new Date());
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!memberId) return;
    setItems(await loadHealthLogs(String(memberId)));
  }, [memberId]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const resetForm = () => {
    setValue('');
    setNotes('');
    setLogDate(new Date());
    setError('');
  };

  const handleAdd = async () => {
    if (!value.trim()) {
      setError(`Please enter a ${HEALTH_METRIC_LABELS[logType].label.toLowerCase()} value`);
      return;
    }
    if (!memberId) return;
    await addHealthLog(String(memberId), {
      type: logType,
      value: value.trim(),
      notes: notes.trim(),
      date: logDate.toISOString(),
    });
    setShowAdd(false);
    resetForm();
    load();
  };

  const filtered = filterType === 'all' ? items : items.filter((h) => h.type === filterType);
  const headerHeight = 110 + insets.top;

  return (
    <View style={[styles.container, { backgroundColor: colors.bg }]}>
      <LinearGradient colors={colors.heroGradient as any} style={[styles.header, { height: headerHeight, paddingTop: insets.top }]}>
        <View style={styles.headerTop}>
          <Pressable onPress={() => router.back()} style={styles.backBtn} hitSlop={12}>
            <Ionicons name="chevron-back" size={24} color={colors.text} />
          </Pressable>
          <Text style={[styles.headerTitle, { color: colors.text }]}>❤️ Health Monitoring</Text>
          <Pressable onPress={() => setShowAdd(true)} style={styles.addBtn} hitSlop={12}>
            <Ionicons name="add-circle" size={30} color={colors.accent} />
          </Pressable>
        </View>
        {memberName ? <Text style={[styles.headerSubtitle, { color: colors.textSecondary }]}>For {memberName}</Text> : null}
      </LinearGradient>

      <View style={styles.filterRow}>
        {(['all', 'bp', 'sugar', 'weight'] as const).map((f) => {
          const active = filterType === f;
          const label = f === 'all' ? 'All' : HEALTH_METRIC_LABELS[f].label;
          return (
            <Pressable
              key={f}
              onPress={() => setFilterType(f)}
              style={[
                styles.filterChip,
                { backgroundColor: colors.card, borderColor: colors.border },
                active && { backgroundColor: colors.accentDim, borderColor: colors.accent + '40' },
              ]}
            >
              <Text style={[styles.filterChipText, { color: active ? colors.accent : colors.textSecondary }]}>{label}</Text>
            </Pressable>
          );
        })}
      </View>

      <ScrollView contentContainerStyle={{ padding: 20, paddingTop: 8, paddingBottom: insets.bottom + 40 }} showsVerticalScrollIndicator={false}>
        {showAdd && (
          <Animated.View entering={FadeIn.duration(200)} exiting={FadeOut.duration(150)} style={styles.formSection}>
            <Text style={[styles.sectionHeading, { color: colors.text }]}>Log Reading</Text>
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

            <Pressable onPress={handleAdd} style={[styles.primaryBtn, { backgroundColor: colors.accent }]}>
              <Text style={styles.primaryBtnLabel}>Save Reading</Text>
            </Pressable>
            <Pressable onPress={() => { setShowAdd(false); resetForm(); }} style={styles.cancelBtn}>
              <Text style={[styles.cancelBtnLabel, { color: colors.textTertiary }]}>Cancel</Text>
            </Pressable>
          </Animated.View>
        )}

        {filtered.length === 0 ? (
          <View style={styles.emptyState}>
            <Ionicons name="heart-outline" size={48} color={colors.textTertiary} />
            <Text style={[styles.emptyTitle, { color: colors.text }]}>No entries yet</Text>
            <Text style={[styles.emptyDesc, { color: colors.textTertiary }]}>Tap + to log blood pressure, sugar, or weight.</Text>
          </View>
        ) : (
          filtered.map((log) => {
            const def = HEALTH_METRIC_LABELS[log.type];
            return (
              <Animated.View key={log.id} entering={FadeInDown.duration(300)} style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <View style={[styles.iconWrap, { backgroundColor: colors.accentDim }]}>
                  <Ionicons name={def.icon as any} size={20} color={colors.accent} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.cardTitle, { color: colors.text }]}>{log.value} <Text style={{ fontFamily: 'Inter_400Regular', fontSize: 12 }}>{def.unit}</Text></Text>
                  <Text style={[styles.cardSub, { color: colors.textTertiary }]}>
                    {def.label} · {new Date(log.date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                  </Text>
                  {!!log.notes && <Text style={[styles.cardNotes, { color: colors.textSecondary }]}>{log.notes}</Text>}
                </View>
                <Pressable onPress={async () => { await deleteHealthLog(String(memberId), log.id); load(); }} hitSlop={10}>
                  <Ionicons name="trash-outline" size={18} color={colors.textTertiary} />
                </Pressable>
              </Animated.View>
            );
          })
        )}
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
  addBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontFamily: 'Inter_700Bold', fontSize: 18 },
  headerSubtitle: { fontFamily: 'Inter_500Medium', fontSize: 13, marginTop: 4, textAlign: 'center' },
  filterRow: { flexDirection: 'row', gap: 8, paddingHorizontal: 20, paddingTop: 14, paddingBottom: 6 },
  filterChip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 12, borderWidth: 1 },
  filterChipText: { fontFamily: 'Inter_600SemiBold', fontSize: 12 },
  emptyState: { alignItems: 'center', paddingVertical: 60, gap: 10 },
  emptyTitle: { fontFamily: 'Inter_700Bold', fontSize: 17 },
  emptyDesc: { fontFamily: 'Inter_400Regular', fontSize: 13, textAlign: 'center', paddingHorizontal: 30 },
  card: { flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: 18, borderWidth: 1, padding: 14, marginBottom: 10 },
  iconWrap: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  cardTitle: { fontFamily: 'Inter_700Bold', fontSize: 16 },
  cardSub: { fontFamily: 'Inter_400Regular', fontSize: 12, marginTop: 2 },
  cardNotes: { fontFamily: 'Inter_400Regular', fontSize: 12, marginTop: 4, fontStyle: 'italic' },
  formSection: { marginBottom: 28 },
  sectionHeading: { fontFamily: 'Inter_700Bold', fontSize: 20, marginBottom: 12 },
  primaryBtn: { borderRadius: 14, paddingVertical: 15, alignItems: 'center', marginTop: 22 },
  primaryBtnLabel: { fontFamily: 'Inter_700Bold', fontSize: 15, color: '#FFF' },
  cancelBtn: { paddingVertical: 12, alignItems: 'center', marginTop: 4 },
  cancelBtnLabel: { fontFamily: 'Inter_500Medium', fontSize: 14 },
  errorText: { fontFamily: 'Inter_500Medium', fontSize: 13, marginBottom: 10, textAlign: 'center' },
  typeRow: { flexDirection: 'row', gap: 8, marginBottom: 6 },
  typeChip: { flex: 1, paddingVertical: 10, borderRadius: 12, borderWidth: 1, alignItems: 'center' },
  typeChipText: { fontFamily: 'Inter_600SemiBold', fontSize: 12 },
  fieldLabel: { fontFamily: 'Inter_600SemiBold', fontSize: 12, marginBottom: 6, marginTop: 10, textTransform: 'uppercase', letterSpacing: 0.5 },
  input: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontFamily: 'Inter_500Medium', fontSize: 14 },
});
