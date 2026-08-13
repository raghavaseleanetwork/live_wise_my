import React, { useCallback, useState } from 'react';
import { StyleSheet, Text, View, ScrollView, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams, useFocusEffect } from 'expo-router';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { useTranslation } from 'react-i18next';

import { useTheme } from '@/lib/theme-context';
import {
  TravelItem,
  TRAVEL_TYPE_LABELS,
  loadTravelItems,
  toggleTravelItem,
  deleteTravelItem,
} from '@/lib/family-records';

export default function FamilyTravelScreen() {
  const router = useRouter();
  const { memberId, memberName } = useLocalSearchParams<{ memberId: string; memberName?: string }>();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const { t } = useTranslation();

  const [items, setItems] = useState<TravelItem[]>([]);

  const load = useCallback(async () => {
    if (!memberId) return;
    setItems(await loadTravelItems(String(memberId)));
  }, [memberId]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const openAdd = () => {
    router.push({ pathname: '/family-travel/add', params: { memberId: String(memberId), memberName: memberName ? String(memberName) : '' } });
  };

  const upcoming = items.filter((t) => !t.completed).sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  const past = items.filter((t) => t.completed);
  const headerHeight = 110 + insets.top;

  return (
    <View style={[styles.container, { backgroundColor: colors.bg }]}>
      <LinearGradient colors={colors.heroGradient as any} style={[styles.header, { height: headerHeight, paddingTop: insets.top }]}>
        <View style={styles.headerTop}>
          <Pressable onPress={() => router.back()} style={styles.backBtn} hitSlop={12}>
            <Ionicons name="chevron-back" size={24} color={colors.text} />
          </Pressable>
          <Text style={[styles.headerTitle, { color: colors.text }]}>{t('familyTravel.headerTitle')}</Text>
          <Pressable onPress={openAdd} style={styles.addBtn} hitSlop={12}>
            <Ionicons name="add-circle" size={30} color={colors.accent} />
          </Pressable>
        </View>
        {memberName ? <Text style={[styles.headerSubtitle, { color: colors.textSecondary }]}>{t('familyTravel.forMember', { name: memberName })}</Text> : null}
      </LinearGradient>

      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: insets.bottom + 40 }} showsVerticalScrollIndicator={false}>
        {items.length === 0 ? (
          <View style={styles.emptyState}>
            <Ionicons name="airplane-outline" size={48} color={colors.textTertiary} />
            <Text style={[styles.emptyTitle, { color: colors.text }]}>{t('familyTravel.emptyTitle')}</Text>
            <Text style={[styles.emptyDesc, { color: colors.textTertiary }]}>{t('familyTravel.emptyDesc')}</Text>
          </View>
        ) : (
          <>
            {upcoming.length > 0 && (
              <>
                <Text style={[styles.sectionLabel, { color: colors.textSecondary }]}>{t('familyTravel.upcoming')}</Text>
                {upcoming.map((item) => (
                  <TravelCard key={item.id} item={item} colors={colors} t={t}
                    onToggle={async () => { await toggleTravelItem(String(memberId), item.id); load(); }}
                    onEdit={() => router.push({ pathname: '/family-travel/add', params: { memberId: String(memberId), memberName: memberName ? String(memberName) : '', editId: item.id } })}
                    onDelete={async () => { await deleteTravelItem(String(memberId), item.id); load(); }} />
                ))}
              </>
            )}
            {past.length > 0 && (
              <>
                <Text style={[styles.sectionLabel, { color: colors.textSecondary, marginTop: 20 }]}>{t('familyTravel.past')}</Text>
                {past.map((item) => (
                  <TravelCard key={item.id} item={item} colors={colors} t={t}
                    onToggle={async () => { await toggleTravelItem(String(memberId), item.id); load(); }}
                    onEdit={() => router.push({ pathname: '/family-travel/add', params: { memberId: String(memberId), memberName: memberName ? String(memberName) : '', editId: item.id } })}
                    onDelete={async () => { await deleteTravelItem(String(memberId), item.id); load(); }} />
                ))}
              </>
            )}
          </>
        )}
      </ScrollView>
    </View>
  );
}

function TravelCard({
  item, colors, onToggle, onEdit, onDelete, t,
}: { item: TravelItem; colors: any; onToggle: () => void; onEdit: () => void; onDelete: () => void; t: (key: string, opts?: any) => string }) {
  const def = TRAVEL_TYPE_LABELS[item.type];
  return (
    <Animated.View entering={FadeInDown.duration(300)} style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <Pressable onPress={onToggle} style={styles.checkCircle}>
        <Ionicons name={item.completed ? 'checkmark-circle' : 'ellipse-outline'} size={26} color={item.completed ? '#10B981' : colors.textTertiary} />
      </Pressable>
      <View style={[styles.iconWrap, { backgroundColor: colors.accentDim }]}>
        <Ionicons name={def.icon as any} size={16} color={colors.accent} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[styles.cardTitle, { color: colors.text }, item.completed && { textDecorationLine: 'line-through', opacity: 0.5 }]} numberOfLines={1}>{item.title}</Text>
        <Text style={[styles.cardSub, { color: colors.textTertiary }]}>
          {t(`familyTravel.type.${item.type}`)} · {new Date(item.date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
          {item.location ? ` · ${item.location}` : ''}
        </Text>
      </View>
      <Pressable onPress={onEdit} hitSlop={10} style={styles.rowAction}>
        <Ionicons name="create-outline" size={18} color={colors.textTertiary} />
      </Pressable>
      <Pressable onPress={onDelete} hitSlop={10}>
        <Ionicons name="trash-outline" size={18} color={colors.textTertiary} />
      </Pressable>
    </Animated.View>
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
  sectionLabel: { fontFamily: 'Inter_700Bold', fontSize: 12, letterSpacing: 1, marginBottom: 10 },
  card: { flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 16, borderWidth: 1, padding: 14, marginBottom: 10 },
  rowAction: { marginRight: 14 },
  checkCircle: { padding: 2 },
  iconWrap: { width: 32, height: 32, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  cardTitle: { fontFamily: 'Inter_600SemiBold', fontSize: 14 },
  cardSub: { fontFamily: 'Inter_400Regular', fontSize: 11, marginTop: 2 },
});
