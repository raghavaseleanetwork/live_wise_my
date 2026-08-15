import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View, ScrollView, Pressable, TextInput, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import DateTimePicker from '@react-native-community/datetimepicker';
import { useTranslation } from 'react-i18next';

import { useTheme } from '@/lib/theme-context';
import { WellnessReminder, addWellnessReminder, loadWellnessReminders, updateWellnessReminder } from '@/lib/family-records';

const KINDS: WellnessReminder['kind'][] = ['meditation', 'breathing', 'journal', 'self_care', 'therapy'];
const KIND_ICONS: Record<WellnessReminder['kind'], string> = {
  meditation: 'leaf',
  breathing: 'cloud-outline',
  journal: 'book-outline',
  self_care: 'heart-outline',
  therapy: 'medkit-outline',
};

export default function AddWellnessReminderScreen() {
  const router = useRouter();
  const { memberId, memberName, editId } = useLocalSearchParams<{ memberId: string; memberName?: string; editId?: string }>();
  const insets = useSafeAreaInsets();
  const { colors, isDark } = useTheme();
  const { t } = useTranslation();

  const [kind, setKind] = useState<WellnessReminder['kind']>('meditation');
  const [title, setTitle] = useState('');
  const [time, setTime] = useState(new Date());
  const [showTimePicker, setShowTimePicker] = useState(false);
  const [frequencyDays, setFrequencyDays] = useState('');
  const [sessionDate, setSessionDate] = useState<Date | null>(null);
  const [showSessionDatePicker, setShowSessionDatePicker] = useState(false);
  const [doctorName, setDoctorName] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const isEditing = !!editId;
  const isTherapy = kind === 'therapy';
  const isBreathing = kind === 'breathing';

  useEffect(() => {
    if (!editId || !memberId) return;
    let cancelled = false;
    (async () => {
      const items = await loadWellnessReminders(String(memberId));
      const found = items.find((x) => x.id === String(editId));
      if (!found || cancelled) return;
      setKind(found.kind);
      setTitle(found.title);
      setFrequencyDays(found.frequencyDays != null ? String(found.frequencyDays) : '');
      setDoctorName(found.doctorName ?? '');
      setSessionDate(found.sessionDate ? new Date(found.sessionDate) : null);
      if (found.time) {
        const parts = /^(\d{1,2}):(\d{2})\s*(AM|PM)$/i.exec(found.time.trim());
        if (parts) {
          let hours = Number(parts[1]) % 12;
          if (parts[3].toUpperCase() === 'PM') hours += 12;
          const d = new Date();
          d.setHours(hours, Number(parts[2]), 0, 0);
          setTime(d);
        }
      }
    })();
    return () => { cancelled = true; };
  }, [editId, memberId]);

  const handleSave = async () => {
    if (!title.trim()) {
      setError(t('familyWellness.errorEnterTitle'));
      return;
    }
    if (!memberId || saving) return;
    setSaving(true);
    const data = {
      kind,
      title: title.trim(),
      time: !isTherapy ? time.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true }) : undefined,
      frequencyDays: isBreathing && frequencyDays.trim() ? Number(frequencyDays) : undefined,
      sessionDate: isTherapy && sessionDate ? sessionDate.toISOString() : undefined,
      doctorName: isTherapy ? doctorName.trim() : undefined,
    };
    if (isEditing) {
      await updateWellnessReminder(String(memberId), String(editId), data);
    } else {
      await addWellnessReminder(String(memberId), data);
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
          <Text style={[styles.headerTitle, { color: colors.text }]}>{isEditing ? t('familyWellness.editHeaderTitle') : t('familyWellness.newHeaderTitle')}</Text>
          <View style={styles.backBtn} />
        </View>
        {memberName ? <Text style={[styles.headerSubtitle, { color: colors.textSecondary }]}>{t('familyWellness.forMember', { name: memberName })}</Text> : null}
      </LinearGradient>

      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: insets.bottom + 40 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        {!!error && <Text style={[styles.errorText, { color: colors.danger }]}>{error}</Text>}

        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.typeScroll} contentContainerStyle={styles.typeRow}>
          {KINDS.map((k) => (
            <Pressable
              key={k}
              onPress={() => setKind(k)}
              style={[styles.typeChip, { backgroundColor: colors.inputBg, borderColor: colors.border }, kind === k && { backgroundColor: colors.accent, borderColor: colors.accent }]}
            >
              <Ionicons name={KIND_ICONS[k] as any} size={14} color={kind === k ? '#FFF' : colors.textSecondary} />
              <Text style={[styles.typeChipText, { color: kind === k ? '#FFF' : colors.textSecondary }]}>{t(`familyWellness.kind.${k}`)}</Text>
            </Pressable>
          ))}
        </ScrollView>

        <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>{t('familyWellness.titleLabel')}</Text>
        <TextInput
          style={[styles.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.inputBg }]}
          value={title}
          onChangeText={setTitle}
          placeholder={t('familyWellness.titlePlaceholder')}
          placeholderTextColor={colors.textTertiary}
          autoFocus
        />

        {!isTherapy && (
          <>
            <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>{t('familyWellness.timeLabel')}</Text>
            <Pressable onPress={() => setShowTimePicker(true)} style={[styles.input, { borderColor: colors.border, backgroundColor: colors.inputBg, justifyContent: 'center' }]}>
              <Text style={{ color: colors.text }}>{time.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true })}</Text>
            </Pressable>
          </>
        )}

        {isBreathing && (
          <>
            <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>{t('familyWellness.frequencyDaysLabel')}</Text>
            <TextInput
              style={[styles.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.inputBg }]}
              value={frequencyDays}
              onChangeText={setFrequencyDays}
              placeholder={t('familyWellness.frequencyDaysPlaceholder')}
              placeholderTextColor={colors.textTertiary}
              keyboardType="numeric"
            />
          </>
        )}

        {isTherapy && (
          <>
            <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>{t('familyWellness.sessionDateLabel')}</Text>
            <Pressable onPress={() => setShowSessionDatePicker(true)} style={[styles.input, { borderColor: colors.border, backgroundColor: colors.inputBg, justifyContent: 'center' }]}>
              <Text style={{ color: sessionDate ? colors.text : colors.textTertiary }}>
                {sessionDate ? sessionDate.toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : t('familyWellness.notSet')}
              </Text>
            </Pressable>
            <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>{t('familyWellness.doctorNameLabel')}</Text>
            <TextInput
              style={[styles.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.inputBg }]}
              value={doctorName}
              onChangeText={setDoctorName}
              placeholder={t('familyWellness.doctorNamePlaceholder')}
              placeholderTextColor={colors.textTertiary}
            />
          </>
        )}

        <Pressable onPress={handleSave} disabled={saving} style={[styles.primaryBtn, { backgroundColor: colors.accent, opacity: saving ? 0.6 : 1 }]}>
          <Text style={styles.primaryBtnLabel}>{isEditing ? t('familyWellness.saveChanges') : t('common.save')}</Text>
        </Pressable>
      </ScrollView>

      {showTimePicker && (
        <DateTimePicker value={time} mode="time" display={Platform.OS === 'ios' ? 'spinner' : 'default'} themeVariant={isDark ? 'dark' : 'light'} onChange={(e, d) => { setShowTimePicker(false); if (d) setTime(d); }} />
      )}
      {showSessionDatePicker && (
        <DateTimePicker value={sessionDate ?? new Date()} mode="datetime" display={Platform.OS === 'ios' ? 'spinner' : 'default'} themeVariant={isDark ? 'dark' : 'light'} onChange={(e, d) => { setShowSessionDatePicker(false); if (d) setSessionDate(d); }} />
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
});
