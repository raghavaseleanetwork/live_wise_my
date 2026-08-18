import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  StyleSheet,
  Text,
  View,
  ScrollView,
  Pressable,
  RefreshControl,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router, useFocusEffect } from 'expo-router';
import Animated, { FadeInDown, FadeIn } from 'react-native-reanimated';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@/lib/theme-context';
import { useAuth } from '@/lib/auth-context';
import { apiRequest } from '@/lib/query-client';
import { Avatar } from '../components/Avatar';
import { FamilyFeatureKey, normalizeFeatures, loadMemberFeatures } from '@/lib/family-features';
import { loadMyInvites, loadSharedMembers, loadCaregivers, normalizeCaregiverPermissions, canAccessModule } from '@/lib/family-caregivers';
import { onCaregiverSync } from '@/lib/caregiver-sync';
import { useSubscription } from '@/lib/subscription-context';
import { usePaywall } from '@/lib/paywall-context';

const RELATIONSHIPS = [
  { key: 'self', labelKey: 'family.relationshipSelf', icon: 'person' },
  { key: 'papa', labelKey: 'family.relationshipPapa', icon: 'man' },
  { key: 'mummy', labelKey: 'family.relationshipMummy', icon: 'woman' },
  { key: 'partner', labelKey: 'family.relationshipPartner', icon: 'heart' },
  { key: 'child', labelKey: 'family.relationshipChild', icon: 'happy' },
  { key: 'other', labelKey: 'family.relationshipOther', icon: 'people' },
];

interface FamilyMember {
  id: string;
  name: string;
  relationship: string;
  avatarUrl?: string | null;
  dateOfBirth?: string;
  features?: unknown;
  /** Normalized, resolved list of enabled feature keys (Phase 1). */
  featureKeys: FamilyFeatureKey[];
  /** True when the current user is a connected caregiver rather than the owner. */
  isSharedWithMe?: boolean;
}

