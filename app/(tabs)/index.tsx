import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import {
  StyleSheet,
  Text,
  View,
  ScrollView,
  Pressable,
  Platform,
  RefreshControl,
  TextInput,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getApiUrl, apiRequest } from '@/lib/query-client';
import Animated, {
  FadeInDown,
  FadeInRight,
  FadeOutUp,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
  withSpring,
  withSequence,
  withDelay,
  Easing,
} from 'react-native-reanimated';
import { BlurView } from 'expo-blur';
import Money from '@/components/Money';
import { TouchableOpacity } from 'react-native-gesture-handler';
import { router, useFocusEffect } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useExpenses } from '@/lib/expense-context';
import { useAuth } from '@/lib/auth-context';
import { hasSmsPermission } from '@/lib/sms-reader';
import { useTheme } from '@/lib/theme-context';
import { useCurrency } from '@/lib/currency-context';
import { useTabBarContentInset } from '@/lib/tab-bar';
import { getIntentPolicy, getReminderIntentFromBill } from '@/lib/reminder-intent';
import { useSeniorMode } from '@/lib/senior-context';
import { useAlert } from '@/lib/alert-context';
import CategoryIcon from '@/components/CategoryIcon';
import PremiumLoader from '@/components/PremiumLoader';
import CustomModal from '@/components/CustomModal';
import AddExpenseFab, { FAB_CONTENT_INSET, type FabAction } from '@/components/AddExpenseFab';
import {
  CATEGORIES,
  getTodaySpending,
  getMonthlySpending,
  getGreetingPeriod,
  formatTime,
  REPEAT_OPTIONS,
  CategoryType,
  type GreetingPeriod,
} from '@/lib/data';

function SpendingScoreRing({ score, colors, isDark, onPress, isSeniorMode }: { score: number; colors: any; isDark: boolean; onPress?: () => void; isSeniorMode: boolean }) {
  const clampedScore = Math.min(100, Math.max(0, score));
  const scoreColor = clampedScore >= 70 ? colors.accentMint : clampedScore >= 40 ? colors.warning : colors.danger;
  const size = isSeniorMode ? 140 : 100;
  const ringWidth = isSeniorMode ? 6 : 4;
  const innerSize = size - (isSeniorMode ? 28 : 22);
  const innerRingWidth = isSeniorMode ? 4 : 2.5;

  return (
    <Pressable onPress={onPress} style={ringStyles.container}>
      <View style={[ringStyles.outerRing, { borderColor: scoreColor + '25', width: size, height: size, borderRadius: size / 2, borderWidth: ringWidth }]}>
        <View style={[ringStyles.innerRing, { borderColor: scoreColor + '60', width: innerSize, height: innerSize, borderRadius: innerSize / 2, borderWidth: innerRingWidth }]}>
          <Text style={[ringStyles.scoreValue, { color: colors.text }, isSeniorMode && { fontSize: 32 }]}>{clampedScore}</Text>
          <Text style={[ringStyles.scoreLabel, { color: colors.textTertiary }, isSeniorMode && { fontSize: 12 }]}>Score</Text>
        </View>
      </View>
    </Pressable>
  );
}

const ringStyles = StyleSheet.create({
  container: { alignItems: 'center', justifyContent: 'center' },
  outerRing: {
    width: 100,
    height: 100,
    borderRadius: 50,
    borderWidth: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  innerRing: {
    width: 78,
    height: 78,
    borderRadius: 39,
    borderWidth: 2.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scoreValue: { fontFamily: 'Inter_700Bold', fontSize: 22 },
  scoreLabel: { fontFamily: 'Inter_600SemiBold', fontSize: 8, letterSpacing: 1.5 },
});

/**
 * Trims a formatted amount to a single decimal place — "$200.66" → "$200.6".
 *
 * The insight cards are a narrow three-across row, and two decimals pushed the
 * value onto a second line ("$200.6" / "6"), which broke the card's alignment.
 * Truncates rather than rounds so the figure never reads as higher than it is.
 *
 * Operates on the formatted string so it keeps the currency symbol, grouping,
 * and the INR lakh suffix that `formatAmount` applies. Values with no decimal
 * point (counts, "₹1.2L") pass through untouched.
 */
function oneDecimal(formatted: string): string {
  const dot = formatted.lastIndexOf('.');
  if (dot === -1) return formatted;

  const decimals = formatted.slice(dot + 1);
  // Only plain trailing digits are decimals; anything else (a lakh "L", a
  // currency code) means this is not a two-decimal amount.
  if (!/^\d{2,}$/.test(decimals)) return formatted;

  return `${formatted.slice(0, dot)}.${decimals[0]}`;
}

const InsightCard = React.memo(({ icon, iconColor, bgColor, title, value, subtitle, colors, isSeniorMode }: {
  icon: string; iconColor: string; bgColor: string; title: string; value: string; subtitle: string; colors: any; isSeniorMode: boolean;
}) => {
  return (
    <View style={[styles.insightCard, { backgroundColor: colors.card, borderColor: colors.border }, isSeniorMode && { padding: 20, minHeight: 140 }]}>
      <View style={[styles.insightIconWrap, { backgroundColor: bgColor }, isSeniorMode && { width: 44, height: 44, borderRadius: 16 }]}>
        <Ionicons name={icon as any} size={isSeniorMode ? 24 : 18} color={iconColor} />
      </View>
      <Text style={[styles.insightTitle, { color: colors.textSecondary }, isSeniorMode && { fontSize: 13 }]}>{title}</Text>
      <Text style={[styles.insightValue, { color: colors.text }, isSeniorMode && { fontSize: 24 }]}>{value}</Text>
      <Text style={[styles.insightSubtitle, { color: colors.textTertiary }, isSeniorMode && { fontSize: 12 }]}>{subtitle}</Text>
    </View>
  );
});

const CategoryPill = React.memo(({ category, total, index, colors, formatAmount, isSeniorMode }: { category: CategoryType; total: number; index: number; colors: any; formatAmount: (n: number) => string; isSeniorMode: boolean }) => {
  const safeCat = (category || 'others').toLowerCase() as CategoryType;
  const cat = CATEGORIES[safeCat] || CATEGORIES.others;
  return (
    <Animated.View entering={Platform.OS !== 'web' ? FadeInRight.delay(index * 80).springify() : undefined}>
      <View style={[styles.categoryPill, { backgroundColor: colors.card, borderColor: colors.border }, isSeniorMode && { paddingHorizontal: 16, paddingVertical: 12 }]}>
        <View style={[styles.catIconWrap, { backgroundColor: cat.color + '15' }, isSeniorMode && { width: 36, height: 36, borderRadius: 12 }]}>
          <CategoryIcon category={category} size={isSeniorMode ? 20 : 16} />
        </View>
        <View style={styles.catTextWrap}>
          <Text style={[styles.categoryPillLabel, { color: colors.textSecondary }, isSeniorMode && { fontSize: 13 }]}>{cat.label}</Text>
          <Money style={[styles.categoryPillAmount, { color: colors.text }, isSeniorMode && { fontSize: 16 }]}>{formatAmount(total)}</Money>
        </View>
      </View>
    </Animated.View>
  );
});

const TransactionRow = React.memo(({ merchant, amount, category, date, colors, formatAmount, isSeniorMode }: { merchant: string; amount: number; category: CategoryType; date: string; colors: any; formatAmount: (n: number) => string; isSeniorMode: boolean }) => {
  const safeCat = (category || 'others').toLowerCase() as CategoryType;
  const cat = CATEGORIES[safeCat] || CATEGORIES.others;
  return (
    <View style={[styles.txRow, isSeniorMode && { paddingVertical: 14 }]}>
      <View style={[styles.txIcon, { backgroundColor: cat.color + '12' }, isSeniorMode && { width: 44, height: 44, borderRadius: 16 }]}>
        <CategoryIcon category={category} size={isSeniorMode ? 22 : 18} />
      </View>
      <View style={styles.txInfo}>
        <Text style={[styles.txMerchant, { color: colors.text }, isSeniorMode && { fontSize: 16 }]}>{merchant}</Text>
        <Text style={[styles.txTime, { color: colors.textTertiary }, isSeniorMode && { fontSize: 13 }]}>{formatTime(date)}</Text>
      </View>
      <Money style={[styles.txAmount, { color: colors.text }, isSeniorMode && { fontSize: 16 }]}>- {formatAmount(amount)}</Money>
    </View>
  );
});

import { SmsSyncPhase } from '@/lib/sms-sync-task';

const PulsingStatusDot = ({ color, size = 8 }: { color: string; size?: number }) => {
  const scale = useSharedValue(1);
  const opacity = useSharedValue(0.5);

  useEffect(() => {
    scale.value = withRepeat(
      withSequence(
        withTiming(2, { duration: 1200, easing: Easing.out(Easing.ease) }),
        withTiming(1, { duration: 0 })
      ),
      -1,
      false
    );
    opacity.value = withRepeat(
      withSequence(
        withTiming(0, { duration: 1200, easing: Easing.out(Easing.ease) }),
        withTiming(0.5, { duration: 0 })
      ),
      -1,
      false
    );
  }, []);

  const animatedRingStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
    opacity: opacity.value,
  }));

  return (
    <View style={{ width: size, height: size, justifyContent: 'center', alignItems: 'center' }}>
      <Animated.View
        style={[
          {
            position: 'absolute',
            width: size,
            height: size,
            borderRadius: size / 2,
            backgroundColor: color,
          },
          animatedRingStyle,
        ]}
      />
      <View
        style={{
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: color,
        }}
      />
    </View>
  );
};

