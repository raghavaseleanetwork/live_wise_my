import React, { useState, useMemo } from 'react';
import {
  StyleSheet,
  Text,
  View,
  SectionList,
  Pressable,
  Platform,
  ActivityIndicator,
  ScrollView,
  Modal,
  TextInput,
  Alert,
  Switch,
} from 'react-native';
import PremiumLoader from '@/components/PremiumLoader';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { useTheme } from '@/lib/theme-context';
import { useCurrency } from '@/lib/currency-context';
import { useExpenses } from '@/lib/expense-context';
import { useTabBarContentInset } from '@/lib/tab-bar';

import { useSeniorMode } from '@/lib/senior-context';
import {
  CATEGORIES,
  formatTime,
  getDateLabel,
  CategoryType,
  Transaction,
} from '@/lib/data';
import { ThemeColors } from '@/constants/colors';
import CategoryIcon from '@/components/CategoryIcon';

const FILTER_OPTIONS: { key: string; label: string; icon?: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'food', label: 'Food', icon: 'fast-food' },
  { key: 'shopping', label: 'Shopping', icon: 'cart' },
  { key: 'transport', label: 'Transport', icon: 'car' },
  { key: 'entertainment', label: 'Fun', icon: 'film' },
  { key: 'bills', label: 'Bills', icon: 'flash' },
  { key: 'health', label: 'Health', icon: 'medkit' },
  { key: 'education', label: 'Edu', icon: 'book' },
  { key: 'investment', label: 'Invest', icon: 'trending-up' },
  { key: 'others', label: 'Others', icon: 'ellipsis-horizontal' },
];

const TransactionItem = React.memo(({ item, colors, isDark, formatAmount, isSeniorMode }: { item: Transaction; colors: ThemeColors; isDark: boolean; formatAmount: (n: number) => string; isSeniorMode: boolean }) => {
  const safeCat = (item.category || 'others').toLowerCase() as CategoryType;
  const cat = CATEGORIES[safeCat] || CATEGORIES.others;
  return (
    <View
      style={[
        styles.txCard,
        {
          backgroundColor: colors.card,
          borderColor: colors.border,
        },
      ]}
    >
      <View style={[styles.txIconWrap, { backgroundColor: cat.color + '18' }]}>
        <CategoryIcon category={item.category} size={20} />
      </View>
      <View style={styles.txInfo}>
        <Text style={[styles.txMerchant, { color: colors.text }, isSeniorMode && { fontSize: 18 }]} numberOfLines={1}>
          {item.merchant}
        </Text>
        <Text style={[styles.txUpi, { color: colors.textTertiary }, isSeniorMode && { fontSize: 14 }]} numberOfLines={1}>
          {item.upiId}
        </Text>
      </View>
      <View style={styles.txRight}>
        <Text style={[styles.txAmount, { color: colors.danger }, isSeniorMode && { fontSize: 19 }]}>
          -{formatAmount(item.amount)}
        </Text>
        <Text style={[styles.txTime, { color: colors.textTertiary }, isSeniorMode && { fontSize: 13 }]}>
          {formatTime(item.date)}
        </Text>
      </View>
    </View>
  );
});

