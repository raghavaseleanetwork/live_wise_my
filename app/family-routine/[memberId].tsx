import React, { useCallback, useState } from 'react';
import { StyleSheet, Text, View, ScrollView, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams, useFocusEffect } from 'expo-router';
import Animated, { FadeInDown } from 'react-native-reanimated';

import { useTheme } from '@/lib/theme-context';
import {
  RoutineItem,
  ROUTINE_TYPE_LABELS,
  loadRoutines,
  toggleRoutine,
  deleteRoutine,
} from '@/lib/family-records';

export default function DailyRoutineScreen() {
  const router = useRouter();
  const { memberId, memberName } = useLocalSearchParams<{ memberId: string; memberName?: string }>();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();

  const [items, setItems] = useState<RoutineItem[]>([]);

  const load = useCallback(async () => {
    if (!memberId) return;
    setItems(await loadRoutines(String(memberId)));
  }, [memberId]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const openAdd = () => {
    router.push({ pathname: '/family-routine/add', params: { memberId: String(memberId), memberName: memberName ? String(memberName) : '' } });
  };

  const sorted = [...items].sort((a, b) => a.time.localeCompare(b.time));
  const headerHeight = 110 + insets.top;

  return (
    <View style={[styles.container, { backgroundColor: colors.bg }]}>
      <LinearGradient colors={colors.heroGradient as any} style={[styles.header, { height: headerHeight, paddingTop: insets.top }]}>
        <View style={styles.headerTop}>
          <Pressable onPress={() => router.back()} style={styles.backBtn} hitSlop={12}>
            <Ionicons name="chevron-back" size={24} color={colors.text} />
          </Pressable>
          <Text style={[styles.headerTitle, { color: colors.text }]}>Daily Routine</Text>
          <Pressable onPress={openAdd} style={styles.addBtn} hitSlop={12}>
            <Ionicons name="add-circle" size={30} color={colors.accent} />
          </Pressable>
        </View>
        {memberName ? <Text style={[styles.headerSubtitle, { color: colors.textSecondary }]}>For {memberName}</Text> : null}
      </LinearGradient>

      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: insets.bottom + 40 }} showsVerticalScrollIndicator={false}>
        {sorted.length === 0 ? (
          <View style={styles.emptyState}>
            <Ionicons name="time-outline" size={48} color={colors.textTertiary} />
            <Text style={[styles.emptyTitle, { color: colors.text }]}>No routine set yet</Text>
            <Text style={[styles.emptyDesc, { color: colors.textTertiary }]}>Tap + to add wake-up, sleep, or walking reminders.</Text>
          </View>
        ) : (
          sorted.map((item) => {
            const def = ROUTINE_TYPE_LABELS[item.type];
            return (
              <Animated.View key={item.id} entering={FadeInDown.duration(300)} style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <View style={[styles.iconWrap, { backgroundColor: colors.accentDim }]}>
                  <Ionicons name={def.icon as any} size={20} color={colors.accent} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.cardTitle, { color: colors.text }, !item.enabled && { opacity: 0.4 }]}>{item.label}</Text>
                  <Text style={[styles.cardSub, { color: colors.textTertiary }]}>{item.time}</Text>
                </View>
                <Pressable onPress={async () => { await toggleRoutine(String(memberId), item.id); load(); }} hitSlop={10}>
                  <Ionicons name={item.enabled ? 'toggle' : 'toggle-outline'} size={32} color={item.enabled ? colors.accent : colors.textTertiary} />
                </Pressable>
                <Pressable onPress={async () => { await deleteRoutine(String(memberId), item.id); load(); }} hitSlop={10} style={{ marginLeft: 8 }}>
                  <Ionicons name="trash-outline" size={18} color={colors.textTertiary} />
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
  card: { flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: 18, borderWidth: 1, padding: 14, marginBottom: 10 },
  iconWrap: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  cardTitle: { fontFamily: 'Inter_600SemiBold', fontSize: 15 },
  cardSub: { fontFamily: 'Inter_400Regular', fontSize: 12, marginTop: 2 },
});
