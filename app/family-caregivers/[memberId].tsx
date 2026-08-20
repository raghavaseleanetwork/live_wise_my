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
import { useRouter, useLocalSearchParams, useFocusEffect } from 'expo-router';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { useTranslation } from 'react-i18next';

import { useTheme } from '@/lib/theme-context';
import { useAuth } from '@/lib/auth-context';
import { useAlert } from '@/lib/alert-context';
import { Avatar } from '@/components/Avatar';
import {
  Caregiver,
  CaregiverInvite,
  loadCaregivers,
  loadPendingCaregiverInvites,
  removeCaregiver,
  normalizeCaregiverPermissions,
} from '@/lib/family-caregivers';
import { LoadingIndicator } from '@/components/PremiumLoader';

/** One-line summary of what a caregiver may see and do, for the row. */
function permissionSummary(c: Caregiver, t: (k: string, o?: any) => string): string {
  const p = normalizeCaregiverPermissions(c.permissions);
  const scope =
    p.allowedModules === null
      ? t('caregiverPermissions.summaryAllModules')
      : t('caregiverPermissions.summaryNModules', { count: p.allowedModules.length });
  return `${t(`caregiverPermissions.level.${p.accessLevel}.title`)} · ${scope}`;
}

export default function FamilyCaregiversScreen() {
  const router = useRouter();
  const { memberId, memberName } = useLocalSearchParams<{ memberId: string; memberName?: string }>();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const { token, user } = useAuth();
  const { showAlert } = useAlert();
  const { t } = useTranslation();

  const [caregivers, setCaregivers] = useState<Caregiver[]>([]);
  const [pendingInvites, setPendingInvites] = useState<CaregiverInvite[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  const load = useCallback(async () => {
    if (!memberId) return;
    setLoading(true);
    setLoadError(false);
    try {
      /*
        Both lists in parallel. The caregiver list is the accepted people; the
        invite list is those who have not accepted yet and is what produces the
        "Pending" rows.

        `allSettled`, not `all`: pending invites are an ENHANCEMENT to this
        screen, so a failure there must not blank out the caregiver list that
        already works. The endpoint is also not implemented yet (returns 404),
        which `loadPendingCaregiverInvites` already absorbs into `[]`.
      */
      const [caregiverResult, inviteResult] = await Promise.allSettled([
        loadCaregivers(String(memberId), token),
        loadPendingCaregiverInvites(String(memberId), token),
      ]);

      if (caregiverResult.status === 'fulfilled') {
        setCaregivers(caregiverResult.value);
      } else {
        console.error('Load caregivers error:', caregiverResult.reason);
        setLoadError(true);
      }

      setPendingInvites(
        inviteResult.status === 'fulfilled' ? inviteResult.value : [],
      );
      if (inviteResult.status === 'rejected') {
        console.error('Load pending invites error:', inviteResult.reason);
      }
    } finally {
      setLoading(false);
    }
  }, [memberId, token]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const isOwner = caregivers.some((c) => c.role === 'owner' && c.userId === user?.id) || caregivers.length === 0;

  const openInvite = () => {
    router.push({ pathname: '/family-caregivers/add', params: { memberId: String(memberId), memberName: memberName ? String(memberName) : '' } });
  };

  const confirmRemove = (c: Caregiver) => {
    showAlert({
      title: t('familyCaregivers.removeConfirmTitle'),
      message: t('familyCaregivers.removeConfirmMessage', { name: c.name, member: memberName || t('familyCaregivers.thisMember') }),
      type: 'warning',
      buttons: [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('familyCaregivers.remove'),
          style: 'destructive',
          onPress: async () => {
            try {
              await removeCaregiver(String(memberId), c.userId, token);
              load();
            } catch (e) {
              console.error('Remove caregiver error:', e);
              showAlert({ title: t('familyCaregivers.couldNotRemoveTitle'), message: t('familyCaregivers.tryAgain'), type: 'error' });
            }
          },
        },
      ],
    });
  };

  const headerHeight = 110 + insets.top;

  return (
    <View style={[styles.container, { backgroundColor: colors.bg }]}>
      <LinearGradient colors={colors.heroGradient as any} style={[styles.header, { height: headerHeight, paddingTop: insets.top }]}>
        <View style={styles.headerTop}>
          <Pressable onPress={() => router.back()} style={styles.backBtn} hitSlop={12}>
            <Ionicons name="chevron-back" size={24} color={colors.text} />
          </Pressable>
          <Text style={[styles.headerTitle, { color: colors.text }]}>{t('familyCaregivers.headerTitle')}</Text>
          <Pressable onPress={openInvite} style={styles.addBtn} hitSlop={12}>
            <Ionicons name="person-add" size={24} color={colors.accent} />
          </Pressable>
        </View>
        {memberName ? <Text style={[styles.headerSubtitle, { color: colors.textSecondary }]}>{t('familyCaregivers.connectedTo', { name: memberName })}</Text> : null}
      </LinearGradient>

      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: insets.bottom + 40 }} showsVerticalScrollIndicator={false}>
        <Text style={[styles.introText, { color: colors.textSecondary }]}>
          {t('familyCaregivers.introText', { member: memberName || t('familyCaregivers.thisMember') })}
        </Text>

        {loading ? (
          <View style={styles.centerBox}>
            <LoadingIndicator color={colors.accent} />
          </View>
        ) : loadError ? (
          <View style={[styles.noticeBox, { backgroundColor: colors.warningDim, borderColor: colors.warning }]}>
            <Ionicons name="alert-circle-outline" size={22} color={colors.warning} />
            <Text style={[styles.noticeText, { color: colors.text }]}>
              {t('familyCaregivers.loadErrorText')}
            </Text>
          </View>
        ) : (
          <>
            {/*
              Empty only when there is nothing in EITHER list. A member with no
              accepted caregivers but one outstanding invite is not empty — that
              is precisely the "I just invited someone and they vanished" case
              this screen was reported for.
            */}
            {caregivers.length === 0 && pendingInvites.length === 0 && (
              <View style={styles.emptyState}>
                <Ionicons name="people-outline" size={48} color={colors.textTertiary} />
                <Text style={[styles.emptyTitle, { color: colors.text }]}>{t('familyCaregivers.emptyTitle')}</Text>
                <Text style={[styles.emptyDesc, { color: colors.textTertiary }]}>
                  {t('familyCaregivers.emptyDesc')}
                </Text>
              </View>
            )}

            {caregivers.map((c, idx) => (
              <Animated.View key={c.id} entering={FadeInDown.delay(idx * 60).duration(300)} style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <Avatar name={c.name} uri={c.avatarUrl} size={44} />
                <View style={{ flex: 1 }}>
                  <View style={styles.nameRow}>
                    {/* Same flex pairing as the pending row below: the name
                        yields and ellipsises so the badge keeps its width. */}
                    <Text
                      style={[styles.cardTitle, { color: colors.text, flex: 1 }]}
                      numberOfLines={1}
                    >
                      {c.name}
                    </Text>
                    {c.role === 'owner' && (
                      <View style={[styles.ownerBadge, { backgroundColor: colors.accentDim }]}>
                        <Text style={[styles.ownerBadgeText, { color: colors.accent }]}>{t('familyCaregivers.ownerBadge')}</Text>
                      </View>
                    )}
                  </View>
                  <Text style={[styles.cardSub, { color: colors.textTertiary }]}>{c.email}</Text>
                  {c.role !== 'owner' && (
                    <Text style={[styles.permSummary, { color: colors.accent }]} numberOfLines={1}>
                      {permissionSummary(c, t)}
                    </Text>
                  )}
                </View>
                {c.role !== 'owner' && isOwner && (
                  <Pressable
                    onPress={() =>
                      router.push({
                        pathname: '/family-caregivers/permissions',
                        params: {
                          memberId: String(memberId),
                          memberName: memberName ? String(memberName) : '',
                          caregiverUserId: c.userId,
                          caregiverName: c.name,
                          caregiverAvatarUrl: c.avatarUrl ?? '',
                        },
                      })
                    }
                    hitSlop={10}
                    style={styles.removeBtn}
                  >
                    <Ionicons name="options-outline" size={20} color={colors.accent} />
                  </Pressable>
                )}
                {c.role !== 'owner' && isOwner && (
                  <Pressable onPress={() => confirmRemove(c)} hitSlop={10} style={styles.removeBtn}>
                    <Ionicons name="close-circle" size={22} color={colors.danger} />
                  </Pressable>
                )}
              </Animated.View>
            ))}

            {/*
              Pending invites — people invited who have not accepted yet.

              Rendered after the accepted caregivers, using the same card so the
              list reads as one thing rather than two. The invitee has no
              account link yet, so there is no avatar image and no permission
              summary to show: the row is deliberately just identity + status.
            */}
            {pendingInvites.map((inv, idx) => (
              <Animated.View
                key={inv.id}
                entering={FadeInDown.delay((caregivers.length + idx) * 60).duration(300)}
                style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}
              >
                {/* No avatarUrl exists for someone who has not accepted — the
                    Avatar falls back to a coloured initial from the email. */}
                <Avatar name={inv.inviteeEmail} size={44} />
                <View style={{ flex: 1 }}>
                  <View style={styles.nameRow}>
                    {/*
                      `flex: 1` pairs with the badge's `flexShrink: 0`: this is
                      the half that yields, so a long email ellipsises inside
                      the row instead of pushing the badge off the card.
                    */}
                    <Text
                      style={[styles.cardTitle, { color: colors.text, flex: 1 }]}
                      numberOfLines={1}
                    >
                      {inv.inviteeEmail}
                    </Text>
                    <View style={[styles.ownerBadge, { backgroundColor: colors.warningDim }]}>
                      <Text style={[styles.ownerBadgeText, { color: colors.warning }]}>
                        {t('familyCaregivers.pendingBadge')}
                      </Text>
                    </View>
                  </View>
                  <Text style={[styles.cardSub, { color: colors.textTertiary }]}>
                    {t('familyCaregivers.pendingSubtitle')}
                  </Text>
                </View>
              </Animated.View>
            ))}
          </>
        )}

        <Pressable onPress={openInvite} style={[styles.inviteCta, { backgroundColor: colors.inputBg, borderColor: colors.border }]}>
          <Ionicons name="person-add-outline" size={18} color={colors.accent} />
          <Text style={[styles.inviteCtaText, { color: colors.accent }]}>{t('familyCaregivers.inviteCta')}</Text>
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
  addBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontFamily: 'Inter_700Bold', fontSize: 18 },
  headerSubtitle: { fontFamily: 'Inter_500Medium', fontSize: 13, marginTop: 4, textAlign: 'center' },
  introText: { fontFamily: 'Inter_400Regular', fontSize: 13, lineHeight: 19, marginBottom: 20 },
  centerBox: { paddingVertical: 40, alignItems: 'center' },
  noticeBox: { flexDirection: 'row', gap: 12, padding: 16, borderRadius: 16, borderWidth: 1, alignItems: 'flex-start' },
  noticeText: { flex: 1, fontFamily: 'Inter_500Medium', fontSize: 13, lineHeight: 19 },
  emptyState: { alignItems: 'center', paddingVertical: 40, gap: 10 },
  emptyTitle: { fontFamily: 'Inter_700Bold', fontSize: 16 },
  emptyDesc: { fontFamily: 'Inter_400Regular', fontSize: 13, textAlign: 'center', paddingHorizontal: 30 },
  card: { flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: 16, borderWidth: 1, padding: 14, marginBottom: 10 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  cardTitle: { fontFamily: 'Inter_600SemiBold', fontSize: 15 },
  cardSub: { fontFamily: 'Inter_400Regular', fontSize: 12, marginTop: 2 },
  permSummary: { fontFamily: 'Inter_600SemiBold', fontSize: 11, marginTop: 3 },
  /**
   * `flexShrink: 0` is load-bearing. `nameRow` is a flex row of
   * [name/email] + [badge]; without it, a long invitee email
   * ("raghavbaheti08@gmail.com") consumed the row and flexbox shrank the BADGE
   * instead, pushing "Pending" past the card's right edge. The text is the
   * flexible half — it has `numberOfLines={1}` and ellipsises — so the badge
   * must keep its intrinsic width.
   */
  ownerBadge: { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6, flexShrink: 0 },
  ownerBadgeText: { fontFamily: 'Inter_700Bold', fontSize: 9, letterSpacing: 0.5 },
  removeBtn: { padding: 2 },
  inviteCta: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: 16, borderWidth: 1, borderStyle: 'dashed', paddingVertical: 14, marginTop: 8 },
  inviteCtaText: { fontFamily: 'Inter_600SemiBold', fontSize: 14 },
});
