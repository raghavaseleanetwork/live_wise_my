import React, { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View, ScrollView, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams, useFocusEffect } from 'expo-router';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { useTranslation } from 'react-i18next';

import { useTheme } from '@/lib/theme-context';
import { onCaregiverSync } from '@/lib/caregiver-sync';
import {
  CustomFeatureConfig,
  CustomTrackerItem,
  loadCustomConfig,
  loadCustomItems,
  toggleCustomItem,
  deleteCustomItem,
} from '@/lib/family-records';

export default function FamilyCustomScreen() {
  const router = useRouter();
  const { memberId, memberName } = useLocalSearchParams<{ memberId: string; memberName?: string }>();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const { t } = useTranslation();

  const [config, setConfig] = useState<CustomFeatureConfig | null>(null);
  const [items, setItems] = useState<CustomTrackerItem[]>([]);
  // First visit with no tracker configured pushes straight to setup; the ref stops
  // it firing again when setup returns here via router.back().
  const autoSetupSent = useRef(false);

  const openSetup = useCallback((current: CustomFeatureConfig | null) => {
    router.push({
      pathname: '/family-custom/setup',
      params: {
        memberId: String(memberId),
        memberName: memberName ? String(memberName) : '',
        currentName: current?.name ?? '',
        currentIcon: current?.icon ?? '',
      },
    });
  }, [memberId, memberName, router]);

  const load = useCallback(async () => {
    if (!memberId) return;
    const [c, i] = await Promise.all([loadCustomConfig(String(memberId)), loadCustomItems(String(memberId))]);
    setConfig(c);
    setItems(i);
    if (!c && !autoSetupSent.current) {
      autoSetupSent.current = true;
      openSetup(null);
    }
  }, [memberId, openSetup]);

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

  const openAdd = () => {
    router.push({
      pathname: '/family-custom/add',
      params: {
        memberId: String(memberId),
        memberName: memberName ? String(memberName) : '',
        trackerName: config?.name ?? '',
      },
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
          <Text style={[styles.headerTitle, { color: colors.text }]}>{config?.name || t('familyCustom.defaultTitle')}</Text>
          <View style={styles.headerActions}>
            {config && (
              <Pressable onPress={() => openSetup(config)} hitSlop={12}>
                <Ionicons name="settings-outline" size={20} color={colors.textSecondary} />
              </Pressable>
            )}
            <Pressable onPress={openAdd} hitSlop={12}>
              <Ionicons name="add-circle" size={30} color={colors.accent} />
            </Pressable>
          </View>
        </View>
        {memberName ? <Text style={[styles.headerSubtitle, { color: colors.textSecondary }]}>{t('familyCustom.forMember', { name: memberName })}</Text> : null}
      </LinearGradient>

      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: insets.bottom + 40 }} showsVerticalScrollIndicator={false}>
        {items.length === 0 ? (
          <View style={styles.emptyState}>
            <Ionicons name={(config?.icon || 'star') as any} size={48} color={colors.textTertiary} />
            <Text style={[styles.emptyTitle, { color: colors.text }]}>{t('familyCustom.emptyTitle')}</Text>
            <Text style={[styles.emptyDesc, { color: colors.textTertiary }]}>{t('familyCustom.emptyDesc', { name: config?.name || t('familyCustom.thisTracker') })}</Text>
          </View>
        ) : (
          items.map((item) => (
            <Animated.View key={item.id} entering={FadeInDown.duration(300)} style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Pressable onPress={async () => { await toggleCustomItem(String(memberId), item.id); load(); }} style={styles.checkCircle}>
                <Ionicons name={item.completed ? 'checkmark-circle' : 'ellipse-outline'} size={24} color={item.completed ? '#10B981' : colors.textTertiary} />
              </Pressable>
              <View style={{ flex: 1 }}>
                <Text style={[styles.cardTitle, { color: colors.text }, item.completed && { textDecorationLine: 'line-through', opacity: 0.5 }]}>{item.title}</Text>
                <Text style={[styles.cardSub, { color: colors.textTertiary }]}>
                  {new Date(item.date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                </Text>
              </View>
              <Pressable onPress={async () => { await deleteCustomItem(String(memberId), item.id); load(); }} hitSlop={10}>
                <Ionicons name="trash-outline" size={18} color={colors.textTertiary} />
              </Pressable>
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
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  headerTitle: { fontFamily: 'Inter_700Bold', fontSize: 17, flex: 1, textAlign: 'center' },
  headerSubtitle: { fontFamily: 'Inter_500Medium', fontSize: 13, marginTop: 4, textAlign: 'center' },
  emptyState: { alignItems: 'center', paddingVertical: 60, gap: 10 },
  emptyTitle: { fontFamily: 'Inter_700Bold', fontSize: 17 },
  emptyDesc: { fontFamily: 'Inter_400Regular', fontSize: 13, textAlign: 'center', paddingHorizontal: 30 },
  card: { flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: 16, borderWidth: 1, padding: 14, marginBottom: 10 },
  checkCircle: { padding: 2 },
  cardTitle: { fontFamily: 'Inter_600SemiBold', fontSize: 15 },
  cardSub: { fontFamily: 'Inter_400Regular', fontSize: 12, marginTop: 2 },
});
