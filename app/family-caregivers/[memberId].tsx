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

import { useTheme } from '@/lib/theme-context';
import { useAuth } from '@/lib/auth-context';
import { useAlert } from '@/lib/alert-context';
import { Avatar } from '@/components/Avatar';
import {
  Caregiver,
  loadCaregivers,
  removeCaregiver,
} from '@/lib/family-caregivers';
import { LoadingIndicator } from '@/components/PremiumLoader';

export default function FamilyCaregiversScreen() {
  const router = useRouter();
  const { memberId, memberName } = useLocalSearchParams<{ memberId: string; memberName?: string }>();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const { token, user } = useAuth();
  const { showAlert } = useAlert();

  const [caregivers, setCaregivers] = useState<Caregiver[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  const load = useCallback(async () => {
    if (!memberId) return;
    setLoading(true);
    setLoadError(false);
    try {
      const list = await loadCaregivers(String(memberId), token);
      setCaregivers(list);
    } catch (e) {
      console.error('Load caregivers error:', e);
      setLoadError(true);
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
      title: 'Remove caregiver?',
      message: `${c.name} will no longer receive reminders or alerts for ${memberName || 'this member'}.`,
      type: 'warning',
      buttons: [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            try {
              await removeCaregiver(String(memberId), c.userId, token);
              load();
            } catch (e) {
              console.error('Remove caregiver error:', e);
              showAlert({ title: 'Could not remove', message: 'Please try again.', type: 'error' });
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
          <Text style={[styles.headerTitle, { color: colors.text }]}>Caregivers</Text>
          <Pressable onPress={openInvite} style={styles.addBtn} hitSlop={12}>
            <Ionicons name="person-add" size={24} color={colors.accent} />
          </Pressable>
        </View>
        {memberName ? <Text style={[styles.headerSubtitle, { color: colors.textSecondary }]}>Connected to {memberName}</Text> : null}
      </LinearGradient>

      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: insets.bottom + 40 }} showsVerticalScrollIndicator={false}>
        <Text style={[styles.introText, { color: colors.textSecondary }]}>
          Everyone connected here gets the same reminders, bill alerts, emergency and health notifications for {memberName || 'this member'}. Marking something done updates it for everyone instantly.
        </Text>

        {loading ? (
          <View style={styles.centerBox}>
            <LoadingIndicator color={colors.accent} />
          </View>
        ) : loadError ? (
          <View style={[styles.noticeBox, { backgroundColor: colors.warningDim, borderColor: colors.warning }]}>
            <Ionicons name="alert-circle-outline" size={22} color={colors.warning} />
            <Text style={[styles.noticeText, { color: colors.text }]}>
              Couldn’t load caregivers right now. Pull to refresh or try again in a moment.
            </Text>
          </View>
        ) : (
          <>
            {caregivers.length === 0 && (
              <View style={styles.emptyState}>
                <Ionicons name="people-outline" size={48} color={colors.textTertiary} />
                <Text style={[styles.emptyTitle, { color: colors.text }]}>No caregivers connected yet</Text>
                <Text style={[styles.emptyDesc, { color: colors.textTertiary }]}>
                  Invite a family member by email so they get the same reminders and alerts.
                </Text>
              </View>
            )}

            {caregivers.map((c, idx) => (
              <Animated.View key={c.id} entering={FadeInDown.delay(idx * 60).duration(300)} style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <Avatar name={c.name} uri={c.avatarUrl} size={44} />
                <View style={{ flex: 1 }}>
                  <View style={styles.nameRow}>
                    <Text style={[styles.cardTitle, { color: colors.text }]}>{c.name}</Text>
                    {c.role === 'owner' && (
                      <View style={[styles.ownerBadge, { backgroundColor: colors.accentDim }]}>
                        <Text style={[styles.ownerBadgeText, { color: colors.accent }]}>Owner</Text>
                      </View>
                    )}
                  </View>
                  <Text style={[styles.cardSub, { color: colors.textTertiary }]}>{c.email}</Text>
                </View>
                {c.role !== 'owner' && isOwner && (
                  <Pressable onPress={() => confirmRemove(c)} hitSlop={10} style={styles.removeBtn}>
                    <Ionicons name="close-circle" size={22} color={colors.danger} />
                  </Pressable>
                )}
              </Animated.View>
            ))}
          </>
        )}

        <Pressable onPress={openInvite} style={[styles.inviteCta, { backgroundColor: colors.inputBg, borderColor: colors.border }]}>
          <Ionicons name="person-add-outline" size={18} color={colors.accent} />
          <Text style={[styles.inviteCtaText, { color: colors.accent }]}>Invite a caregiver by email</Text>
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
  ownerBadge: { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6 },
  ownerBadgeText: { fontFamily: 'Inter_700Bold', fontSize: 9, letterSpacing: 0.5 },
  removeBtn: { padding: 2 },
  inviteCta: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: 16, borderWidth: 1, borderStyle: 'dashed', paddingVertical: 14, marginTop: 8 },
  inviteCtaText: { fontFamily: 'Inter_600SemiBold', fontSize: 14 },
});