export default function TransactionsScreen() {
  const insets = useSafeAreaInsets();
  const tabBarInset = useTabBarContentInset();
  const { colors, isDark } = useTheme();
  const { formatAmount } = useCurrency();
  const { transactions, isLoading } = useExpenses();
  const { isSeniorMode } = useSeniorMode();
  const [activeFilter, setActiveFilter] = useState('all');

  const topInset = Platform.OS === 'web' ? 67 : insets.top;

  const filtered = useMemo(() => {
    if (activeFilter === 'all') return transactions;
    return transactions.filter(tx => (tx.category || 'others').toLowerCase() === activeFilter.toLowerCase());
  }, [transactions, activeFilter]);

  const sections = useMemo(() => {
    const grouped: Record<string, Transaction[]> = {};
    filtered.forEach(tx => {
      const label = getDateLabel(tx.date);
      if (!grouped[label]) grouped[label] = [];
      grouped[label].push(tx);
    });
    return Object.entries(grouped).map(([title, data]) => ({
      title,
      data,
      total: data.filter(tx => tx.isDebit).reduce((s, tx) => s + tx.amount, 0),
    }));
  }, [filtered]);

  const totalFiltered = filtered.filter(tx => tx.isDebit).reduce((s, tx) => s + tx.amount, 0);
  const txCount = filtered.filter(tx => tx.isDebit).length;

  if (isLoading) {
    return (
      <View style={[styles.container, styles.centered, { backgroundColor: colors.bg }]}>
        <PremiumLoader size={60} />

      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.bg }]}>
      <View style={[styles.headerArea, { paddingTop: topInset + 20 }]}>
        <Animated.View entering={Platform.OS !== 'web' ? FadeInDown.duration(500) : undefined}>
          <Text style={[styles.screenTitle, { color: colors.text }]}>Activity</Text>

          <View
            style={[
              styles.summaryCard,
              {
                backgroundColor: colors.card,
                borderColor: colors.border,
              },
            ]}
          >
            <View style={styles.summaryLeft}>
              <Text style={[styles.summaryLabel, { color: colors.textTertiary }, isSeniorMode && { fontSize: 15 }]}>
                Total Spent
              </Text>
              <Text style={[styles.summaryAmount, { color: colors.text }, isSeniorMode && { fontSize: 32 }]}>
                {formatAmount(totalFiltered)}
              </Text>
            </View>
            <View style={[styles.summaryDivider, { backgroundColor: colors.border }]} />
            <View style={styles.summaryRight}>
              <Text style={[styles.summaryLabel, { color: colors.textTertiary }]}>
                Transactions
              </Text>
              <Text style={[styles.summaryCount, { color: colors.accent }]}>
                {txCount}
              </Text>
            </View>
          </View>
        </Animated.View>

        <Animated.View entering={Platform.OS !== 'web' ? FadeInDown.delay(100).duration(500) : undefined}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.filterScroll}
          >
            {FILTER_OPTIONS.map(opt => {
              const isActive = activeFilter === opt.key;
              return (
                <Pressable
                  key={opt.key}
                  onPress={() => setActiveFilter(opt.key)}
                  style={[
                    styles.filterChip,
                    {
                      backgroundColor: isActive ? colors.accent : colors.card,
                      borderColor: isActive ? colors.accent : colors.border,
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.filterChipText,
                      {
                        color: isActive ? '#FFFFFF' : colors.textSecondary,
                      },
                    ]}
                  >
                    {opt.label}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
        </Animated.View>
      </View>

      <SectionList
        sections={sections}
        keyExtractor={item => item.id}
        renderItem={({ item }) => <TransactionItem item={item} colors={colors} isDark={isDark} formatAmount={formatAmount} isSeniorMode={isSeniorMode} />}
        renderSectionHeader={({ section }) => (
          <View style={styles.sectionHeader}>
            <Text style={[styles.sectionTitle, { color: colors.textSecondary }]}>
              {section.title}
            </Text>
            <View style={[styles.sectionBadge, { backgroundColor: colors.surfaceGlow }]}>
              <Text style={[styles.sectionTotal, { color: colors.accent }]}>
                {formatAmount((section as any).total)}
              </Text>
            </View>
          </View>
        )}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
        contentContainerStyle={{
          paddingHorizontal: 20,
          paddingBottom: tabBarInset.bottom,
        }}
        showsVerticalScrollIndicator={false}
        stickySectionHeadersEnabled={false}
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Ionicons name="receipt-outline" size={48} color={colors.textTertiary} />
            <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
              No transactions found
            </Text>
            <Text style={[styles.emptySubtext, { color: colors.textTertiary }]}>
              Try adjusting your filters
            </Text>
          </View>
        }
      />
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
  headerArea: {
    paddingHorizontal: 20,
    paddingBottom: 8,
  },
  screenTitle: {
    fontFamily: 'Inter_700Bold',
    fontSize: 32,
    letterSpacing: -0.5,
    marginBottom: 16,
  },
  summaryCard: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 20,
    borderWidth: 1,
    padding: 20,
    marginBottom: 20,
  },
  summaryLeft: {
    flex: 1,
  },
  summaryRight: {
    flex: 1,
    alignItems: 'flex-end',
  },
  summaryDivider: {
    width: 1,
    height: 40,
    marginHorizontal: 16,
  },
  summaryLabel: {
    fontFamily: 'Inter_500Medium',
    fontSize: 12,
    letterSpacing: 0.5,
    textTransform: 'uppercase' as const,
    marginBottom: 6,
  },
  summaryAmount: {
    fontFamily: 'Inter_700Bold',
    fontSize: 24,
    letterSpacing: -0.5,
  },
  summaryCount: {
    fontFamily: 'Inter_700Bold',
    fontSize: 24,
    letterSpacing: -0.5,
  },
  filterScroll: {
    gap: 8,
    paddingBottom: 12,
  },
  filterChip: {
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 24,
    borderWidth: 1,
  },
  filterChipText: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 13,
    letterSpacing: 0.2,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: 24,
    paddingBottom: 12,
  },
  sectionTitle: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 13,
    letterSpacing: 0.5,
    textTransform: 'uppercase' as const,
  },
  sectionBadge: {
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
  },
  sectionTotal: {
    fontFamily: 'Inter_700Bold',
    fontSize: 13,
  },
  txCard: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 20,
    borderWidth: 1,
    padding: 16,
  },
  txIconWrap: {
    width: 48,
    height: 48,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 14,
  },
  txInfo: {
    flex: 1,
    marginRight: 8,
  },
  txMerchant: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 16,
    letterSpacing: -0.2,
  },
  txUpi: {
    fontFamily: 'Inter_400Regular',
    fontSize: 12,
    marginTop: 4,
    letterSpacing: 0.1,
  },
  txRight: {
    alignItems: 'flex-end',
  },
  txAmount: {
    fontFamily: 'Inter_700Bold',
    fontSize: 17,
    letterSpacing: -0.3,
  },
  txTime: {
    fontFamily: 'Inter_400Regular',
    fontSize: 11,
    marginTop: 4,
    letterSpacing: 0.2,
  },
  separator: {
    height: 10,
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 80,
    gap: 8,
  },
  emptyText: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 16,
    marginTop: 8,
  },
  emptySubtext: {
    fontFamily: 'Inter_400Regular',
    fontSize: 13,
  },
});
