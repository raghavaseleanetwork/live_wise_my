import React, { useCallback, useEffect, useState } from 'react';
import { StyleSheet, Text, View, ScrollView, Pressable, TextInput } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams, useFocusEffect } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { useTheme } from '@/lib/theme-context';
import { onCaregiverSync } from '@/lib/caregiver-sync';
import {
  DietType,
  DIET_TYPE_LABELS,
  MealSlot,
  DietProfile,
  loadDietProfile,
  saveDietProfile,
} from '@/lib/family-records';
import { LoadingIndicator } from '@/components/PremiumLoader';
import { useCaregiverPermissions } from '@/lib/use-caregiver-permissions';

const MEAL_SLOTS: MealSlot[] = ['breakfast', 'lunch', 'evening_snack', 'dinner'];

export default function FamilyDietScreen() {
  const router = useRouter();
  const { memberId, memberName } = useLocalSearchParams<{ memberId: string; memberName?: string }>();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const { t } = useTranslation();

  // Scoped caregiver access (PRD 5.5). The owner is unrestricted; a
  // caregiver only gets the actions their access level allows.
  const { canMarkDone, canEdit } = useCaregiverPermissions(memberId ? String(memberId) : null);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dietType, setDietType] = useState<DietType>('normal');
  const [customDietName, setCustomDietName] = useState('');
  const [meals, setMeals] = useState<DietProfile['meals']>({});
  const [dailyCalorieTarget, setDailyCalorieTarget] = useState('');
  const [foodRestrictions, setFoodRestrictions] = useState('');
  const [waterIntakeReminderEnabled, setWaterIntakeReminderEnabled] = useState(false);
  const [waterIntakeReminderHourly, setWaterIntakeReminderHourly] = useState('2');
  const [doctorNotes, setDoctorNotes] = useState('');

  const load = useCallback(async () => {
    if (!memberId) return;
    setLoading(true);
    const profile = await loadDietProfile(String(memberId));
    setDietType(profile.dietType);
    setCustomDietName(profile.customDietName ?? '');
    setMeals(profile.meals ?? {});
    setDailyCalorieTarget(profile.dailyCalorieTarget != null ? String(profile.dailyCalorieTarget) : '');
    setFoodRestrictions(profile.foodRestrictions ?? '');
    setWaterIntakeReminderEnabled(!!profile.waterIntakeReminderEnabled);
    setWaterIntakeReminderHourly(profile.waterIntakeReminderHourly != null ? String(profile.waterIntakeReminderHourly) : '2');
    setDoctorNotes(profile.doctorNotes ?? '');
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

  const toggleMealReminder = (slot: MealSlot) => {
    setMeals((prev) => {
      const existing = prev[slot];
      if (existing) {
        const next = { ...prev };
        delete next[slot];
        return next;
      }
      return { ...prev, [slot]: { time: '', reminderEnabled: true } };
    });
  };

  const setMealTime = (slot: MealSlot, time: string) => {
    setMeals((prev) => ({ ...prev, [slot]: { ...(prev[slot] ?? { reminderEnabled: true }), time } }));
  };

  const setMealNotes = (slot: MealSlot, notes: string) => {
    setMeals((prev) => ({ ...prev, [slot]: { ...(prev[slot] ?? { time: '', reminderEnabled: true }), notes } }));
  };

  const handleSave = async () => {
    if (!memberId || saving) return;
    setSaving(true);
    await saveDietProfile(String(memberId), {
      dietType,
      customDietName: dietType === 'custom' ? customDietName.trim() : undefined,
      meals,
      dailyCalorieTarget: dailyCalorieTarget.trim() ? Number(dailyCalorieTarget) : null,
      foodRestrictions: foodRestrictions.trim(),
      waterIntakeReminderEnabled,
      waterIntakeReminderHourly: waterIntakeReminderEnabled && waterIntakeReminderHourly.trim() ? Number(waterIntakeReminderHourly) : undefined,
      doctorNotes: doctorNotes.trim(),
      weeklyPlan: [],
    });
    setSaving(false);
    router.back();
  };

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
          <Text style={[styles.headerTitle, { color: colors.text }]}>{t('familyDiet.headerTitle')}</Text>
          <View style={styles.backBtn} />
        </View>
        {memberName ? <Text style={[styles.headerSubtitle, { color: colors.textSecondary }]}>{t('familyDiet.forMember', { name: memberName })}</Text> : null}
      </LinearGradient>

      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: insets.bottom + 40 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>{t('familyDiet.dietTypeLabel')}</Text>
        <View style={styles.chipGrid}>
          {(Object.keys(DIET_TYPE_LABELS) as DietType[]).map((dt) => (
            <Pressable
              key={dt}
              onPress={() => setDietType(dt)}
              style={[styles.typeChip, { backgroundColor: colors.inputBg, borderColor: colors.border }, dietType === dt && { backgroundColor: colors.accent, borderColor: colors.accent }]}
            >
              <Text style={[styles.typeChipText, { color: dietType === dt ? '#FFF' : colors.textSecondary }]}>{t(`familyDiet.type.${dt}`)}</Text>
            </Pressable>
          ))}
        </View>

        {dietType === 'custom' && (
          <>
            <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>{t('familyDiet.customDietNameLabel')}</Text>
            <TextInput
              style={[styles.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.inputBg }]}
              value={customDietName}
              onChangeText={setCustomDietName}
              placeholder={t('familyDiet.customDietNamePlaceholder')}
              placeholderTextColor={colors.textTertiary}
            />
          </>
        )}

        <Text style={[styles.sectionTitle, { color: colors.text }]}>{t('familyDiet.mealsLabel')}</Text>
        {MEAL_SLOTS.map((slot) => {
          const entry = meals[slot];
          return (
            <View key={slot} style={[styles.mealCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Pressable onPress={() => toggleMealReminder(slot)} style={styles.mealHeader}>
                <Ionicons name={entry ? 'checkbox' : 'square-outline'} size={20} color={entry ? colors.accent : colors.textTertiary} />
                <Text style={[styles.mealLabel, { color: colors.text }]}>{t(`familyDiet.meal.${slot}`)}</Text>
              </Pressable>
              {entry && (
                <>
                  <TextInput
                    style={[styles.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.inputBg, marginTop: 8 }]}
                    value={entry.time}
                    onChangeText={(v) => setMealTime(slot, v)}
                    placeholder={t('familyDiet.mealTimePlaceholder')}
                    placeholderTextColor={colors.textTertiary}
                  />
                  <TextInput
                    style={[styles.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.inputBg, marginTop: 8 }]}
                    value={entry.notes ?? ''}
                    onChangeText={(v) => setMealNotes(slot, v)}
                    placeholder={t('familyDiet.mealNotesPlaceholder')}
                    placeholderTextColor={colors.textTertiary}
                  />
                </>
              )}
            </View>
          );
        })}

        <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>{t('familyDiet.calorieTargetLabel')}</Text>
        <TextInput
          style={[styles.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.inputBg }]}
          value={dailyCalorieTarget}
          onChangeText={setDailyCalorieTarget}
          placeholder={t('familyDiet.calorieTargetPlaceholder')}
          placeholderTextColor={colors.textTertiary}
          keyboardType="numeric"
        />

        <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>{t('familyDiet.foodRestrictionsLabel')}</Text>
        <TextInput
          style={[styles.input, styles.textArea, { color: colors.text, borderColor: colors.border, backgroundColor: colors.inputBg }]}
          value={foodRestrictions}
          onChangeText={setFoodRestrictions}
          placeholder={t('familyDiet.foodRestrictionsPlaceholder')}
          placeholderTextColor={colors.textTertiary}
          multiline
        />

        <Pressable onPress={() => setWaterIntakeReminderEnabled(!waterIntakeReminderEnabled)} style={styles.toggleRow}>
          <Ionicons name={waterIntakeReminderEnabled ? 'checkbox' : 'square-outline'} size={22} color={waterIntakeReminderEnabled ? colors.accent : colors.textTertiary} />
          <Text style={[styles.toggleLabel, { color: colors.text }]}>{t('familyDiet.waterReminderLabel')}</Text>
        </Pressable>
        {waterIntakeReminderEnabled && (
          <>
            <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>{t('familyDiet.waterReminderHourlyLabel')}</Text>
            <TextInput
              style={[styles.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.inputBg }]}
              value={waterIntakeReminderHourly}
              onChangeText={setWaterIntakeReminderHourly}
              placeholder="2"
              placeholderTextColor={colors.textTertiary}
              keyboardType="numeric"
            />
          </>
        )}

        <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>{t('familyDiet.doctorNotesLabel')}</Text>
        <TextInput
          style={[styles.input, styles.textArea, { color: colors.text, borderColor: colors.border, backgroundColor: colors.inputBg }]}
          value={doctorNotes}
          onChangeText={setDoctorNotes}
          placeholder={t('familyDiet.doctorNotesPlaceholder')}
          placeholderTextColor={colors.textTertiary}
          multiline
        />

        <Pressable onPress={handleSave} disabled={saving} style={[styles.primaryBtn, { backgroundColor: colors.accent, opacity: saving ? 0.6 : 1 }]}>
          <Text style={styles.primaryBtnLabel}>{t('familyDiet.saveChanges')}</Text>
        </Pressable>
      </ScrollView>
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
  sectionTitle: { fontFamily: 'Inter_700Bold', fontSize: 14, marginTop: 20, marginBottom: 10 },
  input: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontFamily: 'Inter_500Medium', fontSize: 14 },
  textArea: { minHeight: 70, textAlignVertical: 'top' },
  chipGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  typeChip: { paddingVertical: 9, paddingHorizontal: 14, borderRadius: 10, borderWidth: 1 },
  typeChipText: { fontFamily: 'Inter_600SemiBold', fontSize: 12 },
  mealCard: { borderRadius: 14, borderWidth: 1, padding: 12, marginBottom: 10 },
  mealHeader: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  mealLabel: { fontFamily: 'Inter_600SemiBold', fontSize: 14 },
  toggleRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 16 },
  toggleLabel: { fontFamily: 'Inter_500Medium', fontSize: 14 },
  primaryBtn: { borderRadius: 14, paddingVertical: 15, alignItems: 'center', marginTop: 28 },
  primaryBtnLabel: { fontFamily: 'Inter_700Bold', fontSize: 15, color: '#FFF' },
});
