import React, { useCallback, useState } from 'react';
import { StyleSheet, Text, View, ScrollView, Pressable, TextInput, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams, useFocusEffect } from 'expo-router';
import Animated, { FadeInDown, FadeIn, FadeOut } from 'react-native-reanimated';

import { useTheme } from '@/lib/theme-context';
import { useAuth } from '@/lib/auth-context';
import { useAlert } from '@/lib/alert-context';
import { Avatar } from '@/components/Avatar';
import {
  Caregiver,
  loadCaregivers,
  inviteCaregiver,
  removeCaregiver,
} from '@/lib/family-caregivers';

export default function FamilyCaregiversScreen() {
  const router = useRouter();
  const { memberId, memberName } = useLocalSearchParams<{ memberId: string; memberName?: string }>();
  const insets = useSafeAreaInsets();
  const { colors, isDark } = useTheme();
  const { token, user } = useAuth();
  const { showAlert } = useAlert();

  const [caregivers, setCaregivers] = useState<Caregiver[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  const [showInvite, setShowInvite] = useState(false);
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);

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

  const handleInvite = async () => {
    const trimmed = email.trim();
    if (!trimmed || !/^\S+@\S+\.\S+$/.test(trimmed)) {
      setError('Enter a valid email address');
      return;
    }
    setSending(true);
    setError('');
    try {
      await inviteCaregiver(String(memberId), trimmed, token);
      setShowInvite(false);
      setEmail('');
      showAlert({ title: 'Invite sent', message: `${trimmed} will see this invite next time they open LifeWise.`, type: 'success' });
      load();
    } catch (e: any) {
      const msg = String(e?.message || '');
      if (msg.includes('400')) {
        setError('Enter a valid email — you can’t invite yourself.');
      } else if (msg.includes('403')) {
        setError('Only the owner can invite caregivers for this member.');
      } else if (msg.includes('409')) {
        setError('That person is already connected or already invited.');
      } else {
        setError('Could not send invite. Please try again.');
      }
    } finally {
      setSending(false);
    }
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
          <Pressable onPress={() => setShowInvite(true)} style={styles.addBtn} hitSlop={12}>
            <Ionicons name="person-add" size={24} color={colors.accent} />
          </Pressable>
        </View>
        {memberName ? <Text style={[styles.headerSubtitle, { color: colors.textSecondary }]}>Connected to {memberName}</Text> : null}
      </LinearGradient>

      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: insets.bottom + 40 }} showsVerticalScrollIndicator={false}>
        {showInvite && (
          <Animated.View entering={FadeIn.duration(200)} exiting={FadeOut.duration(150)} style={styles.formSection}>
            <Text style={[styles.sectionHeading, { color: colors.text }]}>Invite caregiver</Text>
            <Text style={[styles.modalDesc, { color: colors.textSecondary }]}>
              They'll get an invite in their LifeWise app. Once accepted, they'll see {memberName || 'this member'} and receive the same reminders and alerts.
            </Text>
            {!!error && <Text style={[styles.errorText, { color: colors.danger }]}>{error}</Text>}

            <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>Email address</Text>
            <TextInput
              style={[styles.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.inputBg }]}
              value={email}
              onChangeText={setEmail}
              placeholder="e.g. priya@example.com"
              placeholderTextColor={colors.textTertiary}
              autoCapitalize="none"
              keyboardType="email-address"
              autoFocus
            />

            <Pressable onPress={handleInvite} disabled={sending} style={[styles.primaryBtn, { backgroundColor: colors.accent, opacity: sending ? 0.6 : 1 }]}>
              {sending ? <ActivityIndicator color="#FFF" size="small" /> : <Text style={styles.primaryBtnLabel}>Send Invite</Text>}
            </Pressable>
            <Pressable onPress={() => { setShowInvite(false); setEmail(''); setError(''); }} style={styles.cancelBtn}>
              <Text style={[styles.cancelBtnLabel, { color: colors.textTertiary }]}>Cancel</Text>
            </Pressable>
          </Animated.View>
        )}

        <Text style={[styles.introText, { color: colors.textSecondary }]}>
          Everyone connected here gets the same reminders, bill alerts, emergency and health notifications for {memberName || 'this member'}. Marking something done updates it for everyone instantly.
        </Text>

        {loading ? (
          <View style={styles.centerBox}>
            <ActivityIndicator color={colors.accent} />
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
                        <Text style={[styles.ownerBadgeText, { color: colors.accent }]}>OWNER</Text>
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

        <Pressable onPress={() => setShowInvite(true)} style={[styles.inviteCta, { backgroundColor: colors.inputBg, borderColor: colors.border }]}>
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
  noticeBox: { flexDirection: 'row', gap: 12, padding: 16, borderRadius: 18, borderWidth: 1, alignItems: 'flex-start' },
  noticeText: { flex: 1, fontFamily: 'Inter_500Medium', fontSize: 13, lineHeight: 19 },
  emptyState: { alignItems: 'center', paddingVertical: 40, gap: 10 },
  emptyTitle: { fontFamily: 'Inter_700Bold', fontSize: 16 },
  emptyDesc: { fontFamily: 'Inter_400Regular', fontSize: 13, textAlign: 'center', paddingHorizontal: 30 },
  card: { flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: 18, borderWidth: 1, padding: 14, marginBottom: 10 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  cardTitle: { fontFamily: 'Inter_600SemiBold', fontSize: 15 },
  cardSub: { fontFamily: 'Inter_400Regular', fontSize: 12, marginTop: 2 },
  ownerBadge: { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6 },
  ownerBadgeText: { fontFamily: 'Inter_700Bold', fontSize: 9, letterSpacing: 0.5 },
  removeBtn: { padding: 2 },
  inviteCta: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: 16, borderWidth: 1, borderStyle: 'dashed', paddingVertical: 14, marginTop: 8 },
  inviteCtaText: { fontFamily: 'Inter_600SemiBold', fontSize: 14 },
  formSection: { marginBottom: 28 },
  sectionHeading: { fontFamily: 'Inter_700Bold', fontSize: 20, marginBottom: 12 },
  primaryBtn: { borderRadius: 14, paddingVertical: 15, alignItems: 'center', marginTop: 22 },
  primaryBtnLabel: { fontFamily: 'Inter_700Bold', fontSize: 15, color: '#FFF' },
  cancelBtn: { paddingVertical: 12, alignItems: 'center', marginTop: 4 },
  cancelBtnLabel: { fontFamily: 'Inter_500Medium', fontSize: 14 },
  modalDesc: { fontFamily: 'Inter_400Regular', fontSize: 13, lineHeight: 19, textAlign: 'center', marginBottom: 12 },
  errorText: { fontFamily: 'Inter_500Medium', fontSize: 13, marginBottom: 10, textAlign: 'center' },
  fieldLabel: { fontFamily: 'Inter_600SemiBold', fontSize: 12, marginBottom: 6, marginTop: 4, textTransform: 'uppercase', letterSpacing: 0.5 },
  input: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontFamily: 'Inter_500Medium', fontSize: 14 },
});
