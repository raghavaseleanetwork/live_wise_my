import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View, ScrollView, Pressable, TextInput } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { useTheme } from '@/lib/theme-context';
import { CustomFeatureConfig, CustomFieldDef, CustomFieldType, loadCustomConfig, saveCustomConfig } from '@/lib/family-records';

const ICON_OPTIONS = ['star', 'fitness', 'book', 'musical-notes', 'brush', 'football', 'game-controller', 'leaf'];
const FIELD_TYPES: CustomFieldType[] = ['text', 'date', 'time', 'number'];
const FREQUENCIES: NonNullable<CustomFeatureConfig['frequency']>[] = ['daily', 'weekly', 'monthly', 'custom'];

function genId(): string {
  return Date.now().toString() + Math.random().toString(36).slice(2, 9);
}

export default function CustomTrackerSetupScreen() {
  const router = useRouter();
  const { memberId, memberName, currentName, currentIcon } = useLocalSearchParams<{
    memberId: string;
    memberName?: string;
    currentName?: string;
    currentIcon?: string;
  }>();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const { t } = useTranslation();

  const [trackerName, setTrackerName] = useState(currentName ? String(currentName) : '');
  const [trackerIcon, setTrackerIcon] = useState(currentIcon ? String(currentIcon) : 'star');
  const [customFields, setCustomFields] = useState<CustomFieldDef[]>([]);
  const [newFieldLabel, setNewFieldLabel] = useState('');
  const [newFieldType, setNewFieldType] = useState<CustomFieldType>('text');
  const [reminderEnabled, setReminderEnabled] = useState(false);
  const [frequency, setFrequency] = useState<NonNullable<CustomFeatureConfig['frequency']>>('daily');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!memberId) return;
    (async () => {
      const existing = await loadCustomConfig(String(memberId));
      if (existing?.customFields) setCustomFields(existing.customFields);
      if (existing?.reminderEnabled != null) setReminderEnabled(existing.reminderEnabled);
      if (existing?.frequency) setFrequency(existing.frequency);
    })();
  }, [memberId]);

  const addCustomField = () => {
    if (!newFieldLabel.trim()) return;
    setCustomFields((prev) => [...prev, { id: genId(), label: newFieldLabel.trim(), type: newFieldType }]);
    setNewFieldLabel('');
  };

  const removeCustomField = (id: string) => setCustomFields((prev) => prev.filter((f) => f.id !== id));

  const handleSave = async () => {
    if (!trackerName.trim()) {
      setError(t('familyCustom.errorNameTracker'));
      return;
    }
    if (!memberId || saving) return;
    setSaving(true);
    const newConfig: CustomFeatureConfig = {
      name: trackerName.trim(),
      icon: trackerIcon,
      customFields,
      reminderEnabled,
      frequency,
    };
    await saveCustomConfig(String(memberId), newConfig);
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
          <Text style={[styles.headerTitle, { color: colors.text }]}>{t('familyCustom.setupTitle')}</Text>
          <View style={styles.backBtn} />
        </View>
        {memberName ? <Text style={[styles.headerSubtitle, { color: colors.textSecondary }]}>{t('familyCustom.forMember', { name: memberName })}</Text> : null}
      </LinearGradient>

      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: insets.bottom + 40 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        <Text style={[styles.sectionHint, { color: colors.textTertiary }]}>
          {t('familyCustom.setupHint')}
        </Text>
        {!!error && <Text style={[styles.errorText, { color: colors.danger }]}>{error}</Text>}

        <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>{t('familyCustom.trackerNameLabel')}</Text>
        <TextInput
          style={[styles.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.inputBg }]}
          value={trackerName}
          onChangeText={setTrackerName}
          placeholder={t('familyCustom.trackerNamePlaceholder')}
          placeholderTextColor={colors.textTertiary}
          autoFocus
        />

        <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>{t('familyCustom.iconLabel')}</Text>
        <View style={styles.iconGrid}>
          {ICON_OPTIONS.map((icon) => (
            <Pressable
              key={icon}
              onPress={() => setTrackerIcon(icon)}
              style={[styles.iconOption, { backgroundColor: colors.inputBg, borderColor: colors.border }, trackerIcon === icon && { backgroundColor: colors.accentDim, borderColor: colors.accent }]}
            >
              <Ionicons name={icon as any} size={22} color={trackerIcon === icon ? colors.accent : colors.textTertiary} />
            </Pressable>
          ))}
        </View>

        <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>{t('familyCustom.customFieldsLabel')}</Text>
        {customFields.map((f) => (
          <View key={f.id} style={[styles.fieldRow, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.fieldRowText, { color: colors.text }]}>{f.label} · {t(`familyCustom.fieldType.${f.type}`)}</Text>
            <Pressable onPress={() => removeCustomField(f.id)} hitSlop={10}>
              <Ionicons name="trash-outline" size={16} color={colors.textTertiary} />
            </Pressable>
          </View>
        ))}
        <View style={styles.addFieldRow}>
          <TextInput
            style={[styles.input, { flex: 1, color: colors.text, borderColor: colors.border, backgroundColor: colors.inputBg }]}
            value={newFieldLabel}
            onChangeText={setNewFieldLabel}
            placeholder={t('familyCustom.fieldLabelPlaceholder')}
            placeholderTextColor={colors.textTertiary}
          />
          <Pressable onPress={addCustomField} style={[styles.addFieldBtn, { backgroundColor: colors.accent }]}>
            <Ionicons name="add" size={20} color="#FFF" />
          </Pressable>
        </View>
        <View style={styles.typeRow}>
          {FIELD_TYPES.map((ft) => (
            <Pressable
              key={ft}
              onPress={() => setNewFieldType(ft)}
              style={[styles.smallChip, { backgroundColor: colors.inputBg, borderColor: colors.border }, newFieldType === ft && { backgroundColor: colors.accent, borderColor: colors.accent }]}
            >
              <Text style={[styles.smallChipText, { color: newFieldType === ft ? '#FFF' : colors.textSecondary }]}>{t(`familyCustom.fieldType.${ft}`)}</Text>
            </Pressable>
          ))}
        </View>

        <Pressable onPress={() => setReminderEnabled(!reminderEnabled)} style={styles.toggleRow}>
          <Ionicons name={reminderEnabled ? 'checkbox' : 'square-outline'} size={22} color={reminderEnabled ? colors.accent : colors.textTertiary} />
          <Text style={[styles.toggleLabel, { color: colors.text }]}>{t('familyCustom.reminderToggleLabel')}</Text>
        </Pressable>

        {reminderEnabled && (
          <>
            <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>{t('familyCustom.frequencyLabel')}</Text>
            <View style={styles.typeRow}>
              {FREQUENCIES.map((f) => (
                <Pressable
                  key={f}
                  onPress={() => setFrequency(f)}
                  style={[styles.smallChip, { backgroundColor: colors.inputBg, borderColor: colors.border }, frequency === f && { backgroundColor: colors.accent, borderColor: colors.accent }]}
                >
                  <Text style={[styles.smallChipText, { color: frequency === f ? '#FFF' : colors.textSecondary }]}>{t(`familyCustom.frequencyOption.${f}`)}</Text>
                </Pressable>
              ))}
            </View>
          </>
        )}

        <Pressable onPress={handleSave} disabled={saving} style={[styles.primaryBtn, { backgroundColor: colors.accent, opacity: saving ? 0.6 : 1 }]}>
          <Text style={styles.primaryBtnLabel}>{t('common.save')}</Text>
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
  headerTitle: { fontFamily: 'Inter_700Bold', fontSize: 17, flex: 1, textAlign: 'center' },
  headerSubtitle: { fontFamily: 'Inter_500Medium', fontSize: 13, marginTop: 4, textAlign: 'center' },
  sectionHint: { fontFamily: 'Inter_400Regular', fontSize: 13, lineHeight: 18, marginBottom: 6 },
  primaryBtn: { borderRadius: 14, paddingVertical: 15, alignItems: 'center', marginTop: 28 },
  primaryBtnLabel: { fontFamily: 'Inter_700Bold', fontSize: 15, color: '#FFF' },
  errorText: { fontFamily: 'Inter_500Medium', fontSize: 13, marginBottom: 10, textAlign: 'center' },
  fieldLabel: { fontFamily: 'Inter_600SemiBold', fontSize: 12, marginBottom: 6, marginTop: 10 },
  input: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontFamily: 'Inter_500Medium', fontSize: 14 },
  iconGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  iconOption: { width: 44, height: 44, borderRadius: 12, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  fieldRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderRadius: 12, borderWidth: 1, padding: 12, marginBottom: 8 },
  fieldRowText: { fontFamily: 'Inter_500Medium', fontSize: 13 },
  addFieldRow: { flexDirection: 'row', gap: 8, marginBottom: 8 },
  addFieldBtn: { width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  typeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  smallChip: { paddingVertical: 8, paddingHorizontal: 12, borderRadius: 10, borderWidth: 1 },
  smallChipText: { fontFamily: 'Inter_600SemiBold', fontSize: 12 },
  toggleRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 16, marginBottom: 8 },
  toggleLabel: { fontFamily: 'Inter_500Medium', fontSize: 14 },
});
