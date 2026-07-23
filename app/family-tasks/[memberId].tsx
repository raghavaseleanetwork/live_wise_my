import React, { useCallback, useState } from 'react';
import { StyleSheet, Text, View, ScrollView, Pressable, TextInput, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams, useFocusEffect } from 'expo-router';
import DateTimePicker from '@react-native-community/datetimepicker';
import Animated, { FadeInDown, FadeIn, FadeOut } from 'react-native-reanimated';

import { useTheme } from '@/lib/theme-context';
import {
  FamilyTask,
  loadFamilyTasks,
  addFamilyTask,
  toggleFamilyTask,
  deleteFamilyTask,
} from '@/lib/family-records';

export default function FamilyTasksScreen() {
  const router = useRouter();
  const { memberId, memberName } = useLocalSearchParams<{ memberId: string; memberName?: string }>();
  const insets = useSafeAreaInsets();
  const { colors, isDark } = useTheme();

  const [items, setItems] = useState<FamilyTask[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [showDatePicker, setShowDatePicker] = useState(false);

  const [title, setTitle] = useState('');
  const [hasDueDate, setHasDueDate] = useState(false);
  const [dueDate, setDueDate] = useState(new Date());
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!memberId) return;
    setItems(await loadFamilyTasks(String(memberId)));
  }, [memberId]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const resetForm = () => {
    setTitle('');
    setHasDueDate(false);
    setDueDate(new Date());
    setError('');
  };

  const handleAdd = async () => {
    if (!title.trim()) {
      setError('Please enter a task');
      return;
    }
    if (!memberId) return;
    await addFamilyTask(String(memberId), {
      title: title.trim(),
      dueDate: hasDueDate ? dueDate.toISOString() : null,
    });
    setShowAdd(false);
    resetForm();
    load();
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
          <Text style={[styles.headerTitle, { color: colors.text }]}>Reminder Tasks</Text>
          <Pressable onPress={() => setShowAdd(true)} style={styles.addBtn} hitSlop={12}>
            <Ionicons name="add-circle" size={30} color={colors.accent} />
          </Pressable>
        </View>
        {memberName ? <Text style={[styles.headerSubtitle, { color: colors.textSecondary }]}>For {memberName}</Text> : null}
      </LinearGradient>

      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: insets.bottom + 40 }} showsVerticalScrollIndicator={false}>
        {showAdd && (
          <Animated.View entering={FadeIn.duration(200)} exiting={FadeOut.duration(150)} style={styles.formSection}>
            <Text style={[styles.sectionHeading, { color: colors.text }]}>New Task</Text>
            {!!error && <Text style={[styles.errorText, { color: colors.danger }]}>{error}</Text>}

            <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>Task</Text>
            <TextInput
              style={[styles.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.inputBg }]}
              value={title}
              onChangeText={setTitle}
              placeholder="e.g. Take Papa for a walk"
              placeholderTextColor={colors.textTertiary}
            />

            <Pressable onPress={() => setHasDueDate(!hasDueDate)} style={styles.dueDateRow}>
              <Ionicons name={hasDueDate ? 'checkbox' : 'square-outline'} size={22} color={hasDueDate ? colors.accent : colors.textTertiary} />
              <Text style={[styles.dueDateText, { color: colors.text }]}>Set a due date</Text>
            </Pressable>

            {hasDueDate && (
              <Pressable onPress={() => setShowDatePicker(true)} style={[styles.input, { borderColor: colors.border, backgroundColor: colors.inputBg, justifyContent: 'center', marginTop: 10 }]}>
                <Text style={{ color: colors.text }}>{dueDate.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</Text>
              </Pressable>
            )}

            <Pressable onPress={handleAdd} style={[styles.primaryBtn, { backgroundColor: colors.accent }]}>
              <Text style={styles.primaryBtnLabel}>Add Task</Text>
            </Pressable>
            <Pressable onPress={() => { setShowAdd(false); resetForm(); }} style={styles.cancelBtn}>
              <Text style={[styles.cancelBtnLabel, { color: colors.textTertiary }]}>Cancel</Text>
            </Pressable>
          </Animated.View>
        )}

        {showAdd ? null : items.length === 0 ? (
          <View style={styles.emptyState}>
            <Ionicons name="list-outline" size={48} color={colors.textTertiary} />
            <Text style={[styles.emptyTitle, { color: colors.text }]}>No tasks yet</Text>
            <Text style={[styles.emptyDesc, { color: colors.textTertiary }]}>Tap + to add a daily task or custom reminder.</Text>
          </View>
        ) : (
          <>
            {pending.length > 0 && (
              <>
                <Text style={[styles.sectionLabel, { color: colors.textSecondary }]}>TO DO</Text>
                {pending.map((task) => (
                  <TaskRow key={task.id} task={task} colors={colors}
                    onToggle={async () => { await toggleFamilyTask(String(memberId), task.id); load(); }}
                    onDelete={async () => { await deleteFamilyTask(String(memberId), task.id); load(); }} />
                ))}
              </>
            )}
            {done.length > 0 && (
              <>
                <Text style={[styles.sectionLabel, { color: colors.textSecondary, marginTop: 20 }]}>DONE</Text>
                {done.map((task) => (
                  <TaskRow key={task.id} task={task} colors={colors}
                    onToggle={async () => { await toggleFamilyTask(String(memberId), task.id); load(); }}
                    onDelete={async () => { await deleteFamilyTask(String(memberId), task.id); load(); }} />
                ))}
              </>
            )}
          </>
        )}
      </ScrollView>


      {showDatePicker && (
        <DateTimePicker
          value={dueDate}
          mode="date"
          display={Platform.OS === 'ios' ? 'spinner' : 'default'}
          themeVariant={isDark ? 'dark' : 'light'}
          onChange={(event, date) => { setShowDatePicker(false); if (date) setDueDate(date); }}
        />
      )}
    </View>
  );
}

