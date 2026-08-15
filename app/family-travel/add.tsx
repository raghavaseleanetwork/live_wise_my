import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View, ScrollView, Pressable, TextInput, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import DateTimePicker from '@react-native-community/datetimepicker';
import { useTranslation } from 'react-i18next';

import { useTheme } from '@/lib/theme-context';
import { useAuth } from '@/lib/auth-context';
import { apiRequest } from '@/lib/query-client';
import { TravelType, TRAVEL_TYPE_LABELS, TravelRecurrence, addTravelItem, loadTravelItems, updateTravelItem } from '@/lib/family-records';

const RECURRENCES: TravelRecurrence[] = ['weekly', 'monthly', 'yearly'];
const REMINDER_HOURS_OPTIONS = [1, 3, 24];

/** Example title per travel type, so the hint matches the selected chip. */
const TYPE_PLACEHOLDER_KEYS: Record<TravelType, string> = {
  doctor_visit: 'familyTravel.placeholderDoctorVisit',
  family_visit: 'familyTravel.placeholderFamilyVisit',
  trip: 'familyTravel.placeholderTrip',
};

export default function AddTravelItemScreen() {
  const router = useRouter();
  const { memberId, memberName, editId } = useLocalSearchParams<{ memberId: string; memberName?: string; editId?: string }>();
  const insets = useSafeAreaInsets();
  const { colors, isDark } = useTheme();
  const { token } = useAuth();
  const { t } = useTranslation();

  const [showDatePicker, setShowDatePicker] = useState(false);
  const [showTimePicker, setShowTimePicker] = useState(false);
  const [showReturnDatePicker, setShowReturnDatePicker] = useState(false);
  // Nothing preselected on a new entry; editing seeds it from the record.
  const [type, setType] = useState<TravelType | null>(null);
  const [title, setTitle] = useState('');
  const [location, setLocation] = useState('');
  const [notes, setNotes] = useState('');
  const [date, setDate] = useState(new Date());
  const [isRecurring, setIsRecurring] = useState(false);
  const [recurrence, setRecurrence] = useState<TravelRecurrence>('monthly');
  const [reminderHoursBefore, setReminderHoursBefore] = useState<number>(24);
  const [returnDate, setReturnDate] = useState<Date | null>(null);
  const [companionMemberIds, setCompanionMemberIds] = useState<string[]>([]);
  const [familyMembers, setFamilyMembers] = useState<{ id: string; name: string }[]>([]);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const isEditing = !!editId;

  useEffect(() => {
    if (!token) return;
    (async () => {
      try {
        const res = await apiRequest('GET', '/api/family', undefined, token);
        const data = (await res.json()) as { id: string; name: string }[];
        setFamilyMembers(data.filter((m) => String(m.id) !== String(memberId)));
      } catch {
        // Companion linking is a nice-to-have; a failed fetch just leaves the list empty.
      }
    })();
  }, [token, memberId]);

  // Seed the form from the record being edited.
  useEffect(() => {
    if (!editId || !memberId) return;
    let cancelled = false;
    (async () => {
      const items = await loadTravelItems(String(memberId));
      const found = items.find((x) => x.id === String(editId));
      if (!found || cancelled) return;
      setType(found.type);
      setTitle(found.title);
      setLocation(found.location ?? '');
      setNotes(found.notes ?? '');
      setDate(new Date(found.date));
      setIsRecurring(!!found.isRecurring);
      setRecurrence(found.recurrence ?? 'monthly');
      setReminderHoursBefore(found.reminderHoursBefore ?? 24);
      setReturnDate(found.returnDate ? new Date(found.returnDate) : null);
      setCompanionMemberIds(found.companionMemberIds ?? []);
    })();
    return () => { cancelled = true; };
  }, [editId, memberId]);

  const toggleCompanion = (id: string) => {
    setCompanionMemberIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const handleSave = async () => {
    if (!type) {
      setError(t('familyTravel.errorSelectType'));
      return;
    }
    if (!title.trim()) {
      setError(t('familyTravel.errorEnterTitle'));
      return;
    }
    if (!memberId || saving) return;
    setSaving(true);
    const data = {
      type,
      title: title.trim(),
      location: location.trim(),
      notes: notes.trim(),
      date: date.toISOString(),
      isRecurring,
      recurrence: isRecurring ? recurrence : undefined,
      reminderHoursBefore,
      returnDate: type === 'trip' && returnDate ? returnDate.toISOString() : null,
      companionMemberIds,
    };
    if (isEditing) {
      await updateTravelItem(String(memberId), String(editId), data);
    } else {
      await addTravelItem(String(memberId), data);
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
          <Text style={[styles.headerTitle, { color: colors.text }]}>{isEditing ? t('familyTravel.editHeaderTitle') : t('familyTravel.newHeaderTitle')}</Text>
          <View style={styles.backBtn} />
        </View>
        {memberName ? <Text style={[styles.headerSubtitle, { color: colors.textSecondary }]}>{t('familyTravel.forMember', { name: memberName })}</Text> : null}
      </LinearGradient>

      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: insets.bottom + 40 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        {!!error && <Text style={[styles.errorText, { color: colors.danger }]}>{error}</Text>}

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.typeScroll}
          contentContainerStyle={styles.typeRow}
        >
          {(Object.keys(TRAVEL_TYPE_LABELS) as TravelType[]).map((tt) => (
            <Pressable
              key={tt}
              onPress={() => setType(tt)}
              style={[styles.typeChip, { backgroundColor: colors.inputBg, borderColor: colors.border }, type === tt && { backgroundColor: colors.accent, borderColor: colors.accent }]}
            >
              <Ionicons name={TRAVEL_TYPE_LABELS[tt].icon as any} size={14} color={type === tt ? '#FFF' : colors.textSecondary} />
              <Text style={[styles.typeChipText, { color: type === tt ? '#FFF' : colors.textSecondary }]}>{t(`familyTravel.type.${tt}`)}</Text>
            </Pressable>
          ))}
        </ScrollView>

        <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>{t('familyTravel.titleLabel')}</Text>
        <TextInput
          style={[styles.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.inputBg }]}
          value={title}
          onChangeText={setTitle}
          placeholder={type ? t(TYPE_PLACEHOLDER_KEYS[type]) : t('familyTravel.titlePlaceholderDefault')}
          placeholderTextColor={colors.textTertiary}
          autoFocus
        />

        <View style={styles.formRow}>
          <View style={{ flex: 1 }}>
            <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>{t('familyTravel.dateLabel')}</Text>
            <Pressable onPress={() => setShowDatePicker(true)} style={[styles.input, { borderColor: colors.border, backgroundColor: colors.inputBg, justifyContent: 'center' }]}>
              <Text style={{ color: colors.text }}>{date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</Text>
            </Pressable>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>{t('familyTravel.timeLabel')}</Text>
            <Pressable onPress={() => setShowTimePicker(true)} style={[styles.input, { borderColor: colors.border, backgroundColor: colors.inputBg, justifyContent: 'center' }]}>
              <Text style={{ color: colors.text }}>{date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true })}</Text>
            </Pressable>
          </View>
        </View>

        <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>{t('familyTravel.locationLabel')}</Text>
        <TextInput
          style={[styles.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.inputBg }]}
          value={location}
          onChangeText={setLocation}
          placeholder={t('familyTravel.locationPlaceholder')}
          placeholderTextColor={colors.textTertiary}
        />

        <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>{t('familyTravel.notesLabel')}</Text>
        <TextInput
          style={[styles.input, styles.textArea, { color: colors.text, borderColor: colors.border, backgroundColor: colors.inputBg }]}
          value={notes}
          onChangeText={setNotes}
          placeholder={t('familyTravel.notesPlaceholder')}
          placeholderTextColor={colors.textTertiary}
          multiline
        />

        <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>{t('familyTravel.reminderLabel')}</Text>
        <View style={styles.chipRow}>
          {REMINDER_HOURS_OPTIONS.map((h) => (
            <Pressable
              key={h}
              onPress={() => setReminderHoursBefore(h)}
              style={[styles.smallChip, { backgroundColor: colors.inputBg, borderColor: colors.border }, reminderHoursBefore === h && { backgroundColor: colors.accent, borderColor: colors.accent }]}
            >
              <Text style={[styles.smallChipText, { color: reminderHoursBefore === h ? '#FFF' : colors.textSecondary }]}>{t('familyTravel.hoursBefore', { count: h })}</Text>
            </Pressable>
          ))}
        </View>

        <Pressable onPress={() => setIsRecurring(!isRecurring)} style={styles.toggleRow}>
          <Ionicons name={isRecurring ? 'checkbox' : 'square-outline'} size={22} color={isRecurring ? colors.accent : colors.textTertiary} />
          <Text style={[styles.toggleLabel, { color: colors.text }]}>{t('familyTravel.recurringCheckbox')}</Text>
        </Pressable>
        {isRecurring && (
          <View style={styles.chipRow}>
            {RECURRENCES.map((r) => (
              <Pressable
                key={r}
                onPress={() => setRecurrence(r)}
                style={[styles.smallChip, { backgroundColor: colors.inputBg, borderColor: colors.border }, recurrence === r && { backgroundColor: colors.accent, borderColor: colors.accent }]}
              >
                <Text style={[styles.smallChipText, { color: recurrence === r ? '#FFF' : colors.textSecondary }]}>{t(`familyTravel.recurrence.${r}`)}</Text>
              </Pressable>
            ))}
          </View>
        )}

        {type === 'trip' && (
          <>
            <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>{t('familyTravel.returnDateLabel')}</Text>
            <Pressable onPress={() => setShowReturnDatePicker(true)} style={[styles.input, { borderColor: colors.border, backgroundColor: colors.inputBg, justifyContent: 'center' }]}>
              <Text style={{ color: returnDate ? colors.text : colors.textTertiary }}>
                {returnDate ? returnDate.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : t('familyTravel.notSet')}
              </Text>
            </Pressable>
          </>
        )}

        {familyMembers.length > 0 && (
          <>
            <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>{t('familyTravel.companionLabel')}</Text>
            <View style={styles.chipRow}>
              {familyMembers.map((m) => (
                <Pressable
                  key={m.id}
                  onPress={() => toggleCompanion(m.id)}
                  style={[styles.smallChip, { backgroundColor: colors.inputBg, borderColor: colors.border }, companionMemberIds.includes(m.id) && { backgroundColor: colors.accent, borderColor: colors.accent }]}
                >
                  <Text style={[styles.smallChipText, { color: companionMemberIds.includes(m.id) ? '#FFF' : colors.textSecondary }]}>{m.name}</Text>
                </Pressable>
              ))}
            </View>
          </>
        )}

        <Pressable onPress={handleSave} disabled={saving} style={[styles.primaryBtn, { backgroundColor: colors.accent, opacity: saving ? 0.6 : 1 }]}>
          <Text style={styles.primaryBtnLabel}>{isEditing ? t('familyTravel.saveChanges') : t('common.save')}</Text>
        </Pressable>
      </ScrollView>

      {showDatePicker && (
        <DateTimePicker
          value={date}
          mode="date"
          display={Platform.OS === 'ios' ? 'spinner' : 'default'}
          themeVariant={isDark ? 'dark' : 'light'}
          onChange={(event, d) => { setShowDatePicker(false); if (d) setDate(d); }}
        />
      )}
      {showTimePicker && (
        <DateTimePicker
          value={date}
          mode="time"
          display={Platform.OS === 'ios' ? 'spinner' : 'default'}
          themeVariant={isDark ? 'dark' : 'light'}
          onChange={(event, d) => { setShowTimePicker(false); if (d) setDate(d); }}
        />
      )}
      {showReturnDatePicker && (
        <DateTimePicker
          value={returnDate ?? new Date()}
          mode="date"
          display={Platform.OS === 'ios' ? 'spinner' : 'default'}
          themeVariant={isDark ? 'dark' : 'light'}
          onChange={(event, d) => { setShowReturnDatePicker(false); if (d) setReturnDate(d); }}
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
  // Horizontal rail; negative margin cancels the form's 20px padding so it
  // runs edge to edge, with matching content padding on the inside.
  typeScroll: { marginHorizontal: -20, marginBottom: 6 },
  typeRow: { flexDirection: 'row', gap: 8, paddingHorizontal: 20 },
  typeChip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 8, paddingHorizontal: 12, borderRadius: 10, borderWidth: 1 },
  typeChipText: { fontFamily: 'Inter_600SemiBold', fontSize: 11 },
  fieldLabel: { fontFamily: 'Inter_600SemiBold', fontSize: 12, marginBottom: 6, marginTop: 10 },
  input: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontFamily: 'Inter_500Medium', fontSize: 14 },
  textArea: { minHeight: 70, textAlignVertical: 'top' },
  formRow: { flexDirection: 'row', gap: 12 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  smallChip: { paddingVertical: 8, paddingHorizontal: 12, borderRadius: 10, borderWidth: 1 },
  smallChipText: { fontFamily: 'Inter_600SemiBold', fontSize: 12 },
  toggleRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 16, marginBottom: 8 },
  toggleLabel: { fontFamily: 'Inter_500Medium', fontSize: 14 },
});
