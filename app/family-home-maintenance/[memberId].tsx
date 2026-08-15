import React, { useCallback, useEffect, useState } from 'react';
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
  HomeMaintenanceItem,
  HOME_TASK_TYPE_LABELS,
  loadHomeMaintenanceItems,
  deleteHomeMaintenanceItem,
} from '@/lib/family-records';

export default function FamilyHomeMaintenanceScreen() {
  const router = useRouter();
  const { memberId, memberName } = useLocalSearchParams<{ memberId: string; memberName?: string }>();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const { t } = useTranslation();

  const [items, setItems] = useState<HomeMaintenanceItem[]>([]);

  const load = useCallback(async () => {
    if (!memberId) return;
    setItems(await loadHomeMaintenanceItems(String(memberId)));
  }, [memberId]);

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
    router.push({ pathname: '/family-home-maintenance/add', params: { memberId: String(memberId), memberName: memberName ? String(memberName) : '' } });
  };

  const headerHeight = 110 + insets.top;

  return (
    <View style={[styles.container, { backgroundColor: colors.bg }]}>
      <LinearGradient colors={colors.heroGradient as any} style={[styles.header, { height: headerHeight, paddingTop: insets.top }]}>
        <View style={styles.headerTop}>
          <Pressable onPress={() => router.back()} style={styles.backBtn} hitSlop={12}>
            <Ionicons name="chevron-back" size={24} color={colors.text} />
          </Pressable>
          <Text style={[styles.headerTitle, { color: colors.text }]}>{t('familyHomeMaintenance.headerTitle')}</Text>
          <Pressable onPress={openAdd} style={styles.addBtn} hitSlop={12}>
            <Ionicons name="add-circle" size={30} color={colors.accent} />
          </Pressable>
        </View>
        {memberName ? <Text style={[styles.headerSubtitle, { color: colors.textSecondary }]}>{t('familyHomeMaintenance.forMember', { name: memberName })}</Text> : null}
      </LinearGradient>

      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: insets.bottom + 40 }} showsVerticalScrollIndicator={false}>
        {items.length === 0 ? (
          <View style={styles.emptyState}>
            <Ionicons name="home-outline" size={48} color={colors.textTertiary} />
            <Text style={[styles.emptyTitle, { color: colors.text }]}>{t('familyHomeMaintenance.emptyTitle')}</Text>
            <Text style={[styles.emptyDesc, { color: colors.textTertiary }]}>{t('familyHomeMaintenance.emptyDesc')}</Text>
          </View>
        ) : (
          items.map((item) => (
            <TaskCard
              key={item.id}
              item={item}
              colors={colors}
              t={t}
              onEdit={() => router.push({ pathname: '/family-home-maintenance/add', params: { memberId: String(memberId), memberName: memberName ? String(memberName) : '', editId: item.id } })}
              onDelete={async () => { await deleteHomeMaintenanceItem(String(memberId), item.id); load(); }}
            />
          ))
        )}
      </ScrollView>
    </View>
  );
}

function TaskCard({
  item, colors, onEdit, onDelete, t,
}: { item: HomeMaintenanceItem; colors: any; onEdit: () => void; onDelete: () => void; t: (key: string, opts?: any) => string }) {
  const def = HOME_TASK_TYPE_LABELS[item.taskType];
  const dueDays = item.nextDueDate ? Math.ceil((new Date(item.nextDueDate).getTime() - Date.now()) / 86400000) : null;
  const isWarning = dueDays !== null && dueDays <= 7;

  return (
    <Animated.View entering={FadeInDown.duration(300)} style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <View style={styles.cardTop}>
        <View style={[styles.iconWrap, { backgroundColor: colors.accentDim }]}>
          <Ionicons name={def.icon as any} size={16} color={colors.accent} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[styles.cardTitle, { color: colors.text }]} numberOfLines={1}>{item.taskName}</Text>
          <Text style={[styles.cardSub, { color: colors.textTertiary }]}>
            {t(`familyHomeMaintenance.type.${item.taskType}`)}
            {item.vendorName ? ` · ${item.vendorName}` : ''}
          </Text>
        </View>
        <Pressable onPress={onEdit} hitSlop={10} style={styles.rowAction}>
          <Ionicons name="create-outline" size={18} color={colors.textTertiary} />
        </Pressable>
        <Pressable onPress={onDelete} hitSlop={10}>
          <Ionicons name="trash-outline" size={18} color={colors.textTertiary} />
        </Pressable>
      </View>
      {item.nextDueDate && (
        <View style={[styles.detailsBox, isWarning && { backgroundColor: colors.warningDim }]}>
          <Text style={[styles.detailText, { color: isWarning ? colors.warning : colors.textSecondary }]}>
            {t('familyHomeMaintenance.nextDue', { date: new Date(item.nextDueDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) })}
          </Text>
          {item.hasAmc && item.amcExpiryDate && (
            <Text style={[styles.detailText, { color: colors.textSecondary }]}>
              {t('familyHomeMaintenance.amcExpires', { date: new Date(item.amcExpiryDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) })}
            </Text>
          )}
        </View>
      )}
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
  card: { borderRadius: 16, borderWidth: 1, padding: 14, marginBottom: 10, gap: 10 },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  rowAction: { marginRight: 14 },
  iconWrap: { width: 32, height: 32, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  cardTitle: { fontFamily: 'Inter_600SemiBold', fontSize: 14 },
  cardSub: { fontFamily: 'Inter_400Regular', fontSize: 11, marginTop: 2 },
  detailsBox: { borderRadius: 10, padding: 10, gap: 4 },
  detailText: { fontFamily: 'Inter_500Medium', fontSize: 12 },
});
