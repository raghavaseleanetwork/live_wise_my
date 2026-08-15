import React, { useCallback, useEffect, useState } from 'react';
import { StyleSheet, Text, View, ScrollView, Pressable, TextInput, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams, useFocusEffect } from 'expo-router';
import DateTimePicker from '@react-native-community/datetimepicker';
import { useTranslation } from 'react-i18next';

import { useTheme } from '@/lib/theme-context';
import { onCaregiverSync } from '@/lib/caregiver-sync';
import {
  StudyProfile,
  StudySubject,
  StudyExam,
  StudyEvent,
  StudyFee,
  loadStudyProfile,
  saveStudyProfile,
} from '@/lib/family-records';
import { LoadingIndicator } from '@/components/PremiumLoader';

function genId(): string {
  return Date.now().toString() + Math.random().toString(36).slice(2, 9);
}

export default function FamilyStudyScreen() {
  const router = useRouter();
  const { memberId, memberName } = useLocalSearchParams<{ memberId: string; memberName?: string }>();
  const insets = useSafeAreaInsets();
  const { colors, isDark } = useTheme();
  const { t } = useTranslation();

  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState<StudyProfile>({ grade: '', subjects: [], exams: [], events: [], fees: [] });

  const [subjectName, setSubjectName] = useState('');
  const [examSubject, setExamSubject] = useState('');
  const [examDate, setExamDate] = useState(new Date());
  const [showExamDatePicker, setShowExamDatePicker] = useState(false);
  const [eventTitle, setEventTitle] = useState('');
  const [eventDate, setEventDate] = useState(new Date());
  const [showEventDatePicker, setShowEventDatePicker] = useState(false);
  const [feeTitle, setFeeTitle] = useState('');
  const [feeAmount, setFeeAmount] = useState('');
  const [feeDueDate, setFeeDueDate] = useState(new Date());
  const [showFeeDatePicker, setShowFeeDatePicker] = useState(false);

  const load = useCallback(async () => {
    if (!memberId) return;
    setLoading(true);
    setProfile(await loadStudyProfile(String(memberId)));
    setLoading(false);
  }, [memberId]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  // A connected caregiver marking something done elsewhere pushes a silent
  // { type: 'sync', memberId } notification. Refetch on receipt so an open
  // list updates live instead of waiting for the next focus.
  useEffect(() => {
    const sub = onCaregiverSync((syncedMemberId) => {
      if (memberId && syncedMemberId === String(memberId)) load();
    });
    return () => sub.remove();
  }, [memberId, load]);

  const persist = async (next: StudyProfile) => {
    setProfile(next);
    if (memberId) await saveStudyProfile(String(memberId), next);
  };

  const addSubject = () => {
    if (!subjectName.trim() || !memberId) return;
    const subject: StudySubject = { id: genId(), name: subjectName.trim(), scheduleDays: [], scheduleTime: '', homeworkReminderEnabled: false, createdAt: new Date().toISOString() };
    persist({ ...profile, subjects: [...profile.subjects, subject] });
    setSubjectName('');
  };
  const removeSubject = (id: string) => persist({ ...profile, subjects: profile.subjects.filter((s) => s.id !== id) });

  const addExam = () => {
    if (!examSubject.trim() || !memberId) return;
    const exam: StudyExam = { id: genId(), subject: examSubject.trim(), examDate: examDate.toISOString(), reminderDaysBefore: [7, 3, 1], createdAt: new Date().toISOString() };
    persist({ ...profile, exams: [...profile.exams, exam] });
    setExamSubject('');
  };
  const removeExam = (id: string) => persist({ ...profile, exams: profile.exams.filter((e) => e.id !== id) });

  const addEvent = () => {
    if (!eventTitle.trim() || !memberId) return;
    const event: StudyEvent = { id: genId(), title: eventTitle.trim(), eventDate: eventDate.toISOString(), createdAt: new Date().toISOString() };
    persist({ ...profile, events: [...profile.events, event] });
    setEventTitle('');
  };
  const removeEvent = (id: string) => persist({ ...profile, events: profile.events.filter((e) => e.id !== id) });

  const addFee = () => {
    if (!feeTitle.trim() || !feeAmount.trim() || !memberId) return;
    const fee: StudyFee = { id: genId(), title: feeTitle.trim(), amount: Number(feeAmount), dueDate: feeDueDate.toISOString(), isPaid: false, createdAt: new Date().toISOString() };
    persist({ ...profile, fees: [...profile.fees, fee] });
    setFeeTitle('');
    setFeeAmount('');
  };
  const toggleFeePaid = (id: string) => persist({ ...profile, fees: profile.fees.map((f) => (f.id === id ? { ...f, isPaid: !f.isPaid } : f)) });
  const removeFee = (id: string) => persist({ ...profile, fees: profile.fees.filter((f) => f.id !== id) });

  const headerHeight = 110 + insets.top;

  if (loading) {
    return (
      <View style={[styles.container, { backgroundColor: colors.bg, justifyContent: 'center', alignItems: 'center' }]}>
        <LoadingIndicator size="large" color={colors.accent} />
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.bg }]}>
      <LinearGradient colors={colors.heroGradient as any} style={[styles.header, { height: headerHeight, paddingTop: insets.top }]}>
        <View style={styles.headerTop}>
          <Pressable onPress={() => router.back()} style={styles.backBtn} hitSlop={12}>
            <Ionicons name="chevron-back" size={24} color={colors.text} />
          </Pressable>
          <Text style={[styles.headerTitle, { color: colors.text }]}>{t('familyStudy.headerTitle')}</Text>
          <View style={styles.backBtn} />
        </View>
        {memberName ? <Text style={[styles.headerSubtitle, { color: colors.textSecondary }]}>{t('familyStudy.forMember', { name: memberName })}</Text> : null}
      </LinearGradient>

      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: insets.bottom + 40 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>{t('familyStudy.gradeLabel')}</Text>
        <TextInput
          style={[styles.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.inputBg }]}
          value={profile.grade}
          onChangeText={(v) => setProfile({ ...profile, grade: v })}
          onEndEditing={() => memberId && saveStudyProfile(String(memberId), profile)}
          placeholder={t('familyStudy.gradePlaceholder')}
          placeholderTextColor={colors.textTertiary}
        />

        <Text style={[styles.sectionTitle, { color: colors.text }]}>{t('familyStudy.subjectsLabel')}</Text>
        {profile.subjects.map((s) => (
          <View key={s.id} style={[styles.rowCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.rowCardText, { color: colors.text }]}>{s.name}</Text>
            <Pressable onPress={() => removeSubject(s.id)} hitSlop={10}><Ionicons name="trash-outline" size={16} color={colors.textTertiary} /></Pressable>
          </View>
        ))}
        <View style={styles.addRow}>
          <TextInput
            style={[styles.input, { flex: 1, color: colors.text, borderColor: colors.border, backgroundColor: colors.inputBg }]}
            value={subjectName}
            onChangeText={setSubjectName}
            placeholder={t('familyStudy.subjectPlaceholder')}
            placeholderTextColor={colors.textTertiary}
          />
          <Pressable onPress={addSubject} style={[styles.addBtn, { backgroundColor: colors.accent }]}><Ionicons name="add" size={20} color="#FFF" /></Pressable>
        </View>

        <Text style={[styles.sectionTitle, { color: colors.text }]}>{t('familyStudy.examsLabel')}</Text>
        {profile.exams.map((e) => (
          <View key={e.id} style={[styles.rowCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.rowCardText, { color: colors.text }]}>{e.subject} · {new Date(e.examDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</Text>
            <Pressable onPress={() => removeExam(e.id)} hitSlop={10}><Ionicons name="trash-outline" size={16} color={colors.textTertiary} /></Pressable>
          </View>
        ))}
        <View style={styles.addRow}>
          <TextInput
            style={[styles.input, { flex: 1, color: colors.text, borderColor: colors.border, backgroundColor: colors.inputBg }]}
            value={examSubject}
            onChangeText={setExamSubject}
            placeholder={t('familyStudy.examSubjectPlaceholder')}
            placeholderTextColor={colors.textTertiary}
          />
          <Pressable onPress={() => setShowExamDatePicker(true)} style={[styles.input, { borderColor: colors.border, backgroundColor: colors.inputBg, justifyContent: 'center', paddingHorizontal: 12 }]}>
            <Text style={{ color: colors.text, fontSize: 12 }}>{examDate.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</Text>
          </Pressable>
          <Pressable onPress={addExam} style={[styles.addBtn, { backgroundColor: colors.accent }]}><Ionicons name="add" size={20} color="#FFF" /></Pressable>
        </View>

        <Text style={[styles.sectionTitle, { color: colors.text }]}>{t('familyStudy.eventsLabel')}</Text>
        {profile.events.map((ev) => (
          <View key={ev.id} style={[styles.rowCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.rowCardText, { color: colors.text }]}>{ev.title} · {new Date(ev.eventDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</Text>
            <Pressable onPress={() => removeEvent(ev.id)} hitSlop={10}><Ionicons name="trash-outline" size={16} color={colors.textTertiary} /></Pressable>
          </View>
        ))}
        <View style={styles.addRow}>
          <TextInput
            style={[styles.input, { flex: 1, color: colors.text, borderColor: colors.border, backgroundColor: colors.inputBg }]}
            value={eventTitle}
            onChangeText={setEventTitle}
            placeholder={t('familyStudy.eventTitlePlaceholder')}
            placeholderTextColor={colors.textTertiary}
          />
          <Pressable onPress={() => setShowEventDatePicker(true)} style={[styles.input, { borderColor: colors.border, backgroundColor: colors.inputBg, justifyContent: 'center', paddingHorizontal: 12 }]}>
            <Text style={{ color: colors.text, fontSize: 12 }}>{eventDate.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</Text>
          </Pressable>
          <Pressable onPress={addEvent} style={[styles.addBtn, { backgroundColor: colors.accent }]}><Ionicons name="add" size={20} color="#FFF" /></Pressable>
        </View>

        <Text style={[styles.sectionTitle, { color: colors.text }]}>{t('familyStudy.feesLabel')}</Text>
        {profile.fees.map((f) => (
          <View key={f.id} style={[styles.rowCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Pressable onPress={() => toggleFeePaid(f.id)} hitSlop={10}>
              <Ionicons name={f.isPaid ? 'checkmark-circle' : 'ellipse-outline'} size={20} color={f.isPaid ? '#10B981' : colors.textTertiary} />
            </Pressable>
            <Text style={[styles.rowCardText, { color: colors.text, flex: 1, marginLeft: 8 }, f.isPaid && { textDecorationLine: 'line-through', opacity: 0.5 }]}>
              {f.title} · ₹{f.amount} · {new Date(f.dueDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
            </Text>
            <Pressable onPress={() => removeFee(f.id)} hitSlop={10}><Ionicons name="trash-outline" size={16} color={colors.textTertiary} /></Pressable>
          </View>
        ))}
        <View style={styles.addRow}>
          <TextInput
            style={[styles.input, { flex: 1, color: colors.text, borderColor: colors.border, backgroundColor: colors.inputBg }]}
            value={feeTitle}
            onChangeText={setFeeTitle}
            placeholder={t('familyStudy.feeTitlePlaceholder')}
            placeholderTextColor={colors.textTertiary}
          />
          <TextInput
            style={[styles.input, { width: 80, color: colors.text, borderColor: colors.border, backgroundColor: colors.inputBg }]}
            value={feeAmount}
            onChangeText={setFeeAmount}
            placeholder={t('familyStudy.feeAmountPlaceholder')}
            placeholderTextColor={colors.textTertiary}
            keyboardType="numeric"
          />
          <Pressable onPress={() => setShowFeeDatePicker(true)} style={[styles.input, { borderColor: colors.border, backgroundColor: colors.inputBg, justifyContent: 'center', paddingHorizontal: 12 }]}>
            <Text style={{ color: colors.text, fontSize: 12 }}>{feeDueDate.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</Text>
          </Pressable>
          <Pressable onPress={addFee} style={[styles.addBtn, { backgroundColor: colors.accent }]}><Ionicons name="add" size={20} color="#FFF" /></Pressable>
        </View>
      </ScrollView>

      {showExamDatePicker && (
        <DateTimePicker value={examDate} mode="date" display={Platform.OS === 'ios' ? 'spinner' : 'default'} themeVariant={isDark ? 'dark' : 'light'} onChange={(e, d) => { setShowExamDatePicker(false); if (d) setExamDate(d); }} />
      )}
      {showEventDatePicker && (
        <DateTimePicker value={eventDate} mode="date" display={Platform.OS === 'ios' ? 'spinner' : 'default'} themeVariant={isDark ? 'dark' : 'light'} onChange={(e, d) => { setShowEventDatePicker(false); if (d) setEventDate(d); }} />
      )}
      {showFeeDatePicker && (
        <DateTimePicker value={feeDueDate} mode="date" display={Platform.OS === 'ios' ? 'spinner' : 'default'} themeVariant={isDark ? 'dark' : 'light'} onChange={(e, d) => { setShowFeeDatePicker(false); if (d) setFeeDueDate(d); }} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { paddingHorizontal: 20, justifyContent: 'center', borderBottomLeftRadius: 32, borderBottomRightRadius: 32 },
  headerTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  backBtn: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontFamily: 'Inter_700Bold', fontSize: 18 },
  headerSubtitle: { fontFamily: 'Inter_500Medium', fontSize: 13, marginTop: 4, textAlign: 'center' },
  fieldLabel: { fontFamily: 'Inter_600SemiBold', fontSize: 12, marginBottom: 6, marginTop: 10 },
  sectionTitle: { fontFamily: 'Inter_700Bold', fontSize: 14, marginTop: 22, marginBottom: 10 },
  input: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontFamily: 'Inter_500Medium', fontSize: 14 },
  addRow: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  addBtn: { width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  rowCard: { flexDirection: 'row', alignItems: 'center', borderRadius: 12, borderWidth: 1, padding: 12, marginBottom: 8 },
  rowCardText: { fontFamily: 'Inter_500Medium', fontSize: 13, flex: 1 },
});
