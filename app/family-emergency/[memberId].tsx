import React, { useCallback, useMemo, useState } from 'react';
import { StyleSheet, Text, View, ScrollView, Pressable, Switch } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams, useFocusEffect } from 'expo-router';
import Animated, { FadeInDown } from 'react-native-reanimated';

import { useTheme } from '@/lib/theme-context';
import { useAuth } from '@/lib/auth-context';
import { apiRequest } from '@/lib/query-client';
import { scheduleLocalNotification } from '@/lib/notifications';
import {
  EmergencySettings,
  EmergencyLogEntry,
  DEFAULT_EMERGENCY_SETTINGS,
  loadEmergencySettings,
  saveEmergencySettings,
  loadEmergencyLog,
  addEmergencyLogEntry,
  acknowledgeEmergencyLogEntry,
  findMissedMedicines,
} from '@/lib/family-records';

export default function FamilyEmergencyScreen() {
  const router = useRouter();
  const { memberId, memberName } = useLocalSearchParams<{ memberId: string; memberName?: string }>();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const { token } = useAuth();

  const [settings, setSettings] = useState<EmergencySettings>(DEFAULT_EMERGENCY_SETTINGS);
  const [log, setLog] = useState<EmergencyLogEntry[]>([]);
  const [isChecking, setIsChecking] = useState(false);

  const load = useCallback(async () => {
    if (!memberId) return;
    const [s, l] = await Promise.all([loadEmergencySettings(String(memberId)), loadEmergencyLog(String(memberId))]);
    setSettings(s);
    setLog(l);
  }, [memberId]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

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
          const message = `${missed.join(', ')} ${missed.length === 1 ? 'was' : 'were'} not marked as taken more than ${settings.missedMedicineThresholdHours}h after the scheduled time.`;
          await addEmergencyLogEntry(String(memberId), 'missed_medicine', message);
          await scheduleLocalNotification({
            title: `⚠️ ${memberName || 'Family member'}: Medicine may have been missed`,
            body: message,
            data: { type: 'family_emergency', memberId: String(memberId) },
            triggerAt: new Date(Date.now() + 1000),
          }).catch(() => {});
        }
      }

      await load();
      if (!foundSomething) {
        await addEmergencyLogEntry(String(memberId), 'missed_medicine', 'Check complete — nothing to report right now.');
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
          <Text style={[styles.headerTitle, { color: colors.text }]}>🚨 Emergency Alerts</Text>
          <View style={{ width: 40 }} />
        </View>
        {memberName ? <Text style={[styles.headerSubtitle, { color: colors.textSecondary }]}>For {memberName}</Text> : null}
      </LinearGradient>

      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: insets.bottom + 40 }} showsVerticalScrollIndicator={false}>
        <View style={[styles.infoBanner, { backgroundColor: colors.accentDim, borderColor: colors.accent + '30' }]}>
          <Ionicons name="information-circle" size={18} color={colors.accent} />
          <Text style={[styles.infoText, { color: colors.text }]}>
            Alerts fire as a notification on <Text style={{ fontFamily: 'Inter_700Bold' }}>this device</Text>. Sending alerts to other family members' phones needs a small backend addition — see the notes in this app's project docs.
          </Text>
        </View>

        <Text style={[styles.sectionLabel, { color: colors.textSecondary }]}>SETTINGS</Text>
        <View style={[styles.settingsCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={styles.settingRow}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.settingTitle, { color: colors.text }]}>Missed Medicine Alert</Text>
              <Text style={[styles.settingSub, { color: colors.textTertiary }]}>Alert if a dose is {settings.missedMedicineThresholdHours}h+ overdue</Text>
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
              <Text style={[styles.settingTitle, { color: colors.text }]}>No-Activity Alert</Text>
              <Text style={[styles.settingSub, { color: colors.textTertiary }]}>Alert after {settings.noActivityThresholdDays} day{settings.noActivityThresholdDays === 1 ? '' : 's'} of no logged activity</Text>
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
          <Text style={styles.checkBtnText}>{isChecking ? 'Checking…' : 'Check Now'}</Text>
        </Pressable>

        <Text style={[styles.sectionLabel, { color: colors.textSecondary, marginTop: 24 }]}>ALERT LOG</Text>
        {log.length === 0 ? (
          <View style={styles.emptyState}>
            <Ionicons name="shield-checkmark-outline" size={40} color={colors.textTertiary} />
            <Text style={[styles.emptyDesc, { color: colors.textTertiary }]}>No alerts yet. Tap "Check Now" to run a check.</Text>
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
                <Pressable onPress={async () => { await acknowledgeEmergencyLogEntry(String(memberId), entry.id); load(); }} hitSlop={8}>
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
  settingsCard: { borderRadius: 18, borderWidth: 1, padding: 4 },
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
});
