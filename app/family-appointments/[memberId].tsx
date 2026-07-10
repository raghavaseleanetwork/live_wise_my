import React, { useCallback, useState } from 'react';
import {
  StyleSheet,
  Text,
  View,
  ScrollView,
  Pressable,
  TextInput,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams, useFocusEffect } from 'expo-router';
import DateTimePicker from '@react-native-community/datetimepicker';
import Animated, { FadeInDown } from 'react-native-reanimated';

import { useTheme } from '@/lib/theme-context';
import CustomModal from '@/components/CustomModal';
import {
  Appointment,
  loadAppointments,
  addAppointment,
  toggleAppointmentDone,
  deleteAppointment,
} from '@/lib/family-records';

export default function AppointmentsScreen() {
  const router = useRouter();
  const { memberId, memberName } = useLocalSearchParams<{ memberId: string; memberName?: string }>();
  const insets = useSafeAreaInsets();
  const { colors, isDark } = useTheme();

  const [items, setItems] = useState<Appointment[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [showDatePicker, setShowDatePicker] = useState(false);

  const [doctorName, setDoctorName] = useState('');
  const [specialty, setSpecialty] = useState('');
  const [location, setLocation] = useState('');
  const [notes, setNotes] = useState('');
  const [isFollowUp, setIsFollowUp] = useState(false);
  const [apptDate, setApptDate] = useState(new Date());
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!memberId) return;
    setItems(await loadAppointments(String(memberId)));
  }, [memberId]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const resetForm = () => {
    setDoctorName('');
    setSpecialty('');
    setLocation('');
    setNotes('');
    setIsFollowUp(false);
    setApptDate(new Date());
    setError('');
  };

  const handleAdd = async () => {
    if (!doctorName.trim()) {
      setError('Please enter the doctor\'s name');
      return;
    }
    if (!memberId) return;
    await addAppointment(String(memberId), {
      doctorName: doctorName.trim(),
      specialty: specialty.trim(),
      location: location.trim(),
      notes: notes.trim(),
      isFollowUp,
      date: apptDate.toISOString(),
    });
    setShowAdd(false);
    resetForm();
    load();
  };

  const upcoming = items.filter((a) => !a.completed).sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  const past = items.filter((a) => a.completed);

  const headerHeight = 110 + insets.top;

  return (
    <View style={[styles.container, { backgroundColor: colors.bg }]}>
      <LinearGradient colors={colors.heroGradient as any} style={[styles.header, { height: headerHeight, paddingTop: insets.top }]}>
        <View style={styles.headerTop}>
          <Pressable onPress={() => router.back()} style={styles.backBtn} hitSlop={12}>
            <Ionicons name="chevron-back" size={24} color={colors.text} />
          </Pressable>
          <Text style={[styles.headerTitle, { color: colors.text }]}>🏥 Doctor Appointments</Text>
          <Pressable onPress={() => setShowAdd(true)} style={styles.addBtn} hitSlop={12}>
            <Ionicons name="add-circle" size={30} color={colors.accent} />
          </Pressable>
        </View>
        {memberName ? (
          <Text style={[styles.headerSubtitle, { color: colors.textSecondary }]}>For {memberName}</Text>
        ) : null}
      </LinearGradient>

      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: insets.bottom + 40 }} showsVerticalScrollIndicator={false}>
        {items.length === 0 ? (
          <View style={styles.emptyState}>
            <Ionicons name="calendar-outline" size={48} color={colors.textTertiary} />
            <Text style={[styles.emptyTitle, { color: colors.text }]}>No appointments yet</Text>
            <Text style={[styles.emptyDesc, { color: colors.textTertiary }]}>Tap + to add a doctor appointment or follow-up.</Text>
          </View>
        ) : (
          <>
            {upcoming.length > 0 && (
              <>
                <Text style={[styles.sectionLabel, { color: colors.textSecondary }]}>UPCOMING</Text>
                {upcoming.map((appt) => (
                  <AppointmentCard
                    key={appt.id}
                    appt={appt}
                    colors={colors}
                    onToggle={async () => { await toggleAppointmentDone(String(memberId), appt.id); load(); }}
                    onDelete={async () => { await deleteAppointment(String(memberId), appt.id); load(); }}
                  />
                ))}
              </>
            )}
            {past.length > 0 && (
              <>
                <Text style={[styles.sectionLabel, { color: colors.textSecondary, marginTop: 20 }]}>COMPLETED</Text>
                {past.map((appt) => (
                  <AppointmentCard
                    key={appt.id}
                    appt={appt}
                    colors={colors}
                    onToggle={async () => { await toggleAppointmentDone(String(memberId), appt.id); load(); }}
                    onDelete={async () => { await deleteAppointment(String(memberId), appt.id); load(); }}
                  />
                ))}
              </>
            )}
          </>
        )}
      </ScrollView>

      <CustomModal visible={showAdd} onClose={() => { setShowAdd(false); resetForm(); }} showCloseButton={false}>
        <Text style={[styles.modalTitle, { color: colors.text }]}>New Appointment</Text>
        {!!error && <Text style={[styles.errorText, { color: colors.danger }]}>{error}</Text>}

        <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>Doctor Name</Text>
        <TextInput
          style={[styles.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.inputBg }]}
          value={doctorName}
          onChangeText={setDoctorName}
          placeholder="e.g. Dr. Sharma"
          placeholderTextColor={colors.textTertiary}
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
          style={[styles.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.inputBg }]}
          value={location}
          onChangeText={setLocation}
          placeholder="Clinic / Hospital name"
          placeholderTextColor={colors.textTertiary}
        />

        <Pressable onPress={() => setIsFollowUp(!isFollowUp)} style={styles.followUpRow}>
          <Ionicons name={isFollowUp ? 'checkbox' : 'square-outline'} size={22} color={isFollowUp ? colors.accent : colors.textTertiary} />
          <Text style={[styles.followUpText, { color: colors.text }]}>This is a follow-up visit</Text>
        </Pressable>

        <View style={styles.modalActionsRow}>
          <Pressable onPress={() => { setShowAdd(false); resetForm(); }} style={styles.modalTextBtn}>
            <Text style={[styles.modalTextBtnLabel, { color: colors.textTertiary }]}>Cancel</Text>
          </Pressable>
          <Pressable onPress={handleAdd} style={[styles.modalPrimaryBtn, { backgroundColor: colors.accent }]}>
            <Text style={styles.modalPrimaryBtnLabel}>Save Appointment</Text>
          </Pressable>
        </View>
      </CustomModal>

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

