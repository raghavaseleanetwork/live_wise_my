import React, { useCallback, useEffect, useState } from 'react';
import {
  StyleSheet,
  Text,
  View,
  ScrollView,
  Pressable,
  Platform,
  RefreshControl,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@/lib/theme-context';
import { isConfigured, getPurchaseHistory, type PurchaseRecord } from '@/lib/revenuecat';
import { LoadingIndicator } from '@/components/PremiumLoader';
import Money from '@/components/Money';

/**
 * Payment History (client doc — "Settings Enhancements").
 *
 * Lists the user's subscription purchases and renewals, newest first.
 *
 * ## Why some rows have no amount
 *
 * The data here comes from the RevenueCat SDK's `CustomerInfo`, which is an
 * entitlement API rather than a billing ledger: it knows *what* was bought and
 * *when*, but carries no per-transaction charged amount. Prices shown are the
 * product's current store price, so a plan whose price later changed — or that
 * was withdrawn from sale — deliberately shows no amount rather than a figure
 * that never matched what the user paid.
 *
 * A true billing history (real charged amounts, currency, refunds, invoice ids)
 * has to come from the server consuming RevenueCat webhooks. That is specified
 * in `backend-team/SUBSCRIPTION-PAYMENT-HISTORY-backend-requirements.md`; this
 * screen is built so that swapping its data source for that endpoint is the
 * only change needed.
 */

function formatDate(iso: string, locale: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric' });
}

function PaymentRow({
  record,
  colors,
  t,
  locale,
}: {
  record: PurchaseRecord;
  colors: any;
  t: (key: string, opts?: any) => string;
  locale: string;
}) {
  // An unrecognised product id still deserves a readable row — fall back to the
  // raw id rather than rendering a blank line.
  const planName = record.plan
    ? t(`subscription.planNames.${record.plan}`)
    : record.productId;

  const intervalLabel =
    record.interval === 'year'
      ? t('paymentHistory.intervalYearly')
      : record.interval === 'month'
      ? t('paymentHistory.intervalMonthly')
      : null;

  // An active term reads as a live subscription, a lapsed one as a past receipt.
  const accent = record.isActive ? colors.accentMint : colors.accent;

  return (
    <View style={[styles.row, { borderBottomColor: colors.border }]}>
      <View style={[styles.rowIcon, { backgroundColor: accent + '18' }]}>
        <Ionicons
          name={record.isActive ? 'checkmark-circle' : 'receipt-outline'}
          size={18}
          color={accent}
        />
      </View>

      <View style={styles.rowInfo}>
        <View style={styles.rowTitleLine}>
          <Text style={[styles.rowPlan, { color: colors.text }]} numberOfLines={1}>
            {planName}
          </Text>
          {intervalLabel && (
            <View style={[styles.intervalChip, { backgroundColor: colors.bgSecondary }]}>
              <Text style={[styles.intervalChipText, { color: colors.textSecondary }]}>
                {intervalLabel}
              </Text>
            </View>
          )}
        </View>

        <Text style={[styles.rowDate, { color: colors.textTertiary }]} numberOfLines={1}>
          {formatDate(record.date, locale)}
          {record.store ? ` · ${record.store}` : ''}
        </Text>

        {/* Only meaningful for a term that hasn't lapsed — showing "renews on"
            against a long-expired purchase reads as a live subscription. */}
        {record.expiresDate && (
          <Text style={[styles.rowExpiry, { color: colors.textTertiary }]} numberOfLines={1}>
            {record.isActive && record.willRenew
              ? t('paymentHistory.renewsOn', { date: formatDate(record.expiresDate, locale) })
              : t('paymentHistory.expiresOn', { date: formatDate(record.expiresDate, locale) })}
          </Text>
        )}
      </View>

      <View style={styles.rowRight}>
        {record.amount ? (
          <Money style={[styles.rowAmount, { color: colors.text }]}>{record.amount}</Money>
        ) : (
          <Text style={[styles.rowAmountMissing, { color: colors.textTertiary }]}>—</Text>
        )}
        {record.isActive && (
          <View style={[styles.activeChip, { backgroundColor: colors.accentMintDim }]}>
            <Text style={[styles.activeChipText, { color: colors.accentMint }]}>
              {t('paymentHistory.active')}
            </Text>
          </View>
        )}
      </View>
    </View>
  );
}

export default function PaymentHistoryScreen() {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const { t, i18n } = useTranslation();

  const [records, setRecords] = useState<PurchaseRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const storeAvailable = isConfigured();

  const load = useCallback(async () => {
    if (!storeAvailable) {
      setRecords([]);
      setIsLoading(false);
      return;
    }
    try {
      setRecords(await getPurchaseHistory());
    } catch {
      // getPurchaseHistory already swallows SDK errors and returns []; this is
      // only a guard against an unexpected throw so the screen never white-screens.
      setRecords([]);
    } finally {
      setIsLoading(false);
    }
  }, [storeAvailable]);

  useEffect(() => {
    load();
  }, [load]);

  const onRefresh = useCallback(async () => {
    setIsRefreshing(true);
    await load();
    setIsRefreshing(false);
  }, [load]);

  const topInset = Platform.OS === 'web' ? 67 : insets.top;
  const bottomInset = Platform.OS === 'web' ? 34 : Math.max(insets.bottom, 20);

  const handleBack = () => {
    if (router.canGoBack()) router.back();
    else router.replace('/subscription' as any);
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.bg }]}>
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingTop: topInset + 12, paddingBottom: bottomInset + 20 },
        ]}
        showsVerticalScrollIndicator={false}
        refreshControl={
          storeAvailable ? (
            <RefreshControl refreshing={isRefreshing} onRefresh={onRefresh} tintColor={colors.accent} />
          ) : undefined
        }
      >
        <View style={styles.headerRow}>
          <Pressable onPress={handleBack} hitSlop={10}>
            <Ionicons name="arrow-back" size={24} color={colors.text} />
          </Pressable>
          <Text style={[styles.screenTitle, { color: colors.text }]}>
            {t('paymentHistory.title')}
          </Text>
          <View style={{ width: 24 }} />
        </View>

        {isLoading ? (
          <View style={styles.centered}>
            <LoadingIndicator />
          </View>
        ) : !storeAvailable ? (
          /* The SDK is native-only and needs a configured key. Saying so plainly
             beats an empty list, which reads as "you never paid us". */
          <Animated.View
            entering={Platform.OS !== 'web' ? FadeInDown.duration(300) : undefined}
            style={[styles.emptyCard, { backgroundColor: colors.card, borderColor: colors.border }]}
          >
            <View style={[styles.emptyIcon, { backgroundColor: colors.accentDim }]}>
              <Ionicons name="cloud-offline-outline" size={26} color={colors.accent} />
            </View>
            <Text style={[styles.emptyTitle, { color: colors.text }]}>
              {t('paymentHistory.unavailableTitle')}
            </Text>
            <Text style={[styles.emptyDesc, { color: colors.textSecondary }]}>
              {t('paymentHistory.unavailableDesc')}
            </Text>
          </Animated.View>
        ) : records.length === 0 ? (
          <Animated.View
            entering={Platform.OS !== 'web' ? FadeInDown.duration(300) : undefined}
            style={[styles.emptyCard, { backgroundColor: colors.card, borderColor: colors.border }]}
          >
            <View style={[styles.emptyIcon, { backgroundColor: colors.accentDim }]}>
              <Ionicons name="receipt-outline" size={26} color={colors.accent} />
            </View>
            <Text style={[styles.emptyTitle, { color: colors.text }]}>
              {t('paymentHistory.emptyTitle')}
            </Text>
            <Text style={[styles.emptyDesc, { color: colors.textSecondary }]}>
              {t('paymentHistory.emptyDesc')}
            </Text>
            <Pressable
              onPress={() => router.push('/subscription' as any)}
              style={[styles.emptyCta, { backgroundColor: colors.accent }]}
            >
              <Text style={styles.emptyCtaText}>{t('paymentHistory.viewPlans')}</Text>
            </Pressable>
          </Animated.View>
        ) : (
          <>
            <Animated.View
              entering={Platform.OS !== 'web' ? FadeInDown.duration(300) : undefined}
              style={[styles.listCard, { backgroundColor: colors.card, borderColor: colors.border }]}
            >
              {records.map((record) => (
                <PaymentRow
                  key={`${record.productId}-${record.date}`}
                  record={record}
                  colors={colors}
                  t={t}
                  locale={i18n.language || 'en-IN'}
                />
              ))}
            </Animated.View>

            {/* Sets expectations about the "—" amounts rather than leaving the
                user to assume the screen is broken. */}
            <View style={styles.footnoteRow}>
              <Ionicons name="information-circle-outline" size={14} color={colors.textTertiary} />
              <Text style={[styles.footnote, { color: colors.textTertiary }]}>
                {t('paymentHistory.footnote')}
              </Text>
            </View>
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { paddingHorizontal: 20 },
  centered: { paddingVertical: 60, alignItems: 'center' },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 20,
  },
  screenTitle: { fontFamily: 'Inter_700Bold', fontSize: 20 },

  listCard: { borderRadius: 20, borderWidth: 1, overflow: 'hidden' },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rowIcon: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // `minWidth: 0` lets this column shrink instead of shoving the amount off the
  // card when a plan name is long.
  rowInfo: { flex: 1, minWidth: 0, gap: 2 },
  rowTitleLine: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  rowPlan: { fontFamily: 'Inter_600SemiBold', fontSize: 15, flexShrink: 1 },
  intervalChip: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 },
  intervalChipText: { fontFamily: 'Inter_500Medium', fontSize: 10 },
  rowDate: { fontFamily: 'Inter_400Regular', fontSize: 11 },
  rowExpiry: { fontFamily: 'Inter_400Regular', fontSize: 11 },
  rowRight: { alignItems: 'flex-end', gap: 4, maxWidth: '32%', flexShrink: 1 },
  rowAmount: { fontFamily: 'Inter_700Bold', fontSize: 15 },
  rowAmountMissing: { fontFamily: 'Inter_500Medium', fontSize: 15 },
  activeChip: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 },
  activeChipText: { fontFamily: 'Inter_600SemiBold', fontSize: 9 },

  emptyCard: {
    borderRadius: 20,
    borderWidth: 1,
    padding: 24,
    alignItems: 'center',
    gap: 10,
  },
  emptyIcon: {
    width: 56,
    height: 56,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  emptyTitle: { fontFamily: 'Inter_600SemiBold', fontSize: 16, textAlign: 'center' },
  emptyDesc: { fontFamily: 'Inter_400Regular', fontSize: 13, textAlign: 'center', lineHeight: 19 },
  emptyCta: { marginTop: 8, paddingHorizontal: 20, paddingVertical: 11, borderRadius: 14 },
  emptyCtaText: { fontFamily: 'Inter_600SemiBold', fontSize: 14, color: '#FFFFFF' },

  footnoteRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
    marginTop: 14,
    paddingHorizontal: 4,
  },
  footnote: { flex: 1, fontFamily: 'Inter_400Regular', fontSize: 11, lineHeight: 16 },
});