function MustSmsSyncBanner({
  colors,
  isSyncingSms,
  smsSyncPhase,
  smsSyncDetail,
  smsSyncProgressCurrent,
  smsSyncProgressTotal,
  lastSmsSyncCount,
}: {
  colors: any;
  isSyncingSms: boolean;
  smsSyncPhase: SmsSyncPhase;
  smsSyncStatus: string | null;
  smsSyncDetail: string | null;
  smsSyncProgressCurrent: number | null;
  smsSyncProgressTotal: number | null;
  lastSmsSyncCount: number | null;
}) {
  const progressWidth = useSharedValue(0);
  
  useEffect(() => {
    if (smsSyncPhase === 'fetching') progressWidth.value = withSpring(0.15);
    else if (smsSyncPhase === 'parsing') progressWidth.value = withSpring(0.45);
    else if (smsSyncPhase === 'uploading') {
      const p = smsSyncProgressTotal ? (smsSyncProgressCurrent || 0) / smsSyncProgressTotal : 0.8;
      progressWidth.value = withSpring(0.5 + p * 0.4);
    } else if (smsSyncPhase === 'completed') progressWidth.value = withTiming(1, { duration: 400 });
    else progressWidth.value = withTiming(0);
  }, [smsSyncPhase, smsSyncProgressCurrent, smsSyncProgressTotal]);

  const progressStyle = useAnimatedStyle(() => ({
    width: `${progressWidth.value * 100}%`,
  }));

  if (smsSyncPhase === 'idle' && !isSyncingSms) return null;

  const isError = smsSyncPhase === 'error';
  const isDone = smsSyncPhase === 'completed';
  
  const accentColor = isError 
    ? colors.danger 
    : isDone 
      ? colors.accentMint 
      : colors.accent;

  const statusText = isError 
    ? 'Sync Failed' 
    : isDone 
      ? `Successfully synced ${lastSmsSyncCount ?? 0} new transactions`
      : smsSyncPhase === 'fetching' 
        ? 'Scanning SMS inbox...'
        : smsSyncPhase === 'parsing'
          ? `Searching... (${smsSyncProgressTotal ?? 0} found)`
          : `Syncing ${smsSyncDetail ? smsSyncDetail + ' ' : ''}(${smsSyncProgressCurrent ?? 0}/${smsSyncProgressTotal ?? 0})`;

  return (
    <Animated.View 
      entering={FadeInDown.springify()} 
      exiting={FadeOutUp}
      style={[styles.mustMinimalFullBanner, { borderColor: accentColor + '20', backgroundColor: colors.card }]}
    >
      <View style={styles.mustMinimalContent}>
        {isSyncingSms && !isDone && !isError ? (
           <PulsingStatusDot color={accentColor} size={8} />
        ) : (
          <Ionicons 
            name={isError ? "alert-circle" : isDone ? "checkmark-circle" : "sync"} 
            size={14} 
            color={accentColor} 
          />
        )}
        <Text style={[styles.mustMinimalText, { color: colors.text }]} numberOfLines={1}>
          {statusText}
        </Text>
      </View>
      
      {isSyncingSms && !isDone && !isError && (
        <View style={[styles.minimalProgressBg, { backgroundColor: colors.border }]}>
          <Animated.View style={[styles.minimalProgressFill, { backgroundColor: accentColor }, progressStyle]} />
        </View>
      )}
    </Animated.View>
  );
}


function TopReminderAlert({
  colors,
  upcomingBills,
  onSnooze,
  onCancel,
}: {
  colors: any;
  upcomingBills: any[];
  onSnooze: (id: string) => void;
  onCancel: (id: string) => void;
}) {
  if (!upcomingBills.length) return null;

  const today = new Date();
  const sorted = [...upcomingBills].sort(
    (a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime(),
  );

  // Only show the single most urgent one
  const next = sorted[0];
  const due = new Date(next.dueDate);
  const msDiff = due.setHours(0, 0, 0, 0) - today.setHours(0, 0, 0, 0);
  const daysDiff = Math.round(msDiff / (1000 * 60 * 60 * 24));

  let label: string;
  if (daysDiff === 0) {
    label = `Due Today • ${next.name}`;
  } else {
    label = `Overdue • ${next.name}`;
  }

  const dateLabel = due.toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
  });

  return (
    <Animated.View
      entering={Platform.OS !== 'web' ? FadeInDown.duration(400) : undefined}
      style={[
        styles.reminderAlert,
        {
          backgroundColor: colors.warningDim,
          borderColor: colors.warning,
        },
      ]}
    >
      <View style={styles.reminderAlertRow}>
        <View style={styles.reminderAlertLeft}>
          <View style={[styles.reminderAlertIconWrap, { backgroundColor: colors.warning + '20' }]}>
            <Ionicons
              name="alert-circle"
              size={20}
              color={colors.warning}
            />
          </View>
          <View style={{ flex: 1, marginRight: 8 }}>
            <Text style={[styles.reminderAlertTitle, { color: colors.text }]} numberOfLines={1}>
              {label}
            </Text>
            <Text
              style={[styles.reminderAlertSubtitle, { color: colors.textSecondary }]}
              numberOfLines={1}
            >
              {`Due ${dateLabel}`}
            </Text>
          </View>
        </View>
        <View style={styles.reminderAlertActions}>
          <Pressable
            onPress={() => onSnooze(next.id)}
            style={[
              styles.alertActionBtn,
              { backgroundColor: colors.warning, borderColor: colors.warning }
            ]}
          >
            <Ionicons name="notifications-off-outline" size={14} color="#FFFFFF" />
            <Text style={[styles.alertActionText, { color: '#FFFFFF' }]}>Snooze</Text>
          </Pressable>
          <Pressable
            onPress={() => onCancel(next.id)}
            style={[
              styles.alertActionBtn,
              { backgroundColor: colors.card, borderColor: colors.border }
            ]}
          >
            <Ionicons name="close-circle-outline" size={14} color={colors.textTertiary} />
            <Text style={[styles.alertActionText, { color: colors.textTertiary }]}>Cancel</Text>
          </Pressable>
        </View>
      </View>
    </Animated.View>
  );
}

function QuickAccessCard({ icon, label, subtitle, color, onPress, colors, testID }: { icon: string; label: string; subtitle: string; color: string; onPress: () => void; colors: any; testID?: string }) {
  return (
    <Pressable onPress={onPress} style={[styles.quickCard, { backgroundColor: colors.card, borderColor: colors.border }]} testID={testID}>
      <View style={[styles.quickCardIcon, { backgroundColor: color + '12' }]}>
        <Ionicons name={icon as any} size={20} color={color} />
      </View>
      <Text style={[styles.quickCardLabel, { color: colors.text }]}>{label}</Text>
      <Text style={[styles.quickCardSubtitle, { color: colors.textTertiary }]}>{subtitle}</Text>
    </Pressable>
  );
}

function PrimaryCircleActions({ colors, onScanBill, onQuickAdd, onAutoTrack }: {
  colors: any;
  onScanBill: () => void;
  onQuickAdd: () => void;
  onAutoTrack: () => void;
}) {
  const baseScale = useSharedValue(0.9);
  useEffect(() => {
    baseScale.value = withSpring(1, { damping: 14, stiffness: 140 });
  }, [baseScale]);

  const pulse1 = useSharedValue(1);
  const pulse2 = useSharedValue(1);
  const pulse3 = useSharedValue(1);

  useEffect(() => {
    pulse1.value = withRepeat(withSequence(withTiming(1.05, { duration: 900 }), withTiming(1, { duration: 900 })), -1, true);
    pulse2.value = withRepeat(withSequence(withDelay(150, withTiming(1.05, { duration: 900 })), withTiming(1, { duration: 900 })), -1, true);
    pulse3.value = withRepeat(withSequence(withDelay(300, withTiming(1.05, { duration: 900 })), withTiming(1, { duration: 900 })), -1, true);
  }, [pulse1, pulse2, pulse3]);

  const circleStyle1 = useAnimatedStyle(() => ({
    transform: [{ scale: baseScale.value * pulse1.value }],
  }));
  const circleStyle2 = useAnimatedStyle(() => ({
    transform: [{ scale: baseScale.value * pulse2.value }],
  }));
  const circleStyle3 = useAnimatedStyle(() => ({
    transform: [{ scale: baseScale.value * pulse3.value }],
  }));

  const purple = colors.accentPurple || colors.accent || '#A855F7';
  const purpleDim = colors.accentPurpleDim || (purple + '1F');
  const blue = colors.accentBlue || '#3B82F6';
  const blueDim = colors.accentBlueDim || (blue + '1F');
  const amber = colors.warning || '#F59E0B';
  const amberDim = colors.warningDim || (amber + '1F');

  return (
    <View style={styles.primaryCircleRow}>
      <Pressable onPress={onQuickAdd} style={styles.primaryCircleItem}>
        <Animated.View
          style={[
            styles.primaryCircleFill,
            {
              backgroundColor: purpleDim,
              borderColor: purple + '33',
            },
            circleStyle1,
          ]}
        >
          <View pointerEvents="none" style={styles.primaryCircleInnerWhiteBorder} />
          <Ionicons name="mic" size={24} color={purple} />
        </Animated.View>
        <Text style={[styles.primaryCircleLabel, { color: colors.textSecondary }]}>Voice Reminder</Text>
      </Pressable>
      <Pressable onPress={onScanBill} style={styles.primaryCircleItem}>
        <Animated.View
          style={[
            styles.primaryCircleFill,
            {
              backgroundColor: blueDim,
              borderColor: blue + '33',
            },
            circleStyle2,
          ]}
        >
          <View pointerEvents="none" style={styles.primaryCircleInnerWhiteBorder} />
          <Ionicons name="camera" size={24} color={blue} />
        </Animated.View>
        <Text style={[styles.primaryCircleLabel, { color: colors.textSecondary }]}>Scan Bills</Text>
      </Pressable>
      <Pressable onPress={onAutoTrack} style={styles.primaryCircleItem}>
        <Animated.View
          style={[
            styles.primaryCircleFill,
            {
              backgroundColor: amberDim,
              borderColor: amber + '33',
            },
            circleStyle3,
          ]}
        >
          <View pointerEvents="none" style={styles.primaryCircleInnerWhiteBorder} />
          <Ionicons name="chatbubble-ellipses" size={24} color={amber} />
        </Animated.View>
        <Text style={[styles.primaryCircleLabel, { color: colors.textSecondary }]}>Wise AI</Text>
      </Pressable>
    </View>
  );
}

