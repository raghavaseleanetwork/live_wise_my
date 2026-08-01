import React, { useMemo } from 'react';
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
import { router } from 'expo-router';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { useTheme } from '@/lib/theme-context';
import { useCurrency } from '@/lib/currency-context';
import { useExpenses } from '@/lib/expense-context';
import { CATEGORIES, CategoryType } from '@/lib/data';
import CategoryIcon from '@/components/CategoryIcon';

interface MemoryCard {
  id: string;
  icon: string;
  iconColor: string;
  title: string;
  insight: string;
  tag: string;
  category?: CategoryType;
}

export default function LifeMemoryScreen() {
  const insets = useSafeAreaInsets();
  const { colors, isDark } = useTheme();
  const { formatAmount } = useCurrency();
  const { transactions, bills, leaks } = useExpenses();

  const topInset = Platform.OS === 'web' ? 67 : insets.top;
  const bottomInset = Platform.OS === 'web' ? 34 : Math.max(insets.bottom, 20);

  const memories = useMemo((): MemoryCard[] => {
    const cards: MemoryCard[] = [];

    // 1. Spending Pattern (Day of week)
    const dayTotals: Record<string, number> = {};
    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    transactions.forEach(tx => {
      if (tx.isDebit) {
        const day = dayNames[new Date(tx.date).getDay()];
        dayTotals[day] = (dayTotals[day] || 0) + tx.amount;
      }
    });
    const topDay = Object.entries(dayTotals).sort(([, a], [, b]) => b - a)[0];
    if (topDay) {
      cards.push({
        id: 'day_pattern',
        icon: 'calendar',
        iconColor: '#8B5CF6',
        title: 'Spending Rhythm',
        insight: `Your peak spending day is ${topDay[0]}. Typically, you spend ${formatAmount(Math.round(topDay[1] / 4))} on those days.`,
        tag: 'Pattern',
        category: 'habits',
      });
    }

    // 2. Top Category
    const catTotals: Partial<Record<CategoryType, number>> = {};
    transactions.forEach(tx => {
      if (tx.isDebit) {
        catTotals[tx.category] = (catTotals[tx.category] || 0) + tx.amount;
      }
    });

    const topCat = Object.entries(catTotals).sort(([, a], [, b]) => (b as number) - (a as number))[0];
    if (topCat) {
      const catKey = topCat[0] as CategoryType;
      const cat = CATEGORIES[catKey] || CATEGORIES.others;
      cards.push({
        id: 'top_category',
        icon: cat.icon,
        iconColor: cat.color,
        title: 'Primary Category',
        insight: `${cat.label} leads your expenses at ${formatAmount(topCat[1] as number)} this month.`,
        tag: 'Spending',
        category: catKey,
      });
    }

    // 3. Subscription Sentinel (Strictly filter subscriptions)
    const subscriptions = bills.filter(b => b.reminderType === 'subscription');
    if (subscriptions.length > 0) {
      const yearlySubscriptions = subscriptions.reduce((s, b) => s + b.amount * 12, 0);
      cards.push({
        id: 'sub_sentinel',
        icon: 'refresh-circle',
        iconColor: '#3B82F6',
        title: 'Subscription Tracker',
        insight: `Tracking ${subscriptions.length} recurring services. Estimated yearly commitment: ${formatAmount(yearlySubscriptions)}.`,
        tag: 'Recurring',
        category: 'entertainment',
      });
    }

    // 4. Wealth Wisdom (Weekly Comparison)
    const now = new Date();
    const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const twoWeeksAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);
    
    const lastWeekSpend = transactions
      .filter(tx => tx.isDebit && new Date(tx.date) >= oneWeekAgo)
      .reduce((s, tx) => s + tx.amount, 0);
      
    const prevWeekSpend = transactions
      .filter(tx => tx.isDebit && new Date(tx.date) >= twoWeeksAgo && new Date(tx.date) < oneWeekAgo)
      .reduce((s, tx) => s + tx.amount, 0);

    if (lastWeekSpend > 0 && prevWeekSpend > 0) {
      const diff = ((lastWeekSpend - prevWeekSpend) / prevWeekSpend) * 100;
      cards.push({
        id: 'wealth_wisdom',
        icon: 'stats-chart',
        iconColor: diff > 0 ? '#EF4444' : '#10B981',
        title: 'Financial Momentum',
        insight: diff > 0 
          ? `Expenses rose by ${Math.round(diff)}% this week. A quick review might help!` 
          : `Excellent progress! Your spending decreased by ${Math.abs(Math.round(diff))}% this week.`,
        tag: 'Wealth',
      });
    }

    // 5. Nocturnal Nibbles
    const lateNightFood = transactions.filter(tx => {
      const date = new Date(tx.date);
      const hour = date.getHours();
      return (tx.category === 'food' || tx.category === 'habits') && (hour >= 22 || hour <= 4);
    });

    if (lateNightFood.length >= 2) {
      cards.push({
        id: 'nocturnal_nibbles',
        icon: 'moon',
        iconColor: '#1E293B',
        title: 'Late-Night Habits',
        insight: `Noted ${lateNightFood.length} late-night orders. Monthly total: ${formatAmount(lateNightFood.reduce((s, tx) => s + tx.amount, 0))}.`,
        tag: 'Lifestyle',
        category: 'habits',
      });
    }

    // 6. Favourite Merchant
    const merchantCounts: Record<string, number> = {};
    transactions.forEach(tx => {
      merchantCounts[tx.merchant] = (merchantCounts[tx.merchant] || 0) + 1;
    });
    const favMerchant = Object.entries(merchantCounts).sort(([, a], [, b]) => b - a)[0];
    if (favMerchant && favMerchant[1] > 2) {
      cards.push({
        id: 'fav_merchant',
        icon: 'heart',
        iconColor: '#EC4899',
        title: 'Top Destination',
        insight: `You frequent ${favMerchant[0]} regularly—visited ${favMerchant[1]} times this month.`,
        tag: 'Frequented',
        category: 'others',
      });
    }

    // 7. Savings Leaks
    if (leaks.length > 0) {
      const totalLeaks = leaks.reduce((s, l) => s + l.monthlyEstimate, 0);
      cards.push({
        id: 'leak_insight',
        icon: 'flash',
        iconColor: '#F59E0B',
        title: 'Smart Optimization',
        insight: `Detected ${leaks.length} optimization opportunities. Potential annual savings: ${formatAmount(totalLeaks * 12)}.`,
        tag: 'Efficiency',
        category: 'finance',
      });
    }

    return cards;
  }, [transactions, bills, leaks, formatAmount]);

  const handleBack = () => {
    if (router.canGoBack()) router.back();
    else router.replace('/(tabs)');
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.bg }]}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[
          styles.scroll, 
          { paddingTop: topInset + 8, paddingBottom: bottomInset + 8 }
        ]}
      >
        <View style={styles.header}>
          <Pressable onPress={handleBack} hitSlop={15} style={styles.backBtn}>
            <Ionicons name="chevron-back" size={24} color={colors.text} />
          </Pressable>
          <View style={styles.headerContent}>
            <Text style={[styles.title, { color: colors.text }]}>Life Memory</Text>
            <Text style={[styles.subtitle, { color: colors.textSecondary }]}>Personal Insights & Patterns</Text>
          </View>
          <View style={{ width: 44 }} />
        </View>

        <LinearGradient
          colors={isDark ? ['#1E293B', '#0F172A'] : ['#F8FAFC', '#F1F5F9']}
          style={[styles.summaryBanner]}
        >
          <View style={[styles.sparkleWrap, { backgroundColor: colors.accent + '20' }]}>
            <Ionicons name="sparkles" size={20} color={colors.accent} />
          </View>
          <View style={styles.bannerInfo}>
            <Text style={[styles.bannerTitle, { color: colors.text }]}>{memories.length} Key Insights</Text>
            <Text style={[styles.bannerText, { color: colors.textSecondary }]}>
              Analyzed from your recent activity
            </Text>
          </View>
        </LinearGradient>

        <View style={styles.cardsGrid}>
          {memories.map((memory, idx) => (
            <Animated.View
              key={memory.id}
              entering={Platform.OS !== 'web' ? FadeInDown.delay(100 + idx * 80).duration(500) : undefined}
              style={styles.cardWrapper}
            >
              <View style={[
                styles.memoryCard, 
                { backgroundColor: colors.card, borderColor: colors.border }
              ]}>
                <View style={styles.cardHeader}>
                  <View style={[styles.iconBox, { backgroundColor: memory.iconColor + '15' }]}>
                    {memory.category ? (
                      <CategoryIcon category={memory.category} size={22} />
                    ) : (
                      <Ionicons name={memory.icon as any} size={22} color={memory.iconColor} />
                    )}
                  </View>
                  <View style={[styles.tag, { backgroundColor: memory.iconColor + '10' }]}>
                    <Text style={[styles.tagLabel, { color: memory.iconColor }]}>{memory.tag}</Text>
                  </View>
                </View>
                
                <View style={styles.cardBody}>
                  <Text style={[styles.cardTitle, { color: colors.text }]}>{memory.title}</Text>
                  <Text style={[styles.cardInsight, { color: colors.textSecondary }]}>{memory.insight}</Text>
                </View>
              </View>
            </Animated.View>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { 
    flex: 1 
  },
  scroll: { 
    paddingHorizontal: 16 
  },
  header: { 
    flexDirection: 'row', 
    alignItems: 'center', 
    justifyContent: 'space-between', 
    marginBottom: 20 
  },
  backBtn: {
    width: 44,
    height: 44,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerContent: { 
    alignItems: 'center' 
  },
  title: { 
    fontFamily: 'Inter_700Bold', 
    fontSize: 22,
    letterSpacing: -0.5,
  },
  subtitle: { 
    fontFamily: 'Inter_500Medium', 
    fontSize: 13,
    marginTop: 2,
  },
  summaryBanner: {
    padding: 16,
    borderRadius: 16,
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.05)',
  },
  sparkleWrap: {
    width: 44,
    height: 44,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 14,
  },
  bannerInfo: {
    flex: 1,
  },
  bannerTitle: {
    fontFamily: 'Inter_700Bold',
    fontSize: 16,
  },
  bannerText: {
    fontFamily: 'Inter_400Regular',
    fontSize: 13,
    marginTop: 1,
  },
  cardsGrid: {
    gap: 12,
  },
  cardWrapper: {
    marginBottom: 4,
  },
  memoryCard: { 
    borderRadius: 24, 
    padding: 20, 
    borderWidth: 1, 
    gap: 12,
  },
  cardHeader: { 
    flexDirection: 'row', 
    alignItems: 'center', 
    justifyContent: 'space-between',
  },
  iconBox: { 
    width: 46, 
    height: 46, 
    borderRadius: 16, 
    alignItems: 'center', 
    justifyContent: 'center' 
  },
  tag: { 
    paddingHorizontal: 12, 
    paddingVertical: 5, 
    borderRadius: 10 
  },
  tagLabel: { 
    fontFamily: 'Inter_700Bold', 
    fontSize: 10, 
    letterSpacing: 0.6 
  },
  cardBody: {
    gap: 6,
  },
  cardTitle: { 
    fontFamily: 'Inter_700Bold', 
    fontSize: 18,
    letterSpacing: -0.3,
  },
  cardInsight: { 
    fontFamily: 'Inter_400Regular', 
    fontSize: 14, 
    lineHeight: 22,
    opacity: 0.9,
  },
});
