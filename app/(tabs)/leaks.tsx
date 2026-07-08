import React from 'react';
import {
  StyleSheet,
  Text,
  View,
  ScrollView,
  Platform,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { useTheme } from '@/lib/theme-context';
import { useCurrency } from '@/lib/currency-context';
import { useExpenses } from '@/lib/expense-context';
import { useTabBarContentInset } from '@/lib/tab-bar';
import PremiumLoader from '@/components/PremiumLoader';
import { CATEGORIES, MoneyLeak } from '@/lib/data';
import { ThemeColors } from '@/constants/colors';

function LeakCard({ leak, index, colors, formatAmount }: { leak: MoneyLeak; index: number; colors: ThemeColors; formatAmount: (n: number) => string }) {
  const cat = CATEGORIES[leak.category] || CATEGORIES.others;

  return (
    <Animated.View entering={Platform.OS !== 'web' ? FadeInDown.delay(200 + index * 100).duration(500) : undefined}>
      <View style={[styles.leakCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <View style={styles.leakHeader}>
          <View style={[styles.leakIcon, { backgroundColor: cat.color + '15' }]}>
            <Ionicons name={cat.icon as any} size={22} color={cat.color} />
          </View>
          <View style={styles.leakInfo}>
            <Text style={[styles.leakMerchant, { color: colors.text }]}>{leak.merchant}</Text>
            <View style={styles.leakMeta}>
              <View style={[styles.freqBadge, { backgroundColor: colors.warningDim }]}>
                <Ionicons name="time-outline" size={10} color={colors.warning} style={{ marginRight: 3 }} />
                <Text style={[styles.freqText, { color: colors.warning }]}>{leak.frequency}</Text>
              </View>
              <Text style={[styles.leakCount, { color: colors.textTertiary }]}>{leak.transactionCount} times</Text>
            </View>
          </View>
          <View style={styles.leakAmountBox}>
            <Text style={[styles.leakAmount, { color: colors.danger }]}>{formatAmount(leak.monthlyEstimate)}</Text>
            <Text style={[styles.leakAmountLabel, { color: colors.textTertiary }]}>per month</Text>
          </View>
        </View>

        <View style={[styles.savingsPotentialRow, { backgroundColor: colors.accentMintDim }]}>
          <Ionicons name="leaf-outline" size={14} color={colors.accentMint} />
          <Text style={[styles.savingsPotentialText, { color: colors.accentMint }]}>
            Save up to {formatAmount(leak.yearlyPrediction)}/year
          </Text>
        </View>

        <View style={[styles.suggestionBox, { borderTopColor: colors.border }]}>
          <View style={[styles.suggestionIconWrap, { backgroundColor: colors.warningDim }]}>
            <Ionicons name="bulb-outline" size={13} color={colors.warning} />
          </View>
          <Text style={[styles.suggestionText, { color: colors.textSecondary }]}>{leak.suggestion}</Text>
        </View>
      </View>
    </Animated.View>
  );
}

export default function LeaksScreen() {
  const insets = useSafeAreaInsets();
  const tabBarInset = useTabBarContentInset();
  const { leaks, isLoading } = useExpenses();
  const { colors } = useTheme();
  const { formatAmount } = useCurrency();

  const topInset = Platform.OS === 'web' ? 67 : insets.top;
  const totalLeaks = leaks.reduce((s, l) => s + l.monthlyEstimate, 0);
  const potentialYearlySavings = totalLeaks * 12;

  if (isLoading) {
    return (
      <View style={[styles.container, styles.centered, { backgroundColor: colors.bg }]}>
        <PremiumLoader size={60} text="Scanning for leaks..." />
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.bg }]}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[
          styles.scrollContent,
          { paddingTop: topInset + 16, paddingBottom: tabBarInset.bottom },
        ]}
      >
        <Animated.View entering={Platform.OS !== 'web' ? FadeInDown.duration(500) : undefined}>
          <Text style={[styles.screenTitle, { color: colors.text }]}>Money Leaks</Text>
          <Text style={[styles.screenSubtitle, { color: colors.textSecondary }]}>
            Smart insights on recurring expenses
          </Text>
        </Animated.View>

        <Animated.View entering={Platform.OS !== 'web' ? FadeInDown.delay(100).duration(500) : undefined}>
          <LinearGradient
            colors={colors.heroGradient as unknown as [string, string, string]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={[styles.savingsCard, { borderColor: colors.border }]}
          >
            <View style={styles.savingsCardTop}>
              <View style={[styles.savingsIconWrap, { backgroundColor: colors.accentMintDim }]}>
                <Ionicons name="shield-checkmark" size={26} color={colors.accentMint} />
              </View>
              <View style={styles.savingsContent}>
                <Text style={[styles.savingsLabel, { color: colors.textSecondary }]}>Potential Savings</Text>
                <Text style={[styles.savingsAmount, { color: colors.accentMint }]}>
                  {formatAmount(totalLeaks)}
                </Text>
                <Text style={[styles.savingsAmountSuffix, { color: colors.textTertiary }]}>per month</Text>
              </View>
            </View>

            <View style={[styles.yearlySavingsRow, { backgroundColor: colors.surfaceGlow }]}>
              <Ionicons name="trending-up" size={16} color={colors.accentMint} />
              <Text style={[styles.yearlyText, { color: colors.accentMint }]}>
                {formatAmount(potentialYearlySavings)} potential yearly savings
              </Text>
            </View>
          </LinearGradient>
        </Animated.View>

        <Animated.View
          entering={Platform.OS !== 'web' ? FadeInDown.delay(150).duration(500) : undefined}
          style={styles.sectionHeader}
        >
          <View style={[styles.howItWorks, { backgroundColor: colors.surfaceGlow, borderColor: colors.border }]}>
            <View style={styles.howItWorksHeader}>
              <Ionicons name="help-circle-outline" size={18} color={colors.accent} />
              <Text style={[styles.howItWorksTitle, { color: colors.text }]}>How it works?</Text>
            </View>
            <Text style={[styles.howItWorksText, { color: colors.textSecondary }]}>
              We scan your spending for patterns that quietly drain money. A leak is flagged when:
            </Text>
            <View style={styles.howItWorksList}>
              <Text style={[styles.howItWorksItem, { color: colors.textTertiary }]}>• A merchant is paid 3+ times — frequent, avoidable spending</Text>
              <Text style={[styles.howItWorksItem, { color: colors.textTertiary }]}>• A recurring charge suddenly increases in price</Text>
              <Text style={[styles.howItWorksItem, { color: colors.textTertiary }]}>• A subscription is billed but hasn't been used in 45+ days</Text>
            </View>
            <View style={[styles.howItWorksDivider, { backgroundColor: colors.border }]} />
            <View style={styles.howItWorksHeader}>
              <Ionicons name="shield-checkmark-outline" size={16} color={colors.accentMint} />
              <Text style={[styles.howItWorksTitle, { color: colors.text, fontSize: 13 }]}>What's never counted as a leak</Text>
            </View>
            <Text style={[styles.howItWorksText, { color: colors.textSecondary }]}>
              Essential and important payments are always excluded — bills, EMIs/loans, insurance, medical/health, education, rent, taxes, and investments or savings. Only unnecessary or extra spending is considered.
            </Text>
          </View>

          <View style={[styles.sectionBadge, { backgroundColor: colors.warningDim, marginTop: 24 }]}>
            <Ionicons name="alert-circle-outline" size={14} color={colors.warning} />
            <Text style={[styles.sectionTitle, { color: colors.warning }]}>
              {leaks.length} leak{leaks.length !== 1 ? 's' : ''} detected
            </Text>
          </View>
        </Animated.View>

        {leaks.length === 0 ? (
          <View style={[styles.emptyState, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={[styles.emptyIconWrap, { backgroundColor: colors.accentMintDim }]}>
              <Ionicons name="shield-checkmark" size={40} color={colors.accentMint} />
            </View>
            <Text style={[styles.emptyTitle, { color: colors.text }]}>All clear!</Text>
            <Text style={[styles.emptySubtitle, { color: colors.textSecondary }]}>
              No spending leaks detected. Your finances look healthy.
            </Text>
          </View>
        ) : (
          leaks.map((leak, idx) => (
            <LeakCard key={leak.id} leak={leak} index={idx} colors={colors} formatAmount={formatAmount} />
          ))
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  centered: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  scrollContent: {
    paddingHorizontal: 20,
  },
  screenTitle: {
    fontFamily: 'Inter_700Bold',
    fontSize: 28,
    letterSpacing: -0.5,
  },
  screenSubtitle: {
    fontFamily: 'Inter_400Regular',
    fontSize: 14,
    marginTop: 4,
    marginBottom: 24,
  },
  savingsCard: {
    borderRadius: 24,
    padding: 24,
    marginBottom: 28,
    borderWidth: 1,
    overflow: 'hidden',
  },
  savingsCardTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    marginBottom: 18,
  },
  savingsIconWrap: {
    width: 56,
    height: 56,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  savingsContent: {
    flex: 1,
  },
  savingsLabel: {
    fontFamily: 'Inter_500Medium',
    fontSize: 12,
    textTransform: 'uppercase' as const,
    letterSpacing: 1,
    marginBottom: 4,
  },
  savingsAmount: {
    fontFamily: 'Inter_700Bold',
    fontSize: 36,
    letterSpacing: -1,
  },
  savingsAmountSuffix: {
    fontFamily: 'Inter_400Regular',
    fontSize: 12,
    marginTop: 2,
  },
  yearlySavingsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  yearlyText: {
    fontFamily: 'Inter_500Medium',
    fontSize: 13,
  },
  sectionHeader: {
    marginBottom: 16,
  },
  sectionBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-start',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 10,
  },
  sectionTitle: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 13,
    letterSpacing: 0.3,
  },
  leakCard: {
    borderRadius: 22,
    padding: 20,
    marginBottom: 14,
    borderWidth: 1,
  },
  leakHeader: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  leakIcon: {
    width: 48,
    height: 48,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 14,
  },
  leakInfo: {
    flex: 1,
  },
  leakMerchant: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 16,
    marginBottom: 6,
  },
  leakMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  freqBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
  },
  freqText: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 10,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.5,
  },
  leakCount: {
    fontFamily: 'Inter_400Regular',
    fontSize: 11,
  },
  leakAmountBox: {
    alignItems: 'flex-end',
  },
  leakAmount: {
    fontFamily: 'Inter_700Bold',
    fontSize: 20,
    letterSpacing: -0.3,
  },
  leakAmountLabel: {
    fontFamily: 'Inter_400Regular',
    fontSize: 10,
    marginTop: 2,
  },
  savingsPotentialRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 16,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 12,
  },
  savingsPotentialText: {
    fontFamily: 'Inter_500Medium',
    fontSize: 12,
  },
  suggestionBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 14,
    paddingTop: 14,
    borderTopWidth: 1,
  },
  suggestionIconWrap: {
    width: 28,
    height: 28,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  suggestionText: {
    fontFamily: 'Inter_400Regular',
    fontSize: 13,
    flex: 1,
    lineHeight: 18,
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: 60,
    paddingHorizontal: 32,
    gap: 14,
    borderRadius: 24,
    borderWidth: 1,
  },
  emptyIconWrap: {
    width: 80,
    height: 80,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  emptyTitle: {
    fontFamily: 'Inter_700Bold',
    fontSize: 20,
  },
  emptySubtitle: {
    fontFamily: 'Inter_400Regular',
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
  },
  howItWorks: {
    padding: 16,
    borderRadius: 20,
    borderWidth: 1,
    marginBottom: 8,
  },
  howItWorksHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  howItWorksTitle: {
    fontFamily: 'Inter_700Bold',
    fontSize: 14,
  },
  howItWorksText: {
    fontFamily: 'Inter_400Regular',
    fontSize: 13,
    lineHeight: 18,
    marginBottom: 8,
  },
  howItWorksList: {
    gap: 4,
  },
  howItWorksItem: {
    fontFamily: 'Inter_500Medium',
    fontSize: 12,
  },
  howItWorksDivider: {
    height: 1,
    marginVertical: 12,
  },
});
