import React, { useEffect, useState } from 'react';
import { StyleSheet, View, Text, FlatList, Pressable, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { useTheme } from '@/lib/theme-context';
import { useAuth } from '@/lib/auth-context';
import { apiRequest } from '@/lib/query-client';
import { useFamilyReminders } from '@/lib/use-family-reminders';
import { familyReminderLabel, type FamilyReminder } from '@/lib/family-reminders';

type NotificationItem = {
  id: string;
  type: string;
  title: string;
  body: string;
  read: boolean;
  createdAt: string;
  meta?: Record<string, unknown>;
};

/**
 * Marks a row as coming from Family Hub so the list can badge it.
 *
 * Carried on `meta` rather than overloading `type`, because `type` drives the
 * server's own semantics ('reminder' vs anything else) and a server-sent family
 * row will eventually arrive as `type: 'reminder'` too. A dedicated flag lets
 * both the locally derived rows and future server rows be labelled the same way
 * without either side reinterpreting `type`.
 */
const FAMILY_SOURCE = 'family-hub';

/** True for rows that should show the "Family Hub" chip. */
function isFamilyRow(item: NotificationItem): boolean {
  const meta = item.meta as Record<string, unknown> | undefined;
  return meta?.source === FAMILY_SOURCE;
}

/**
 * How far ahead a family reminder shows up in this list.
 *
 * The Reminders tab lists everything scheduled; a notification list is about
 * what needs attention *now*, so anything further out than this is noise.
 */
const FAMILY_LOOKAHEAD_DAYS = 7;

/** Whole days from today to `date`, ignoring clock time. Negative = overdue. */
function daysUntil(date: Date): number {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date(date);
  end.setHours(0, 0, 0, 0);
  return Math.round((end.getTime() - start.getTime()) / 86400000);
}

/**
 * Projects a Family Hub reminder into a notification row.
 *
 * These are **derived**, not stored: Family Hub records live on-device
 * (AsyncStorage) while `/api/notifications` only knows about server-side bills
 * and medicines, so the bell would otherwise never mention family items at all.
 * See `backend-team/FAMILY-HUB-NOTIFICATIONS-backend-requirements.md` — once the
 * server owns these, this projection is deleted and the rows arrive as real
 * notifications.
 */
function familyReminderToNotification(reminder: FamilyReminder, t: TFunction): NotificationItem | null {
  const due = new Date(reminder.dueDate);
  if (Number.isNaN(due.getTime())) return null;

  const days = daysUntil(due);
  if (days > FAMILY_LOOKAHEAD_DAYS) return null;

  const kindLabel = familyReminderLabel(reminder.sourceKind);
  const when =
    days < 0
      ? t('notifications.overdueBy', { count: Math.abs(days) })
      : days === 0
        ? t('notifications.dueToday')
        : days === 1
          ? t('notifications.dueTomorrow')
          : t('notifications.dueInDays', { count: days });

  const amount = reminder.amount > 0 ? `₹${reminder.amount.toLocaleString('en-IN')} · ` : '';

  return {
    id: reminder.id,
    type: 'reminder',
    title: `${reminder.memberName} · ${reminder.name}`,
    body: `${amount}${kindLabel} ${when}.`,
    // Derived rows have no read state to persist — marking one read server-side
    // would 404, so they always render as unread and are excluded from the
    // mark-read calls below.
    read: false,
    createdAt: due.toISOString(),
    meta: {
      source: FAMILY_SOURCE,
      route: `/family-reminder/${encodeURIComponent(reminder.id)}`,
    },
  };
}

function formatTimeAgo(dateString: string, t: TFunction) {
  const date = new Date(dateString);
  const diffMs = Date.now() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return t('notifications.justNow');
  if (diffMin < 60) return t('notifications.minAgo', { count: diffMin });
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return t('notifications.hrAgo', { count: diffHr });
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay === 1) return t('notifications.yesterday');
  return t('notifications.daysAgo', { count: diffDay });
}