const GREETING_CONFIG: Record<GreetingPeriod, { icon: string; accent: string; label: string }> = {
  morning: { icon: 'sunny', accent: '#F59E0B', label: 'Good Morning' },
  afternoon: { icon: 'partly-sunny', accent: '#3B82F6', label: 'Good Afternoon' },
  evening: { icon: 'moon', accent: '#8B5CF6', label: 'Good Evening' },
};

const springConfig = { damping: 14, stiffness: 120 };

function AnimatedGreeting({ userName, colors }: { userName: string; colors: any }) {
  const period = getGreetingPeriod();
  const config = GREETING_CONFIG[period];
  const iconScale = useSharedValue(0);
  const iconScalePulse = useSharedValue(1);
  const iconTranslateY = useSharedValue(0);
  const greetingOpacity = useSharedValue(0);
  const greetingTranslateY = useSharedValue(12);
  const nameOpacity = useSharedValue(0);
  const nameTranslateY = useSharedValue(16);

  useEffect(() => {
    iconScale.value = withSpring(1, springConfig);
    greetingOpacity.value = withDelay(100, withSpring(1, springConfig));
    greetingTranslateY.value = withDelay(100, withSpring(0, springConfig));
    nameOpacity.value = withDelay(200, withSpring(1, springConfig));
    nameTranslateY.value = withDelay(200, withSpring(0, springConfig));
  }, []);

  useEffect(() => {
    iconTranslateY.value = withRepeat(
      withSequence(
        withTiming(-4, { duration: 2000 }),
        withTiming(0, { duration: 2000 })
      ),
      -1,
      true
    );
    iconScalePulse.value = withRepeat(
      withSequence(
        withTiming(1.05, { duration: 2400 }),
        withTiming(1, { duration: 2400 })
      ),
      -1,
      true
    );
  }, [iconTranslateY, iconScalePulse]);

  const iconAnimatedStyle = useAnimatedStyle(() => ({
    transform: [
      { scale: iconScale.value * iconScalePulse.value },
      { translateY: iconTranslateY.value },
    ],
  }));

  const greetingTextStyle = useAnimatedStyle(() => ({
    opacity: greetingOpacity.value,
    transform: [{ translateY: greetingTranslateY.value }],
  }));

  const nameTextStyle = useAnimatedStyle(() => ({
    opacity: nameOpacity.value,
    transform: [{ translateY: nameTranslateY.value }],
  }));

  return (
    <View style={styles.headerLeft}>
      <View style={styles.greetingRow}>
        <Animated.View style={iconAnimatedStyle}>
          <View style={[styles.greetingIconWrap, { backgroundColor: config.accent + '20' }]}>
            <Ionicons name={config.icon as any} size={22} color={config.accent} />
          </View>
        </Animated.View>
        <View style={styles.greetingTextWrap}>
          <Animated.Text
            style={[styles.greetingAnimated, { color: config.accent }, greetingTextStyle]}
            numberOfLines={1}
          >
            {config.label}
          </Animated.Text>
          <Animated.Text
            style={[styles.userNameHero, { color: colors.text }, nameTextStyle]}
            numberOfLines={1}
          >
            {userName}
          </Animated.Text>
        </View>
      </View>
    </View>
  );
}

