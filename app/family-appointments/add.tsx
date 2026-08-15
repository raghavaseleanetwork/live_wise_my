import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View, ScrollView, Pressable, TextInput, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import DateTimePicker from '@react-native-community/datetimepicker';
import { useTranslation } from 'react-i18next';

import { useTheme } from '@/lib/theme-context';
import { addAppointment, loadAppointments, updateAppointment, AppointmentRecurrence, AppointmentReminderLead } from '@/lib/family-records';

const SPECIALIZATIONS = ['general', 'cardiologist', 'orthopedic', 'neurologist', 'pediatric', 'dermatologist', 'gynecologist', 'dentist', 'ent', 'ophthalmologist', 'psychiatrist', 'other'] as const;
const RECURRENCES: AppointmentRecurrence[] = ['monthly', 'quarterly', 'every_6_months', 'yearly'];
const REMINDER_LEADS: AppointmentReminderLead[] = ['1_day', '3_hours', '1_hour', '30_min'];

/**
 * Add *and* edit an appointment.
 *
 * One screen for both, keyed on an optional `editId` param: the fields, the
 * validation and the date picker are identical, and a separate edit screen
 * would be this file with two lines changed — a copy that silently drifts the
 * first time a field is added to one and not the other.
 */
export default function AddAppointmentScreen() {
  const router = useRouter();
  const { memberId, memberName, editId } = useLocalSearchParams<{
    memberId: string;
    memberName?: string;
    editId?: string;
  }>();
  const insets = useSafeAreaInsets();
  const { colors, isDark } = useTheme();
  const { t } = useTranslation();

  const isEditing = !!editId;

  const [showDatePicker, setShowDatePicker] = useState(false);
  const [showTimePicker, setShowTimePicker] = useState(false);
  const [showFollowUpDatePicker, setShowFollowUpDatePicker] = useState(false);
  const [doctorName, setDoctorName] = useState('');
  const [specialty, setSpecialty] = useState<typeof SPECIALIZATIONS[number] | ''>('');
  const [hospitalName, setHospitalName] = useState('');
  const [location, setLocation] = useState('');
  const [notes, setNotes] = useState('');
  const [isFollowUp, setIsFollowUp] = useState(false);
  const [followUpDate, setFollowUpDate] = useState<Date | null>(null);
  const [isRecurring, setIsRecurring] = useState(false);
  const [recurrence, setRecurrence] = useState<AppointmentRecurrence>('monthly');
  const [reminderLead, setReminderLead] = useState<AppointmentReminderLead>('1_day');
  const [apptDate, setApptDate] = useState(new Date());
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  // Seed the form from the record being edited.
  useEffect(() => {
    if (!editId || !memberId) return;
    let cancelled = false;
    (async () => {
      const items = await loadAppointments(String(memberId));
      const found = items.find((a) => a.id === String(editId));
      if (!found || cancelled) return;
      setDoctorName(found.doctorName);
      setSpecialty((found.specialty as any) ?? '');
      setHospitalName(found.hospitalName ?? '');
      setLocation(found.location ?? '');
      setNotes(found.notes ?? '');
      setIsFollowUp(found.isFollowUp);
      setFollowUpDate(found.followUpDate ? new Date(found.followUpDate) : null);
      setIsRecurring(!!found.isRecurring);
      setRecurrence(found.recurrence ?? 'monthly');
      setReminderLead(found.reminderLead ?? '1_day');
      setApptDate(new Date(found.date));
    })();
    return () => { cancelled = true; };
  }, [editId, memberId]);

  const handleSave = async () => {
    if (!doctorName.trim()) {
      setError(t('familyAppointments.errorEnterDoctorName'));
      return;
    }
    if (!memberId || saving) return;
    setSaving(true);

    const data = {
      doctorName: doctorName.trim(),
      specialty,
      hospitalName: hospitalName.trim(),
      location: location.trim(),
      notes: notes.trim(),
      isFollowUp,
      followUpDate: isFollowUp && followUpDate ? followUpDate.toISOString() : null,
      isRecurring,
      recurrence: isRecurring ? recurrence : undefined,
      reminderLead,
      date: apptDate.toISOString(),
    };

    if (isEditing) {
      await updateAppointment(String(memberId), String(editId), data);
    } else {
      await addAppointment(String(memberId), data);
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
          <Text style={[styles.headerTitle, { color: colors.text }]}>
            {isEditing ? t('familyAppointments.editHeaderTitle') : t('familyAppointments.newHeaderTitle')}
          </Text>
          <View style={styles.backBtn} />
        </View>
        {memberName ? <Text style={[styles.headerSubtitle, { color: colors.textSecondary }]}>{t('familyAppointments.forMember', { name: memberName })}</Text> : null}
      </LinearGradient>

      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: insets.bottom + 40 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        {!!error && <Text style={[styles.errorText, { color: colors.danger }]}>{error}</Text>}

        <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>{t('familyAppointments.doctorNameLabel')}</Text>
        <TextInput
          style={[styles.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.inputBg }]}
          value={doctorName}
          onChangeText={setDoctorName}
          placeholder={t('familyAppointments.doctorNamePlaceholder')}
          placeholderTextColor={colors.textTertiary}
          autoFocus
        />

        <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>{t('familyAppointments.specialtyLabel')}</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipScroll} contentContainerStyle={styles.chipRow}>
          {SPECIALIZATIONS.map((s) => (
            <Pressable
              key={s}
              onPress={() => setSpecialty(specialty === s ? '' : s)}
              style={[styles.smallChip, { backgroundColor: colors.inputBg, borderColor: colors.border }, specialty === s && { backgroundColor: colors.accent, borderColor: colors.accent }]}
            >
              <Text style={[styles.smallChipText, { color: specialty === s ? '#FFF' : colors.textSecondary }]}>{t(`familyAppointments.specialization.${s}`)}</Text>
            </Pressable>
          ))}
        </ScrollView>

        <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>{t('familyAppointments.hospitalNameLabel')}</Text>
        <TextInput
          style={[styles.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.inputBg }]}
          value={hospitalName}
          onChangeText={setHospitalName}
          placeholder={t('familyAppointments.hospitalNamePlaceholder')}
          placeholderTextColor={colors.textTertiary}
        />

        <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>{t('familyAppointments.dateLocationLabel')}</Text>
        <View style={styles.formRow}>
          <Pressable
            onPress={() => setShowDatePicker(true)}
            style={[styles.input, { flex: 1, borderColor: colors.border, backgroundColor: colors.inputBg, justifyContent: 'center' }]}
          >
            <Text style={{ color: colors.text }}>{apptDate.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</Text>
          </Pressable>
          <Pressable
            onPress={() => setShowTimePicker(true)}
            style={[styles.input, { flex: 1, borderColor: colors.border, backgroundColor: colors.inputBg, justifyContent: 'center' }]}
          >
            <Text style={{ color: colors.text }}>{apptDate.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true })}</Text>
          </Pressable>
        </View>
        <TextInput
          style={[styles.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.inputBg, marginTop: 10 }]}
          value={location}
          onChangeText={setLocation}
          placeholder={t('familyAppointments.locationPlaceholder')}
          placeholderTextColor={colors.textTertiary}
        />

        <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>{t('familyAppointments.notesLabel')}</Text>
        <TextInput
          style={[styles.input, styles.textArea, { color: colors.text, borderColor: colors.border, backgroundColor: colors.inputBg }]}
          value={notes}
          onChangeText={setNotes}
          placeholder={t('familyAppointments.notesPlaceholder')}
          placeholderTextColor={colors.textTertiary}
          multiline
        />

        <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>{t('familyAppointments.reminderLeadLabel')}</Text>
        <View style={styles.chipRow}>
          {REMINDER_LEADS.map((r) => (
            <Pressable
              key={r}
              onPress={() => setReminderLead(r)}
              style={[styles.smallChip, { backgroundColor: colors.inputBg, borderColor: colors.border }, reminderLead === r && { backgroundColor: colors.accent, borderColor: colors.accent }]}
            >
              <Text style={[styles.smallChipText, { color: reminderLead === r ? '#FFF' : colors.textSecondary }]}>{t(`familyAppointments.reminderLead.${r}`)}</Text>
            </Pressable>
          ))}
        </View>

        <Pressable onPress={() => setIsRecurring(!isRecurring)} style={styles.followUpRow}>
          <Ionicons name={isRecurring ? 'checkbox' : 'square-outline'} size={22} color={isRecurring ? colors.accent : colors.textTertiary} />
          <Text style={[styles.followUpText, { color: colors.text }]}>{t('familyAppointments.recurringCheckbox')}</Text>
        </Pressable>
        {isRecurring && (
          <View style={[styles.chipRow, { marginTop: 8 }]}>
            {RECURRENCES.map((r) => (
              <Pressable
                key={r}
                onPress={() => setRecurrence(r)}
                style={[styles.smallChip, { backgroundColor: colors.inputBg, borderColor: colors.border }, recurrence === r && { backgroundColor: colors.accent, borderColor: colors.accent }]}
              >
                <Text style={[styles.smallChipText, { color: recurrence === r ? '#FFF' : colors.textSecondary }]}>{t(`familyAppointments.recurrence.${r}`)}</Text>
              </Pressable>
            ))}
          </View>
        )}

        <Pressable onPress={() => setIsFollowUp(!isFollowUp)} style={styles.followUpRow}>
          <Ionicons name={isFollowUp ? 'checkbox' : 'square-outline'} size={22} color={isFollowUp ? colors.accent : colors.textTertiary} />
          <Text style={[styles.followUpText, { color: colors.text }]}>{t('familyAppointments.followUpCheckbox')}</Text>
        </Pressable>
        {isFollowUp && (
          <Pressable
            onPress={() => setShowFollowUpDatePicker(true)}
            style={[styles.input, { marginTop: 8, borderColor: colors.border, backgroundColor: colors.inputBg, justifyContent: 'center' }]}
          >
            <Text style={{ color: followUpDate ? colors.text : colors.textTertiary }}>
              {followUpDate ? followUpDate.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : t('familyAppointments.followUpDatePlaceholder')}
            </Text>
          </Pressable>
        )}

        <Pressable onPress={handleSave} disabled={saving} style={[styles.primaryBtn, { backgroundColor: colors.accent, opacity: saving ? 0.6 : 1 }]}>
          <Text style={styles.primaryBtnLabel}>{isEditing ? t('familyAppointments.saveChanges') : t('familyAppointments.saveAppointment')}</Text>
        </Pressable>
      </ScrollView>

      {showDatePicker && (
        <DateTimePicker
          value={apptDate}
          mode="date"
          display={Platform.OS === 'ios' ? 'spinner' : 'default'}
          themeVariant={isDark ? 'dark' : 'light'}
          onChange={(event, date) => {
            setShowDatePicker(false);
            if (date) setApptDate(date);
          }}
        />
      )}
      {showTimePicker && (
        <DateTimePicker
          value={apptDate}
          mode="time"
          display={Platform.OS === 'ios' ? 'spinner' : 'default'}
          themeVariant={isDark ? 'dark' : 'light'}
          onChange={(event, date) => {
            setShowTimePicker(false);
            if (date) setApptDate(date);
          }}
        />
      )}
      {showFollowUpDatePicker && (
        <DateTimePicker
          value={followUpDate ?? new Date()}
          mode="date"
          display={Platform.OS === 'ios' ? 'spinner' : 'default'}
          themeVariant={isDark ? 'dark' : 'light'}
          onChange={(event, date) => {
            setShowFollowUpDatePicker(false);
            if (date) setFollowUpDate(date);
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
  fieldLabel: { fontFamily: 'Inter_600SemiBold', fontSize: 12, marginBottom: 6, marginTop: 10 },
  input: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontFamily: 'Inter_500Medium', fontSize: 14 },
  textArea: { minHeight: 70, textAlignVertical: 'top' },
  formRow: { flexDirection: 'row', gap: 12 },
  followUpRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 16 },
  followUpText: { fontFamily: 'Inter_500Medium', fontSize: 14 },
  chipScroll: { marginHorizontal: -20 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: 20 },
  smallChip: { paddingVertical: 8, paddingHorizontal: 12, borderRadius: 10, borderWidth: 1 },
  smallChipText: { fontFamily: 'Inter_600SemiBold', fontSize: 12 },
});
