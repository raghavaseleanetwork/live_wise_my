import React, { useState, useEffect, useCallback } from 'react';
import {
  StyleSheet,
  Text,
  View,
  ScrollView,
  Pressable,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, router } from 'expo-router';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@/lib/theme-context';
import { useAuth } from '@/lib/auth-context';
import { apiRequest } from '@/lib/query-client';
import { useSeniorMode } from '@/lib/senior-context';
import { LoadingIndicator } from '@/components/PremiumLoader';

type MedAppearance = 'capsule' | 'tablet' | 'round' | 'liquid';
type MedInstruction = 'before_meal' | 'after_meal' | 'any';

interface Medicine {
  id: string;
  name: string;
  dosage?: string;
  appearance?: MedAppearance;
  color?: string;
  instruction?: MedInstruction;
  slots?: { morning?: string; noon?: string; evening?: string };
  adherenceScore?: number;
  streak?: number;
  lastStatus?: string;
}

interface FamilyMember {
  id: string;
  name: string;
  relationship: string;
  medicines: Medicine[];
}

export default function MedicineDetailsScreen() {
  const insets = useSafeAreaInsets();
  const { colors, isDark } = useTheme();
  const { token } = useAuth();
  const { isSeniorMode } = useSeniorMode();
  const { t } = useTranslation();
  const { memberId, medId } = useLocalSearchParams<{ memberId: string; medId: string }>();

  const [member, setMember] = useState<FamilyMember | null>(null);
  const [medicine, setMedicine] = useState<Medicine | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const topInset = Platform.OS === 'web' ? 67 : insets.top;

  const loadData = useCallback(async () => {
    if (!token || !memberId || !medId) return;
    try {
      setLoading(true);
      const res = await apiRequest('GET', '/api/family', undefined, token);
      const data = (await res.json()) as FamilyMember[];
      const foundMember = data.find((m) => m.id === memberId);
      if (foundMember) {
        setMember(foundMember);
        const foundMed = foundMember.medicines.find((m) => m.id === medId);
        if (foundMed) {
          setMedicine(foundMed);
        } else {
          setError(t('medicineDetails.errorMedicineNotFound'));
        }
      } else {
        setError(t('medicineDetails.errorMemberNotFound'));
      }
    } catch (e) {
      console.error('Load medicine detail error:', e);
      setError(t('medicineDetails.errorLoadFailed'));
    } finally {
      setLoading(false);
    }
  }, [token, memberId, medId, t]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const markMedicine = async (action: 'taken' | 'snooze' | 'skip') => {
    if (!token || !memberId || !medId) return;
    try {
      await apiRequest(
        'PATCH',
        `/api/family/${memberId}/medicines/${medId}`,
        { action },
        token
      );
      // Reload to see updated status/score
      loadData();
    } catch (e) {
      console.error('Action error:', e);
    }
  };

  if (loading) {
    return (
      <View style={[styles.container, styles.centered, { backgroundColor: colors.bg }]}>
        <LoadingIndicator size="large" color={colors.accent} />
      </View>
    );
  }

  if (error || !member || !medicine) {
    return (
      <View style={[styles.container, styles.centered, { backgroundColor: colors.bg }]}>
        <Ionicons name="alert-circle-outline" size={48} color={colors.textTertiary} />
        <Text style={[styles.errorText, { color: colors.textSecondary }]}>
          {error || t('medicineDetails.errorGeneric')}
        </Text>
        <Pressable onPress={() => router.back()} style={styles.backBtn}>
          <Text style={{ color: colors.accent }}>{t('medicineDetails.goBack')}</Text>
        </Pressable>
      </View>
    );
  }

  const pillColor = medicine.color || '#10B981';
  const slots = medicine.slots || {};
  const parts: string[] = [];
  if (slots.morning) parts.push(`${t('addMedicine.slotMorning')}: ${slots.morning}`);
  if (slots.noon) parts.push(`${t('addMedicine.slotNoon')}: ${slots.noon}`);
  if (slots.evening) parts.push(`${t('addMedicine.slotEvening')}: ${slots.evening}`);

  return (
    <View style={[styles.container, { backgroundColor: colors.bg }]}>
      <View style={[styles.header, { paddingTop: topInset + 12 }]}>
        <Pressable onPress={() => router.back()} hitSlop={15}>
          <Ionicons name="arrow-back" size={24} color={colors.text} />
        </Pressable>
        <Text style={[styles.headerTitle, { color: colors.text }]}>{t('medicineDetails.title')}</Text>
        <View style={{ width: 24 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent}>
        <Animated.View entering={FadeInDown.duration(500)}>
          <LinearGradient
            colors={[pillColor + '20', pillColor + '05']}
            style={[styles.heroCard, { borderColor: pillColor + '30' }]}
          >
            <View style={[styles.iconLarge, { backgroundColor: pillColor + '20' }]}>
              <Ionicons name="medkit" size={32} color={pillColor} />
            </View>
            <Text style={[styles.medNameText, { color: colors.text }]}>{medicine.name}</Text>
            {medicine.dosage && (
              <Text style={[styles.dosageText, { color: colors.textSecondary }]}>
                {medicine.dosage}
              </Text>
            )}
            <View style={[styles.memberBadge, { backgroundColor: colors.accentDim }]}>
              <Text style={[styles.memberBadgeText, { color: colors.accent }]}>
                {t('familyHealth.forMember', { name: member.name })}
              </Text>
            </View>
          </LinearGradient>

          <View style={[styles.section, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.sectionLabel, { color: colors.textTertiary }]}>{t('medicineDetails.schedule')}</Text>
            {parts.map((p, i) => (
              <View key={i} style={styles.slotRow}>
                <Ionicons name="time-outline" size={16} color={colors.textSecondary} />
                <Text style={[styles.slotText, { color: colors.textSecondary }]}>{p}</Text>
              </View>
            ))}
            {medicine.instruction !== 'any' && (
              <View style={styles.instructionBox}>
                <Ionicons name="information-circle-outline" size={16} color={colors.accent} />
                <Text style={[styles.instructionText, { color: colors.accent }]}>
                  {medicine.instruction === 'before_meal' ? t('medicineDetails.takeBeforeMeal') : t('medicineDetails.takeAfterMeal')}
                </Text>
              </View>
            )}
          </View>

          {typeof medicine.adherenceScore === 'number' && (
            <View style={[styles.statsRow]}>
              <View style={[styles.statCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <Text style={[styles.statValue, { color: colors.text }]}>{medicine.adherenceScore}%</Text>
                <Text style={[styles.statLabel, { color: colors.textTertiary }]}>{t('medicineDetails.adherence')}</Text>
              </View>
              <View style={[styles.statCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <Text style={[styles.statValue, { color: colors.text }]}>{medicine.streak || 0}</Text>
                <Text style={[styles.statLabel, { color: colors.textTertiary }]}>{t('medicineDetails.dayStreak')}</Text>
              </View>
            </View>
          )}

          <View style={styles.actionContainer}>
            <Text style={[styles.takeActionTitle, { color: colors.text }]}>{t('medicineDetails.actions')}</Text>
            <View style={styles.actionGrid}>
              <Pressable
                onPress={() => markMedicine('taken')}
                style={[styles.bigActionBtn, { backgroundColor: '#10B981' }]}
              >
                <Ionicons name="checkmark-circle" size={24} color="#FFF" />
                <Text style={styles.bigActionText}>{t('medicineDetails.markTaken')}</Text>
              </Pressable>

              <View style={styles.actionRowSmall}>
                <Pressable
                  onPress={() => markMedicine('snooze')}
                  style={[styles.smallActionBtn, { backgroundColor: colors.warning }]}
                >
                  <Ionicons name="time" size={20} color="#FFF" />
                  <Text style={styles.smallActionText}>{t('medicineDetails.later')}</Text>
                </Pressable>
                <Pressable
                  onPress={() => markMedicine('skip')}
                  style={[styles.smallActionBtn, { backgroundColor: colors.danger }]}
                >
                  <Ionicons name="close-circle" size={20} color="#FFF" />
                  <Text style={styles.smallActionText}>{t('medicineDetails.skip')}</Text>
                </Pressable>
              </View>
            </View>
          </View>
        </Animated.View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  centered: { alignItems: 'center', justifyContent: 'center', padding: 40 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingBottom: 16,
  },
  headerTitle: {
    fontFamily: 'Inter_700Bold',
    fontSize: 18,
  },
  scrollContent: { paddingHorizontal: 20, paddingBottom: 40 },
  heroCard: {
    padding: 24,
    borderRadius: 24,
    alignItems: 'center',
    borderWidth: 1,
    marginBottom: 20,
  },
  iconLarge: {
    width: 64,
    height: 64,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  medNameText: {
    fontFamily: 'Inter_700Bold',
    fontSize: 24,
    textAlign: 'center',
  },
  dosageText: {
    fontFamily: 'Inter_500Medium',
    fontSize: 16,
    marginTop: 4,
  },
  memberBadge: {
    marginTop: 12,
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
  },
  memberBadgeText: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 13,
  },
  section: {
    padding: 16,
    borderRadius: 16,
    borderWidth: 1,
    gap: 12,
    marginBottom: 16,
  },
  sectionLabel: {
    fontFamily: 'Inter_700Bold',
    fontSize: 12,
    letterSpacing: 0.5,
  },
  slotRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  slotText: {
    fontFamily: 'Inter_500Medium',
    fontSize: 15,
  },
  instructionBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 4,
  },
  instructionText: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 14,
  },
  statsRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 24,
  },
  statCard: {
    flex: 1,
    padding: 16,
    borderRadius: 16,
    borderWidth: 1,
    alignItems: 'center',
  },
  statValue: {
    fontFamily: 'Inter_700Bold',
    fontSize: 20,
  },
  statLabel: {
    fontFamily: 'Inter_500Medium',
    fontSize: 12,
    marginTop: 2,
  },
  actionContainer: {
    gap: 12,
  },
  takeActionTitle: {
    fontFamily: 'Inter_700Bold',
    fontSize: 16,
  },
  actionGrid: {
    gap: 12,
  },
  bigActionBtn: {
    height: 60,
    borderRadius: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  bigActionText: {
    color: '#FFF',
    fontFamily: 'Inter_700Bold',
    fontSize: 18,
  },
  actionRowSmall: {
    flexDirection: 'row',
    gap: 12,
  },
  smallActionBtn: {
    flex: 1,
    height: 50,
    borderRadius: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  smallActionText: {
    color: '#FFF',
    fontFamily: 'Inter_600SemiBold',
    fontSize: 15,
  },
  errorText: {
    fontFamily: 'Inter_500Medium',
    fontSize: 16,
    marginTop: 12,
    textAlign: 'center',
  },
  backBtn: {
    marginTop: 20,
    padding: 10,
  },
});
