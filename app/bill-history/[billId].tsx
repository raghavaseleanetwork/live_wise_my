import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  ActivityIndicator,
  RefreshControl,
  Dimensions,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { FadeInDown, Layout } from 'react-native-reanimated';
import { useExpenses } from '@/lib/expense-context';
import { useAuth } from '@/lib/auth-context';
import { getApiUrl } from '@/lib/query-client';
import { useCurrency } from '@/lib/currency-context';
import { useTheme } from '@/lib/theme-context';

const { width } = Dimensions.get('window');

interface HistoryItem {
  _id: string;
  billId: string;
  date: string;
  action: string;
  amount?: number;
  note?: string;
}

export default function BillHistoryScreen() {
  const { billId } = useLocalSearchParams<{ billId: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { bills } = useExpenses();
  const { formatAmount } = useCurrency();
  const { token } = useAuth();
  const { colors } = useTheme();
  const bill = bills.find(r => r.id === billId);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  async function fetchHistory() {
    if (!token) return;
    try {
      const baseUrl = getApiUrl();
      const res = await fetch(`${baseUrl}/api/bills/${billId}/history`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      if (res.ok) {
        const data = await res.json();
        setHistory(data);
      }
    } catch (err) {
      console.error('Fetch history error:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => {
    fetchHistory();
  }, [billId, token]);

  const onRefresh = React.useCallback(() => {
    setRefreshing(true);
    fetchHistory();
  }, [token]);

  if (loading && !refreshing) {
    return (
      <View style={[styles.center, { backgroundColor: colors.bg }]}>
        <ActivityIndicator size="large" color={colors.accent} />
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.bg, paddingTop: insets.top }]}>
      {/* Header */}
      <View style={[styles.header, { backgroundColor: colors.card, borderBottomColor: colors.border }]}>
        <Pressable onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={24} color={colors.text} />
        </Pressable>
        <View style={styles.headerTitleWrap}>
          <Text style={[styles.headerTitle, { color: colors.text }]}>Payment History</Text>
          <Text style={[styles.headerSubtitle, { color: colors.textSecondary }]}>{bill?.name || 'Bill Reminder'}</Text>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} />
        }
      >
        {history.length === 0 ? (
          <View style={styles.emptyState}>
            <View style={[styles.emptyIconWrap, { backgroundColor: colors.card }]}>
              <Ionicons name="time-outline" size={48} color={colors.textTertiary} />
            </View>
            <Text style={[styles.emptyTitle, { color: colors.text }]}>No History Yet</Text>
            <Text style={[styles.emptyDesc, { color: colors.textSecondary }]}>Actions like paying or snoozing this bill will appear here.</Text>
          </View>
        ) : (
          <View style={styles.timelineContainer}>
            {history.map((item, index) => (
              <Animated.View 
                key={item._id} 
                entering={FadeInDown.delay(index * 100).duration(400)}
                layout={Layout.springify()}
                style={styles.timelineItem}
              >
                {/* Connector Line */}
                {index !== history.length - 1 && <View style={[styles.connector, { backgroundColor: colors.border }]} />}

                {/* Icon Circle */}
                <View style={[styles.iconCircle, { backgroundColor: getActionColor(item.action).bg }]}>
                  <Ionicons 
                    name={getActionIcon(item.action)} 
                    size={18} 
                    color={getActionColor(item.action).text} 
                  />
                </View>

                {/* Content Card */}
                <View style={[styles.historyCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                  <View style={styles.cardHeader}>
                    <Text style={[styles.actionText, { color: getActionColor(item.action).text }]}>{item.action.toUpperCase()}</Text>
                    <Text style={[styles.dateText, { color: colors.textTertiary }]}>
                      {new Date(item.date).toLocaleDateString('en-IN', {
                        day: 'numeric',
                        month: 'short',
                        year: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit'
                      })}
                    </Text>
                  </View>

                  {item.note && (
                    <Text style={[styles.noteText, { color: colors.text }]}>{item.note}</Text>
                  )}

                  {item.amount && (
                    <Text style={[styles.amountText, { color: colors.accentMint }]}>{formatAmount(item.amount)}</Text>
                  )}
                </View>
              </Animated.View>
            ))}
          </View>
        )}
      </ScrollView>

      {/* Footer Info */}
      <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, 16) }]}>
        <View style={[styles.infoBox, { backgroundColor: colors.accentDim }]}>
          <Ionicons name="shield-checkmark" size={16} color={colors.accent} />
          <Text style={[styles.footerText, { color: colors.accent }]}>Secure Audit Trail - LifeWise Intelligence</Text>
        </View>
      </View>
    </View>
  );
}

function getActionIcon(action: string): any {
  switch (action) {
    case 'paid': return 'checkmark-circle';
    case 'snoozed': return 'notifications-off';
    case 'cancelled': return 'close-circle';
    case 'restored': return 'arrow-undo';
    default: return 'refresh-circle';
  }
}

function getActionColor(action: string) {
  switch (action) {
    case 'paid': return { bg: '#DCFCE7', text: '#10B981' };
    case 'snoozed': return { bg: '#F1F5F9', text: '#475569' };
    case 'cancelled': return { bg: '#FEE2E2', text: '#EF4444' };
    case 'restored': return { bg: '#E0F2FE', text: '#0EA5E9' };
    default: return { bg: '#F5F3FF', text: '#7C3AED' };
  }
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F8FAFC',
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  headerTitleWrap: {
    flex: 1,
  },
  headerTitle: {
    fontFamily: 'Inter_700Bold',
    fontSize: 18,
    color: '#1E293B',
  },
  headerSubtitle: {
    fontFamily: 'Inter_500Medium',
    fontSize: 13,
    color: '#64748B',
  },
  scrollContent: {
    padding: 20,
    paddingBottom: 100,
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 80,
  },
  emptyIconWrap: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
  },
  emptyTitle: {
    fontFamily: 'Inter_700Bold',
    fontSize: 20,
    color: '#1E293B',
    marginBottom: 8,
  },
  emptyDesc: {
    fontFamily: 'Inter_500Medium',
    fontSize: 14,
    color: '#64748B',
    textAlign: 'center',
    lineHeight: 22,
    paddingHorizontal: 40,
  },
  timelineContainer: {
    paddingLeft: 10,
  },
  timelineItem: {
    flexDirection: 'row',
    marginBottom: 24,
    minHeight: 80,
  },
  connector: {
    position: 'absolute',
    left: 17,
    top: 36,
    bottom: -24,
    width: 2,
    backgroundColor: '#E2E8F0',
  },
  iconCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1,
    backgroundColor: '#FFFFFF',
  },
  historyCard: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    marginLeft: 16,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: '#F1F5F9',
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  actionText: {
    fontFamily: 'Inter_800ExtraBold',
    fontSize: 11,
    letterSpacing: 0.5,
  },
  dateText: {
    fontFamily: 'Inter_500Medium',
    fontSize: 11,
    color: '#94A3B8',
  },
  noteText: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 14,
    color: '#1E293B',
    lineHeight: 20,
  },
  amountText: {
    fontFamily: 'Inter_700Bold',
    fontSize: 16,
    color: '#10B981',
    marginTop: 8,
  },
  footer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    padding: 16,
    alignItems: 'center',
  },
  infoBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#EEF2FF',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
  },
  footerText: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 12,
    color: '#4F46E5',
  },
});
