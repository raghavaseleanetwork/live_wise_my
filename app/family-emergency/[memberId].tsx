import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, View, ScrollView, Pressable, Switch, TextInput } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams, useFocusEffect } from 'expo-router';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { useTranslation } from 'react-i18next';

import { useTheme } from '@/lib/theme-context';
import { onCaregiverSync } from '@/lib/caregiver-sync';
import { useAuth } from '@/lib/auth-context';
import { apiRequest } from '@/lib/query-client';
import { scheduleLocalNotification } from '@/lib/notifications';
import {
  EmergencySettings,
  EmergencyLogEntry,
  EmergencyMedicalProfile,
  EmergencyContact,
  DEFAULT_EMERGENCY_SETTINGS,
  loadEmergencySettings,
  saveEmergencySettings,
  loadEmergencyLog,
  addEmergencyLogEntry,
  acknowledgeEmergencyLogEntry,
  findMissedMedicines,
  loadEmergencyMedicalProfile,
  saveEmergencyMedicalProfile,
} from '@/lib/family-records';
import { useCaregiverPermissions } from '@/lib/use-caregiver-permissions';

function genId(): string {
  return Date.now().toString() + Math.random().toString(36).slice(2, 9);
}

export default function FamilyEmergencyScreen() {
  const router = useRouter();
  const { memberId, memberName } = useLocalSearchParams<{ memberId: string; memberName?: string }>();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const { token } = useAuth();
  const { t } = useTranslation();

  // Scoped caregiver access (PRD 5.5). The owner is unrestricted; a
  // caregiver only gets the actions their access level allows.
  const { canMarkDone, canEdit } = useCaregiverPermissions(memberId ? String(memberId) : null);

  const [settings, setSettings] = useState<EmergencySettings>(DEFAULT_EMERGENCY_SETTINGS);
  const [log, setLog] = useState<EmergencyLogEntry[]>([]);
  const [isChecking, setIsChecking] = useState(false);
  const [profile, setProfile] = useState<EmergencyMedicalProfile>({ contacts: [] });
  const [contactName, setContactName] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [contactRelation, setContactRelation] = useState('');

  const load = useCallback(async () => {
    if (!memberId) return;
    const [s, l, p] = await Promise.all([loadEmergencySettings(String(memberId)), loadEmergencyLog(String(memberId)), loadEmergencyMedicalProfile(String(memberId))]);
    setSettings(s);
    setLog(l);
    setProfile(p);
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

  const persistProfile = async (next: EmergencyMedicalProfile) => {
    setProfile(next);
    if (memberId) await saveEmergencyMedicalProfile(String(memberId), next);
  };

  const addContact = () => {
    if (!contactName.trim() || !contactPhone.trim() || profile.contacts.length >= 5) return;
    const contact: EmergencyContact = { id: genId(), name: contactName.trim(), phone: contactPhone.trim(), relation: contactRelation.trim() };
    persistProfile({ ...profile, contacts: [...profile.contacts, contact] });
    setContactName('');
    setContactPhone('');
    setContactRelation('');
  };

  const removeContact = (id: string) => {
    persistProfile({ ...profile, contacts: profile.contacts.filter((c) => c.id !== id) });
  };

  const updateSetting = async <K extends keyof EmergencySettings>(key: K, value: EmergencySettings[K]) => {
    if (!memberId) return;
    const next = { ...settings, [key]: value };
    setSettings(next);
    await saveEmergencySettings(String(memberId), next);
  };

  const runCheckNow = async () => {
    if (!memberId || !token) return;
    setIsChecking(true);
    try {
      const res = await apiRequest('GET', '/api/family', undefined, token);
      const data = (await res.json()) as any[];
      const member = data.find((m) => String(m.id) === String(memberId));
      const medicines = Array.isArray(member?.medicines) ? member.medicines : [];

      let foundSomething = false;

      if (settings.missedMedicineAlertEnabled) {
        const missed = findMissedMedicines(medicines, settings.missedMedicineThresholdHours);
        if (missed.length > 0) {
          foundSomething = true;
          const message = t('familyEmergency.missedMedicineMessage', { medicines: missed.join(', '), count: missed.length, hours: settings.missedMedicineThresholdHours });
          await addEmergencyLogEntry(String(memberId), 'missed_medicine', message);
          await scheduleLocalNotification({
            title: t('familyEmergency.missedMedicineNotifTitle', { name: memberName || t('familyEmergency.familyMemberFallback') }),
            body: message,
            data: { type: 'family_emergency', memberId: String(memberId) },
            triggerAt: new Date(Date.now() + 1000),
          }).catch(() => {});
        }
      }

      await load();
      if (!foundSomething) {
        await addEmergencyLogEntry(String(memberId), 'missed_medicine', t('familyEmergency.checkCompleteNothing'));
        const refreshed = await loadEmergencyLog(String(memberId));
        setLog(refreshed);
      }
    } finally {
      setIsChecking(false);
    }
  };

  const unacknowledged = useMemo(() => log.filter((e) => !e.acknowledged), [log]);
  const headerHeight = 110 + insets.top;

  return (
    <View style={[styles.container, { backgroundColor: colors.bg }]}>
      <LinearGradient colors={colors.heroGradient as any} style={[styles.header, { height: headerHeight, paddingTop: insets.top }]}>
        <View style={styles.headerTop}>
          <Pressable onPress={() => router.back()} style={styles.backBtn} hitSlop={12}>
            <Ionicons name="chevron-back" size={24} color={colors.text} />
          </Pressable>
          <Text style={[styles.headerTitle, { color: colors.text }]}>{t('familyEmergency.headerTitle')}</Text>
          <View style={{ width: 40 }} />
        </View>
        {memberName ? <Text style={[styles.headerSubtitle, { color: colors.textSecondary }]}>{t('familyEmergency.forMember', { name: memberName })}</Text> : null}
      </LinearGradient>

      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: insets.bottom + 40 }} showsVerticalScrollIndicator={false}>
        <View style={[styles.infoBanner, { backgroundColor: colors.accentDim, borderColor: colors.accent + '30' }]}>
          <Ionicons name="information-circle" size={18} color={colors.accent} />
          <Text style={[styles.infoText, { color: colors.text }]}>
            {t('familyEmergency.infoBannerPrefix')}<Text style={{ fontFamily: 'Inter_700Bold' }}>{t('familyEmergency.thisDevice')}</Text>{t('familyEmergency.infoBannerSuffix')}
          </Text>
        </View>

        <Text style={[styles.sectionLabel, { color: colors.textSecondary }]}>{t('familyEmergency.contactsSection')}</Text>
        {profile.contacts.map((c) => (
          <View key={c.id} style={[styles.contactCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={[styles.contactIconWrap, { backgroundColor: colors.accentDim }]}>
              <Ionicons name="person" size={16} color={colors.accent} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.contactName, { color: colors.text }]}>{c.name}{c.relation ? ` · ${c.relation}` : ''}</Text>
              <Text style={[styles.contactPhone, { color: colors.textTertiary }]}>{c.phone}</Text>
            </View>
            {canEdit && (<Pressable onPress={() => removeContact(c.id)} hitSlop={10}>
              <Ionicons name="trash-outline" size={18} color={colors.textTertiary} />
            </Pressable>)}
          </View>
        ))}
        {profile.contacts.length < 5 && (
          <View style={[styles.addContactCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <TextInput
              style={[styles.smallInput, { color: colors.text, borderColor: colors.border, backgroundColor: colors.inputBg }]}
              value={contactName}
              onChangeText={setContactName}
              placeholder={t('familyEmergency.contactNamePlaceholder')}
              placeholderTextColor={colors.textTertiary}
            />
            <View style={styles.formRow}>
              <TextInput
                style={[styles.smallInput, { flex: 1, color: colors.text, borderColor: colors.border, backgroundColor: colors.inputBg }]}
                value={contactPhone}
                onChangeText={setContactPhone}
                placeholder={t('familyEmergency.contactPhonePlaceholder')}
                placeholderTextColor={colors.textTertiary}
                keyboardType="phone-pad"
              />
              <TextInput
                style={[styles.smallInput, { flex: 1, color: colors.text, borderColor: colors.border, backgroundColor: colors.inputBg }]}
                value={contactRelation}
                onChangeText={setContactRelation}
                placeholder={t('familyEmergency.contactRelationPlaceholder')}
                placeholderTextColor={colors.textTertiary}
              />
            </View>
            <Pressable onPress={addContact} style={[styles.addContactBtn, { backgroundColor: colors.accent }]}>
              <Ionicons name="add" size={16} color="#FFF" />
              <Text style={styles.addContactBtnText}>{t('familyEmergency.addContact')}</Text>
            </Pressable>
          </View>
        )}

        <Text style={[styles.sectionLabel, { color: colors.textSecondary, marginTop: 20 }]}>{t('familyEmergency.medicalInfoSection')}</Text>
        <View style={[styles.settingsCard, { backgroundColor: colors.card, borderColor: colors.border, padding: 14, gap: 10 }]}>
          <View>
            <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>{t('familyEmergency.knownAllergiesLabel')}</Text>
            <TextInput
              style={[styles.smallInput, styles.textArea, { color: colors.text, borderColor: colors.border, backgroundColor: colors.inputBg }]}
              value={profile.knownAllergies ?? ''}
              onChangeText={(v) => setProfile({ ...profile, knownAllergies: v })}
              onEndEditing={() => persistProfile(profile)}
              placeholder={t('familyEmergency.knownAllergiesPlaceholder')}
              placeholderTextColor={colors.textTertiary}
              multiline
            />
          </View>
          <View>
            <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>{t('familyEmergency.medicalConditionsLabel')}</Text>
            <TextInput
              style={[styles.smallInput, styles.textArea, { color: colors.text, borderColor: colors.border, backgroundColor: colors.inputBg }]}
              value={profile.existingMedicalConditions ?? ''}
              onChangeText={(v) => setProfile({ ...profile, existingMedicalConditions: v })}
              onEndEditing={() => persistProfile(profile)}
              placeholder={t('familyEmergency.medicalConditionsPlaceholder')}
              placeholderTextColor={colors.textTertiary}
              multiline
            />
          </View>
          <View>
            <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>{t('familyEmergency.currentMedicationsLabel')}</Text>
            <TextInput
              style={[styles.smallInput, { color: colors.text, borderColor: colors.border, backgroundColor: colors.inputBg }]}
              value={profile.currentMedicationsNote ?? ''}
              onChangeText={(v) => setProfile({ ...profile, currentMedicationsNote: v })}
              onEndEditing={() => persistProfile(profile)}
              placeholder={t('familyEmergency.currentMedicationsPlaceholder')}
              placeholderTextColor={colors.textTertiary}
            />
          </View>
          <View style={styles.formRow}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>{t('familyEmergency.doctorNameLabel')}</Text>
              <TextInput
                style={[styles.smallInput, { color: colors.text, borderColor: colors.border, backgroundColor: colors.inputBg }]}
                value={profile.doctorName ?? ''}
                onChangeText={(v) => setProfile({ ...profile, doctorName: v })}
                onEndEditing={() => persistProfile(profile)}
                placeholder={t('familyEmergency.doctorNamePlaceholder')}
                placeholderTextColor={colors.textTertiary}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>{t('familyEmergency.doctorPhoneLabel')}</Text>
              <TextInput
                style={[styles.smallInput, { color: colors.text, borderColor: colors.border, backgroundColor: colors.inputBg }]}
                value={profile.doctorPhone ?? ''}
                onChangeText={(v) => setProfile({ ...profile, doctorPhone: v })}
                onEndEditing={() => persistProfile(profile)}
                placeholder={t('familyEmergency.doctorPhonePlaceholder')}
                placeholderTextColor={colors.textTertiary}
                keyboardType="phone-pad"
              />
            </View>
          </View>
          <View>
            <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>{t('familyEmergency.hospitalPreferenceLabel')}</Text>
            <TextInput
              style={[styles.smallInput, { color: colors.text, borderColor: colors.border, backgroundColor: colors.inputBg }]}
              value={profile.hospitalPreference ?? ''}
              onChangeText={(v) => setProfile({ ...profile, hospitalPreference: v })}
              onEndEditing={() => persistProfile(profile)}
              placeholder={t('familyEmergency.hospitalPreferencePlaceholder')}
              placeholderTextColor={colors.textTertiary}
            />
          </View>
          <View>
            <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>{t('familyEmergency.insurancePolicyLabel')}</Text>
            <TextInput
              style={[styles.smallInput, { color: colors.text, borderColor: colors.border, backgroundColor: colors.inputBg }]}
              value={profile.insurancePolicyNumber ?? ''}
              onChangeText={(v) => setProfile({ ...profile, insurancePolicyNumber: v })}
              onEndEditing={() => persistProfile(profile)}
              placeholder={t('familyEmergency.insurancePolicyPlaceholder')}
              placeholderTextColor={colors.textTertiary}
            />
          </View>
        </View>

        <Text style={[styles.sectionLabel, { color: colors.textSecondary, marginTop: 20 }]}>{t('familyEmergency.settingsSection')}</Text>
        <View style={[styles.settingsCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={styles.settingRow}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.settingTitle, { color: colors.text }]}>{t('familyEmergency.missedMedicineAlertTitle')}</Text>
              <Text style={[styles.settingSub, { color: colors.textTertiary }]}>{t('familyEmergency.missedMedicineAlertSub', { hours: settings.missedMedicineThresholdHours })}</Text>
            </View>
            <Switch
              value={settings.missedMedicineAlertEnabled}
              onValueChange={(v) => updateSetting('missedMedicineAlertEnabled', v)}
              trackColor={{ false: colors.border, true: colors.accent }}
            />
          </View>
          <View style={[styles.divider, { backgroundColor: colors.border }]} />
          <View style={styles.settingRow}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.settingTitle, { color: colors.text }]}>{t('familyEmergency.noActivityAlertTitle')}</Text>
              <Text style={[styles.settingSub, { color: colors.textTertiary }]}>{t('familyEmergency.noActivityAlertSub', { count: settings.noActivityThresholdDays })}</Text>
            </View>
            <Switch
              value={settings.noActivityAlertEnabled}
              onValueChange={(v) => updateSetting('noActivityAlertEnabled', v)}
              trackColor={{ false: colors.border, true: colors.accent }}
            />
          </View>
        </View>

        <Pressable
          onPress={runCheckNow}
          disabled={isChecking}
          style={[styles.checkBtn, { backgroundColor: colors.accent, opacity: isChecking ? 0.6 : 1 }]}
        >
          <Ionicons name="shield-checkmark" size={18} color="#FFF" />
          <Text style={styles.checkBtnText}>{isChecking ? t('familyEmergency.checking') : t('familyEmergency.checkNow')}</Text>
        </Pressable>

        <Text style={[styles.sectionLabel, { color: colors.textSecondary, marginTop: 24 }]}>{t('familyEmergency.alertLogSection')}</Text>
        {log.length === 0 ? (
          <View style={styles.emptyState}>
            <Ionicons name="shield-checkmark-outline" size={40} color={colors.textTertiary} />
            <Text style={[styles.emptyDesc, { color: colors.textTertiary }]}>{t('familyEmergency.emptyLogDesc')}</Text>
          </View>
        ) : (
          log.map((entry) => (
            <Animated.View
              key={entry.id}
              entering={FadeInDown.duration(300)}
              style={[styles.logCard, { backgroundColor: colors.card, borderColor: entry.acknowledged ? colors.border : colors.warning + '50' }]}
            >
              <Ionicons
                name={entry.kind === 'missed_medicine' ? 'medkit' : 'pulse'}
                size={18}
                color={entry.acknowledged ? colors.textTertiary : colors.warning}
              />
              <View style={{ flex: 1 }}>
                <Text style={[styles.logMessage, { color: colors.text }]}>{entry.message}</Text>
                <Text style={[styles.logTime, { color: colors.textTertiary }]}>
                  {new Date(entry.createdAt).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                </Text>
              </View>
              {!entry.acknowledged && (
                <Pressable disabled={!canMarkDone} onPress={async () => { await acknowledgeEmergencyLogEntry(String(memberId), entry.id); load(); }} hitSlop={8}>
                  <Ionicons name="checkmark-circle-outline" size={22} color={colors.accent} />
                </Pressable>
              )}
            </Animated.View>
          ))
        )}
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
  infoBanner: { flexDirection: 'row', gap: 10, padding: 14, borderRadius: 16, borderWidth: 1, marginBottom: 20 },
  infoText: { flex: 1, fontFamily: 'Inter_400Regular', fontSize: 12, lineHeight: 17 },
  sectionLabel: { fontFamily: 'Inter_700Bold', fontSize: 12, letterSpacing: 1, marginBottom: 10 },
  settingsCard: { borderRadius: 16, borderWidth: 1, padding: 4 },
  settingRow: { flexDirection: 'row', alignItems: 'center', padding: 14 },
  settingTitle: { fontFamily: 'Inter_600SemiBold', fontSize: 14 },
  settingSub: { fontFamily: 'Inter_400Regular', fontSize: 11, marginTop: 2 },
  divider: { height: 1, marginHorizontal: 14 },
  checkBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: 16, paddingVertical: 14, marginTop: 16 },
  checkBtnText: { fontFamily: 'Inter_700Bold', fontSize: 14, color: '#FFF' },
  emptyState: { alignItems: 'center', paddingVertical: 30, gap: 10 },
  emptyDesc: { fontFamily: 'Inter_400Regular', fontSize: 13, textAlign: 'center', paddingHorizontal: 30 },
  logCard: { flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: 16, borderWidth: 1, padding: 14, marginBottom: 10 },
  logMessage: { fontFamily: 'Inter_500Medium', fontSize: 13, lineHeight: 18 },
  logTime: { fontFamily: 'Inter_400Regular', fontSize: 11, marginTop: 4 },
  contactCard: { flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 14, borderWidth: 1, padding: 12, marginBottom: 8 },
  contactIconWrap: { width: 30, height: 30, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  contactName: { fontFamily: 'Inter_600SemiBold', fontSize: 13 },
  contactPhone: { fontFamily: 'Inter_400Regular', fontSize: 11, marginTop: 2 },
  addContactCard: { borderRadius: 14, borderWidth: 1, borderStyle: 'dashed', padding: 12, gap: 8 },
  addContactBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderRadius: 10, paddingVertical: 10 },
  addContactBtnText: { fontFamily: 'Inter_700Bold', fontSize: 12, color: '#FFF' },
  smallInput: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontFamily: 'Inter_500Medium', fontSize: 13 },
  textArea: { minHeight: 60, textAlignVertical: 'top' },
  fieldLabel: { fontFamily: 'Inter_600SemiBold', fontSize: 11, marginBottom: 6 },
  formRow: { flexDirection: 'row', gap: 10 },
});
