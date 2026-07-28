import React, { useState } from 'react';
import { StyleSheet, Text, View, ScrollView, Pressable, TextInput, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import DateTimePicker from '@react-native-community/datetimepicker';

import { useTheme } from '@/lib/theme-context';
import { addAppointment } from '@/lib/family-records';

export default function AddAppointmentScreen() {
  const router = useRouter();
  const { memberId, memberName } = useLocalSearchParams<{ memberId: string; memberName?: string }>();
  const insets = useSafeAreaInsets();
  const { colors, isDark } = useTheme();

  const [showDatePicker, setShowDatePicker] = useState(false);
  const [doctorName, setDoctorName] = useState('');
  const [specialty, setSpecialty] = useState('');
  const [location, setLocation] = useState('');
  const [isFollowUp, setIsFollowUp] = useState(false);
  const [apptDate, setApptDate] = useState(new Date());
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!doctorName.trim()) {
      setError('Please enter the doctor\'s name');
      return;
    }
    if (!memberId || saving) return;
    setSaving(true);
    await addAppointment(String(memberId), {
      doctorName: doctorName.trim(),
      specialty: specialty.trim(),
      location: location.trim(),
      notes: '',
      isFollowUp,
      date: apptDate.toISOString(),
    });
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
          <Text style={[styles.headerTitle, { color: colors.text }]}>New Appointment</Text>
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
          <Text style={styles.primaryBtnLabel}>Save Appointment</Text>
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
  fieldLabel: { fontFamily: 'Inter_600SemiBold', fontSize: 12, marginBottom: 6, marginTop: 10, textTransform: 'uppercase', letterSpacing: 0.5 },
  input: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontFamily: 'Inter_500Medium', fontSize: 14 },
  followUpRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 16 },
  followUpText: { fontFamily: 'Inter_500Medium', fontSize: 14 },
});