export default function NotificationsScreen() {
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
  const { colors } = useTheme();
  const { token } = useAuth();

  const [items, setItems] = useState<NotificationItem[]>([]);
  const [loading, setLoading] = useState(true);
  const { familyReminders } = useFamilyReminders();

  const topInset = Platform.OS === 'web' ? 67 : insets.top;

  // Server notifications plus the Family Hub rows the server cannot see yet,
  // newest/soonest first. Family rows are derived on every render rather than
  // stored, so they stay in step with edits made in Family Hub.
  const visibleItems = React.useMemo(() => {
    const familyItems = familyReminders
      .map((r) => familyReminderToNotification(r, t))
      .filter((n): n is NotificationItem => n !== null);

    return [...items, ...familyItems].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
  }, [items, familyReminders, t]);

  // Only server rows have a persisted read state; family rows are projections.
  const hasUnreadServerItems = items.some((n) => !n.read);

  useEffect(() => {
    const run = async () => {
      try {
        const res = await apiRequest('GET', '/api/notifications', undefined, token);
        const json = (await res.json()) as NotificationItem[];
        setItems(json);
        const unreadIds = json.filter(n => !n.read).map(n => n.id);
        if (unreadIds.length) {
          await apiRequest('POST', '/api/notifications/mark-read', { ids: unreadIds }, token);
        }
      } catch {
        // ignore, keep empty list
      } finally {
        setLoading(false);
      }
    };
    run();
  }, [token]);

  return (
    <View style={[styles.container, { backgroundColor: colors.bg, paddingTop: topInset + 16 }]}>
      <View style={styles.headerRow}>
        <Pressable onPress={() => (router.canGoBack() ? router.back() : router.replace('/(tabs)'))} hitSlop={10}>
          <Ionicons name="arrow-back" size={24} color={colors.text} />
        </Pressable>
        <Text style={[styles.screenTitle, { color: colors.text }]}>{t('notifications.title')}</Text>
        <Pressable
          onPress={async () => {
            if (hasUnreadServerItems) {
              await apiRequest('POST', '/api/notifications/mark-read-all', {}, token);
              setItems(items.map(n => ({ ...n, read: true })));
            }
          }}
          disabled={!hasUnreadServerItems}
          style={({ pressed }) => [{ opacity: pressed || !hasUnreadServerItems ? 0.6 : 1 }]}
        >
          <Text style={[styles.markAllText, { color: colors.accent }]}>{t('notifications.markAllRead')}</Text>
        </Pressable>
      </View>

      {loading ? (
        <Text style={[styles.emptyText, { color: colors.textSecondary }]}>{t('notifications.loading')}</Text>
      ) : visibleItems.length === 0 ? (
        <Text style={[styles.emptyText, { color: colors.textSecondary }]}>{t('notifications.empty')}</Text>
      ) : (
        <FlatList
          data={visibleItems}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 24 }}
          renderItem={({ item }) => {
            const family = isFamilyRow(item);
            return (
            <Pressable
              onPress={() => {
                const meta = item.meta;
                const redirectUrl = meta?.redirectUrl || meta?.route;
                
                if (redirectUrl) {
                  router.push(redirectUrl as any);
                  return;
                }

                // Retroactive / Root Fix Logic: Infer route if missing
                if (meta?.type === 'bill' && meta?.referenceId) {
                  router.push(`/bill-details/${meta.referenceId}` as any);
                } else if (meta?.type === 'medication' && meta?.memberId && meta?.medId) {
                  router.push(`/medicine-details/${meta.memberId}/${meta.medId}` as any);
                } else if (meta?.billId) {
                  // Fallback for very old notifications
                  router.push(`/bill-details/${meta.billId}` as any);
                } else {
                  // Total fallback to detail page
                  router.push({
                    pathname: `/notification-details/${item.id}`,
                    params: { title: item.title, body: item.body }
                  } as any);
                }
              }}
              style={({ pressed }) => [
                styles.item,
                {
                  backgroundColor: colors.card,
                  borderColor: item.read ? colors.border : colors.accentDim,
                  opacity: pressed ? 0.85 : 1,
                },
              ]}
            >
              <View
                style={[
                  styles.itemIcon,
                  { backgroundColor: item.read ? colors.accentDim : colors.accent },
                ]}
              >
                <Ionicons
                  name={
                    family
                      ? 'people'
                      : item.type === 'reminder'
                        ? 'notifications'
                        : 'information-circle'
                  }
                  size={18}
                  color={item.read ? colors.accent : '#FFFFFF'}
                />
              </View>
              <View style={styles.itemContent}>
                {/* Family Hub items are merged into this one list so there is a
                    single place to look for notifications. The chip is what
                    keeps them distinguishable after that merge. */}
                {family && (
                  <View style={[styles.sourceChip, { backgroundColor: colors.accentDim }]}>
                    <Text style={[styles.sourceChipText, { color: colors.accent }]}>
                      {t('notifications.familyHub')}
                    </Text>
                  </View>
                )}
                <Text
                  style={[
                    styles.itemTitle,
                    { color: colors.text },
                    !item.read && { fontFamily: 'Inter_700Bold' },
                  ]}
                  numberOfLines={1}
                >
                  {item.title}
                </Text>
                <Text
                  style={[styles.itemBody, { color: colors.textSecondary }]}
                  numberOfLines={2}
                >
                  {item.body}
                </Text>
                <Text style={[styles.itemTime, { color: colors.textTertiary }]}>
                  {formatTimeAgo(item.createdAt, t)}
                </Text>
              </View>
              <Pressable
                onPress={async () => {
                  try {
                    await apiRequest('DELETE', `/api/notifications/${item.id}`, undefined, token);
                    setItems(items.filter((n) => n.id !== item.id));
                  } catch (err) {
                    console.error('Delete notification UI error:', err);
                  }
                }}
                style={({ pressed }) => [styles.deleteBtn, { opacity: pressed ? 0.6 : 1 }]}
              >
                <Ionicons name="trash-outline" size={18} color={colors.textTertiary} />
              </Pressable>
            </Pressable>
            );
          }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    marginBottom: 16,
  },
  screenTitle: {
    fontFamily: 'Inter_700Bold',
    fontSize: 20,
  },
  emptyText: {
    paddingHorizontal: 20,
    marginTop: 40,
    fontFamily: 'Inter_400Regular',
    fontSize: 14,
    textAlign: 'center',
  },
  item: {
    flexDirection: 'row',
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    marginBottom: 12,
    gap: 12,
  },
  itemIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  itemContent: {
    flex: 1,
    gap: 2,
  },
  itemTitle: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 14,
  },
  sourceChip: {
    alignSelf: 'flex-start',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 8,
    marginBottom: 2,
  },
  sourceChipText: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 10,
    letterSpacing: 0.3,
  },
  itemBody: {
    fontFamily: 'Inter_400Regular',
    fontSize: 13,
  },
  itemTime: {
    fontFamily: 'Inter_400Regular',
    fontSize: 11,
    marginTop: 4,
  },
  markAllText: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 13,
  },
  deleteBtn: {
    padding: 8,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
  },
});

