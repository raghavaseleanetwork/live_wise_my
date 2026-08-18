import React, { useCallback, useState } from 'react';
import { StyleSheet, Text, View, ScrollView, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams, useFocusEffect } from 'expo-router';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { useTranslation } from 'react-i18next';

import { useTheme } from '@/lib/theme-context';
import { useAuth } from '@/lib/auth-context';
import { apiRequest } from '@/lib/query-client';
import { onCaregiverSync } from '@/lib/caregiver-sync';
import { useCaregiverPermissions } from '@/lib/use-caregiver-permissions';

type MedAppearance = 'capsule' | 'tablet' | 'round' | 'liquid';

interface Medicine {
  id: string;
  name: string;
  dosage?: string;
  appearance?: MedAppearance;
  color?: string;
  slots?: { morning?: string; noon?: string; evening?: string };
  taken?: boolean;
}

export default function FamilyMedicinesScreen() {
  const router = useRouter();
  const { memberId, memberName } = useLocalSearchParams<{ memberId: string; memberName?: string }>();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const { token } = useAuth();
  const { t } = useTranslation();

  // Scoped caregiver access (PRD 5.5). Adding is owner-only server-side for
  // every caregiver regardless of level, so the add button is gated on that,
  // not just canEdit — see the note in add-medicine.tsx.
  const { isOwner, canEdit } = useCaregiverPermissions(memberId ? String(memberId) : null);
  const mayAddMedicine = isOwner && canEdit;

  const [medicines, setMedicines] = useState<Medicine[]>([]);

  const load = useCallback(async () => {
    if (!token || !memberId) return;
    try {
      const res = await apiRequest('GET', '/api/family', undefined, token);
      const data = (await res.json()) as any[];
      const member = data.find((m) => String(m.id) === String(memberId));
      setMedicines(Array.isArray(member?.medicines) ? member.medicines : []);
    } catch (e) {
      console.error('Load medicines error:', e);
    }
  }, [token, memberId]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  React.useEffect(() => {
    const sub = onCaregiverSync((syncedMemberId) => {
      if (memberId && syncedMemberId === String(memberId)) load();
    });
    return () => sub.remove();
  }, [memberId, load]);

  const openAdd = () => {
    router.push({ pathname: '/add-medicine', params: { memberId: String(memberId), memberName: memberName ? String(memberName) : '' } });
  };

  const openDetail = (medId: string) => {
    router.push({ pathname: '/medicine-details/[memberId]/[medId]', params: { memberId: String(memberId), medId } });
  };

  const headerHeight = 110 + insets.top;

  return (
    <View style={[styles.container, { backgroundColor: colors.bg }]}>
      <LinearGradient colors={colors.heroGradient as any} style={[styles.header, { height: headerHeight, paddingTop: insets.top }]}>
        <View style={styles.headerTop}>
          <Pressable onPress={() => router.back()} style={styles.backBtn} hitSlop={12}>
            <Ionicons name="chevron-back" size={24} color={colors.text} />
          </Pressable>
          <Text style={[styles.headerTitle, { color: colors.text }]}>{t('familyMedicines.headerTitle')}</Text>
          {mayAddMedicine ? (
            <Pressable onPress={openAdd} style={styles.addBtn} hitSlop={12}>
              <Ionicons name="add-circle" size={30} color={colors.accent} />
            </Pressable>
          ) : (
            <View style={styles.addBtn} />
          )}
        </View>
        {memberName ? <Text style={[styles.headerSubtitle, { color: colors.textSecondary }]}>{t('familyStock.forMember', { name: memberName })}</Text> : null}
      </LinearGradient>

      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: insets.bottom + 40 }} showsVerticalScrollIndicator={false}>
        {medicines.length === 0 ? (
          <View style={styles.emptyState}>
            <Ionicons name="medkit-outline" size={48} color={colors.textTertiary} />
            <Text style={[styles.emptyTitle, { color: colors.text }]}>{t('familyMedicines.emptyTitle')}</Text>
            <Text style={[styles.emptyDesc, { color: colors.textTertiary }]}>{t('familyMedicines.emptyDesc')}</Text>
          </View>
        ) : (
          medicines.map((med) => {
            const pillColor = med.color || colors.accent;
            const slots = med.slots || {};
            const times = [slots.morning, slots.noon, slots.evening].filter(Boolean).join(' · ');
            return (
              <Animated.View key={med.id} entering={FadeInDown.duration(300)}>
                <Pressable
                  onPress={() => openDetail(med.id)}
                  style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}
                >
                  <View style={[styles.medIcon, { backgroundColor: pillColor + '20' }]}>
                    <Ionicons name="medkit" size={18} color={pillColor} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.cardTitle, { color: colors.text }]}>{med.name}</Text>
                    <Text style={[styles.cardSub, { color: colors.textTertiary }]} numberOfLines={1}>
                      {[med.dosage, times].filter(Boolean).join(' · ') || t('familyMedicines.noScheduleSet')}
                    </Text>
                  </View>
                  {med.taken && (
                    <View style={[styles.takenBadge, { backgroundColor: '#10B98120' }]}>
                      <Ionicons name="checkmark" size={12} color="#10B981" />
                    </View>
                  )}
                  <Ionicons name="chevron-forward" size={18} color={colors.textTertiary} />
                </Pressable>
              </Animated.View>
            );
          })
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
  addBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontFamily: 'Inter_700Bold', fontSize: 18 },
  headerSubtitle: { fontFamily: 'Inter_500Medium', fontSize: 13, marginTop: 4, textAlign: 'center' },
  emptyState: { alignItems: 'center', paddingVertical: 60, gap: 10 },
  emptyTitle: { fontFamily: 'Inter_700Bold', fontSize: 17 },
  emptyDesc: { fontFamily: 'Inter_400Regular', fontSize: 13, textAlign: 'center', paddingHorizontal: 30 },
  card: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    borderRadius: 16, borderWidth: 1, padding: 14, marginBottom: 10,
  },
  medIcon: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  cardTitle: { fontFamily: 'Inter_600SemiBold', fontSize: 15 },
  cardSub: { fontFamily: 'Inter_400Regular', fontSize: 12, marginTop: 2 },
  takenBadge: { width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
});
