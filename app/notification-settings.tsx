import React, { useState } from 'react';
import { StyleSheet, Text, View, ScrollView, Pressable, Platform, Switch } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import DateTimePicker from '@react-native-community/datetimepicker';
import { useTranslation } from 'react-i18next';

import { useTheme } from '@/lib/theme-context';
import { useExpenses } from '@/lib/expense-context';
import { ReminderSettings } from '@/lib/data';

function formatHour(hour: number): string {
  const h = ((hour % 12) + 12) % 12 || 12;
  const suffix = hour >= 12 && hour < 24 ? 'PM' : 'AM';
  return `${h}:00 ${suffix}`;
}

function Row({
  icon,
  label,
  description,
  rightElement,
  colors,
}: {
  icon: string;
  label: string;
  description?: string;
  rightElement: React.ReactNode;
  colors: any;
}) {
  return (
    <View style={[styles.row, { borderBottomColor: colors.border }]}>
      <View style={styles.rowLeft}>
        <View style={[styles.rowIcon, { backgroundColor: colors.accentDim }]}>
          <Ionicons name={icon as any} size={18} color={colors.accent} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[styles.rowLabel, { color: colors.text }]}>{label}</Text>
          {description ? (
            <Text style={[styles.rowDesc, { color: colors.textTertiary }]}>{description}</Text>
          ) : null}
        </View>
      </View>
      {rightElement}
    </View>
  );
}