function TaskRow({
  task, colors, onToggle, onDelete,
}: { task: FamilyTask; colors: any; onToggle: () => void; onDelete: () => void }) {
  return (
    <Animated.View entering={FadeInDown.duration(300)} style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <Pressable onPress={onToggle} style={styles.checkCircle}>
        <Ionicons name={task.completed ? 'checkmark-circle' : 'ellipse-outline'} size={24} color={task.completed ? '#10B981' : colors.textTertiary} />
      </Pressable>
      <View style={{ flex: 1 }}>
        <Text style={[styles.cardTitle, { color: colors.text }, task.completed && { textDecorationLine: 'line-through', opacity: 0.5 }]}>{task.title}</Text>
        {!!task.dueDate && (
          <Text style={[styles.cardSub, { color: colors.textTertiary }]}>
            Due {new Date(task.dueDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
          </Text>
        )}
      </View>
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
  card: { flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: 18, borderWidth: 1, padding: 14, marginBottom: 10 },
  checkCircle: { padding: 2 },
  cardTitle: { fontFamily: 'Inter_600SemiBold', fontSize: 15 },
  cardSub: { fontFamily: 'Inter_400Regular', fontSize: 12, marginTop: 2 },
  formSection: { marginBottom: 28 },
  sectionHeading: { fontFamily: 'Inter_700Bold', fontSize: 20, marginBottom: 12 },
  primaryBtn: { borderRadius: 14, paddingVertical: 15, alignItems: 'center', marginTop: 22 },
  primaryBtnLabel: { fontFamily: 'Inter_700Bold', fontSize: 15, color: '#FFF' },
  cancelBtn: { paddingVertical: 12, alignItems: 'center', marginTop: 4 },
  cancelBtnLabel: { fontFamily: 'Inter_500Medium', fontSize: 14 },
  errorText: { fontFamily: 'Inter_500Medium', fontSize: 13, marginBottom: 10, textAlign: 'center' },
  fieldLabel: { fontFamily: 'Inter_600SemiBold', fontSize: 12, marginBottom: 6, marginTop: 10, textTransform: 'uppercase', letterSpacing: 0.5 },
  input: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontFamily: 'Inter_500Medium', fontSize: 14 },
  dueDateRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 16 },
  dueDateText: { fontFamily: 'Inter_500Medium', fontSize: 14 },
});
