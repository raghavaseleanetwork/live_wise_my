import React, { useState, useCallback, useEffect } from 'react';
import {
  StyleSheet,
  Text,
  View,
  ScrollView,
  Pressable,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams, useFocusEffect } from 'expo-router';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { useTheme } from '@/lib/theme-context';
import { useAuth } from '@/lib/auth-context';
import { apiRequest } from '@/lib/query-client';
import { Avatar } from '../../components/Avatar';
import {
  FAMILY_FEATURE_MAP,
  FamilyFeatureKey,
  normalizeFeatures,
  loadMemberFeatures,
} from '@/lib/family-features';
import { loadSharedMembers } from '@/lib/family-caregivers';
import { onCaregiverSync } from '@/lib/caregiver-sync';
import {
  loadAppointments,
  loadHealthLogs,
  loadStock,
  loadRoutines,
  isLowStock,
  loadFamilyBills,
  loadSubscriptions,
  loadFamilyExpenses,
  loadFamilyTasks,
  loadFamilyDocuments,
  totalThisMonth,
  loadCheckins,
  loadTravelItems,
  loadEmergencyLog,
  loadCustomItems,
  loadCustomConfig,
} from '@/lib/family-records';
import { useCurrency } from '@/lib/currency-context';

const RELATIONSHIPS = [
  { key: 'self', label: 'Self', icon: 'person' },
  { key: 'papa', label: 'Papa', icon: 'man' },
  { key: 'mummy', label: 'Mummy', icon: 'woman' },
  { key: 'partner', label: 'Partner', icon: 'heart' },
  { key: 'child', label: 'Child', icon: 'happy' },
  { key: 'other', label: 'Other', icon: 'people' },
];

type MedAppearance = 'capsule' | 'tablet' | 'round' | 'liquid';
type MedInstruction = 'before_meal' | 'after_meal' | 'any';
type MedScheduleType = 'continuous' | 'custom';

interface MedicineSlots {
  morning?: string | null;
  noon?: string | null;
  evening?: string | null;
}

interface Medicine {
  id: string;
  name: string;
  dosage?: string;
  appearance?: MedAppearance;
  color?: string;
  instruction?: MedInstruction;
  slots?: MedicineSlots;
  scheduleType?: MedScheduleType;
  startDate?: string;
  endDate?: string | null;
  taken?: boolean;
  snoozed?: boolean;
}

interface FamilyMember {
  id: string;
  name: string;
  relationship: string;
  avatarUrl?: string | null;
  dateOfBirth?: string;
  features?: unknown;
  featureKeys: FamilyFeatureKey[];
  medicines: Medicine[];
  summaries: {
    appointments: { upcoming: number };
    health: { total: number };
    stock: { lowCount: number; total: number };
    routine: { total: number };
    bills: { unpaid: number };
    subscriptions: { total: number; monthlyTotal: number };
    expenses: { monthTotal: number };
    tasks: { pending: number };
    insurance: { total: number };
    checkin: { total: number };
    travel: { upcoming: number };
    emergency: { unacknowledged: number };
    custom: { name: string | null; total: number };
  };
  isSharedWithMe?: boolean;
}