export default function NotificationSettingsScreen() {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const { t } = useTranslation();
  const { reminderSettings, updateReminderSettings } = useExpenses();
  const [pickingEdge, setPickingEdge] = useState<'start' | 'end' | null>(null);

  const topInset = Platform.OS === 'web' ? 67 : insets.top;

  const patch = (partial: Partial<ReminderSettings>) => {
    updateReminderSettings({ ...reminderSettings, ...partial });
  };

  const onTimeChange = (_event: any, selectedDate?: Date) => {
    if (Platform.OS === 'android') setPickingEdge(null);
    if (!selectedDate || !pickingEdge) return;
    const hour = selectedDate.getHours();
    if (pickingEdge === 'start') patch({ quietHoursStart: hour });
    else patch({ quietHoursEnd: hour });
  };

  const pickerBaseDate = React.useMemo(() => {
    const d = new Date();
    d.setMinutes(0, 0, 0);
    d.setHours(pickingEdge === 'end' ? reminderSettings.quietHoursEnd : reminderSettings.quietHoursStart);
    return d;
  }, [pickingEdge, reminderSettings.quietHoursStart, reminderSettings.quietHoursEnd]);

  return (
    <View style={[styles.container, { backgroundColor: colors.bg }]}>
      <View style={[styles.header, { paddingTop: topInset + 12 }]}>
        <Pressable onPress={() => router.back()} hitSlop={12} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={24} color={colors.text} />
        </Pressable>
        <Text style={[styles.headerTitle, { color: colors.text }]}>{t('notificationSettings.title')}</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: insets.bottom + 40 }} showsVerticalScrollIndicator={false}>
        <View style={[styles.group, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Row
            icon="notifications"
            label={t('notificationSettings.masterToggle')}
            description={t('notificationSettings.masterToggleDesc')}
            colors={colors}
            rightElement={
              <Switch
                value={reminderSettings.notificationsEnabled}
                onValueChange={(val) => patch({ notificationsEnabled: val })}
                trackColor={{ false: colors.inputBorder, true: colors.accent + '50' }}
                thumbColor={reminderSettings.notificationsEnabled ? colors.accent : '#ccc'}
              />
            }
          />
        </View>

        <Text style={[styles.sectionLabel, { color: colors.textSecondary }]}>{t('notificationSettings.quietHoursSection')}</Text>
        <View style={[styles.group, { backgroundColor: colors.card, borderColor: colors.border }, !reminderSettings.notificationsEnabled && { opacity: 0.5 }]}>
          <Row
            icon="moon"
            label={t('notificationSettings.quietHours')}
            description={t('notificationSettings.quietHoursDesc')}
            colors={colors}
            rightElement={
              <Switch
                disabled={!reminderSettings.notificationsEnabled}
                value={reminderSettings.quietHoursEnabled}
                onValueChange={(val) => patch({ quietHoursEnabled: val })}
                trackColor={{ false: colors.inputBorder, true: colors.accent + '50' }}
                thumbColor={reminderSettings.quietHoursEnabled ? colors.accent : '#ccc'}
              />
            }
          />
          {reminderSettings.quietHoursEnabled && (
            <View style={styles.quietHoursRange}>
              <Pressable
                disabled={!reminderSettings.notificationsEnabled}
                onPress={() => setPickingEdge('start')}
                style={[styles.timeChip, { backgroundColor: colors.inputBg, borderColor: colors.border }]}
              >
                <Text style={[styles.timeChipLabel, { color: colors.textTertiary }]}>{t('notificationSettings.from')}</Text>
                <Text style={[styles.timeChipValue, { color: colors.text }]}>{formatHour(reminderSettings.quietHoursStart)}</Text>
              </Pressable>
              <Ionicons name="arrow-forward" size={16} color={colors.textTertiary} />
              <Pressable
                disabled={!reminderSettings.notificationsEnabled}
                onPress={() => setPickingEdge('end')}
                style={[styles.timeChip, { backgroundColor: colors.inputBg, borderColor: colors.border }]}
              >
                <Text style={[styles.timeChipLabel, { color: colors.textTertiary }]}>{t('notificationSettings.to')}</Text>
                <Text style={[styles.timeChipValue, { color: colors.text }]}>{formatHour(reminderSettings.quietHoursEnd)}</Text>
              </Pressable>
            </View>
          )}
        </View>
        {reminderSettings.quietHoursEnabled && (
          <Text style={[styles.hint, { color: colors.textTertiary }]}>{t('notificationSettings.quietHoursRecurringHint')}</Text>
        )}

        <Text style={[styles.sectionLabel, { color: colors.textSecondary }]}>{t('notificationSettings.soundSection')}</Text>
        <View style={[styles.group, { backgroundColor: colors.card, borderColor: colors.border }, !reminderSettings.notificationsEnabled && { opacity: 0.5 }]}>
          <Row
            icon="volume-high"
            label={t('notificationSettings.sound')}
            description={t('notificationSettings.soundDesc')}
            colors={colors}
            rightElement={
              <Switch
                disabled={!reminderSettings.notificationsEnabled}
                value={reminderSettings.soundEnabled}
                onValueChange={(val) => patch({ soundEnabled: val })}
                trackColor={{ false: colors.inputBorder, true: colors.accent + '50' }}
                thumbColor={reminderSettings.soundEnabled ? colors.accent : '#ccc'}
              />
            }
          />
          <Row
            icon="phone-portrait"
            label={t('notificationSettings.vibration')}
            colors={colors}
            rightElement={
              <Switch
                disabled={!reminderSettings.notificationsEnabled}
                value={reminderSettings.vibrationEnabled}
                onValueChange={(val) => patch({ vibrationEnabled: val })}
                trackColor={{ false: colors.inputBorder, true: colors.accent + '50' }}
                thumbColor={reminderSettings.vibrationEnabled ? colors.accent : '#ccc'}
              />
            }
          />
        </View>
      </ScrollView>

      {pickingEdge && (
        <DateTimePicker
          value={pickerBaseDate}
          mode="time"
          display={Platform.OS === 'ios' ? 'spinner' : 'default'}
          onChange={onTimeChange}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingBottom: 16,
  },
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontFamily: 'Inter_700Bold', fontSize: 18 },
  sectionLabel: {
    fontFamily: 'Inter_600SemiBold', fontSize: 12, letterSpacing: 0.5,
    marginTop: 20, marginBottom: 8, paddingHorizontal: 4,
  },
  group: { borderRadius: 16, borderWidth: 1, overflow: 'hidden' },
  row: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    padding: 16, borderBottomWidth: 1,
  },
  rowLeft: { flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1, marginRight: 12 },
  rowIcon: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  rowLabel: { fontFamily: 'Inter_600SemiBold', fontSize: 15 },
  rowDesc: { fontFamily: 'Inter_400Regular', fontSize: 12, marginTop: 2, lineHeight: 16 },
  quietHoursRange: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 12,
    paddingHorizontal: 16, paddingVertical: 16,
  },
  timeChip: { flex: 1, borderRadius: 12, borderWidth: 1, paddingVertical: 10, paddingHorizontal: 14, alignItems: 'center' },
  timeChipLabel: { fontFamily: 'Inter_500Medium', fontSize: 11, marginBottom: 2 },
  timeChipValue: { fontFamily: 'Inter_700Bold', fontSize: 15 },
  hint: {
    fontFamily: 'Inter_400Regular', fontSize: 12, lineHeight: 17,
    marginTop: 10, paddingHorizontal: 4,
  },
});
