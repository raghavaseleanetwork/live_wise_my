import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View, ScrollView, Pressable, TextInput, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import DateTimePicker from '@react-native-community/datetimepicker';
import { useTranslation } from 'react-i18next';

import { useTheme } from '@/lib/theme-context';
import { FamilyDocument, FamilyDocumentType, DocumentExpiryReminderLead, DOCUMENT_TYPE_LABELS, addFamilyDocument, loadFamilyDocuments, updateFamilyDocument } from '@/lib/family-records';

/** Example title per document type, so the hint matches the selected chip. */
const TYPE_PLACEHOLDER_KEYS: Record<FamilyDocumentType, string> = {
  aadhaar: 'familyDocuments.placeholder.aadhaar',
  pan: 'familyDocuments.placeholder.pan',
  passport: 'familyDocuments.placeholder.passport',
  driving_license: 'familyDocuments.placeholder.driving_license',
  birth_certificate: 'familyDocuments.placeholder.birth_certificate',
  marriage_certificate: 'familyDocuments.placeholder.marriage_certificate',
  property: 'familyDocuments.placeholder.property',
  vehicle_rc: 'familyDocuments.placeholder.vehicle_rc',
  insurance: 'familyDocuments.placeholder.insurance',
  medical: 'familyDocuments.placeholder.medical',
  other: 'familyDocuments.placeholder.other',
};

const EXPIRY_REMINDER_LEADS: DocumentExpiryReminderLead[] = ['6_months', '3_months', '1_month'];

