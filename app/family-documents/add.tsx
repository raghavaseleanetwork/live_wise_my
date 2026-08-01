import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View, ScrollView, Pressable, TextInput, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import DateTimePicker from '@react-native-community/datetimepicker';

import { useTheme } from '@/lib/theme-context';
import { FamilyDocument, DOCUMENT_TYPE_LABELS, addFamilyDocument, loadFamilyDocuments, updateFamilyDocument } from '@/lib/family-records';

/** Example title per document type, so the hint matches the selected chip. */
const TYPE_PLACEHOLDERS: Record<FamilyDocument['type'], string> = {
  insurance: 'e.g. Health Insurance Policy',
  id: 'e.g. Aadhaar Card',
  medical: 'e.g. Blood Test Report',
  other: 'e.g. Document title',
};

export default function AddFamilyDocumentScreen() {
  const router = useRouter();
  const { memberId, memberName, editId } = useLocalSearchParams<{ memberId: string; memberName?: string; editId?: string }>();
  const insets = useSafeAreaInsets();
  const { colors, isDark } = useTheme();

  const [showDatePicker, setShowDatePicker] = useState(false);
  const [title, setTitle] = useState('');
  // Nothing preselected on a new document; editing seeds it from the record.
  const [type, setType] = useState<FamilyDocument['type'] | null>(null);
  const [hasReminder, setHasReminder] = useState(false);
  const [reminderDate, setReminderDate] = useState(new Date());
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const isEditing = !!editId;

  // Seed the form from the record being edited.
  useEffect(() => {
    if (!editId || !memberId) return;
    let cancelled = false;
    (async () => {
      const items = await loadFamilyDocuments(String(memberId));
      const found = items.find((x) => x.id === String(editId));
      if (!found || cancelled) return;
      setTitle(found.title);
      setType(found.type);
      setHasReminder(!!found.reminderDate);
      if (found.reminderDate) setReminderDate(new Date(found.reminderDate));
      setNotes(found.notes ?? '');
    })();
    return () => { cancelled = true; };
  }, [editId, memberId]);

  const handleSave = async () => {
    if (!type) {
      setError('Please select a document type');
      return;
    }
    if (!title.trim()) {
      setError('Please enter a document title');
      return;
    }
    if (!memberId || saving) return;
    setSaving(true);
    const data = {
      title: title.trim(),
      type,
      reminderDate: hasReminder ? reminderDate.toISOString() : null,
      notes: notes.trim(),
    };
    if (isEditing) {
      await updateFamilyDocument(String(memberId), String(editId), data);
    } else {
      await addFamilyDocument(String(memberId), data);
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
          <Text style={[styles.headerTitle, { color: colors.text }]}>{isEditing ? 'Edit Document' : 'New Document'}</Text>
          <View style={styles.backBtn} />
        </View>
        {memberName ? <Text style={[styles.headerSubtitle, { color: colors.textSecondary }]}>For {memberName}</Text> : null}
      </LinearGradient>

      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: insets.bottom + 40 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        {!!error && <Text style={[styles.errorText, { color: colors.danger }]}>{error}</Text>}

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.typeScroll}
          contentContainerStyle={styles.typeGrid}
        >
          {(Object.keys(DOCUMENT_TYPE_LABELS) as FamilyDocument['type'][]).map((t) => (
            <Pressable
              key={t}
              onPress={() => setType(t)}
              style={[styles.typeChip, { backgroundColor: colors.inputBg, borderColor: colors.border }, type === t && { backgroundColor: colors.accent, borderColor: colors.accent }]}
            >
              <Ionicons name={DOCUMENT_TYPE_LABELS[t].icon as any} size={14} color={type === t ? '#FFF' : colors.textSecondary} />
              <Text style={[styles.typeChipText, { color: type === t ? '#FFF' : colors.textSecondary }]}>{DOCUMENT_TYPE_LABELS[t].label}</Text>
            </Pressable>
          ))}
        </ScrollView>

        <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>Title</Text>
        <TextInput
          style={[styles.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.inputBg }]}
          value={title}
          onChangeText={setTitle}
          placeholder={type ? TYPE_PLACEHOLDERS[type] : 'e.g. Document title'}
          placeholderTextColor={colors.textTertiary}
          autoFocus
        />

        <Pressable onPress={() => setHasReminder(!hasReminder)} style={styles.reminderRow}>
          <Ionicons name={hasReminder ? 'checkbox' : 'square-outline'} size={22} color={hasReminder ? colors.accent : colors.textTertiary} />
          <Text style={[styles.reminderText, { color: colors.text }]}>Set a renewal reminder</Text>
        </Pressable>

        {hasReminder && (
          <Pressable onPress={() => setShowDatePicker(true)} style={[styles.input, { borderColor: colors.border, backgroundColor: colors.inputBg, justifyContent: 'center', marginTop: 10 }]}>
            <Text style={{ color: colors.text }}>{reminderDate.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</Text>
          </Pressable>
        )}

        <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>Notes (optional)</Text>
        <TextInput
          style={[styles.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.inputBg }]}
          value={notes}
          onChangeText={setNotes}
          placeholder="e.g. Policy number, provider"
          placeholderTextColor={colors.textTertiary}
        />

        <Pressable onPress={handleSave} disabled={saving} style={[styles.primaryBtn, { backgroundColor: colors.accent, opacity: saving ? 0.6 : 1 }]}>
          <Text style={styles.primaryBtnLabel}>{isEditing ? 'Save Changes' : 'Save'}</Text>
        </Pressable>
      </ScrollView>

      {showDatePicker && (
        <DateTimePicker
          value={reminderDate}
          mode="date"
          display={Platform.OS === 'ios' ? 'spinner' : 'default'}
          themeVariant={isDark ? 'dark' : 'light'}
          onChange={(event, date) => { setShowDatePicker(false); if (date) setReminderDate(date); }}
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
  typeGrid: { flexDirection: 'row', gap: 8, paddingHorizontal: 20 },
  typeChip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 8, paddingHorizontal: 12, borderRadius: 10, borderWidth: 1 },
  typeChipText: { fontFamily: 'Inter_600SemiBold', fontSize: 11 },
  fieldLabel: { fontFamily: 'Inter_600SemiBold', fontSize: 12, marginBottom: 6, marginTop: 10 },
  input: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontFamily: 'Inter_500Medium', fontSize: 14 },
  reminderRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 16 },
  reminderText: { fontFamily: 'Inter_500Medium', fontSize: 14 },
});
