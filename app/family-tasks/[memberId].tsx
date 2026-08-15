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
  FamilyTask,
  loadFamilyTasks,
  toggleFamilyTask,
  deleteFamilyTask,
} from '@/lib/family-records';

export default function FamilyTasksScreen() {
  const router = useRouter();
  const { memberId, memberName } = useLocalSearchParams<{ memberId: string; memberName?: string }>();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const { t } = useTranslation();

  const [items, setItems] = useState<FamilyTask[]>([]);

  const load = useCallback(async () => {
    if (!memberId) return;
    setItems(await loadFamilyTasks(String(memberId)));
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
    router.push({ pathname: '/family-tasks/add', params: { memberId: String(memberId), memberName: memberName ? String(memberName) : '' } });
  };

  const pending = items.filter((t) => !t.completed);
  const done = items.filter((t) => t.completed);
  const headerHeight = 110 + insets.top;

  return (
    <View style={[styles.container, { backgroundColor: colors.bg }]}>
      <LinearGradient colors={colors.heroGradient as any} style={[styles.header, { height: headerHeight, paddingTop: insets.top }]}>
        <View style={styles.headerTop}>
          <Pressable onPress={() => router.back()} style={styles.backBtn} hitSlop={12}>
            <Ionicons name="chevron-back" size={24} color={colors.text} />
          </Pressable>
          <Text style={[styles.headerTitle, { color: colors.text }]}>{t('familyTasks.headerTitle')}</Text>
          <Pressable onPress={openAdd} style={styles.addBtn} hitSlop={12}>
            <Ionicons name="add-circle" size={30} color={colors.accent} />
          </Pressable>
        </View>
        {memberName ? <Text style={[styles.headerSubtitle, { color: colors.textSecondary }]}>{t('familyTasks.forMember', { name: memberName })}</Text> : null}
      </LinearGradient>

      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: insets.bottom + 40 }} showsVerticalScrollIndicator={false}>
        {items.length === 0 ? (
          <View style={styles.emptyState}>
            <Ionicons name="list-outline" size={48} color={colors.textTertiary} />
            <Text style={[styles.emptyTitle, { color: colors.text }]}>{t('familyTasks.emptyTitle')}</Text>
            <Text style={[styles.emptyDesc, { color: colors.textTertiary }]}>{t('familyTasks.emptyDesc')}</Text>
          </View>
        ) : (
          <>
            {pending.length > 0 && (
              <>
                <Text style={[styles.sectionLabel, { color: colors.textSecondary }]}>{t('familyTasks.sectionToDo')}</Text>
                {pending.map((task) => (
                  <TaskRow key={task.id} task={task} colors={colors} t={t}
                    onToggle={async () => { await toggleFamilyTask(String(memberId), task.id); load(); }}
                    onEdit={() => router.push({ pathname: '/family-tasks/add', params: { memberId: String(memberId), memberName: memberName ? String(memberName) : '', editId: task.id } })}
                    onDelete={async () => { await deleteFamilyTask(String(memberId), task.id); load(); }} />
                ))}
              </>
            )}
            {done.length > 0 && (
              <>
                <Text style={[styles.sectionLabel, { color: colors.textSecondary, marginTop: 20 }]}>{t('familyTasks.sectionDone')}</Text>
                {done.map((task) => (
                  <TaskRow key={task.id} task={task} colors={colors} t={t}
                    onToggle={async () => { await toggleFamilyTask(String(memberId), task.id); load(); }}
                    onEdit={() => router.push({ pathname: '/family-tasks/add', params: { memberId: String(memberId), memberName: memberName ? String(memberName) : '', editId: task.id } })}
                    onDelete={async () => { await deleteFamilyTask(String(memberId), task.id); load(); }} />
                ))}
              </>
            )}
          </>
        )}
      </ScrollView>
    </View>
  );
}

function TaskRow({
  task, colors, onToggle, onEdit, onDelete, t,
}: { task: FamilyTask; colors: any; onToggle: () => void; onEdit: () => void; onDelete: () => void; t: (key: string, opts?: any) => string }) {
  return (
    <Animated.View entering={FadeInDown.duration(300)} style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <Pressable onPress={onToggle} style={styles.checkCircle}>
        <Ionicons name={task.completed ? 'checkmark-circle' : 'ellipse-outline'} size={24} color={task.completed ? '#10B981' : colors.textTertiary} />
      </Pressable>
      <View style={{ flex: 1 }}>
        <Text style={[styles.cardTitle, { color: colors.text }, task.completed && { textDecorationLine: 'line-through', opacity: 0.5 }]}>{task.title}</Text>
        {!!task.dueDate && (
          <Text style={[styles.cardSub, { color: colors.textTertiary }]}>
            {t('familyTasks.dueOn', { date: new Date(task.dueDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) })}
          </Text>
        )}
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
  card: { flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: 16, borderWidth: 1, padding: 14, marginBottom: 10 },
  rowAction: { marginRight: 14 },
  checkCircle: { padding: 2 },
  cardTitle: { fontFamily: 'Inter_600SemiBold', fontSize: 15 },
  cardSub: { fontFamily: 'Inter_400Regular', fontSize: 12, marginTop: 2 },
});
