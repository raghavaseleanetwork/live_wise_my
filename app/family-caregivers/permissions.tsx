import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View, ScrollView, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { useTheme } from '@/lib/theme-context';
import { useAuth } from '@/lib/auth-context';
import { useAlert } from '@/lib/alert-context';
import { Avatar } from '@/components/Avatar';
import CaregiverPermissionEditor from '@/components/CaregiverPermissionEditor';
import {
  CaregiverPermissions,
  DEFAULT_CAREGIVER_PERMISSIONS,
  loadCaregivers,
  normalizeCaregiverPermissions,
  updateCaregiverPermissions,
} from '@/lib/family-caregivers';
import { FamilyFeatureKey, loadMemberFeatures, normalizeFeatures } from '@/lib/family-features';
import { apiRequest } from '@/lib/query-client';
import { LoadingIndicator } from '@/components/PremiumLoader';

/**
 * Owner-only screen to change what an already-connected caregiver may see and
 * do (PRD 5.5). Reached from the caregiver row on
 * `family-caregivers/[memberId]`.
 */
export default function CaregiverPermissionsScreen() {
  const router = useRouter();
  const { memberId, memberName, caregiverUserId, caregiverName, caregiverAvatarUrl } =
    useLocalSearchParams<{
      memberId: string;
      memberName?: string;
      caregiverUserId: string;
      caregiverName?: string;
      caregiverAvatarUrl?: string;
    }>();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const { token } = useAuth();
  const { showAlert } = useAlert();
  const { t } = useTranslation();

  const [permissions, setPermissions] = useState<CaregiverPermissions>({
    ...DEFAULT_CAREGIVER_PERMISSIONS,
  });
  const [availableModules, setAvailableModules] = useState<FamilyFeatureKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!memberId || !caregiverUserId) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        // Current permissions come from the caregiver list rather than a
        // dedicated GET — the list already carries them, so this avoids a
        // second round-trip and cannot disagree with what the list showed.
        const list = await loadCaregivers(String(memberId), token);
        const found = list.find((c) => String(c.userId) === String(caregiverUserId));
        if (found && !cancelled) {
          setPermissions(normalizeCaregiverPermissions(found.permissions));
        }

        const local = await loadMemberFeatures(String(memberId));
        if (local != null) {
          if (!cancelled) setAvailableModules(local);
        } else {
          const res = await apiRequest('GET', '/api/family', undefined, token);
          const members = (await res.json()) as any[];
          const m = members.find((x) => String(x.id) === String(memberId));
          if (!cancelled) setAvailableModules(normalizeFeatures(m?.features) ?? []);
        }
      } catch (e) {
        console.error('Load caregiver permissions error:', e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [memberId, caregiverUserId, token]);

  const handleSave = async () => {
    if (!memberId || !caregiverUserId || saving) return;
    setSaving(true);
    try {
      await updateCaregiverPermissions(
        String(memberId),
        String(caregiverUserId),
        permissions,
        token,
      );
      router.back();
    } catch (e) {
      console.error('Update caregiver permissions error:', e);
      // Surface the server's own message on a 400. The permissions endpoint
      // validates strictly and returns a specific reason (e.g. a wrongly
      // shaped body, or a missing accessLevel); showing only a generic
      // 'try again' would hide the one detail that makes it fixable.
      const raw = String((e as Error)?.message ?? '');
      const serverMessage = (() => {
        const m = raw.match(/^d{3}:s*(.*)$/s);
        if (!m) return null;
        try {
          const parsed = JSON.parse(m[1]);
          return parsed?.message ? String(parsed.message) : null;
        } catch {
          return m[1].trim() || null;
        }
      })();
      showAlert({
        title: t('caregiverPermissions.saveFailedTitle'),
        message: serverMessage || t('caregiverPermissions.saveFailedMessage'),
        type: 'error',
      });
      setSaving(false);
    }
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
      <LinearGradient
        colors={colors.heroGradient as any}
        style={[styles.header, { height: headerHeight, paddingTop: insets.top }]}
      >
        <View style={styles.headerTop}>
          <Pressable onPress={() => router.back()} style={styles.backBtn} hitSlop={12}>
            <Ionicons name="chevron-back" size={24} color={colors.text} />
          </Pressable>
          <Text style={[styles.headerTitle, { color: colors.text }]}>
            {t('caregiverPermissions.headerTitle')}
          </Text>
          <View style={styles.backBtn} />
        </View>
        {memberName ? (
          <Text style={[styles.headerSubtitle, { color: colors.textSecondary }]}>
            {t('caregiverPermissions.forMember', { name: memberName })}
          </Text>
        ) : null}
      </LinearGradient>

      <ScrollView
        contentContainerStyle={{ padding: 20, paddingBottom: insets.bottom + 40 }}
        showsVerticalScrollIndicator={false}
      >
        <View style={[styles.caregiverCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Avatar
            name={caregiverName ? String(caregiverName) : '?'}
            uri={caregiverAvatarUrl ? String(caregiverAvatarUrl) : null}
            size={44}
          />
          <View style={{ flex: 1 }}>
            <Text style={[styles.caregiverName, { color: colors.text }]} numberOfLines={1}>
              {caregiverName ? String(caregiverName) : t('caregiverPermissions.thisCaregiver')}
            </Text>
            <Text style={[styles.caregiverSub, { color: colors.textTertiary }]}>
              {t('caregiverPermissions.editingFor', { name: memberName || t('caregiverPermissions.thisMember') })}
            </Text>
          </View>
        </View>

        <CaregiverPermissionEditor
          availableModules={availableModules}
          value={permissions}
          onChange={setPermissions}
        />

        <Pressable
          onPress={handleSave}
          disabled={saving}
          style={[styles.primaryBtn, { backgroundColor: colors.accent, opacity: saving ? 0.6 : 1 }]}
        >
          {saving ? (
            <LoadingIndicator color="#FFF" size="small" />
          ) : (
            <Text style={styles.primaryBtnLabel}>{t('caregiverPermissions.savePermissions')}</Text>
          )}
        </Pressable>
      </ScrollView>
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
  headerTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  backBtn: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontFamily: 'Inter_700Bold', fontSize: 17, flex: 1, textAlign: 'center' },
  headerSubtitle: { fontFamily: 'Inter_500Medium', fontSize: 13, marginTop: 4, textAlign: 'center' },
  caregiverCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderRadius: 16,
    borderWidth: 1,
    padding: 14,
    marginBottom: 22,
  },
  caregiverName: { fontFamily: 'Inter_700Bold', fontSize: 15 },
  caregiverSub: { fontFamily: 'Inter_400Regular', fontSize: 12, marginTop: 2 },
  primaryBtn: { borderRadius: 14, paddingVertical: 15, alignItems: 'center', marginTop: 28 },
  primaryBtnLabel: { fontFamily: 'Inter_700Bold', fontSize: 15, color: '#FFF' },
});
