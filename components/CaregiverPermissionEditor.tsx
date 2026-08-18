import React from 'react';
import { StyleSheet, Text, View, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { useTheme } from '@/lib/theme-context';
import {
  CaregiverAccessLevel,
  CaregiverPermissions,
} from '@/lib/family-caregivers';
import { FAMILY_FEATURE_MAP, FamilyFeatureKey } from '@/lib/family-features';

/**
 * Editor for the two independent caregiver permission dimensions (PRD 5.5,
 * client item 11):
 *
 *  1. WHICH modules the caregiver can see  -> `allowedModules`
 *  2. WHAT they may do inside them         -> `accessLevel`
 *
 * Used both when inviting (initial permissions) and when editing an existing
 * caregiver, so the two flows cannot drift apart.
 */

const ACCESS_LEVELS: CaregiverAccessLevel[] = ['view', 'mark_done', 'full'];

const LEVEL_ICON: Record<CaregiverAccessLevel, string> = {
  view: 'eye-outline',
  mark_done: 'checkmark-circle-outline',
  full: 'create-outline',
};

export default function CaregiverPermissionEditor({
  availableModules,
  value,
  onChange,
}: {
  /**
   * Modules the MEMBER has enabled. Only these can be granted — you cannot
   * share a module the member does not use.
   */
  availableModules: FamilyFeatureKey[];
  value: CaregiverPermissions;
  onChange: (next: CaregiverPermissions) => void;
}) {
  const { colors } = useTheme();
  const { t } = useTranslation();

  // `null` means "everything" — surfaced as an explicit All toggle rather than
  // leaving the user to tick every box, which is both tedious and drifts as the
  // member enables new modules later.
  const allSelected = value.allowedModules === null;

  const toggleAll = () => {
    onChange({ ...value, allowedModules: allSelected ? [] : null });
  };

  const toggleModule = (key: FamilyFeatureKey) => {
    const current = value.allowedModules ?? availableModules;
    const next = current.includes(key)
      ? current.filter((k) => k !== key)
      : [...current, key];
    // Ticking every box collapses back to `null` so the caregiver keeps access
    // to modules the member adds in future, matching what "All" visibly implies.
    onChange({
      ...value,
      allowedModules: next.length === availableModules.length ? null : next,
    });
  };

  const isModuleOn = (key: FamilyFeatureKey) =>
    allSelected || (value.allowedModules ?? []).includes(key);

  return (
    <View>
      <Text style={[styles.sectionLabel, { color: colors.text }]}>
        {t('caregiverPermissions.accessLevelLabel')}
      </Text>
      <Text style={[styles.sectionHint, { color: colors.textTertiary }]}>
        {t('caregiverPermissions.accessLevelHint')}
      </Text>

      {ACCESS_LEVELS.map((level) => {
        const selected = value.accessLevel === level;
        return (
          <Pressable
            key={level}
            onPress={() => onChange({ ...value, accessLevel: level })}
            style={[
              styles.levelRow,
              { backgroundColor: colors.card, borderColor: colors.border },
              selected && { borderColor: colors.accent, backgroundColor: colors.accentDim },
            ]}
          >
            <View style={[styles.levelIcon, { backgroundColor: selected ? colors.accent : colors.inputBg }]}>
              <Ionicons
                name={LEVEL_ICON[level] as any}
                size={16}
                color={selected ? '#FFF' : colors.textSecondary}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.levelTitle, { color: colors.text }]}>
                {t(`caregiverPermissions.level.${level}.title`)}
              </Text>
              <Text style={[styles.levelDesc, { color: colors.textTertiary }]}>
                {t(`caregiverPermissions.level.${level}.desc`)}
              </Text>
            </View>
            <Ionicons
              name={selected ? 'radio-button-on' : 'radio-button-off'}
              size={20}
              color={selected ? colors.accent : colors.textTertiary}
            />
          </Pressable>
        );
      })}

      <Text style={[styles.sectionLabel, { color: colors.text, marginTop: 22 }]}>
        {t('caregiverPermissions.modulesLabel')}
      </Text>
      <Text style={[styles.sectionHint, { color: colors.textTertiary }]}>
        {t('caregiverPermissions.modulesHint')}
      </Text>

      <Pressable
        onPress={toggleAll}
        style={[
          styles.allRow,
          { backgroundColor: colors.card, borderColor: allSelected ? colors.accent : colors.border },
        ]}
      >
        <Ionicons
          name={allSelected ? 'checkbox' : 'square-outline'}
          size={22}
          color={allSelected ? colors.accent : colors.textTertiary}
        />
        <Text style={[styles.allLabel, { color: colors.text }]}>
          {t('caregiverPermissions.allModules')}
        </Text>
      </Pressable>

      {availableModules.length === 0 ? (
        <Text style={[styles.emptyHint, { color: colors.textTertiary }]}>
          {t('caregiverPermissions.noModules')}
        </Text>
      ) : (
        <View style={styles.moduleGrid}>
          {availableModules.map((key) => {
            const def = FAMILY_FEATURE_MAP[key];
            if (!def) return null;
            const on = isModuleOn(key);
            return (
              <Pressable
                key={key}
                onPress={() => toggleModule(key)}
                style={[
                  styles.moduleChip,
                  { backgroundColor: colors.inputBg, borderColor: colors.border },
                  on && { backgroundColor: colors.accentDim, borderColor: colors.accent },
                ]}
              >
                <Ionicons
                  name={def.icon as any}
                  size={14}
                  color={on ? colors.accent : colors.textTertiary}
                />
                <Text
                  style={[styles.moduleChipText, { color: on ? colors.accent : colors.textSecondary }]}
                  numberOfLines={1}
                >
                  {t(`familyFeatures.${key}.label`)}
                </Text>
                {on && <Ionicons name="checkmark" size={12} color={colors.accent} />}
              </Pressable>
            );
          })}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  sectionLabel: { fontFamily: 'Inter_700Bold', fontSize: 13, letterSpacing: 0.5, marginBottom: 4 },
  sectionHint: { fontFamily: 'Inter_400Regular', fontSize: 12, lineHeight: 17, marginBottom: 12 },
  levelRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    borderRadius: 14, borderWidth: 1.5, padding: 12, marginBottom: 8,
  },
  levelIcon: { width: 32, height: 32, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  levelTitle: { fontFamily: 'Inter_600SemiBold', fontSize: 14 },
  levelDesc: { fontFamily: 'Inter_400Regular', fontSize: 11, marginTop: 2, lineHeight: 15 },
  allRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    borderRadius: 12, borderWidth: 1.5, padding: 12, marginBottom: 10,
  },
  allLabel: { fontFamily: 'Inter_600SemiBold', fontSize: 14 },
  moduleGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  moduleChip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingVertical: 9, paddingHorizontal: 12, borderRadius: 10, borderWidth: 1.5,
    maxWidth: '48%',
  },
  moduleChipText: { fontFamily: 'Inter_600SemiBold', fontSize: 12, flexShrink: 1 },
  emptyHint: { fontFamily: 'Inter_400Regular', fontSize: 12, fontStyle: 'italic', paddingVertical: 8 },
});
