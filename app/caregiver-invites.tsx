import React, { useCallback, useState } from 'react';
import {
  StyleSheet,
  Text,
  View,
  ScrollView,
  Pressable,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect } from 'expo-router';
import Animated, { FadeInDown } from 'react-native-reanimated';

import { useTheme } from '@/lib/theme-context';
import { useAuth } from '@/lib/auth-context';
import { useAlert } from '@/lib/alert-context';
import { Avatar } from '@/components/Avatar';
import {
  CaregiverInvite,
  loadMyInvites,
  acceptInvite,
  declineInvite,
} from '@/lib/family-caregivers';
import { LoadingIndicator } from '@/components/PremiumLoader';
import { useTranslation } from 'react-i18next';

export default function CaregiverInvitesScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const { token } = useAuth();
  const { showAlert } = useAlert();
  const { t } = useTranslation();

  const [invites, setInvites] = useState<CaregiverInvite[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      const list = await loadMyInvites(token);
      setInvites(list.filter((i) => i.status === 'pending'));
    } catch (e) {
      console.error('Load invites error:', e);
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const handleAccept = async (invite: CaregiverInvite) => {
    setBusyId(invite.id);
    try {
      await acceptInvite(invite.id, token);
      setInvites((prev) => prev.filter((i) => i.id !== invite.id));
      showAlert({ title: t('caregiverInvites.connectedTitle'), message: t('caregiverInvites.connectedMessage', { memberName: invite.memberName }), type: 'success' });
    } catch (e) {
      console.error('Accept invite error:', e);
      showAlert({ title: t('caregiverInvites.couldNotAcceptTitle'), message: t('caregiverInvites.tryAgain'), type: 'error' });
    } finally {
      setBusyId(null);
    }
  };

  const handleDecline = async (invite: CaregiverInvite) => {
    setBusyId(invite.id);
    try {
      await declineInvite(invite.id, token);
      setInvites((prev) => prev.filter((i) => i.id !== invite.id));
    } catch (e) {
      console.error('Decline invite error:', e);
      showAlert({ title: t('caregiverInvites.couldNotDeclineTitle'), message: t('caregiverInvites.tryAgain'), type: 'error' });
    } finally {
      setBusyId(null);
    }
  };

  const headerHeight = 110 + insets.top;

  return (
    <View style={[styles.container, { backgroundColor: colors.bg }]}>
      <LinearGradient colors={colors.heroGradient as any} style={[styles.header, { height: headerHeight, paddingTop: insets.top }]}>
        <View style={styles.headerTop}>
          <Pressable onPress={() => router.back()} style={styles.backBtn} hitSlop={12}>
            <Ionicons name="chevron-back" size={24} color={colors.text} />
          </Pressable>
          <Text style={[styles.headerTitle, { color: colors.text }]}>{t('caregiverInvites.title')}</Text>
          <View style={{ width: 40 }} />
        </View>
      </LinearGradient>

      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: insets.bottom + 40 }} showsVerticalScrollIndicator={false}>
        {loading ? (
          <View style={styles.centerBox}>
            <LoadingIndicator color={colors.accent} />
          </View>
        ) : loadError ? (
          <View style={[styles.noticeBox, { backgroundColor: colors.warningDim, borderColor: colors.warning }]}>
            <Ionicons name="alert-circle-outline" size={22} color={colors.warning} />
            <Text style={[styles.noticeText, { color: colors.text }]}>
              {t('caregiverInvites.loadError')}
            </Text>
          </View>
        ) : invites.length === 0 ? (
          <View style={styles.emptyState}>
            <Ionicons name="mail-open-outline" size={48} color={colors.textTertiary} />
            <Text style={[styles.emptyTitle, { color: colors.text }]}>{t('caregiverInvites.emptyTitle')}</Text>
            <Text style={[styles.emptyDesc, { color: colors.textTertiary }]}>
              {t('caregiverInvites.emptyDesc')}
            </Text>
          </View>
        ) : (
          invites.map((invite, idx) => (
            <Animated.View key={invite.id} entering={FadeInDown.delay(idx * 60).duration(300)} style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <View style={styles.cardTop}>
                <Avatar name={invite.memberName} uri={invite.memberAvatarUrl} size={44} />
                <View style={{ flex: 1 }}>
                  <Text style={[styles.cardTitle, { color: colors.text }]}>{invite.memberName}</Text>
                  <Text style={[styles.cardSub, { color: colors.textTertiary }]}>
                    {t('caregiverInvites.invitedBy', { name: invite.invitedByName, email: invite.invitedByEmail })}
                  </Text>
                </View>
              </View>
              <View style={styles.cardActions}>
                <Pressable
                  onPress={() => handleDecline(invite)}
                  disabled={busyId === invite.id}
                  style={[styles.declineBtn, { borderColor: colors.border }]}
                >
                  <Text style={[styles.declineBtnText, { color: colors.textSecondary }]}>{t('caregiverInvites.decline')}</Text>
                </Pressable>
                <Pressable
                  onPress={() => handleAccept(invite)}
                  disabled={busyId === invite.id}
                  style={[styles.acceptBtn, { backgroundColor: colors.accent }]}
                >
                  {busyId === invite.id ? <LoadingIndicator color="#FFF" size="small" /> : <Text style={styles.acceptBtnText}>{t('caregiverInvites.accept')}</Text>}
                </Pressable>
              </View>
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
  centerBox: { paddingVertical: 40, alignItems: 'center' },
  noticeBox: { flexDirection: 'row', gap: 12, padding: 16, borderRadius: 16, borderWidth: 1, alignItems: 'flex-start' },
  noticeText: { flex: 1, fontFamily: 'Inter_500Medium', fontSize: 13, lineHeight: 19 },
  emptyState: { alignItems: 'center', paddingVertical: 60, gap: 10 },
  emptyTitle: { fontFamily: 'Inter_700Bold', fontSize: 17 },
  emptyDesc: { fontFamily: 'Inter_400Regular', fontSize: 13, textAlign: 'center', paddingHorizontal: 30 },
  card: { borderRadius: 16, borderWidth: 1, padding: 14, marginBottom: 12, gap: 14 },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  cardTitle: { fontFamily: 'Inter_600SemiBold', fontSize: 15 },
  cardSub: { fontFamily: 'Inter_400Regular', fontSize: 12, marginTop: 2 },
  cardActions: { flexDirection: 'row', gap: 10 },
  declineBtn: { flex: 1, paddingVertical: 11, borderRadius: 12, borderWidth: 1, alignItems: 'center' },
  declineBtnText: { fontFamily: 'Inter_600SemiBold', fontSize: 13 },
  acceptBtn: { flex: 1, paddingVertical: 11, borderRadius: 12, alignItems: 'center' },
  acceptBtnText: { fontFamily: 'Inter_700Bold', fontSize: 13, color: '#FFF' },
});