export default function FamilyMemberDetailScreen() {
  const router = useRouter();
  const { memberId } = useLocalSearchParams<{ memberId: string; memberName?: string }>();
  const insets = useSafeAreaInsets();
  const { colors, isDark } = useTheme();
  const { token } = useAuth();
  const { formatAmount } = useCurrency();
  const [member, setMember] = useState<FamilyMember | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const loadMember = useCallback(async () => {
    if (!token || !memberId) return;
    try {
      const [res, shared] = await Promise.all([
        apiRequest('GET', '/api/family', undefined, token),
        loadSharedMembers(token).catch(() => []),
      ]);
      const owned = (await res.json()) as any[];
      const m =
        owned.find((x) => String(x.id) === String(memberId)) ||
        shared.find((x) => String(x.id) === String(memberId));
      if (!m) {
        setMember(null);
        setIsLoading(false);
        return;
      }
      const isShared = !owned.some((o) => String(o.id) === String(m.id));

      const id = String(m.id);
      const local = await loadMemberFeatures(id);
      const featureKeys = local && local.length ? local : normalizeFeatures(m.features);

      const [appts, healthLogs, stockItems, routines, bills, subs, expenses, tasks, documents, checkins, travelItems, emergencyLog, customItems, customConfig] = await Promise.all([
        loadAppointments(id),
        loadHealthLogs(id),
        loadStock(id),
        loadRoutines(id),
        loadFamilyBills(id),
        loadSubscriptions(id),
        loadFamilyExpenses(id),
        loadFamilyTasks(id),
        loadFamilyDocuments(id),
        loadCheckins(id),
        loadTravelItems(id),
        loadEmergencyLog(id),
        loadCustomItems(id),
        loadCustomConfig(id),
      ]);

      setMember({
        ...m,
        featureKeys,
        medicines: Array.isArray(m.medicines) ? m.medicines : [],
        isSharedWithMe: isShared,
        summaries: {
          appointments: { upcoming: appts.filter((a) => !a.completed).length },
          health: { total: healthLogs.length },
          stock: { lowCount: stockItems.filter(isLowStock).length, total: stockItems.length },
          routine: { total: routines.filter((r) => r.enabled).length },
          bills: { unpaid: bills.filter((b) => !b.isPaid).length },
          subscriptions: {
            total: subs.length,
            monthlyTotal: Math.round(subs.reduce((s, sub) => s + (sub.cycle === 'monthly' ? sub.amount : sub.amount / 12), 0)),
          },
          expenses: { monthTotal: totalThisMonth(expenses) },
          tasks: { pending: tasks.filter((t) => !t.completed).length },
          insurance: { total: documents.length },
          checkin: { total: checkins.filter((c) => c.enabled).length },
          travel: { upcoming: travelItems.filter((t) => !t.completed).length },
          emergency: { unacknowledged: emergencyLog.filter((e) => !e.acknowledged).length },
          custom: { name: customConfig?.name || null, total: customItems.length },
        },
      } as FamilyMember);
    } catch (e) {
      console.error('Load family member detail error:', e);
    } finally {
      setIsLoading(false);
    }
  }, [token, memberId]);

  useFocusEffect(
    useCallback(() => {
      loadMember();
    }, [loadMember])
  );

  useEffect(() => {
    const sub = onCaregiverSync((syncedMemberId) => {
      if (memberId && syncedMemberId === String(memberId)) loadMember();
    });
    return () => sub.remove();
  }, [memberId, loadMember]);

  const markMedicine = (medId: string, action: 'taken' | 'snooze' | 'skip') => {
    if (!token || !member) return;
    (async () => {
      try {
        const res = await apiRequest(
          'PATCH',
          `/api/family/${member.id}/medicines/${medId}`,
          { action },
          token,
        );
        const updatedMember = (await res.json()) as FamilyMember;
        setMember((prev) => (prev ? { ...prev, medicines: updatedMember.medicines } : prev));
      } catch (e) {
        console.error('Update medicine status error:', e);
      }
    })();
  };

  const headerHeight = 110 + insets.top;

  if (isLoading) {
    return (
      <View style={[styles.container, { backgroundColor: colors.bg, justifyContent: 'center', alignItems: 'center' }]}>
        <ActivityIndicator size="large" color={colors.accent} />
      </View>
    );
  }

  if (!member) {
    return (
      <View style={[styles.container, { backgroundColor: colors.bg, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 40 }]}>
        <Text style={[styles.emptyTitle, { color: colors.text }]}>Member not found</Text>
        <Pressable onPress={() => router.back()} style={{ marginTop: 16 }}>
          <Text style={{ color: colors.accent, fontFamily: 'Inter_600SemiBold' }}>Go back</Text>
        </Pressable>
      </View>
    );
  }

  const activeMedCount = member.medicines.filter((m) => !m.taken).length;
  const medicinesTitle = member.medicines.length === 0
    ? 'Medicines'
    : `Medicines (${activeMedCount} active)`;

  return (
    <View style={[styles.container, { backgroundColor: colors.bg }]}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: insets.bottom + 100 }}
      >
        <LinearGradient
          colors={colors.heroGradient as any}
          style={[styles.header, { height: headerHeight, paddingTop: insets.top }]}
        >
          <View style={styles.headerTop}>
            <Pressable onPress={() => router.back()} style={styles.backBtn}>
              <Ionicons name="chevron-back" size={24} color={colors.text} />
            </Pressable>
            <View style={styles.headerMemberInfo}>
              <Avatar name={member.name} uri={member.avatarUrl} size={40} />
              <View>
                <Text style={[styles.headerTitle, { color: colors.text }]}>{member.name}</Text>
                <Text style={[styles.headerRel, { color: colors.textSecondary }]}>
                  {RELATIONSHIPS.find((r) => r.key === member.relationship)?.label || member.relationship}
                </Text>
              </View>
            </View>
            <View style={{ width: 44 }} />
          </View>
        </LinearGradient>

        <View style={styles.content}>
          <View style={styles.featuresDashboard}>
            {member.featureKeys.length === 0 && (
              <View style={[styles.noMedsBox, { backgroundColor: isDark ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.02)' }]}>
                <Text style={[styles.noItemsText, { color: colors.textTertiary }]}>
                  No features selected. Tap edit to choose what to manage.
                </Text>
              </View>
            )}

            {member.featureKeys.map((key) => {
              if (key === 'medicines') {
                return (
                  <View key={key} style={styles.featureSection}>
                    <View style={styles.featureHeader}>
                      <Ionicons name="medical" size={18} color={colors.accent} />
                      <Text style={[styles.featureTitle, { color: colors.text }]}>{medicinesTitle}</Text>
                    </View>

                    {member.medicines.length === 0 ? (
                      <View style={[styles.noMedsBox, { backgroundColor: isDark ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.02)' }]}>
                        <Text style={[styles.noItemsText, { color: colors.textTertiary }]}>No active medications</Text>
                      </View>
                    ) : (
                      <View style={styles.medList}>
                        {member.medicines.map((med) => {
                          const pillColor = med.color || colors.accent;
                          return (
                            <View key={med.id} style={[styles.miniMedCard, { backgroundColor: colors.inputBg, borderColor: colors.border }]}>
                              <View style={[styles.miniMedIcon, { backgroundColor: pillColor + '20' }]}>
                                <Ionicons name="medkit" size={12} color={pillColor} />
                              </View>
                              <Text style={[styles.miniMedName, { color: colors.text }]} numberOfLines={1}>{med.name}</Text>
                              <Pressable
                                onPress={() => markMedicine(med.id, 'taken')}
                                style={[styles.miniCheck, med.taken && { backgroundColor: '#10B981' }]}
                              >
                                <Ionicons name="checkmark" size={12} color={med.taken ? '#FFF' : colors.textTertiary} />
                              </Pressable>
                            </View>
                          );
                        })}
                      </View>
                    )}
                  </View>
                );
              }

              const def = FAMILY_FEATURE_MAP[key];
              if (!def) return null;

              let subtitle = def.description;
              let route: { pathname: string; params: { memberId: string; memberName: string } } | null = null;
              let isWarning = false;

              if (key === 'appointments') {
                const n = member.summaries.appointments.upcoming;
                subtitle = n === 0 ? 'No upcoming appointments' : `${n} upcoming appointment${n === 1 ? '' : 's'}`;
                route = { pathname: '/family-appointments/[memberId]', params: { memberId: member.id, memberName: member.name } };
              } else if (key === 'health') {
                const n = member.summaries.health.total;
                subtitle = n === 0 ? 'No readings logged yet' : `${n} reading${n === 1 ? '' : 's'} logged`;
                route = { pathname: '/family-health/[memberId]', params: { memberId: member.id, memberName: member.name } };
              } else if (key === 'stock') {
                const { lowCount, total } = member.summaries.stock;
                subtitle = total === 0 ? 'No stock tracked yet' : lowCount > 0 ? `${lowCount} medicine${lowCount === 1 ? '' : 's'} low on stock` : `${total} medicine${total === 1 ? '' : 's'} tracked`;
                isWarning = lowCount > 0;
                route = { pathname: '/family-stock/[memberId]', params: { memberId: member.id, memberName: member.name } };
              } else if (key === 'routine') {
                const n = member.summaries.routine.total;
                subtitle = n === 0 ? 'No routine set yet' : `${n} active reminder${n === 1 ? '' : 's'}`;
                route = { pathname: '/family-routine/[memberId]', params: { memberId: member.id, memberName: member.name } };
              } else if (key === 'bills') {
                const n = member.summaries.bills.unpaid;
                subtitle = n === 0 ? 'No bills due' : `${n} bill${n === 1 ? '' : 's'} due`;
                isWarning = n > 0;
                route = { pathname: '/family-bills/[memberId]', params: { memberId: member.id, memberName: member.name } };
              } else if (key === 'subscriptions') {
                const { total, monthlyTotal } = member.summaries.subscriptions;
                subtitle = total === 0 ? 'No subscriptions tracked' : `${total} active · ~${formatAmount(monthlyTotal)}/mo`;
                route = { pathname: '/family-subscriptions/[memberId]', params: { memberId: member.id, memberName: member.name } };
              } else if (key === 'expenses') {
                const n = member.summaries.expenses.monthTotal;
                subtitle = n === 0 ? 'No expenses logged this month' : `${formatAmount(n)} spent this month`;
                route = { pathname: '/family-expenses/[memberId]', params: { memberId: member.id, memberName: member.name } };
              } else if (key === 'tasks') {
                const n = member.summaries.tasks.pending;
                subtitle = n === 0 ? 'No pending tasks' : `${n} task${n === 1 ? '' : 's'} pending`;
                route = { pathname: '/family-tasks/[memberId]', params: { memberId: member.id, memberName: member.name } };
              } else if (key === 'insurance') {
                const n = member.summaries.insurance.total;
                subtitle = n === 0 ? 'No documents tracked yet' : `${n} document${n === 1 ? '' : 's'} tracked`;
                route = { pathname: '/family-documents/[memberId]', params: { memberId: member.id, memberName: member.name } };
              } else if (key === 'checkin') {
                const n = member.summaries.checkin.total;
                subtitle = n === 0 ? 'No check-ins set yet' : `${n} active check-in${n === 1 ? '' : 's'}`;
                route = { pathname: '/family-checkin/[memberId]', params: { memberId: member.id, memberName: member.name } };
              } else if (key === 'travel') {
                const n = member.summaries.travel.upcoming;
                subtitle = n === 0 ? 'No visits planned' : `${n} upcoming visit${n === 1 ? '' : 's'}`;
                route = { pathname: '/family-travel/[memberId]', params: { memberId: member.id, memberName: member.name } };
              } else if (key === 'emergency') {
                const n = member.summaries.emergency.unacknowledged;
                subtitle = n === 0 ? 'All clear' : `${n} unacknowledged alert${n === 1 ? '' : 's'}`;
                isWarning = n > 0;
                route = { pathname: '/family-emergency/[memberId]', params: { memberId: member.id, memberName: member.name } };
              } else if (key === 'custom') {
                const { name, total } = member.summaries.custom;
                subtitle = !name ? 'Tap to set up your tracker' : total === 0 ? `${name} — nothing logged yet` : `${name} — ${total} entr${total === 1 ? 'y' : 'ies'}`;
                route = { pathname: '/family-custom/[memberId]', params: { memberId: member.id, memberName: member.name } };
              }

              const cardContent = (
                <>
                  <View style={[styles.featureIconWrap, { backgroundColor: colors.accentDim }]}>
                    <Ionicons name={def.icon as any} size={18} color={colors.accent} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.featureTitle, { color: colors.text }]}>{def.label}</Text>
                    <Text style={[styles.featureSubtitle, { color: isWarning ? colors.warning : colors.textTertiary }]}>
                      {subtitle}
                    </Text>
                  </View>
                  {route ? (
                    <Ionicons name="chevron-forward" size={16} color={colors.textTertiary} />
                  ) : (
                    <View style={[styles.comingSoonBadge, { backgroundColor: colors.warningDim }]}>
                      <Text style={[styles.comingSoonText, { color: colors.warning }]}>Soon</Text>
                    </View>
                  )}
                </>
              );

              if (route) {
                return (
                  <Pressable
                    key={key}
                    onPress={() => router.push(route as any)}
                    style={[styles.featureCard, { backgroundColor: colors.inputBg, borderColor: colors.border }]}
                  >
                    {cardContent}
                  </Pressable>
                );
              }

              return (
                <View key={key} style={[styles.featureCard, { backgroundColor: colors.inputBg, borderColor: colors.border }]}>
                  {cardContent}
                </View>
              );
            })}
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    paddingHorizontal: 20,
    justifyContent: 'center',
    borderBottomLeftRadius: 36,
    borderBottomRightRadius: 36,
  },
  headerTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  backBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerMemberInfo: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  headerTitle: {
    fontFamily: 'Inter_700Bold',
    fontSize: 20,
  },
  headerRel: {
    fontFamily: 'Inter_500Medium',
    fontSize: 12,
    marginTop: 2,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  content: {
    padding: 16,
    paddingTop: 20,
  },
  emptyTitle: {
    fontFamily: 'Inter_700Bold',
    fontSize: 18,
    textAlign: 'center',
  },
  featuresDashboard: {
    gap: 12,
  },
  featureSection: {
    marginBottom: 4,
  },
  featureHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 10,
    paddingLeft: 4,
  },
  featureTitle: {
    fontFamily: 'Inter_700Bold',
    fontSize: 14,
  },
  featureSubtitle: {
    fontFamily: 'Inter_400Regular',
    fontSize: 11,
    marginTop: 1,
  },
  noMedsBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 14,
    borderRadius: 16,
    borderStyle: 'dashed',
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.08)',
  },
  noItemsText: {
    fontFamily: 'Inter_500Medium',
    fontSize: 12,
    textAlign: 'center',
  },
  medList: {
    gap: 10,
  },
  miniMedCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 10,
    borderRadius: 14,
    borderWidth: 1,
    gap: 10,
  },
  miniMedIcon: {
    width: 24,
    height: 24,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  miniMedName: {
    flex: 1,
    fontFamily: 'Inter_600SemiBold',
    fontSize: 13,
  },
  miniCheck: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.1)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  featureCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    borderRadius: 18,
    borderWidth: 1,
    gap: 12,
  },
  featureIconWrap: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  comingSoonBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  comingSoonText: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 10,
    textTransform: 'uppercase',
    letterSpacing: 0.3,
  },
});