function AppointmentCard({
  appt,
  colors,
  onToggle,
  onDelete,
}: {
  appt: Appointment;
  colors: any;
  onToggle: () => void;
  onDelete: () => void;
}) {
  return (
    <Animated.View entering={FadeInDown.duration(300)} style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <Pressable onPress={onToggle} style={styles.checkCircle}>
        <Ionicons name={appt.completed ? 'checkmark-circle' : 'ellipse-outline'} size={26} color={appt.completed ? '#10B981' : colors.textTertiary} />
      </Pressable>
      <View style={{ flex: 1 }}>
        <Text style={[styles.cardTitle, { color: colors.text }, appt.completed && { textDecorationLine: 'line-through', opacity: 0.5 }]} numberOfLines={1}>
          {appt.doctorName}{appt.isFollowUp ? ' · Follow-up' : ''}
        </Text>
        {!!appt.specialty && <Text style={[styles.cardSub, { color: colors.textTertiary }]}>{appt.specialty}</Text>}
        <Text style={[styles.cardSub, { color: colors.textTertiary }]}>
          {new Date(appt.date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
          {appt.location ? ` · ${appt.location}` : ''}
        </Text>
      </View>
      <Pressable onPress={onDelete} hitSlop={10}>
        <Ionicons name="trash-outline" size={18} color={colors.textTertiary} />
      </Pressable>
    </Animated.View>
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
  sectionLabel: { fontFamily: 'Inter_700Bold', fontSize: 12, letterSpacing: 1, marginBottom: 10 },
  card: { flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: 18, borderWidth: 1, padding: 14, marginBottom: 10 },
  checkCircle: { padding: 2 },
  cardTitle: { fontFamily: 'Inter_600SemiBold', fontSize: 15 },
  cardSub: { fontFamily: 'Inter_400Regular', fontSize: 12, marginTop: 2 },
  modalTitle: { fontFamily: 'Inter_700Bold', fontSize: 18, marginBottom: 12, textAlign: 'center' },
  errorText: { fontFamily: 'Inter_500Medium', fontSize: 13, marginBottom: 10, textAlign: 'center' },
  fieldLabel: { fontFamily: 'Inter_600SemiBold', fontSize: 12, marginBottom: 6, marginTop: 10, textTransform: 'uppercase', letterSpacing: 0.5 },
  input: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontFamily: 'Inter_500Medium', fontSize: 14 },
  followUpRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 16 },
  followUpText: { fontFamily: 'Inter_500Medium', fontSize: 14 },
  modalActionsRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 20 },
  modalTextBtn: { paddingVertical: 10, paddingHorizontal: 16 },
  modalTextBtnLabel: { fontFamily: 'Inter_500Medium', fontSize: 14 },
  modalPrimaryBtn: { paddingVertical: 12, paddingHorizontal: 20, borderRadius: 14 },
  modalPrimaryBtnLabel: { fontFamily: 'Inter_700Bold', fontSize: 14, color: '#FFF' },
});
