import React, { useState } from 'react';
import {
  StyleSheet,
  Text,
  View,
  ScrollView,
  Pressable,
  TextInput,
  Platform,
  KeyboardAvoidingView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import DateTimePicker from '@react-native-community/datetimepicker';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { useTranslation } from 'react-i18next';

import { useTheme } from '@/lib/theme-context';
import { useAuth } from '@/lib/auth-context';
import { apiRequest } from '@/lib/query-client';
import { toLocalDateString } from '@/lib/data';

type MedAppearance = 'capsule' | 'tablet' | 'round' | 'liquid';
type MedInstruction = 'before_meal' | 'after_meal' | 'any';
type MedScheduleType = 'continuous' | 'custom';

interface MedicineSlots {
  morning?: string | null;
  noon?: string | null;
  evening?: string | null;
}

export default function AddMedicineScreen() {
  const router = useRouter();
  const { memberId, memberName } = useLocalSearchParams<{ memberId: string; memberName: string }>();
  const insets = useSafeAreaInsets();
  const { colors, isDark } = useTheme();
  const { token } = useAuth();
  const { t } = useTranslation();

  // Form State
  const [medName, setMedName] = useState('');
  const [medDosage, setMedDosage] = useState('');
  // Nothing preselected — the user picks the form the medicine comes in.
  const [medAppearance, setMedAppearance] = useState<MedAppearance | null>(null);
  const [medColor, setMedColor] = useState('#10B981');
  const [medInstruction, setMedInstruction] = useState<MedInstruction>('any');
  const [slotMorning, setSlotMorning] = useState(false);
  const [slotNoon, setSlotNoon] = useState(false);
  const [slotEvening, setSlotEvening] = useState(false);
  const [slotMorningTime, setSlotMorningTime] = useState('09:00 AM');
  const [slotNoonTime, setSlotNoonTime] = useState('01:00 PM');
  const [slotEveningTime, setSlotEveningTime] = useState('08:00 PM');
  // Nothing preselected — "continuous" vs "custom" is a real choice, and the
  // custom date fields only appear once the user makes it.
  const [medScheduleType, setMedScheduleType] = useState<MedScheduleType | null>(null);
  
  // Local, not UTC: after 18:30 IST a UTC-derived "today" is already tomorrow,
  // so the default start date would jump a day ahead each evening.
  const todayIso = toLocalDateString(new Date());
  const [medStartDate, setMedStartDate] = useState(todayIso);
  const [medEndDate, setMedEndDate] = useState('');
  const [error, setError] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  // UI State for Time Pickers
  const [pickingSlot, setPickingSlot] = useState<'morning' | 'noon' | 'evening' | null>(null);

  const handleSave = async () => {
    if (!medName.trim()) {
      setError(t('addMedicine.errorEnterName'));
      return;
    }
    if (!medAppearance) {
      setError(t('addMedicine.errorSelectAppearance'));
      return;
    }
    // No slot is preselected, so an unanswered schedule has to be caught here —
    // saving with an empty `slots` would create a medicine that never reminds.
    if (!slotMorning && !slotNoon && !slotEvening) {
      setError(t('addMedicine.errorSelectSlot'));
      return;
    }
    if (!medScheduleType) {
      setError(t('addMedicine.errorSelectDuration'));
      return;
    }
    if (!token || !memberId) return;

    setIsSaving(true);
    try {
      const slots: MedicineSlots = {};
      if (slotMorning) slots.morning = slotMorningTime;
      if (slotNoon) slots.noon = slotNoonTime;
      if (slotEvening) slots.evening = slotEveningTime;

      const body = {
        name: medName.trim(),
        dosage: medDosage.trim(),
        appearance: medAppearance,
        color: medColor,
        instruction: medInstruction,
        slots,
        scheduleType: medScheduleType,
        startDate: medStartDate,
        endDate: medScheduleType === 'custom' ? medEndDate || null : null,
      };

      const res = await apiRequest(
        'POST',
        `/api/family/${memberId}/medicines`,
        body,
        token
      );
      if (res.ok) {
        router.back();
      } else {
        setError(t('addMedicine.errorAddFailed'));
      }
    } catch (e) {
      console.error('Add medicine error:', e);
      setError(t('familyMember.errorUnexpected'));
    } finally {
      setIsSaving(false);
    }
  };

  const onTimeChange = (event: any, selectedDate?: Date) => {
    if (Platform.OS === 'android') setPickingSlot(null);
    if (selectedDate) {
      const timeStr = selectedDate.toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: true,
      });
      if (pickingSlot === 'morning') setSlotMorningTime(timeStr);
      else if (pickingSlot === 'noon') setSlotNoonTime(timeStr);
      else if (pickingSlot === 'evening') setSlotEveningTime(timeStr);
    }
  };

  const headerHeight = 120 + insets.top;

  return (
    <View style={[styles.container, { backgroundColor: colors.bg }]}>
      <KeyboardAvoidingView 
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'} 
        style={{ flex: 1 }}
      >
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: insets.bottom + 100 }}>
          {/* Header */}
          <LinearGradient
            colors={colors.heroGradient as any}
            style={[styles.header, { height: headerHeight, paddingTop: insets.top }]}
          >
            <View style={styles.headerTop}>
              <Pressable onPress={() => router.back()} style={styles.backBtn}>
                <Ionicons name="chevron-back" size={24} color={colors.text} />
              </Pressable>
              <Text style={[styles.headerTitle, { color: colors.text }]}>{t('addMedicine.title')}</Text>
              <View style={{ width: 40 }} />
            </View>

            <View style={styles.headerNameBlock}>
              <Text style={[styles.memberContext, { color: colors.textSecondary }]}>{t('familyHealth.forMember', { name: memberName })}</Text>
              <TextInput
                style={[styles.nameInput, { color: colors.text }]}
                value={medName}
                onChangeText={setMedName}
                placeholder={t('addMedicine.namePlaceholder')}
                placeholderTextColor={colors.textTertiary}
                autoFocus
              />
              <View style={[styles.nameUnderline, { backgroundColor: colors.accent }]} />
            </View>
          </LinearGradient>

          <View style={styles.form}>
            {error ? (
              <Animated.View entering={FadeInDown} style={[styles.errorBox, { backgroundColor: colors.dangerDim }]}>
                <Ionicons name="alert-circle" size={18} color={colors.danger} />
                <Text style={[styles.errorText, { color: colors.danger }]}>{error}</Text>
              </Animated.View>
            ) : null}

            {/* Basic Info Card */}
            <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
               <View style={styles.field}>
                  <Text style={[styles.label, { color: colors.textSecondary }]}>{t('addMedicine.dosage')}</Text>
                  <TextInput
                    style={[styles.valueInput, { color: colors.text }]}
                    value={medDosage}
                    onChangeText={setMedDosage}
                    placeholder={t('addMedicine.dosagePlaceholder')}
                    placeholderTextColor={colors.textTertiary}
                  />
               </View>
            </View>

            {/* Appearance & Color */}
            <Text style={[styles.sectionTitle, { color: colors.textSecondary }]}>{t('addMedicine.appearance')}</Text>
            <View style={styles.appearanceGrid}>
              {[
                { key: 'capsule', label: t('addMedicine.appearanceCapsule'), icon: 'ellipse-outline' },
                { key: 'tablet', label: t('addMedicine.appearanceTablet'), icon: 'square-outline' },
                { key: 'round', label: t('addMedicine.appearanceRound'), icon: 'radio-button-on' },
                { key: 'liquid', label: t('addMedicine.appearanceLiquid'), icon: 'water' },
              ].map(opt => (
                <Pressable
                  key={opt.key}
                  onPress={() => setMedAppearance(opt.key as MedAppearance)}
                  style={[
                    styles.appearanceCard,
                    { backgroundColor: colors.card, borderColor: colors.border },
                    medAppearance === opt.key && { borderColor: colors.accent, backgroundColor: colors.accent + '10' }
                  ]}
                >
                  <Ionicons 
                    name={opt.icon as any} 
                    size={24} 
                    color={medAppearance === opt.key ? colors.accent : colors.textTertiary} 
                  />
                  <Text style={[
                    styles.appearanceLabel, 
                    { color: colors.textSecondary },
                    medAppearance === opt.key && { color: colors.accent, fontFamily: 'Inter_600SemiBold' }
                  ]}>
                    {opt.label}
                  </Text>
                </Pressable>
              ))}
            </View>

            <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border, marginTop: 20 }]}>
              <Text style={[styles.label, { color: colors.textSecondary, marginBottom: 12 }]}>{t('addMedicine.medicineColor')}</Text>
              <View style={styles.colorRow}>
                {['#10B981', '#3B82F6', '#F97316', '#EF4444', '#8B5CF6', '#EC4899'].map(c => (
                  <Pressable
                    key={c}
                    onPress={() => setMedColor(c)}
                    style={[
                      styles.colorDot,
                      { backgroundColor: c },
                      medColor === c && { borderColor: colors.text, borderWidth: 2 }
                    ]}
                  />
                ))}
              </View>
            </View>

            {/* Timing Selection */}
            <Text style={[styles.sectionTitle, { color: colors.textSecondary }]}>{t('addMedicine.timingSlots')}</Text>
            <View style={styles.slotContainer}>
              {[
                { key: 'morning', label: t('addMedicine.slotMorning'), time: slotMorningTime, active: slotMorning, set: setSlotMorning },
                { key: 'noon', label: t('addMedicine.slotNoon'), time: slotNoonTime, active: slotNoon, set: setSlotNoon },
                { key: 'evening', label: t('addMedicine.slotEvening'), time: slotEveningTime, active: slotEvening, set: setSlotEvening },
              ].map(slot => (
                <View key={slot.key} style={[styles.slotRow, { borderBottomColor: colors.border }]}>
                  <Pressable 
                    onPress={() => slot.set(!slot.active)}
                    style={styles.slotToggle}
                  >
                    <Ionicons 
                      name={slot.active ? "checkbox" : "square-outline"} 
                      size={24} 
                      color={slot.active ? colors.accent : colors.textTertiary} 
                    />
                    <Text style={[styles.slotLabel, { color: colors.text }]}>{slot.label}</Text>
                  </Pressable>
                  
                  {slot.active && (
                    <Pressable 
                      onPress={() => setPickingSlot(slot.key as any)}
                      style={[styles.timeButton, { backgroundColor: colors.accentDim }]}
                    >
                      <Text style={[styles.timeButtonText, { color: colors.accent }]}>{slot.time}</Text>
                      <Ionicons name="time-outline" size={14} color={colors.accent} style={{ marginLeft: 4 }} />
                    </Pressable>
                  )}
                </View>
              ))}
            </View>

            {/* Instructions */}
            <Text style={[styles.sectionTitle, { color: colors.textSecondary }]}>{t('addMedicine.instructions')}</Text>
            <View style={styles.instructionRow}>
              {[
                { key: 'before_meal', label: t('addMedicine.instructionBeforeMeal') },
                { key: 'after_meal', label: t('addMedicine.instructionAfterMeal') },
                { key: 'any', label: t('addMedicine.instructionAnyTime') },
              ].map(opt => (
                <Pressable
                  key={opt.key}
                  onPress={() => setMedInstruction(opt.key as MedInstruction)}
                  style={[
                    styles.instructionChip,
                    { backgroundColor: colors.card, borderColor: colors.border },
                    medInstruction === opt.key && { backgroundColor: '#10B981', borderColor: '#10B981' }
                  ]}
                >
                  <Text style={[
                    styles.chipText, 
                    { color: colors.textSecondary },
                    medInstruction === opt.key && { color: '#FFF' }
                  ]}>
                    {opt.label}
                  </Text>
                </Pressable>
              ))}
            </View>

            {/* Duration */}
            <Text style={[styles.sectionTitle, { color: colors.textSecondary }]}>{t('addMedicine.duration')}</Text>
            <View style={styles.durationCard}>
              <Pressable
                onPress={() => setMedScheduleType('continuous')}
                style={[
                  styles.durationOption,
                  { backgroundColor: colors.card, borderColor: colors.border },
                  medScheduleType === 'continuous' && { borderColor: colors.accent, backgroundColor: colors.accent + '05' }
                ]}
              >
                <View style={styles.durationInfo}>
                  <Text style={[styles.durationTitle, { color: colors.text }]}>{t('addMedicine.continuous')}</Text>
                  <Text style={[styles.durationSubtitle, { color: colors.textTertiary }]}>{t('addMedicine.continuousSubtitle')}</Text>
                </View>
                {medScheduleType === 'continuous' && <Ionicons name="checkmark-circle" size={20} color={colors.accent} />}
              </Pressable>

              <Pressable
                onPress={() => setMedScheduleType('custom')}
                style={[
                  styles.durationOption,
                  { backgroundColor: colors.card, borderColor: colors.border },
                  medScheduleType === 'custom' && { borderColor: colors.accent, backgroundColor: colors.accent + '05' }
                ]}
              >
                <View style={styles.durationInfo}>
                  <Text style={[styles.durationTitle, { color: colors.text }]}>{t('addMedicine.customDuration')}</Text>
                  <Text style={[styles.durationSubtitle, { color: colors.textTertiary }]}>{t('addMedicine.customDurationSubtitle')}</Text>
                </View>
                {medScheduleType === 'custom' && <Ionicons name="checkmark-circle" size={20} color={colors.accent} />}
              </Pressable>
            </View>

            {medScheduleType === 'custom' && (
              <Animated.View entering={FadeInDown} style={styles.dateInputs}>
                <View style={styles.field}>
                  <Text style={[styles.label, { color: colors.textSecondary }]}>{t('addMedicine.startDate')}</Text>
                  <TextInput
                    style={[styles.dateInput, { color: colors.text, borderBottomColor: colors.border }]}
                    value={medStartDate}
                    onChangeText={setMedStartDate}
                    placeholder="YYYY-MM-DD"
                    placeholderTextColor={colors.textTertiary}
                  />
                </View>
                <View style={styles.field}>
                  <Text style={[styles.label, { color: colors.textSecondary }]}>{t('addMedicine.endDate')}</Text>
                  <TextInput
                    style={[styles.dateInput, { color: colors.text, borderBottomColor: colors.border }]}
                    value={medEndDate}
                    onChangeText={setMedEndDate}
                    placeholder="YYYY-MM-DD"
                    placeholderTextColor={colors.textTertiary}
                  />
                </View>
              </Animated.View>
            )}
          </View>
        </ScrollView>

        {/* Footer Save */}
        <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, 16) }]}>
          <Pressable onPress={handleSave} disabled={isSaving} style={styles.saveBtn}>
            <LinearGradient
              colors={colors.buttonGradient as any}
              style={styles.saveGradient}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
            >
              <Ionicons name="medkit-outline" size={24} color="#FFF" />
              <Text style={styles.saveBtnText}>{isSaving ? t('addMedicine.adding') : t('addMedicine.addMedicineButton')}</Text>
            </LinearGradient>
          </Pressable>
        </View>

        {pickingSlot && (
          <DateTimePicker
            value={new Date()}
            mode="time"
            display={Platform.OS === 'ios' ? 'spinner' : 'default'}
            onChange={onTimeChange}
          />
        )}
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    paddingHorizontal: 20,
    justifyContent: 'center',
    borderBottomLeftRadius: 32,
    borderBottomRightRadius: 32,
  },
  headerTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontFamily: 'Inter_700Bold',
    fontSize: 20,
  },
  headerNameBlock: {
    marginTop: 0,
  },
  memberContext: {
    fontFamily: 'Inter_500Medium',
    fontSize: 14,
    marginBottom: 4,
  },
  nameInput: {
    fontFamily: 'Inter_700Bold',
    fontSize: 28,
    paddingVertical: 4,
  },
  nameUnderline: {
    height: 3,
    width: 60,
    borderRadius: 2,
    marginTop: 4,
  },
  form: {
    paddingTop: 24,
    paddingHorizontal: 20,
  },
  errorBox: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderRadius: 12,
    marginBottom: 20,
  },
  errorText: {
    marginLeft: 8,
    fontFamily: 'Inter_500Medium',
    fontSize: 14,
  },
  card: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 16,
    marginBottom: 20,
  },
  field: {
    marginBottom: 4,
  },
  label: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 12,
    letterSpacing: 0.5,
    marginBottom: 8,
  },
  valueInput: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 18,
    paddingVertical: 4,
  },
  sectionTitle: {
    fontFamily: 'Inter_700Bold',
    fontSize: 13,
    marginBottom: 16,
    marginTop: 8,
    letterSpacing: 1,
  },
  appearanceGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  appearanceCard: {
    width: '48%',
    height: 80,
    borderRadius: 16,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  appearanceLabel: {
    fontSize: 12,
    fontFamily: 'Inter_500Medium',
  },
  colorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  colorDot: {
    width: 32,
    height: 32,
    borderRadius: 16,
  },
  slotContainer: {
    backgroundColor: 'transparent',
    marginBottom: 20,
  },
  slotRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    borderBottomWidth: 1,
  },
  slotToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  slotLabel: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 16,
  },
  timeButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
  },
  timeButtonText: {
    fontFamily: 'Inter_700Bold',
    fontSize: 14,
  },
  instructionRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginBottom: 24,
  },
  instructionChip: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 14,
    borderWidth: 1,
  },
  chipText: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 13,
  },
  durationCard: {
    gap: 10,
    marginBottom: 20,
  },
  durationOption: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    borderRadius: 16,
    borderWidth: 1,
  },
  durationInfo: {
    flex: 1,
  },
  durationTitle: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 15,
    marginBottom: 2,
  },
  durationSubtitle: {
    fontFamily: 'Inter_400Regular',
    fontSize: 12,
  },
  dateInputs: {
    flexDirection: 'row',
    gap: 16,
    marginBottom: 20,
  },
  dateInput: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 14,
    borderBottomWidth: 1,
    paddingVertical: 6,
    minWidth: 120,
  },
  footer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 20,
    paddingTop: 10,
  },
  saveBtn: {
    height: 64,
    borderRadius: 16,
    overflow: 'hidden',
  },
  saveGradient: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  saveBtnText: {
    color: '#FFF',
    fontFamily: 'Inter_700Bold',
    fontSize: 18,
  },
});