export default function HomeScreen() {
  const insets = useSafeAreaInsets();
  const tabBarInset = useTabBarContentInset();
  const {
    transactions,
    bills,
    leaks,
    isLoading,
    isSyncingSms,
    smsSyncPhase,
    smsSyncStatus,
    smsSyncProgressCurrent,
    smsSyncProgressTotal,
    smsSyncDetail,
    lastSmsSyncCount,
    monthlyBudget,
    lifeScore,
    refreshData,
    syncSmsFromDevice,
    quickAddReminder,
    snoozeReminder,
    cancelReminder,
  } = useExpenses();
  const { user, token } = useAuth();
  const { colors, isDark } = useTheme();
  const { formatAmount } = useCurrency();
  const { isSeniorMode } = useSeniorMode();
  const { showAlert } = useAlert();
  const [showScoreDetail, setShowScoreDetail] = useState(false);
  const [showQuickAdd, setShowQuickAdd] = useState(false);
  const [quickAddText, setQuickAddText] = useState('');
  const [isQuickAdding, setIsQuickAdding] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [isSnoozeModalVisible, setIsSnoozeModalVisible] = useState(false);
  const [isCancelModalVisible, setIsCancelModalVisible] = useState(false);
  const [activeReminderId, setActiveReminderId] = useState<string | null>(null);
  const [dismissedReminderIds, setDismissedReminderIds] = useState<string[]>([]);

  useEffect(() => {
    const loadDismissed = async () => {
      try {
        const stored = await AsyncStorage.getItem('@lifewise_dismissed_alerts');
        if (stored) setDismissedReminderIds(JSON.parse(stored));
      } catch (e) { console.error('Load dismissed alerts error:', e); }
    };
    loadDismissed();
  }, []);

  const dismissAlert = useCallback(async (id: string) => {
    const updated = [...dismissedReminderIds, id];
    setDismissedReminderIds(updated);
    try {
      await AsyncStorage.setItem('@lifewise_dismissed_alerts', JSON.stringify(updated));
    } catch (e) { console.error('Save dismissed alerts error:', e); }
  }, [dismissedReminderIds]);

  const topInset = Platform.OS === 'web' ? 67 : insets.top;
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await refreshData();
      if (!isSyncingSms) {
        await syncSmsFromDevice();
      }
    } finally {
      setRefreshing(false);
    }
  }, [refreshData, syncSmsFromDevice, isSyncingSms]);

  /**
   * Scan for new bank SMS as soon as the home screen opens.
   *
   * Previously the only trigger was pull-to-refresh, so a user who opened the
   * app and never pulled down saw stale data and assumed Auto Track was
   * broken — the messages were there, nothing had read them yet.
   *
   * Two constraints shape this:
   *
   * 1. **Never prompt.** `syncSmsFromDevice` asks for SMS permission and, on
   *    iOS, opens an explanatory alert. Firing that automatically would greet
   *    every user with a popup on launch, so this runs only when permission is
   *    *already* granted. Asking still happens from the Auto Track button.
   * 2. **Once per app session.** The ref guard means switching tabs and coming
   *    back does not re-scan; pull-to-refresh remains the way to force one.
   */
  const didAutoSyncSms = useRef(false);

  useEffect(() => {
    if (!token || didAutoSyncSms.current) return;

    let cancelled = false;
    (async () => {
      if (!(await hasSmsPermission())) return;
      // Re-check after the await: the guard above ran before it, and a
      // pull-to-refresh could have started a sync in the meantime.
      if (cancelled || didAutoSyncSms.current || isSyncingSms) return;
      didAutoSyncSms.current = true;
      await syncSmsFromDevice();
    })();

    return () => { cancelled = true; };
    // `isSyncingSms` is deliberately not a dependency — it flips during the
    // sync this effect starts, which would re-run it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, syncSmsFromDevice]);

  const fetchUnreadCount = useCallback(async () => {
    if (!token) return;
    try {
      const res = await apiRequest('GET', '/api/notifications', undefined, token);
      const json = (await res.json()) as { id: string; read: boolean }[];
      setUnreadCount(json.filter((n) => !n.read).length);
    } catch { /* ignore */ }
  }, [token]);

  useEffect(() => {
    fetchUnreadCount();
  }, [fetchUnreadCount]);

  // Removed local seniorMode effect (using global context)

  const handleScanBill = useCallback(() => {
    router.push('/scan-bill');
  }, [router]);

  /**
   * Entry methods offered by the expanding action button. Ordered by how often
   * they get used, since the bottom-most item sits closest to the trigger and is
   * the easiest to reach. Import is Android-and-iOS but matters most on iOS,
   * where Apple's SMS restriction leaves no automatic capture path.
   */
  const fabActions: FabAction[] = useMemo(
    () => [
      {
        key: 'import',
        icon: 'document-text-outline',
        label: 'Import statement',
        color: colors.warning,
        onPress: () => router.push('/import-statement'),
      },
      {
        key: 'recurring',
        icon: 'repeat',
        label: 'Recurring expenses',
        color: colors.accentMint || '#10B981',
        onPress: () => router.push('/recurring-expenses'),
      },
      {
        key: 'voice',
        icon: 'mic',
        label: 'Speak an expense',
        color: colors.accentPurple || colors.accent,
        // mode=expense flips the screen's primary action to "Save expense".
        // Without it the user arrives from "Speak an expense" at a screen whose
        // main button creates a reminder — which reads as broken.
        onPress: () => router.push('/voice-reminder?mode=expense'),
      },
      {
        key: 'scan',
        icon: 'camera',
        label: 'Scan a receipt',
        color: colors.accentBlue || '#3B82F6',
        onPress: () => router.push('/scan-bill?mode=expense'),
      },
      {
        key: 'quick',
        icon: 'create-outline',
        label: 'Add expense',
        color: colors.accent,
        onPress: () => router.push('/add-expense'),
      },
    ],
    [router, colors],
  );

  // Never show a full-screen sync animation; we use a compact top banner instead.

  const { 
    displaySpend, 
    isLastMonthFallback, 
    todaySpend, 
    dailyAvg,
    categoryTotals, 
    budgetUsed, 
    budgetBarWidth, 
    budgetHealthScore, 
    thisMonthTxsCount 
  } = useMemo(() => {
    const now = new Date();
    const currM = now.getMonth();
    const currY = now.getFullYear();
    
    // Last Month
    let lastM = currM - 1;
    let lastY = currY;
    if (lastM < 0) {
      lastM = 11;
      lastY = currY - 1;
    }

    const currentMonthly = getMonthlySpending(transactions, currM, currY);
    const lastMonthly = getMonthlySpending(transactions, lastM, lastY);
    
    const isFallback = currentMonthly === 0 && lastMonthly > 0;
    const displayValue = isFallback ? lastMonthly : currentMonthly;
    
    const today = isFallback ? 0 : getTodaySpending(transactions);
    
    // Daily Average
    let avg = 0;
    if (isFallback) {
      // Last month total days
      const daysInLastM = new Date(lastY, lastM + 1, 0).getDate();
      avg = lastMonthly / daysInLastM;
    } else {
      const daysPassed = now.getDate();
      avg = daysPassed > 0 ? currentMonthly / daysPassed : 0;
    }

    const used = monthlyBudget > 0 ? (currentMonthly / monthlyBudget) * 100 : 0;
    const barWidth = Math.min(used, 100);

    const catTotals: Partial<Record<CategoryType, number>> = {};
    let thisMonthCount = 0;

    transactions.forEach(tx => {
      if (tx.isDebit) {
        const d = new Date(tx.date);
        // If fallback, we show last month's categories? 
        // User said "all details fetch properly", usually means the breakdown should match the shown total.
        const targetM = isFallback ? lastM : currM;
        const targetY = isFallback ? lastY : currY;
        
        if (d.getMonth() === targetM && d.getFullYear() === targetY) {
          const cat = (tx.category || 'others').toLowerCase() as CategoryType;
          const safeCat = CATEGORIES[cat] ? cat : 'others';
          catTotals[safeCat] = (catTotals[safeCat] || 0) + tx.amount;
          if (!isFallback) thisMonthCount++;
        }
      }
    });

    const billsPaidRatioValue = bills.length > 0 ? bills.filter(b => b.status === 'paid' || b.isPaid).length / bills.length : 0;
    const totalLeakAmt = leaks.reduce((s, l) => s + l.monthlyEstimate, 0);
    const hasAct = transactions.length > 0 || bills.length > 0 || leaks.length > 0;

    let healthScore = hasAct ? Math.round(
      Math.max(0, Math.min(100, 100 - used)) * 0.5 +
      (bills.length > 0 ? billsPaidRatioValue * 100 : 100) * 0.3 +
      (leaks.length > 0 ? (totalLeakAmt < 1000 ? 100 : totalLeakAmt < 3000 ? 50 : 0) : 100) * 0.2
    ) : 0;

    return {
      displaySpend: displayValue,
      isLastMonthFallback: isFallback,
      todaySpend: today,
      dailyAvg: avg,
      categoryTotals: catTotals,
      budgetUsed: used,
      budgetBarWidth: barWidth,
      budgetHealthScore: healthScore,
      thisMonthTxsCount: thisMonthCount
    };
  }, [transactions, monthlyBudget, bills, leaks]);

  const sortedCategories = useMemo(() => 
    Object.entries(categoryTotals)
      .sort(([, a], [, b]) => (b as number) - (a as number))
      .slice(0, 6),
    [categoryTotals]
  );

    const currM = new Date().getMonth();
    const currY = new Date().getFullYear();
    const recentTxs = useMemo(() => {
      return transactions
        .filter(tx => {
          const d = new Date(tx.date);
          return d.getMonth() === currM && d.getFullYear() === currY;
        })
        .slice(0, 5);
    }, [transactions, currM, currY]);
  const unpaidBills = useMemo(() => bills.filter(b => b.status !== 'paid' && !b.isPaid).length, [bills]);
  const totalLeakAmount = useMemo(() => leaks.reduce((s, l) => s + l.monthlyEstimate, 0), [leaks]);
  const userName = user?.name?.split(' ')[0] || 'User';

  const billsPaidRatio = useMemo(() => bills.length > 0 ? bills.filter(b => b.status === 'paid' || b.isPaid).length / bills.length : 0, [bills]);
  const hasActivity = useMemo(() => transactions.length > 0 || bills.length > 0 || leaks.length > 0, [transactions, bills, leaks]);

  // Life Score from backend (high precision)
  const officialLifeScore = lifeScore?.score ?? 85;
  const displayScore = lifeScore != null ? lifeScore.score : budgetHealthScore;

  const nowDay = new Date();
  nowDay.setHours(0, 0, 0, 0);
  const upcomingBills = bills
    .filter((b) => !b.isPaid && !['paid', 'snoozed', 'cancelled'].includes(b.status))
    .filter((b) => !dismissedReminderIds.includes(b.id)) // Persistent dismissal
    .filter((b) => {
      const due = new Date(b.dueDate);
      due.setHours(0, 0, 0, 0);
      // Only show if due date is today or in the past
      return due.getTime() <= nowDay.getTime();
    })
    .sort((a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime());

  const showComingSoon = useCallback(() => {
    showAlert({
      title: 'Coming Soon',
      message: 'This feature will be available in a future update.',
      type: 'info',
    });
  }, [showAlert]);

  if (isLoading && !refreshing) {
    return (
      <View style={[styles.container, styles.centered, { backgroundColor: colors.bg }]}>
        <PremiumLoader />
      </View>
    );
  }

  if (isSeniorMode) {
    return (
      <View style={[styles.container, { backgroundColor: colors.bg }]}>
        <ScrollView
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              colors={[colors.accent]}
              tintColor={colors.accent}
              title="Refreshing…"
            />
          }
          contentContainerStyle={[styles.scrollContent, { paddingTop: topInset + 12, paddingBottom: tabBarInset.bottom }]}
        >
          <TopReminderAlert
            colors={colors}
            upcomingBills={upcomingBills}
            onSnooze={(id) => {
              setActiveReminderId(id);
              setIsSnoozeModalVisible(true);
            }}
            onCancel={(id) => {
              dismissAlert(id); // Dismiss locally and persistently
              setActiveReminderId(id);
              setIsCancelModalVisible(true);
            }}
          />
          <MustSmsSyncBanner
            colors={colors}
            isSyncingSms={isSyncingSms || isLoading}
            smsSyncPhase={smsSyncPhase}
            smsSyncDetail={smsSyncDetail}
            smsSyncStatus={smsSyncStatus}
            smsSyncProgressCurrent={smsSyncProgressCurrent}
            smsSyncProgressTotal={smsSyncProgressTotal}
            lastSmsSyncCount={lastSmsSyncCount}
          />
          <View style={styles.header}>
            <AnimatedGreeting userName={userName} colors={colors} />
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <Pressable
                onPress={() => router.push('/notifications')}
                style={[styles.iconBtn, { backgroundColor: colors.card, borderColor: colors.border }]}
              >
                <Ionicons name="notifications-outline" size={20} color={colors.textSecondary} />
                {unreadCount > 0 && (
                  <View style={styles.unreadDot} />
                )}
              </Pressable>
              <Pressable
                onPress={() => router.push('/support')}
                style={[styles.iconBtn, { backgroundColor: colors.card, borderColor: colors.border }]}
              >
                <Ionicons name="help-circle-outline" size={20} color={colors.textSecondary} />
              </Pressable>
            </View>
          </View>

          <View style={[styles.seniorHeroCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.seniorHeroLabel, { color: colors.textSecondary }]}>
              {isLastMonthFallback ? 'Last Month' : 'Balance Left'}
            </Text>
            <Money style={[styles.seniorHeroAmount, { color: colors.text }]}>
              {formatAmount(Math.max(0, monthlyBudget - displaySpend))}
            </Money>
          </View>

          {upcomingBills.length > 0 && (
            <Animated.View entering={Platform.OS !== 'web' ? FadeInDown.delay(120).duration(450) : undefined}>
              <Text style={[styles.sectionTitle, { color: colors.text }]}>Upcoming Reminders</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.remindersScroll}>
                {upcomingBills.map((bill) => {
                  const dueDate = new Date(bill.dueDate);
                  const intent = getIntentPolicy(getReminderIntentFromBill(bill));
                  const repeatLabel = REPEAT_OPTIONS.find((r) => r.key === bill.repeatType)?.label || '';
                  const showDue = intent.showDue;
                  const showRepeat = intent.showRepeat;
                  const showAmount = intent.shouldHaveAmount && bill.amount > 0;
                  const dueText = dueDate.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
                  const dueOrRepeatText =
                    showDue && showRepeat
                      ? `${dueText} • ${repeatLabel}`
                      : showDue
                        ? dueText
                        : showRepeat
                          ? repeatLabel
                          : '';

                  return (
                    <Pressable
                      key={bill.id}
                      onPress={() => router.push(`/bill-details/${bill.id}`)}
                      style={[styles.reminderPill, { backgroundColor: colors.card, borderColor: colors.border }]}
                    >
                      <View style={[styles.reminderPillIcon, { backgroundColor: colors.warningDim }]}>
                        <Ionicons name={bill.icon as any} size={18} color={colors.warning} />
                      </View>
                      <View style={styles.reminderPillInfo}>
                        <Text style={[styles.reminderPillName, { color: colors.text }]} numberOfLines={1}>
                          {bill.name}
                        </Text>
                        {!!dueOrRepeatText ? (
                          <Text style={[styles.reminderPillDue, { color: colors.textTertiary }]}>{dueOrRepeatText}</Text>
                        ) : null}
                      </View>
                      <Money style={[styles.reminderPillAmount, { color: colors.accent, opacity: showAmount ? 1 : 0 }]}>
                        {formatAmount(bill.amount)}
                      </Money>
                    </Pressable>
                  );
                })}
              </ScrollView>
            </Animated.View>
          )}

          <View style={styles.seniorGrid}>
            <Pressable onPress={() => router.push('/(tabs)/transactions')} style={[styles.seniorBtn, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <View style={[styles.seniorBtnIcon, { backgroundColor: colors.accentDim }]}>
                <Ionicons name="wallet" size={32} color={colors.accent} />
              </View>
              <Text style={[styles.seniorBtnLabel, { color: colors.text }]}>Money</Text>
            </Pressable>
            <Pressable onPress={() => router.push('/family')} style={[styles.seniorBtn, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <View style={[styles.seniorBtnIcon, { backgroundColor: '#10B981' + '12' }]}>
                <Ionicons name="medkit" size={32} color="#10B981" />
              </View>
              <Text style={[styles.seniorBtnLabel, { color: colors.text }]}>Health</Text>
            </Pressable>
            <Pressable onPress={() => router.push('/family')} style={[styles.seniorBtn, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <View style={[styles.seniorBtnIcon, { backgroundColor: '#EC4899' + '12' }]}>
                <Ionicons name="people" size={32} color="#EC4899" />
              </View>
              <Text style={[styles.seniorBtnLabel, { color: colors.text }]}>Family</Text>
            </Pressable>
            <Pressable onPress={() => router.push('/(tabs)/bills')} style={[styles.seniorBtn, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <View style={[styles.seniorBtnIcon, { backgroundColor: '#F59E0B' + '12' }]}>
                <Ionicons name="notifications" size={32} color="#F59E0B" />
              </View>
              <Text style={[styles.seniorBtnLabel, { color: colors.text }]}>Reminders</Text>
            </Pressable>
            <Pressable onPress={() => router.push('/voice-reminder')} style={[styles.seniorBtn, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <View style={[styles.seniorBtnIcon, { backgroundColor: '#6366F1' + '12' }]}>
                <Ionicons name="mic" size={32} color="#6366F1" />
              </View>
              <Text style={[styles.seniorBtnLabel, { color: colors.text }]}>Voice Reminder</Text>
            </Pressable>
            <Pressable
              onPress={() => router.push('/add-expense')}
              style={[styles.seniorBtn, { backgroundColor: colors.card, borderColor: colors.border }]}
              testID="home-add-expense-btn"
            >
              <View style={[styles.seniorBtnIcon, { backgroundColor: '#3B82F6' + '12' }]}>
                <Ionicons name="add-circle" size={32} color="#3B82F6" />
              </View>
              <Text style={[styles.seniorBtnLabel, { color: colors.text }]}>Add Expense</Text>
            </Pressable>
          </View>
        </ScrollView>

        {/* Senior mode deliberately has no expanding FAB — its large labelled
            tiles are the whole point, and small fan-out targets would undercut
            that. The Add Expense tile above navigates to /add-expense. */}
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.bg }]}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            colors={[colors.accent]}
            tintColor={colors.accent}
            title="Refreshing…"
          />
        }
        contentContainerStyle={[
          styles.scrollContent,
          {
            paddingTop: topInset + 12,
            // Clear the tab bar AND the floating action button above it.
            paddingBottom: tabBarInset.bottom + FAB_CONTENT_INSET,
          },
        ]}
      >
        <TopReminderAlert
          colors={colors}
          upcomingBills={upcomingBills}
          onSnooze={(id) => {
            setActiveReminderId(id);
            setIsSnoozeModalVisible(true);
          }}
          onCancel={(id) => {
            setActiveReminderId(id);
            setIsCancelModalVisible(true);
          }}
        />
        <MustSmsSyncBanner
          colors={colors}
          isSyncingSms={isSyncingSms || isLoading}
          smsSyncPhase={smsSyncPhase}
          smsSyncDetail={smsSyncDetail}
          smsSyncStatus={smsSyncStatus}
          smsSyncProgressCurrent={smsSyncProgressCurrent}
          smsSyncProgressTotal={smsSyncProgressTotal}
          lastSmsSyncCount={lastSmsSyncCount}
        />
        <Animated.View entering={Platform.OS !== 'web' ? FadeInDown.duration(500) : undefined}>
          <View style={styles.header}>
            <AnimatedGreeting userName={userName} colors={colors} />
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <Pressable
                onPress={() => router.push('/notifications')}
                style={[styles.iconBtn, { backgroundColor: colors.card, borderColor: colors.border }]}
              >
                <Ionicons name="notifications-outline" size={20} color={colors.textSecondary} />
                {unreadCount > 0 && <View style={styles.unreadDot} />}
              </Pressable>
              <Pressable
                onPress={() => router.push('/support')}
                style={[styles.iconBtn, { backgroundColor: colors.card, borderColor: colors.border }]}
              >
                <Ionicons name="help-circle-outline" size={20} color={colors.textSecondary} />
              </Pressable>
            </View>
          </View>
        </Animated.View>

        <Animated.View entering={Platform.OS !== 'web' ? FadeInDown.delay(40).duration(450) : undefined}>
          <PrimaryCircleActions
            colors={colors}
            onScanBill={handleScanBill}
            onQuickAdd={() => router.push('/voice-reminder')}
            onAutoTrack={() => router.push('/assistant')}
          />
        </Animated.View>

        {/* Old multi-line SMS banners removed in favor of compact MUST banner */}

        <Animated.View entering={Platform.OS !== 'web' ? FadeInDown.delay(80).duration(500) : undefined}>
          <LinearGradient
            colors={colors.heroGradient as unknown as [string, string, ...string[]]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.heroCard}
          >
            <View style={styles.heroTop}>
              <View style={styles.heroLeft}>
                <Text style={[styles.heroLabel, { color: isDark ? 'rgba(255,255,255,0.5)' : 'rgba(15,23,42,0.45)' }]}>
                  {isLastMonthFallback ? 'Last Month' : 'This Month'}
                </Text>
                <Money style={[styles.heroAmount, { color: isDark ? '#F1F5F9' : '#0F172A' }]}>{formatAmount(displaySpend)}</Money>
                <View style={styles.budgetSection}>
                  <View style={[styles.budgetTrack, { backgroundColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(15,23,42,0.08)' }]}>
                    <LinearGradient
                      colors={colors.buttonGradient as unknown as [string, string]}
                      start={{ x: 0, y: 0 }}
                      end={{ x: 1, y: 0 }}
                      style={[styles.budgetFill, { width: `${budgetBarWidth}%` as any }]}
                    />
                  </View>
                  <Text style={[styles.budgetText, { color: isDark ? 'rgba(255,255,255,0.35)' : 'rgba(15,23,42,0.35)' }]}>
                    {isLastMonthFallback ? 'Based on last month' : `${Math.round(budgetUsed)}% of ${formatAmount(monthlyBudget)}`}
                  </Text>
                </View>
              </View>
              <SpendingScoreRing score={displayScore} colors={colors} isDark={isDark} onPress={() => setShowScoreDetail(true)} isSeniorMode={isSeniorMode} />
            </View>
            <View style={[styles.heroDivider, { backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(15,23,42,0.06)' }]} />
            <View style={styles.heroStats}>
              <View style={styles.heroStat}>
                <Text style={[styles.heroStatLabel, { color: isDark ? 'rgba(255,255,255,0.4)' : 'rgba(15,23,42,0.4)' }]}>
                  {isLastMonthFallback ? 'Today (no spend yet)' : 'Today'}
                </Text>
                <Money style={[styles.heroStatValue, { color: isDark ? '#F1F5F9' : '#0F172A' }]}>{formatAmount(todaySpend)}</Money>
              </View>
              <View style={[styles.heroStatDivider, { backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(15,23,42,0.06)' }]} />
              <View style={styles.heroStat}>
                <Text style={[styles.heroStatLabel, { color: isDark ? 'rgba(255,255,255,0.4)' : 'rgba(15,23,42,0.4)' }]}>
                  {isLastMonthFallback ? 'Avg (last mo.)' : 'Daily Avg'}
                </Text>
                <Money style={[styles.heroStatValue, { color: isDark ? '#F1F5F9' : '#0F172A' }]}>
                  {formatAmount(Math.round(dailyAvg))}
                </Money>
              </View>
              <View style={[styles.heroStatDivider, { backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(15,23,42,0.06)' }]} />
              <View style={styles.heroStat}>
                <Text style={[styles.heroStatLabel, { color: isDark ? 'rgba(255,255,255,0.4)' : 'rgba(15,23,42,0.4)' }]}>Remaining</Text>
                <Money style={[styles.heroStatValue, { color: isDark ? '#F1F5F9' : '#0F172A' }, monthlyBudget - displaySpend < 0 ? { color: colors.danger } : {}]}>
                  {formatAmount(Math.max(0, monthlyBudget - displaySpend))}
                </Money>
              </View>
            </View>
          </LinearGradient>
        </Animated.View>

        {upcomingBills.length > 0 && (
          <Animated.View entering={Platform.OS !== 'web' ? FadeInDown.delay(120).duration(500) : undefined}>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>Upcoming Reminders</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.remindersScroll}>
              {upcomingBills.map((bill) => {
                const dueDate = new Date(bill.dueDate);
                const intent = getIntentPolicy(getReminderIntentFromBill(bill));
                const repeatLabel = REPEAT_OPTIONS.find((r) => r.key === bill.repeatType)?.label || '';
                const showDue = intent.showDue;
                const showRepeat = intent.showRepeat;
                const showAmount = intent.shouldHaveAmount && bill.amount > 0;
                const dueText = dueDate.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
                const dueOrRepeatText =
                  showDue && showRepeat
                    ? `${dueText} • ${repeatLabel}`
                    : showDue
                      ? dueText
                      : showRepeat
                        ? repeatLabel
                        : '';
                return (
                  <Pressable
                    key={bill.id}
                    onPress={() => router.push(`/bill-details/${bill.id}`)}
                    style={[styles.reminderPill, { backgroundColor: colors.card, borderColor: colors.border }]}
                  >
                    <View style={[styles.reminderPillIcon, { backgroundColor: colors.warningDim }]}>
                      <Ionicons name={bill.icon as any} size={18} color={colors.warning} />
                    </View>
                    <View style={styles.reminderPillInfo}>
                      <Text style={[styles.reminderPillName, { color: colors.text }]} numberOfLines={1}>{bill.name}</Text>
                      {!!dueOrRepeatText ? (
                        <Text style={[styles.reminderPillDue, { color: colors.textTertiary }]}>
                          {dueOrRepeatText}
                        </Text>
                      ) : null}
                    </View>
                    {showAmount && (
                      <Money style={[styles.reminderPillAmount, { color: colors.accent }]}>
                        {formatAmount(bill.amount)}
                      </Money>
                    )}
                  </Pressable>
                );
              })}
            </ScrollView>
          </Animated.View>
        )}

        <Animated.View entering={Platform.OS !== 'web' ? FadeInDown.delay(160).duration(500) : undefined}>
          <View style={styles.insightsRow}>
            <Pressable onPress={() => router.push('/(tabs)/leaks')} style={{ flex: 1 }}>
              <InsightCard
                icon="water"
                iconColor={colors.danger}
                bgColor={colors.dangerDim}
                title="Leaks"
                value={oneDecimal(formatAmount(totalLeakAmount))}
                subtitle="/month"
                colors={colors}
                isSeniorMode={isSeniorMode}
              />
            </Pressable>
            <Pressable onPress={() => router.push('/(tabs)/bills')} style={{ flex: 1 }}>
              <InsightCard
                icon="notifications"
                iconColor={colors.warning}
                bgColor={colors.warningDim}
                title="Due"
                value={String(unpaidBills)}
                subtitle="reminders"
                colors={colors}
                isSeniorMode={isSeniorMode}
              />
            </Pressable>
            <Pressable onPress={() => router.push('/(tabs)/transactions')} style={{ flex: 1 }}>
              <InsightCard
                icon="swap-horizontal"
                iconColor={colors.accentBlue}
                bgColor={colors.accentBlueDim}
                title="Total"
                value={String(thisMonthTxsCount)}
                subtitle="this month"
                colors={colors}
                isSeniorMode={isSeniorMode}
              />
            </Pressable>
          </View>
        </Animated.View>

        <Animated.View entering={Platform.OS !== 'web' ? FadeInDown.delay(200).duration(500) : undefined}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>Quick Reach</Text>
          <View style={styles.quickReachRow}>
            <QuickAccessCard
              icon="water"
              label="Leaks"
              subtitle="Save money"
              color="#EF4444"
              onPress={() => router.push('/(tabs)/leaks')}
              colors={colors}
            />
            <QuickAccessCard
              icon="stats-chart"
              label="Analytics"
              subtitle="View activity"
              color="#3B82F6"
              onPress={() => router.push('/(tabs)/transactions')}
              colors={colors}
              testID="home-activity-btn"
            />
          </View>
        </Animated.View>

        <Animated.View entering={Platform.OS !== 'web' ? FadeInDown.delay(240).duration(500) : undefined}>
          <View style={[styles.lifeInsightCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={[styles.lifeInsightIconWrap, { backgroundColor: colors.accentBlueDim || colors.accentDim }]}>
              <Ionicons name="wallet" size={18} color={colors.accentBlue || colors.accent} />
            </View>
            <View style={styles.lifeInsightContent}>
              <Text style={[styles.lifeInsightTitle, { color: colors.text }]}>Spending Insight</Text>
              <Text style={[styles.lifeInsightText, { color: colors.textSecondary }]}>
                {isLastMonthFallback
                  ? "No spending recorded yet this month — figures below are from last month so you have something to compare against."
                  : todaySpend > 500
                  ? `You've spent ${formatAmount(todaySpend)} today. Consider slowing down to stay within your daily average.`
                  : `Great discipline today! You've only spent ${formatAmount(todaySpend)} so far.`}
              </Text>
            </View>
          </View>
        </Animated.View>

        <Animated.View entering={Platform.OS !== 'web' ? FadeInDown.delay(320).duration(500) : undefined}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>Spending by Category</Text>
          {sortedCategories.length === 0 ? (
            <View style={[styles.emptyCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <View style={[styles.emptyIconWrap, { backgroundColor: colors.accentDim }]}>
                <Ionicons name="pie-chart-outline" size={20} color={colors.accent} />
              </View>
              <View style={styles.emptyTextWrap}>
                <Text style={[styles.emptyTitle, { color: colors.text }]}>No spending yet</Text>
                <Text style={[styles.emptySubtitle, { color: colors.textTertiary }]}>
                  Add a few expenses and we’ll show a beautiful category breakdown here.
                </Text>
              </View>
            </View>
          ) : (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.categoryScroll}>
              {sortedCategories.map(([catKey, total], idx) => (
                <CategoryPill
                  key={`${catKey}-${idx}`}
                  category={catKey as CategoryType}
                  total={total}
                  index={idx}
                  colors={colors}
                  formatAmount={formatAmount}
                  isSeniorMode={isSeniorMode}
                />
              ))}
            </ScrollView>
          )}
        </Animated.View>

        <Animated.View entering={Platform.OS !== 'web' ? FadeInDown.delay(400).duration(500) : undefined}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>Recent Transactions</Text>
          {recentTxs.length === 0 ? (
            <View style={[styles.emptyCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <View style={[styles.emptyIconWrap, { backgroundColor: colors.accentBlueDim || colors.accentDim }]}>
                <Ionicons name="receipt-outline" size={20} color={colors.accentBlue || colors.accent} />
              </View>
              <View style={styles.emptyTextWrap}>
                <Text style={[styles.emptyTitle, { color: colors.text }]}>No activity recorded</Text>
                <Text style={[styles.emptySubtitle, { color: colors.textTertiary }]}>
                  Tap Auto Track or add a transaction to see your latest spending here.
                </Text>
              </View>
            </View>
          ) : (
            <View style={[styles.txCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
              {recentTxs.map((tx, idx) => (
                <React.Fragment key={tx.id}>
                  <TransactionRow
                    merchant={tx.merchant}
                    amount={tx.amount}
                    category={tx.category}
                    date={tx.date}
                    colors={colors}
                    formatAmount={formatAmount}
                    isSeniorMode={isSeniorMode}
                  />
                  {idx < recentTxs.length - 1 && <View style={[styles.txDivider, { backgroundColor: colors.border }]} />}
                </React.Fragment>
              ))}
            </View>
          )}
        </Animated.View>

      </ScrollView>

      <AddExpenseFab actions={fabActions} />

      <CustomModal visible={showScoreDetail} onClose={() => setShowScoreDetail(false)}>
        {/* No close button here — CustomModal renders its own, and a second one
            sat directly on top of it. */}
        <View style={[styles.scoreDetailHeader, { borderBottomColor: colors.border }]}>
          <Text style={[styles.scoreDetailTitle, { color: colors.text }]}>Life Score Breakdown</Text>
        </View>

        <View style={{ alignItems: 'center', paddingVertical: 20 }}>
          <SpendingScoreRing score={budgetHealthScore} colors={colors} isDark={isDark} isSeniorMode={isSeniorMode} />
        </View>

        <View style={styles.scoreBreakdown}>
          <View style={[styles.scoreRow, { borderBottomColor: colors.border }]}>
            <View style={styles.scoreRowLeft}>
              <View style={[styles.scoreRowDot, { backgroundColor: colors.accentMint }]} />
              <Text style={[styles.scoreRowLabel, { color: colors.text }]}>Budget Control</Text>
            </View>
            <Text style={[styles.scoreRowValue, { color: colors.accentMint }]}>
              {Math.round(Math.max(0, Math.min(100, 100 - budgetUsed)) * 0.5)}/50
            </Text>
          </View>
          <View style={[styles.scoreRow, { borderBottomColor: colors.border }]}>
            <View style={styles.scoreRowLeft}>
              <View style={[styles.scoreRowDot, { backgroundColor: colors.accentBlue }]} />
              <Text style={[styles.scoreRowLabel, { color: colors.text }]}>Bills Paid</Text>
            </View>
            <Text style={[styles.scoreRowValue, { color: colors.accentBlue }]}>
              {Math.round((bills.length > 0 ? billsPaidRatio * 100 : 100) * 0.3)}/30
            </Text>
          </View>
          <View style={[styles.scoreRow, { borderBottomColor: colors.border }]}>
            <View style={styles.scoreRowLeft}>
              <View style={[styles.scoreRowDot, { backgroundColor: colors.warning }]} />
              <Text style={[styles.scoreRowLabel, { color: colors.text }]}>Leak Detection</Text>
            </View>
            <Text style={[styles.scoreRowValue, { color: colors.warning }]}>
              {Math.round((leaks.length > 0 ? (totalLeakAmount < 1000 ? 100 : totalLeakAmount < 3000 ? 50 : 0) : 100) * 0.2)}/20
            </Text>
          </View>
        </View>

        <Pressable onPress={() => { setShowScoreDetail(false); showComingSoon(); }} style={[styles.shareBtn, { backgroundColor: colors.accentDim }]}>
          <Ionicons name="share-outline" size={18} color={colors.accent} />
          <Text style={[styles.shareBtnText, { color: colors.accent }]}>Share Score Card</Text>
        </Pressable>
      </CustomModal>

      {/* The close button is hidden mid-save, as the old inline one was — the
          sheet should not be dismissable while the reminder is being created. */}
      <CustomModal
        visible={showQuickAdd}
        onClose={() => setShowQuickAdd(false)}
        showCloseButton={!isQuickAdding}
      >
        {/* Close button comes from CustomModal; a second one here overlapped it. */}
        <View style={[styles.scoreDetailHeader, { borderBottomColor: colors.border }]}>
          <Text style={[styles.scoreDetailTitle, { color: colors.text }]}>Quick Add Reminder</Text>
        </View>
        <Text style={[styles.lifeInsightText, { color: colors.textSecondary, marginBottom: 12 }]}>
          {`Type something like "Pay electricity bill tomorrow at 8 pm".`}
        </Text>
        <TextInput
          style={[
            styles.input,
            {
              backgroundColor: colors.inputBg,
              borderColor: colors.inputBorder,
              color: colors.text,
              marginBottom: 16,
            },
          ]}
          value={quickAddText}
          onChangeText={setQuickAddText}
          placeholder={`e.g., "Pay electricity bill tomorrow at 8 pm"`}
          placeholderTextColor={colors.textTertiary}
          multiline
          numberOfLines={3}
        />
        <Pressable
          disabled={!quickAddText.trim() || isQuickAdding}
          onPress={async () => {
            if (!quickAddText.trim()) return;
            setIsQuickAdding(true);
            await quickAddReminder(quickAddText.trim());
            setIsQuickAdding(false);
            setShowQuickAdd(false);
            setQuickAddText('');
          }}
          style={[
            styles.shareBtn,
            {
              backgroundColor: !quickAddText.trim() || isQuickAdding ? colors.accentDim : colors.accent,
              marginTop: 10,
            },
          ]}
        >
          {isQuickAdding ? (
            <PremiumLoader size={28} compact />
          ) : (
            <>
              <Ionicons name="checkmark-circle" size={18} color="#FFFFFF" />
              <Text style={[styles.shareBtnText, { color: '#FFFFFF' }]}>Create Reminder</Text>
            </>
          )}
        </Pressable>
      </CustomModal>
      <CustomModal visible={isSnoozeModalVisible} onClose={() => setIsSnoozeModalVisible(false)} showCloseButton={false}>
        <View style={styles.modalHeader}>
          <Text style={[styles.snoozeModalTitle, { color: colors.text }]}>Snooze Reminder</Text>
        </View>
        <Text style={[styles.snoozeModalSubtitle, { color: colors.textSecondary }]}>
          When should we remind you again?
        </Text>

        <View style={styles.snoozeOptions}>
          {[
            { label: '10 Minutes', desc: 'Quick nudge', icon: 'timer-outline', color: colors.accent, value: { minutes: 10 } },
            { label: '1 Hour', desc: 'Later today', icon: 'time-outline', color: colors.accentBlue, value: { minutes: 60 } },
            { label: 'Tomorrow', desc: 'At 9:00 AM', icon: 'sunny-outline', color: colors.warning, value: { days: 1 } },
            { label: 'Next Week', desc: '7 days later', icon: 'calendar-outline', color: colors.accentMint, value: { days: 7 } },
          ].map((opt) => (
            <Pressable
              key={opt.label}
              onPress={async () => {
                if (activeReminderId) {
                  await snoozeReminder(activeReminderId, opt.value.days || 0, opt.value.minutes || 0);
                  setIsSnoozeModalVisible(false);
                  setActiveReminderId(null);
                }
              }}
              style={({ pressed }) => [
                styles.snoozeOption,
                {
                  backgroundColor: colors.cardElevated,
                  borderColor: colors.border,
                  opacity: pressed ? 0.7 : 1,
                },
              ]}
            >
              <View style={[styles.snoozeIconWrap, { backgroundColor: opt.color + '15' }]}>
                <Ionicons name={opt.icon as any} size={20} color={opt.color} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.snoozeOptionLabel, { color: colors.text, fontSize: isSeniorMode ? 18 : 16 }]}>
                  {opt.label}
                </Text>
                <Text style={[styles.snoozeOptionDesc, { color: colors.textTertiary, fontSize: isSeniorMode ? 14 : 12 }]}>
                  {opt.desc}
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={16} color={colors.textTertiary} />
            </Pressable>
          ))}
        </View>

        <Pressable
          onPress={() => setIsSnoozeModalVisible(false)}
          style={[styles.snoozeCancelBtn, { borderColor: colors.border }]}
        >
          <Text style={[styles.snoozeCancelText, { color: colors.textSecondary }]}>Cancel</Text>
        </Pressable>
      </CustomModal>

      <CustomModal visible={isCancelModalVisible} onClose={() => setIsCancelModalVisible(false)}>
        <View style={{ alignItems: 'center' }}>
          <View style={[styles.confirmIconWrap, { backgroundColor: colors.dangerDim }]}>
            <Ionicons name="trash-outline" size={32} color={colors.danger} />
          </View>
          <Text style={[styles.confirmTitle, { color: colors.text }]}>Remove Reminder?</Text>
          <Text style={[styles.confirmSubtitle, { color: colors.textSecondary }]}>
            Are you sure you want to stop tracking this reminder? You won't get any more alerts for it.
          </Text>

          <View style={styles.confirmActions}>
            <Pressable
              onPress={() => setIsCancelModalVisible(false)}
              style={[styles.confirmBtn, { borderColor: colors.border }]}
            >
              <Text style={[styles.confirmBtnText, { color: colors.textSecondary }]}>No, Keep It</Text>
            </Pressable>
            <Pressable
              onPress={async () => {
                if (activeReminderId) {
                  await cancelReminder(activeReminderId);
                  setIsCancelModalVisible(false);
                  setActiveReminderId(null);
                }
              }}
              style={[styles.confirmBtn, { backgroundColor: colors.danger, borderColor: colors.danger }]}
            >
              <Text style={[styles.confirmBtnText, { color: '#FFFFFF' }]}>Yes, Remove</Text>
            </Pressable>
          </View>
        </View>
      </CustomModal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  centered: { justifyContent: 'center', alignItems: 'center' },
  syncOverlayCard: { padding: 32, borderRadius: 24, alignItems: 'center', minWidth: 260 },
  syncIconWrap: { width: 80, height: 80, borderRadius: 40, alignItems: 'center', justifyContent: 'center', marginBottom: 20 },
  syncTitle: { fontFamily: 'Inter_700Bold', fontSize: 22, marginBottom: 8 },
  syncSubtitle: { fontFamily: 'Inter_400Regular', fontSize: 14 },
  scrollContent: { paddingHorizontal: 20, gap: 4 },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  headerLeft: { flex: 1, minWidth: 0 },
  greetingRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  greetingIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  greetingTextWrap: { flex: 1, gap: 2, justifyContent: 'center', minWidth: 0 },
  greetingAnimated: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 13,
    letterSpacing: 0.3,
  },
  userNameHero: {
    fontFamily: 'Inter_700Bold',
    fontSize: 24,
    letterSpacing: -0.3,
  },
  greeting: { fontFamily: 'Inter_400Regular', fontSize: 14, opacity: 0.6 },
  userName: { fontFamily: 'Inter_700Bold', fontSize: 26 },
  settingsBtn: {
    width: 44,
    height: 44,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  iconBtn: {
    width: 40,
    height: 40,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  unreadDot: {
    position: 'absolute',
    top: 6,
    right: 6,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#EF4444',
  },
  heroCard: { borderRadius: 24, padding: 24, marginBottom: 20 },
  heroTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  heroLeft: { flex: 1, marginRight: 16 },
  heroLabel: { fontFamily: 'Inter_500Medium', fontSize: 12, letterSpacing: 1.5, marginBottom: 6 },
  heroAmount: { fontFamily: 'Inter_700Bold', fontSize: 36, marginBottom: 12 },
  budgetSection: { gap: 6 },
  budgetTrack: { height: 4, borderRadius: 2, overflow: 'hidden' },
  budgetFill: { height: '100%', borderRadius: 2 },
  budgetText: { fontFamily: 'Inter_400Regular', fontSize: 11 },
  heroDivider: { height: 1, marginVertical: 18 },
  heroStats: { flexDirection: 'row', alignItems: 'center' },
  heroStat: { flex: 1, alignItems: 'center' },
  heroStatDivider: { width: 1, height: 28 },
  heroStatLabel: { fontFamily: 'Inter_400Regular', fontSize: 10, marginBottom: 4 },
  heroStatValue: { fontFamily: 'Inter_600SemiBold', fontSize: 15 },
  sectionTitle: { fontFamily: 'Inter_600SemiBold', fontSize: 17, marginBottom: 14 },
  emptyCard: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 16,
    borderWidth: 1,
    paddingHorizontal: 16,
    paddingVertical: 14,
    marginBottom: 24,
    gap: 12,
  },
  emptyIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyTextWrap: { flex: 1, gap: 2 },
  emptyTitle: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 14,
  },
  emptySubtitle: {
    fontFamily: 'Inter_400Regular',
    fontSize: 12,
  },
  remindersScroll: { gap: 10, paddingBottom: 20 },
  reminderPill: { flexDirection: 'row', alignItems: 'center', borderRadius: 16, paddingHorizontal: 14, paddingVertical: 12, borderWidth: 1, gap: 10, minWidth: 200 },
  reminderPillIcon: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  reminderPillInfo: { flex: 1, gap: 2 },
  reminderPillName: { fontFamily: 'Inter_600SemiBold', fontSize: 13 },
  reminderPillDue: { fontFamily: 'Inter_400Regular', fontSize: 11 },
  reminderPillAmount: { fontFamily: 'Inter_700Bold', fontSize: 14 },
  insightsRow: { flexDirection: 'row', gap: 10, marginBottom: 20 },
  insightCard: { flex: 1, borderRadius: 16, padding: 14, gap: 6, borderWidth: 1 },
  insightIconWrap: { width: 32, height: 32, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  insightTitle: { fontFamily: 'Inter_500Medium', fontSize: 11 },
  insightValue: { fontFamily: 'Inter_700Bold', fontSize: 18 },
  insightSubtitle: { fontFamily: 'Inter_400Regular', fontSize: 10 },
  quickAccessScroll: { gap: 10, paddingBottom: 20 },
  quickReachRow: { flexDirection: 'row', gap: 10, paddingBottom: 20 },
  quickCard: { flex: 1, minWidth: 0, borderRadius: 16, padding: 16, borderWidth: 1, gap: 8 },
  quickCardIcon: { width: 42, height: 42, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  quickCardLabel: { fontFamily: 'Inter_600SemiBold', fontSize: 14 },
  quickCardSubtitle: { fontFamily: 'Inter_400Regular', fontSize: 11 },
  lifeInsightCard: {
    flexDirection: 'row',
    borderRadius: 16,
    padding: 18,
    gap: 14,
    alignItems: 'center',
    borderWidth: 1,
    marginBottom: 24,
  },
  lifeInsightIconWrap: { width: 42, height: 42, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  lifeInsightContent: { flex: 1, gap: 4 },
  lifeInsightTitle: { fontFamily: 'Inter_600SemiBold', fontSize: 14 },
  lifeInsightText: { fontFamily: 'Inter_400Regular', fontSize: 13, lineHeight: 19 },
  categoryScroll: { paddingBottom: 24, gap: 10 },
  categoryPill: { borderRadius: 16, paddingHorizontal: 16, paddingVertical: 14, borderWidth: 1, flexDirection: 'row', alignItems: 'center', gap: 12 },
  catIconWrap: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  catTextWrap: { gap: 2 },
  categoryPillLabel: { fontFamily: 'Inter_400Regular', fontSize: 11 },
  categoryPillAmount: { fontFamily: 'Inter_700Bold', fontSize: 16 },
  txCard: { borderRadius: 16, padding: 6, borderWidth: 1 },
  txRow: { flexDirection: 'row', alignItems: 'center', padding: 14 },
  txIcon: { width: 42, height: 42, borderRadius: 14, alignItems: 'center', justifyContent: 'center', marginRight: 12 },
  txInfo: { flex: 1 },
  txMerchant: { fontFamily: 'Inter_600SemiBold', fontSize: 15 },
  txTime: { fontFamily: 'Inter_400Regular', fontSize: 12, marginTop: 2 },
  txAmount: { fontFamily: 'Inter_600SemiBold', fontSize: 15 },
  txDivider: { height: 1, marginHorizontal: 14 },
  primaryCircleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 18,
    marginTop: 4,
  },
  primaryCircleItem: {
    flex: 1,
    alignItems: 'center',
  },
  primaryCircleFill: {
    width: 74,
    height: 74,
    borderRadius: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  primaryCircleInnerWhiteBorder: {
    position: 'absolute',
    top: 1,
    left: 1,
    right: 1,
    bottom: 1,
    borderRadius: 40,
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.90)',
  },
  primaryCircleLabel: {
    fontFamily: 'Dmsans_500SemiBold',
    fontSize: 11,
    marginTop: 8,
    textAlign: 'center',
    width: 'auto' as const,
  },
  seniorHeroCard: { borderRadius: 24, padding: 28, borderWidth: 1, alignItems: 'center', marginBottom: 28, gap: 8 },
  seniorHeroLabel: { fontFamily: 'Inter_500Medium', fontSize: 14 },
  seniorHeroAmount: { fontFamily: 'Inter_700Bold', fontSize: 42, letterSpacing: -1 },
  seniorGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 14 },
  seniorBtn: { width: '47%' as any, borderRadius: 24, padding: 28, borderWidth: 1, alignItems: 'center', gap: 14 },
  seniorBtnIcon: { width: 72, height: 72, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  seniorBtnLabel: { fontFamily: 'Inter_700Bold', fontSize: 18 },
  scoreOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center', padding: 24 },
  grabber: { width: 36, height: 4, borderRadius: 2, alignSelf: 'center', marginBottom: 16 },
  scoreDetailCard: { borderRadius: 24, padding: 24, borderWidth: 1, width: '100%', maxWidth: 360 },
  // `paddingRight` keeps the title clear of CustomModal's floating close
  // button, which sits absolutely positioned in the sheet's top-right corner.
  scoreDetailHeader: { flexDirection: 'row', alignItems: 'center', paddingRight: 44, paddingBottom: 16, borderBottomWidth: 1, marginBottom: 4 },
  scoreDetailTitle: { fontFamily: 'Inter_700Bold', fontSize: 18 },
  input: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontFamily: 'Inter_400Regular',
    fontSize: 14,
    textAlignVertical: 'top',
    minHeight: 86,
  },
  scoreBreakdown: { gap: 4, marginBottom: 16 },
  scoreRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 12, borderBottomWidth: 1 },
  scoreRowLeft: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  scoreRowDot: { width: 10, height: 10, borderRadius: 5 },
  scoreRowLabel: { fontFamily: 'Inter_500Medium', fontSize: 14 },
  scoreRowValue: { fontFamily: 'Inter_700Bold', fontSize: 14 },
  shareBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 14, borderRadius: 14 },
  shareBtnText: { fontFamily: 'Inter_600SemiBold', fontSize: 14 },
  syncBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'stretch',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 12,
    marginBottom: 12,
  },
  syncBannerText: {
    fontFamily: 'Inter_400Regular',
    fontSize: 12,
  },
  syncBannerSubText: {
    fontFamily: 'Inter_400Regular',
    fontSize: 11,
    marginTop: 2,
  },
  reminderAlert: {
    alignSelf: 'stretch',
    borderRadius: 16,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginBottom: 8,
  },
  reminderAlertLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flexShrink: 1,
  },
  reminderAlertTitle: {
    fontFamily: 'Inter_700Bold',
    fontSize: 13,
  },
  reminderAlertSubtitle: {
    fontFamily: 'Inter_400Regular',
    fontSize: 11,
    marginTop: 2,
  },
  reminderAlertRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  reminderAlertActions: {
    flexDirection: 'row',
    gap: 6,
  },
  reminderAlertIconWrap: {
    width: 34,
    height: 34,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  alertActionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 6,
    paddingHorizontal: 8,
    borderRadius: 10,
    borderWidth: 1,
  },
  alertActionText: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 11,
  },
  modalOverlayCentered: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  snoozeModalCard: {
    borderRadius: 24,
    padding: 24,
    borderWidth: 1,
    width: '100%',
    maxWidth: 360,
  },
  snoozeModalTitle: {
    fontFamily: 'Inter_700Bold',
    fontSize: 20,
    textAlign: 'center',
    marginBottom: 8,
  },
  snoozeModalSubtitle: {
    fontFamily: 'Inter_400Regular',
    fontSize: 14,
    textAlign: 'center',
    marginBottom: 24,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  modalCloseBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  snoozeOptions: {
    gap: 12,
    marginBottom: 20,
  },
  snoozeOption: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderRadius: 16,
    borderWidth: 1,
    gap: 14,
  },
  snoozeIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  snoozeOptionLabel: {
    flex: 1,
    fontFamily: 'Inter_600SemiBold',
    fontSize: 16,
  },
  snoozeOptionDesc: {
    fontFamily: 'Inter_400Regular',
    fontSize: 12,
    marginTop: 2,
  },
  snoozeCancelBtn: {
    paddingVertical: 16,
    alignItems: 'center',
    borderRadius: 14,
    borderWidth: 1,
  },
  snoozeCancelText: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 15,
  },
  mustMinimalFullBanner: {
    alignSelf: 'stretch',
    borderRadius: 16,
    borderWidth: 1,
    paddingHorizontal: 16,
    marginBottom: 12,
    overflow: 'hidden',
  },
  mustMinimalContent: {
    height: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  mustMinimalText: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 13,
    flex: 1,
  },
  minimalProgressBg: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 2,
  },
  minimalProgressFill: {
    height: '100%',
  },
  confirmModalCard: {
    borderRadius: 24,
    padding: 24,
    borderWidth: 1,
    width: '100%',
    maxWidth: 340,
    alignItems: 'center',
  },
  confirmIconWrap: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  confirmTitle: {
    fontFamily: 'Inter_700Bold',
    fontSize: 20,
    textAlign: 'center',
    marginBottom: 8,
  },
  confirmSubtitle: {
    fontFamily: 'Inter_400Regular',
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 24,
  },
  confirmActions: {
    flexDirection: 'row',
    gap: 12,
    width: '100%',
  },
  confirmBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 14,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  confirmBtnText: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 14,
  },
});
