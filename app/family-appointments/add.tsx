import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View, ScrollView, Pressable, TextInput, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import DateTimePicker from '@react-native-community/datetimepicker';

import { useTheme } from '@/lib/theme-context';
import { addAppointment, loadAppointments, updateAppointment } from '@/lib/family-records';

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

  const isEditing = !!editId;

  const [showDatePicker, setShowDatePicker] = useState(false);
  const [doctorName, setDoctorName] = useState('');
  const [specialty, setSpecialty] = useState('');
  const [location, setLocation] = useState('');
  const [isFollowUp, setIsFollowUp] = useState(false);
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
      setSpecialty(found.specialty ?? '');
      setLocation(found.location ?? '');
      setIsFollowUp(found.isFollowUp);
      setApptDate(new Date(found.date));
    })();
    return () => { cancelled = true; };
  }, [editId, memberId]);

  const handleSave = async () => {
    if (!doctorName.trim()) {
      setError('Please enter the doctor\'s name');
      return;
    }
    if (!memberId || saving) return;
    setSaving(true);

    const data = {
      doctorName: doctorName.trim(),
      specialty: specialty.trim(),
      location: location.trim(),
      isFollowUp,
      date: apptDate.toISOString(),
    };

    if (isEditing) {
      // `notes` is deliberately absent from the patch — this form does not
      // expose it, and including it would wipe any note set elsewhere.
      await updateAppointment(String(memberId), String(editId), data);
    } else {
      await addAppointment(String(memberId), { ...data, notes: '' });
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
            {isEditing ? 'Edit Appointment' : 'New Appointment'}
          </Text>
          <View style={styles.backBtn} />
        </View>
        {memberName ? <Text style={[styles.headerSubtitle, { color: colors.textSecondary }]}>For {memberName}</Text> : null}
      </LinearGradient>

      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: insets.bottom + 40 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        {!!error && <Text style={[styles.errorText, { color: colors.danger }]}>{error}</Text>}

        <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>Doctor Name</Text>
        <TextInput
          style={[styles.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.inputBg }]}
          value={doctorName}
          onChangeText={setDoctorName}
          placeholder="e.g. Dr. Sharma"
          placeholderTextColor={colors.textTertiary}
          autoFocus
        />

        <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>Specialty (optional)</Text>
        <TextInput
          style={[styles.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.inputBg }]}
          value={specialty}
          onChangeText={setSpecialty}
          placeholder="e.g. Cardiologist"
          placeholderTextColor={colors.textTertiary}
        />

        <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>Date & Location</Text>
        <Pressable
          onPress={() => setShowDatePicker(true)}
          style={[styles.input, { borderColor: colors.border, backgroundColor: colors.inputBg, justifyContent: 'center' }]}
        >
          <Text style={{ color: colors.text }}>{apptDate.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</Text>
        </Pressable>
        <TextInput
          style={[styles.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.inputBg, marginTop: 10 }]}
          value={location}
          onChangeText={setLocation}
          placeholder="Clinic / Hospital name"
          placeholderTextColor={colors.textTertiary}
        />

        <Pressable onPress={() => setIsFollowUp(!isFollowUp)} style={styles.followUpRow}>
          <Ionicons name={isFollowUp ? 'checkbox' : 'square-outline'} size={22} color={isFollowUp ? colors.accent : colors.textTertiary} />
          <Text style={[styles.followUpText, { color: colors.text }]}>This is a follow-up visit</Text>
        </Pressable>

        <Pressable onPress={handleSave} disabled={saving} style={[styles.primaryBtn, { backgroundColor: colors.accent, opacity: saving ? 0.6 : 1 }]}>
          <Text style={styles.primaryBtnLabel}>{isEditing ? 'Save Changes' : 'Save Appointment'}</Text>
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
  followUpRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 16 },
  followUpText: { fontFamily: 'Inter_500Medium', fontSize: 14 },
});