export default function FamilyScreen() {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const { t } = useTranslation();
  const { token, user } = useAuth();
  const { checkLimit } = useSubscription();
  const { presentPaywall } = usePaywall();
  const [members, setMembers] = useState<FamilyMember[]>([]);
  const [pendingInviteCount, setPendingInviteCount] = useState(0);
  const [refreshing, setRefreshing] = useState(false);

  // Guards against an older in-flight load resolving after a newer one and
  // clobbering fresher data (e.g. focus refetch racing a caregiver-sync push).
  const loadSeq = useRef(0);

  const loadMembers = useCallback(async () => {
    if (!token) return;
    const seq = ++loadSeq.current;
    try {
      const [res, shared] = await Promise.all([
        apiRequest('GET', '/api/family', undefined, token),
        loadSharedMembers(token).catch(() => []),
      ]);
      const owned = (await res.json()) as any[];
      // Members shared by another caregiver (this user is connected, not the
      // owner). Merged in alongside the user's own members below.
      const data = [
        ...owned,
        ...shared.filter((s) => !owned.some((o) => String(o.id) === String(s.id))).map((s) => ({ ...s, isSharedWithMe: true })),
      ];
      // Resolve each member's feature list: prefer the on-device selection
      // (Phase 1 source of truth), else normalize whatever the server sent.
      const hydrated: FamilyMember[] = await Promise.all(
        data.map(async (m) => {
          const id = String(m.id);
          const local = await loadMemberFeatures(id);
          let featureKeys = local ?? normalizeFeatures(m.features) ?? [];

          // Shared members: the "N features managed" summary must reflect
          // what this caregiver can actually see, not the member's full set
          // (which would leak the existence of modules they were not
          // granted, e.g. always showing 20 regardless of scope).
          if (m.isSharedWithMe) {
            try {
              const caregivers = await loadCaregivers(id, token);
              const me = caregivers.find((c) => String(c.userId) === String(user?.id));
              if (me && me.role !== 'owner') {
                const permissions = normalizeCaregiverPermissions(me.permissions);
                featureKeys = featureKeys.filter((k) => canAccessModule(k, permissions, false));
              }
            } catch {
              // Fail open, matching useCaregiverPermissions: an unreachable
              // caregiver list must not hide a member's summary entirely.
            }
          }

          return { ...m, featureKeys, isSharedWithMe: !!m.isSharedWithMe } as FamilyMember;
        }),
      );
      if (seq === loadSeq.current) setMembers(hydrated);
    } catch (e) {
      console.error('Load family error:', e);
    }
  }, [token]);

  const loadInviteCount = useCallback(async () => {
    if (!token) return;
    try {
      const list = await loadMyInvites(token);
      setPendingInviteCount(list.filter((i) => i.status === 'pending').length);
    } catch {
      setPendingInviteCount(0);
    }
  }, [token]);

  // Refetch every time the screen regains focus, so returning from add/edit
  // (or any other screen) always shows current data.
  useFocusEffect(
    useCallback(() => {
      loadMembers();
      loadInviteCount();
    }, [loadMembers, loadInviteCount])
  );

  useEffect(() => {
    const sub = onCaregiverSync(() => {
      loadMembers();
      loadInviteCount();
    });
    return () => sub.remove();
  }, [loadMembers, loadInviteCount]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([loadMembers(), loadInviteCount()]);
    setRefreshing(false);
  }, [loadMembers, loadInviteCount]);

  const deleteMember = (memberId: string) => {
    if (!token) return;
    (async () => {
      try {
        await apiRequest('DELETE', `/api/family/${memberId}`, undefined, token);
        // Drop it locally for instant feedback, then reconcile with the server
        // so the row can't reappear from a stale list.
        setMembers(prev => prev.filter(m => m.id !== memberId));
        loadMembers();
      } catch (e) {
        console.error('Delete family member error:', e);
        loadMembers();
      }
    })();
  };

  // Gate: adding a family member beyond the plan's limit shows the paywall
  // (doc §5.1 — "3rd member on Free"). Only members this user owns count toward
  // the limit; members shared in by another caregiver don't.
  const addMemberNavInFlight = useRef(false);
  const handleAddMember = () => {
    // A fast double-tap fires before the modal transition finishes and
    // pushes this screen twice. Saving then landed the user back on the
    // second copy instead of Family Hub — see the fix in
    // add-family-member.tsx. Guarding here stops the duplicate push itself.
    if (addMemberNavInFlight.current) return;
    const ownedCount = members.filter((m) => !m.isSharedWithMe).length;
    const check = checkLimit('familyMembers', ownedCount);
    if (!check.allowed && check.triggerKey) {
      presentPaywall(check.triggerKey);
      return;
    }
    addMemberNavInFlight.current = true;
    router.push('/add-family-member');
    setTimeout(() => { addMemberNavInFlight.current = false; }, 1000);
  };

  const topInset = Platform.OS === 'web' ? 67 : insets.top;

  return (
    <View style={[styles.container, { backgroundColor: colors.bg }]}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{
          paddingHorizontal: 20,
          paddingTop: topInset + 16,
          paddingBottom: insets.bottom + 100,
        }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            colors={[colors.accent]}
            tintColor={colors.accent}
          />
        }
      >
        <View style={styles.headerRow}>
          <View style={styles.headerTitleWrap}>
            <Text style={[styles.screenTitle, { color: colors.text }]}>{t('family.title')}</Text>
            <Text style={[styles.screenSubtitle, { color: colors.textSecondary }]}>
              {t('family.subtitle')}
            </Text>
          </View>
          <View style={styles.headerActions}>
            <Pressable
              onPress={() => router.push('/caregiver-invites')}
              style={[styles.headerIconBtn, { backgroundColor: colors.card, borderColor: colors.border }]}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              accessibilityLabel={t('family.caregiverInvitesLabel')}
            >
              {/* Deliberately NOT a bell. This opens Caregiver Invites, not a
                  notification list — the bell made it read as a second
                  notification centre alongside the one on Home, which is the
                  confusion this icon change removes. All notifications,
                  including Family Hub ones, live in `app/notifications.tsx`. */}
              <Ionicons name="person-add-outline" size={20} color={colors.textSecondary} />
              {pendingInviteCount > 0 && (
                <View style={[styles.inviteBadge, { backgroundColor: colors.danger }]}>
                  <Text style={styles.inviteBadgeText}>{pendingInviteCount > 9 ? '9+' : pendingInviteCount}</Text>
                </View>
              )}
            </Pressable>
            <Pressable onPress={handleAddMember} accessibilityLabel={t('family.addMemberLabel')}>
              <LinearGradient
                colors={colors.buttonGradient as any}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={styles.addBtnGradient}
              >
                <Ionicons name="add" size={22} color="#FFFFFF" />
              </LinearGradient>
            </Pressable>
          </View>
        </View>

        <View style={styles.content}>
          {members.length === 0 ? (
            <Animated.View entering={FadeIn} style={styles.emptyState}>
              <View style={[styles.emptyIconWrap, { backgroundColor: colors.accentDim }]}>
                <Ionicons name="people-outline" size={60} color={colors.accent} />
              </View>
              <Text style={[styles.emptyTitle, { color: colors.text }]}>{t('family.emptyTitle')}</Text>
              <Text style={[styles.emptyDesc, { color: colors.textSecondary }]}>
                {t('family.emptyDesc')}
              </Text>
              <Pressable
                onPress={handleAddMember}
                style={styles.emptyActionBtn}
              >
                <LinearGradient
                  colors={colors.buttonGradient as any}
                  style={styles.emptyActionGradient}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 0 }}
                >
                  <Text style={styles.emptyActionText}>{t('family.addFirstMember')}</Text>
                </LinearGradient>
              </Pressable>
            </Animated.View>
          ) : (
            members.map((member, idx) => (
              <Animated.View
                key={member.id}
                entering={FadeInDown.delay(idx * 100).duration(500)}
              >
                <Pressable
                  onPress={() => router.push({
                    pathname: '/family-member-detail/[memberId]',
                    params: { memberId: member.id, memberName: member.name },
                  })}
                  style={[styles.memberCard, { backgroundColor: colors.card, borderColor: colors.border }]}
                >
                  <View style={styles.memberHeader}>
                    <View style={styles.memberInfo}>
                      <Avatar name={member.name} uri={member.avatarUrl} size={48} />
                      <View>
                        <View style={styles.nameWithBadge}>
                          <Text style={[styles.memberName, { color: colors.text }]}>{member.name}</Text>
                          {member.isSharedWithMe && (
                            <View style={[styles.sharedBadge, { backgroundColor: colors.accentDim }]}>
                              <Text style={[styles.sharedBadgeText, { color: colors.accent }]}>{t('family.shared')}</Text>
                            </View>
                          )}
                        </View>
                        <Text style={[styles.memberRel, { color: colors.textTertiary }]}>
                          {(() => {
                            const rel = RELATIONSHIPS.find(r => r.key === member.relationship);
                            return rel ? t(rel.labelKey) : member.relationship;
                          })()}
                        </Text>
                      </View>
                    </View>
                    <View style={styles.memberActions}>
                      <Pressable
                        onPress={() => router.push({
                          pathname: '/family-caregivers/[memberId]',
                          params: { memberId: member.id, memberName: member.name },
                        })}
                        style={[styles.actionBtn, { backgroundColor: colors.accentMintDim }]}
                      >
                        <Ionicons name="people" size={17} color={colors.accentMint} />
                      </Pressable>
                      {!member.isSharedWithMe && (
                        <Pressable
                          onPress={() => router.push({
                            pathname: '/edit-family-member',
                            params: { id: member.id }
                          })}
                          style={[styles.actionBtn, { backgroundColor: colors.accentDim }]}
                        >
                          <Ionicons name="create-outline" size={18} color={colors.accent} />
                        </Pressable>
                      )}
                      {!member.isSharedWithMe && (
                        <Pressable
                          onPress={() => deleteMember(member.id)}
                          style={[styles.actionBtn, { backgroundColor: colors.dangerDim }]}
                        >
                          <Ionicons name="trash-outline" size={16} color={colors.danger} />
                        </Pressable>
                      )}
                    </View>
                  </View>

                  <View style={[styles.summaryRow, { borderTopColor: colors.border }]}>
                    <Text style={[styles.summaryText, { color: colors.textTertiary }]}>
                      {member.featureKeys.length === 0
                        ? t('family.noFeaturesSelectedYet')
                        : t('family.featuresManaged', { count: member.featureKeys.length })}
                    </Text>
                    <Ionicons name="chevron-forward" size={16} color={colors.textTertiary} />
                  </View>
                </Pressable>
              </Animated.View>
            ))
          )}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 24,
  },
  headerTitleWrap: {
    flex: 1,
    paddingRight: 12,
  },
  screenTitle: {
    fontFamily: 'Inter_700Bold',
    fontSize: 30,
    letterSpacing: -0.5,
  },
  screenSubtitle: {
    fontFamily: 'Inter_400Regular',
    fontSize: 14,
    marginTop: 4,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  headerIconBtn: {
    width: 42,
    height: 42,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  addBtnGradient: {
    width: 42,
    height: 42,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  inviteBadge: {
    position: 'absolute',
    top: 2,
    right: 2,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    paddingHorizontal: 3,
    alignItems: 'center',
    justifyContent: 'center',
  },
  inviteBadgeText: {
    color: '#FFF',
    fontFamily: 'Inter_700Bold',
    fontSize: 9,
  },
  nameWithBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  sharedBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  sharedBadgeText: {
    fontFamily: 'Inter_700Bold',
    fontSize: 9,
    letterSpacing: 0.4,
  },
  content: {
    paddingBottom: 16,
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 60,
    paddingHorizontal: 40,
  },
  emptyIconWrap: {
    width: 120,
    height: 120,
    borderRadius: 40,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 24,
  },
  emptyTitle: {
    fontFamily: 'Inter_700Bold',
    fontSize: 22,
    marginBottom: 12,
    textAlign: 'center',
  },
  emptyDesc: {
    fontFamily: 'Inter_400Regular',
    fontSize: 15,
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 32,
  },
  emptyActionBtn: {
    height: 56,
    borderRadius: 16,
    overflow: 'hidden',
    width: '100%',
  },
  emptyActionGradient: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyActionText: {
    color: '#FFF',
    fontFamily: 'Inter_700Bold',
    fontSize: 16,
  },
  memberCard: {
    borderRadius: 28,
    padding: 18,
    borderWidth: 1,
    marginBottom: 16,
  },
  memberHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  memberInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  avatarWrap: {
    width: 52,
    height: 52,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  memberName: {
    fontFamily: 'Inter_700Bold',
    fontSize: 18,
  },
  memberRel: {
    fontFamily: 'Inter_500Medium',
    fontSize: 12,
    marginTop: 2,
    letterSpacing: 0.5,
  },
  memberActions: {
    flexDirection: 'row',
    gap: 8,
  },
  actionBtn: {
    width: 36,
    height: 36,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  summaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 14,
    marginTop: 14,
    borderTopWidth: 1,
  },
  summaryText: {
    fontFamily: 'Inter_500Medium',
    fontSize: 13,
  },
});