export default function AddFamilyDocumentScreen() {
  const router = useRouter();
  const { memberId, memberName, editId } = useLocalSearchParams<{ memberId: string; memberName?: string; editId?: string }>();
  const insets = useSafeAreaInsets();
  const { colors, isDark } = useTheme();
  const { t } = useTranslation();

  const documentTypeLabel = (type: FamilyDocumentType) => t(`familyDocuments.type.${type}`);

  const [showIssueDatePicker, setShowIssueDatePicker] = useState(false);
  const [showExpiryDatePicker, setShowExpiryDatePicker] = useState(false);
  const [title, setTitle] = useState('');
  // Nothing preselected on a new document; editing seeds it from the record.
  const [type, setType] = useState<FamilyDocumentType | null>(null);
  const [documentNumber, setDocumentNumber] = useState('');
  const [issueDate, setIssueDate] = useState<Date | null>(null);
  const [hasExpiry, setHasExpiry] = useState(false);
  const [expiryDate, setExpiryDate] = useState(new Date());
  const [expiryReminderLead, setExpiryReminderLead] = useState<DocumentExpiryReminderLead>('1_month');
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
      setDocumentNumber(found.documentNumber ?? '');
      setIssueDate(found.issueDate ? new Date(found.issueDate) : null);
      setHasExpiry(!!found.expiryDate);
      if (found.expiryDate) setExpiryDate(new Date(found.expiryDate));
      setExpiryReminderLead(found.expiryReminderLead ?? '1_month');
      setNotes(found.notes ?? '');
    })();
    return () => { cancelled = true; };
  }, [editId, memberId]);

  const handleSave = async () => {
    if (!type) {
      setError(t('familyDocuments.errorSelectType'));
      return;
    }
    if (!title.trim()) {
      setError(t('familyDocuments.errorEnterTitle'));
      return;
    }
    if (!memberId || saving) return;
    setSaving(true);
    const data = {
      title: title.trim(),
      type,
      documentNumber: documentNumber.trim(),
      issueDate: issueDate ? issueDate.toISOString() : null,
      expiryDate: hasExpiry ? expiryDate.toISOString() : null,
      expiryReminderLead: hasExpiry ? expiryReminderLead : undefined,
      // Kept in sync with expiryDate for older screens/back-compat readers.
      reminderDate: hasExpiry ? expiryDate.toISOString() : null,
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
          <Text style={[styles.headerTitle, { color: colors.text }]}>{isEditing ? t('familyDocuments.editHeaderTitle') : t('familyDocuments.newHeaderTitle')}</Text>
          <View style={styles.backBtn} />
        </View>
        {memberName ? <Text style={[styles.headerSubtitle, { color: colors.textSecondary }]}>{t('familyDocuments.forMember', { name: memberName })}</Text> : null}
      </LinearGradient>

      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: insets.bottom + 40 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        {!!error && <Text style={[styles.errorText, { color: colors.danger }]}>{error}</Text>}

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.typeScroll}
          contentContainerStyle={styles.typeGrid}
        >
          {(Object.keys(DOCUMENT_TYPE_LABELS) as FamilyDocumentType[]).map((docType) => (
            <Pressable
              key={docType}
              onPress={() => setType(docType)}
              style={[styles.typeChip, { backgroundColor: colors.inputBg, borderColor: colors.border }, type === docType && { backgroundColor: colors.accent, borderColor: colors.accent }]}
            >
              <Ionicons name={DOCUMENT_TYPE_LABELS[docType].icon as any} size={14} color={type === docType ? '#FFF' : colors.textSecondary} />
              <Text style={[styles.typeChipText, { color: type === docType ? '#FFF' : colors.textSecondary }]}>{documentTypeLabel(docType)}</Text>
            </Pressable>
          ))}
        </ScrollView>

        <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>{t('familyDocuments.titleLabel')}</Text>
        <TextInput
          style={[styles.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.inputBg }]}
          value={title}
          onChangeText={setTitle}
          placeholder={type ? t(TYPE_PLACEHOLDER_KEYS[type]) : t('familyDocuments.placeholder.other')}
          placeholderTextColor={colors.textTertiary}
          autoFocus
        />

        <View style={styles.formRow}>
          <View style={{ flex: 1 }}>
            <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>{t('familyDocuments.documentNumberLabel')}</Text>
            <TextInput
              style={[styles.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.inputBg }]}
              value={documentNumber}
              onChangeText={setDocumentNumber}
              placeholder={t('familyDocuments.documentNumberPlaceholder')}
              placeholderTextColor={colors.textTertiary}
            />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>{t('familyDocuments.issueDateLabel')}</Text>
            <Pressable onPress={() => setShowIssueDatePicker(true)} style={[styles.input, { borderColor: colors.border, backgroundColor: colors.inputBg, justifyContent: 'center' }]}>
              <Text style={{ color: issueDate ? colors.text : colors.textTertiary }}>
                {issueDate ? issueDate.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : t('familyDocuments.notSet')}
              </Text>
            </Pressable>
          </View>
        </View>

        <Pressable onPress={() => setHasExpiry(!hasExpiry)} style={styles.reminderRow}>
          <Ionicons name={hasExpiry ? 'checkbox' : 'square-outline'} size={22} color={hasExpiry ? colors.accent : colors.textTertiary} />
          <Text style={[styles.reminderText, { color: colors.text }]}>{t('familyDocuments.setExpiryCheckbox')}</Text>
        </Pressable>

        {hasExpiry && (
          <>
            <Pressable onPress={() => setShowExpiryDatePicker(true)} style={[styles.input, { borderColor: colors.border, backgroundColor: colors.inputBg, justifyContent: 'center', marginTop: 10 }]}>
              <Text style={{ color: colors.text }}>{expiryDate.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</Text>
            </Pressable>

            <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>{t('familyDocuments.expiryReminderLabel')}</Text>
            <View style={styles.typeGridWrap}>
              {EXPIRY_REMINDER_LEADS.map((lead) => (
                <Pressable
                  key={lead}
                  onPress={() => setExpiryReminderLead(lead)}
                  style={[styles.smallChip, { backgroundColor: colors.inputBg, borderColor: colors.border }, expiryReminderLead === lead && { backgroundColor: colors.accent, borderColor: colors.accent }]}
                >
                  <Text style={[styles.smallChipText, { color: expiryReminderLead === lead ? '#FFF' : colors.textSecondary }]}>{t(`familyDocuments.expiryReminderLead.${lead}`)}</Text>
                </Pressable>
              ))}
            </View>
          </>
        )}

        <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>{t('familyDocuments.notesLabel')}</Text>
        <TextInput
          style={[styles.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.inputBg }]}
          value={notes}
          onChangeText={setNotes}
          placeholder={t('familyDocuments.notesPlaceholder')}
          placeholderTextColor={colors.textTertiary}
        />

        <Pressable onPress={handleSave} disabled={saving} style={[styles.primaryBtn, { backgroundColor: colors.accent, opacity: saving ? 0.6 : 1 }]}>
          <Text style={styles.primaryBtnLabel}>{isEditing ? t('familyDocuments.saveChanges') : t('common.save')}</Text>
        </Pressable>
      </ScrollView>

      {showIssueDatePicker && (
        <DateTimePicker
          value={issueDate ?? new Date()}
          mode="date"
          display={Platform.OS === 'ios' ? 'spinner' : 'default'}
          themeVariant={isDark ? 'dark' : 'light'}
          onChange={(event, date) => { setShowIssueDatePicker(false); if (date) setIssueDate(date); }}
        />
      )}
      {showExpiryDatePicker && (
        <DateTimePicker
          value={expiryDate}
          mode="date"
          display={Platform.OS === 'ios' ? 'spinner' : 'default'}
          themeVariant={isDark ? 'dark' : 'light'}
          onChange={(event, date) => { setShowExpiryDatePicker(false); if (date) setExpiryDate(date); }}
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
  formRow: { flexDirection: 'row', gap: 12 },
  typeGridWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  smallChip: { paddingVertical: 8, paddingHorizontal: 12, borderRadius: 10, borderWidth: 1 },
  smallChipText: { fontFamily: 'Inter_600SemiBold', fontSize: 12 },
});
