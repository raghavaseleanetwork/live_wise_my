import React, { useCallback, useState } from 'react';
import {
  StyleSheet,
  Text,
  View,
  ScrollView,
  Pressable,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams, useFocusEffect } from 'expo-router';
import Animated, { FadeInDown } from 'react-native-reanimated';

import { useTheme } from '@/lib/theme-context';
import {
  Appointment,
  loadAppointments,
  toggleAppointmentDone,
  deleteAppointment,
} from '@/lib/family-records';

export default function AppointmentsScreen() {
  const router = useRouter();
  const { memberId, memberName } = useLocalSearchParams<{ memberId: string; memberName?: string }>();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();

  const [items, setItems] = useState<Appointment[]>([]);

  const load = useCallback(async () => {
    if (!memberId) return;
    setItems(await loadAppointments(String(memberId)));
  }, [memberId]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const openAdd = () => {
    router.push({ pathname: '/family-appointments/add', params: { memberId: String(memberId), memberName: memberName ? String(memberName) : '' } });
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
          <Text style={[styles.headerTitle, { color: colors.text }]}>Doctor Appointments</Text>
          <Pressable onPress={openAdd} style={styles.addBtn} hitSlop={12}>
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
});
