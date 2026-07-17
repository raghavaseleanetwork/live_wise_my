import React, { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  Platform,
  StyleSheet,
  Text,
  Image,
  View,
  ScrollView,
  TextInput,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import DateTimePicker from '@react-native-community/datetimepicker';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { 
  GestureHandlerRootView, 
  Gesture,
  GestureDetector
} from 'react-native-gesture-handler';
import Animated, { 
  useAnimatedStyle, 
  useSharedValue, 
  withSpring 
} from 'react-native-reanimated';
import { useTheme } from '@/lib/theme-context';
import { useAuth } from '../../lib/auth-context';
import { useSeniorMode } from '@/lib/senior-context';
import { useAlert } from '@/lib/alert-context';
import PremiumLoader from '@/components/PremiumLoader';
import CustomModal from '@/components/CustomModal';
import { useExpenses } from '@/lib/expense-context';
import { useCurrency } from '@/lib/currency-context';
import { getApiUrl } from '@/lib/query-client';
import { REPEAT_OPTIONS, ReminderType, RepeatType, REMINDER_TYPE_CONFIG, type Bill } from '@/lib/data';
import { scheduleLocalNotification } from '@/lib/notifications';
import { getIntentPolicy, getReminderIntentFromBill } from '@/lib/reminder-intent';
import CategoryIcon from '@/components/CategoryIcon';

function timeLabelFromDate(d: Date) {
  const hour24 = d.getHours();
  const minute = d.getMinutes();
  const hour12 = ((hour24 + 11) % 12) + 1;
  const suffix = hour24 >= 12 ? 'PM' : 'AM';
  const mm = String(minute).padStart(2, '0');
  return `${hour12}:${mm} ${suffix}`;
}

function formatRepeat(r: RepeatType) {
  const found = REPEAT_OPTIONS.find((x) => x.key === r);
  return found?.label ?? 'One-time';
}

export default function BillDetailsScreen() {
  const { billId } = useLocalSearchParams<{ billId: string }>();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const { formatAmount } = useCurrency();
  const {
    bills,
    toggleBillPaid,
    editReminder,
    snoozeReminder,
    cancelReminder,
    uncancelReminder,
  } = useExpenses();
  const { isSeniorMode } = useSeniorMode();
  const { showAlert } = useAlert();

  const bill = useMemo(() => bills.find((b) => b.id === billId), [bills, billId]);

  const [showSnoozeModal, setShowSnoozeModal] = useState(false);
  const [showBillImageModal, setShowBillImageModal] = useState(false);
  const [showTimePickerModal, setShowTimePickerModal] = useState(false);
  const [showRepeatPickerModal, setShowRepeatPickerModal] = useState(false);
  const [tempTime, setTempTime] = useState<Date>(() => (bill ? new Date(bill.dueDate) : new Date()));
  const [tempRepeat, setTempRepeat] = useState<RepeatType>(() => (bill ? bill.repeatType : 'none'));
  const [draftTime, setDraftTime] = useState<Date>(() => (bill ? new Date(bill.dueDate) : new Date()));
  const [draftRepeat, setDraftRepeat] = useState<RepeatType>(() => (bill ? bill.repeatType : 'none'));
  const [tempAmount, setTempAmount] = useState<string>(() => (bill ? bill.amount.toString() : '0'));
  const [tempName, setTempName] = useState<string>(() => (bill ? bill.name : ''));
  const [tempVendor, setTempVendor] = useState<string>(() => (bill?.vendorName || ''));
  const [tempBillNum, setTempBillNum] = useState<string>(() => (bill?.billNumber || ''));
  const [tempAccNum, setTempAccNum] = useState<string>(() => (bill?.accountNumber || ''));
  const [editError, setEditError] = useState<string>('');
  const { token } = useAuth();
  const [history, setHistory] = useState<any[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(true);

  async function fetchHistory() {
    if (!token) return;
    try {
      const baseUrl = getApiUrl();
      const res = await fetch(`${baseUrl}/api/bills/${billId}/history`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        setHistory(data.slice(0, 2)); // Only show last 2 in preview
      }
    } catch (err) {
      console.error('Fetch history preview error:', err);
    } finally {
      setLoadingHistory(false);
    }
  }

  React.useEffect(() => {
    fetchHistory();
  }, [billId, token]);

  // Pinch to zoom shared values
  const scale = useSharedValue(1);
  const focalX = useSharedValue(0);
  const focalY = useSharedValue(0);

  const pinchGesture = Gesture.Pinch()
    .onUpdate((event) => {
      scale.value = event.scale;
      focalX.value = event.focalX;
      focalY.value = event.focalY;
    })
    .onEnd(() => {
      scale.value = withSpring(1);
    });

  const animatedImageStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: focalX.value },
      { translateY: focalY.value },
      { scale: scale.value },
      { translateX: -focalX.value },
      { translateY: -focalY.value },
    ],
  }));

  React.useEffect(() => {
    if (!bill) return;
    setTempTime(new Date(bill.dueDate));
    setTempRepeat(bill.repeatType);
    setDraftTime(new Date(bill.dueDate));
    setDraftRepeat(bill.repeatType);
    setTempAmount(bill.amount.toString());
    setTempName(bill.name);
    setTempVendor(bill.vendorName || '');
    setTempBillNum(bill.billNumber || '');
    setTempAccNum(bill.accountNumber || '');
    if (bill.status === 'cancelled') { // Assuming uncancel is desired if bill was cancelled
      uncancelReminder(bill.id);
    }
    fetchHistory(); // Refresh history
  }, [bill]);

  const isPaid = bill ? bill.status === 'paid' || bill.isPaid : false;
  const dueDate = bill ? new Date(bill.dueDate) : null;
  const repeatLabel = bill ? formatRepeat(bill.repeatType) : '';
  const intent = bill ? getReminderIntentFromBill(bill) : 'custom';
  const policy = getIntentPolicy(intent);

  const headerTop = Platform.OS === 'web' ? 36 : insets.top + 8;
  const contentPadBottom = Math.max(insets.bottom, 16);

  async function onSaveEdit() {
    if (!bill) return;
    if (!tempName.trim()) {
      setEditError('Name is required');
      return;
    }
    const amountNum = parseFloat(tempAmount);
    if (isNaN(amountNum) || amountNum < 0) {
      setEditError('Please enter a valid amount');
      return;
    }
    setEditError('');
    const nextDue = new Date(tempTime);

    const updated: Bill = {
      ...bill,
      name: tempName || bill.name,
      amount: amountNum,
      dueDate: nextDue.toISOString(),
      repeatType: tempRepeat,
      vendorName: tempVendor,
      billNumber: tempBillNum,
      accountNumber: tempAccNum,
      status: 'active',
      snoozedUntil: undefined,
    };

    editReminder(updated);

    scheduleLocalNotification({
      title: `${updated.name} Due`,
      body: `₹${updated.amount} is due today.`,
      data: { type: 'reminder', billId: bill.id },
      triggerAt: nextDue,
    }).catch(() => {});

    setEditError('');
  }

  function onToggleDone() {
    if (!bill) return;
    toggleBillPaid(bill.id);
    fetchHistory(); // Refresh history
  }

  function onSnooze(days: number) {
    if (!bill) return;
    snoozeReminder(bill.id, days);
    fetchHistory(); // Refresh history
    
    // Best-effort schedule for snoozed time.
    const snoozedUntil = new Date();
    snoozedUntil.setDate(snoozedUntil.getDate() + days);
    scheduleLocalNotification({
      title: 'Reminder',
      body: bill.name,
      data: { type: 'reminder', billId: bill.id },
      triggerAt: snoozedUntil,
    }).catch(() => {});

    setShowSnoozeModal(false);
  }

  function onCancelReminder() {
    if (!bill) return;
    cancelReminder(bill.id);
    fetchHistory(); // Refresh history
    setShowSnoozeModal(false); // Close snooze modal if open
  }

  if (!bill) {
    return (
      <View style={[styles.container, { backgroundColor: colors.bg }]}>
        <View style={{ paddingTop: headerTop, paddingHorizontal: 18 }}>
          <Pressable onPress={() => router.back()} hitSlop={12}>
            <Ionicons name="chevron-back" size={22} color={colors.text} />
          </Pressable>
        </View>
        <View style={styles.center}>
          <PremiumLoader text="Loading reminder..." />
        </View>
      </View>
    );
  }

  const statusLabel =
    bill.status === 'paid'
      ? 'Done'
      : bill.status === 'snoozed'
        ? 'Snoozed'
        : dueDate
            ? (dueDate.getTime() < Date.now() ? 'Overdue' : 'Upcoming')
          : bill.status === 'cancelled'
            ? 'Cancelled'
            : 'Active';

  const snoozedUntilLabel =
    bill.status === 'snoozed' && bill.snoozedUntil
      ? `Until ${new Date(bill.snoozedUntil).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}`
      : null;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <View style={[styles.container, { backgroundColor: colors.bg }]}>
      {/* Premium Header */}
      <View style={styles.headerOuter}>
        <View style={[styles.headerGradient, { paddingTop: headerTop, backgroundColor: '#1E1B4B' }]}>
          {/* Abstract pattern decoration */}
          <View style={styles.headerDecoration1} />
          <View style={styles.headerDecoration2} />
          
          {/* Animated Category Icon Decoration */}
          <View style={styles.headerCatIconPos}>
            <CategoryIcon category={bill.category} size={120} color="rgba(255,255,255,0.12)" />
          </View>

          <View style={styles.headerTop}>
            <Pressable onPress={() => router.back()} style={[styles.headerBackBtn, isSeniorMode && { width: 50, height: 50, borderRadius: 25 }]}>
              <Ionicons name="chevron-back" size={isSeniorMode ? 32 : 24} color="#FFFFFF" />
            </Pressable>
            <Text style={[styles.headerTitleMain, isSeniorMode && { fontSize: 22 }]}>Reminder Details</Text>
            <Pressable onPress={() => router.push({ pathname: '/edit-reminder', params: { id: bill.id } })} style={[styles.headerEditBtn, isSeniorMode && { width: 50, height: 50, borderRadius: 25 }]}>
              <Ionicons name="pencil" size={isSeniorMode ? 28 : 20} color="#FFFFFF" />
            </Pressable>
          </View>

          <View style={styles.headerHero}>
            {bill.amount > 0 && (
              <View style={styles.heroAmountBadge}>
                <Text style={styles.heroAmount}>{formatAmount(bill.amount)}</Text>
              </View>
            )}
            <Text style={styles.heroName}>{bill.name}</Text>
            <View style={[styles.heroStatusBadge, { backgroundColor: isPaid ? 'rgba(16, 185, 129, 0.2)' : 'rgba(239, 68, 68, 0.2)' }]}>
              <View style={[styles.statusDot, { backgroundColor: isPaid ? '#10B981' : '#EF4444' }]} />
              <Text style={[styles.heroStatusText, { color: '#FFFFFF' }]}>{statusLabel}</Text>
            </View>
          </View>
        </View>
      </View>

      <ScrollView
        style={styles.contentScroll}
        contentContainerStyle={{ paddingBottom: contentPadBottom + 120 }}
        showsVerticalScrollIndicator={false}
      >
        {/* Main Info Card */}
        <View style={[styles.mainCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={styles.infoRow}>
            <View style={[styles.infoIconWrap, { backgroundColor: colors.accentDim }]}>
              <Ionicons name="calendar-outline" size={20} color={colors.accent} />
            </View>
            <View style={styles.infoTextWrap}>
              <Text style={[styles.infoLabel, { color: colors.textSecondary }, isSeniorMode && { fontSize: 16 }]}>Due Date</Text>
              <Text style={[styles.infoValue, { color: colors.text }, isSeniorMode && { fontSize: 18 }]}>
                {dueDate?.toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })}
              </Text>
            </View>
          </View>

          <View style={styles.infoRow}>
            <View style={[styles.infoIconWrap, { backgroundColor: colors.accentMintDim }]}>
              <Ionicons name="repeat-outline" size={20} color={colors.accentMint} />
            </View>
            <View style={styles.infoTextWrap}>
              <Text style={[styles.infoLabel, { color: colors.textSecondary }]}>Frequency</Text>
              <Text style={[styles.infoValue, { color: colors.text }]}>{repeatLabel}</Text>
            </View>
          </View>

          <View style={styles.infoRow}>
            <View style={[styles.infoIconWrap, { backgroundColor: colors.warningDim }]}>
              <Ionicons name="stats-chart-outline" size={20} color={colors.warning} />
            </View>
            <View style={styles.infoTextWrap}>
              <Text style={[styles.infoLabel, { color: colors.textSecondary }]}>Status</Text>
              <View style={[styles.statusBadge, { backgroundColor: isPaid ? colors.accentMintDim : colors.dangerDim }]}>
                <Text style={[styles.statusBadgeText, { color: isPaid ? colors.accentMint : colors.danger }]}>
                  {isPaid ? 'Paid' : 'Upcoming'}
                </Text>
              </View>
            </View>
          </View>
        </View>

        {/* Metadata section if available */}
        {(bill.vendorName || bill.billNumber || bill.accountNumber) && (
          <View style={styles.section}>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>Bill Metadata</Text>
            <View style={[styles.metaCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
              {bill.vendorName && (
                <View style={styles.metaItem}>
                  <Text style={[styles.metaLabel, { color: colors.textSecondary }]}>Vendor</Text>
                  <Text style={[styles.metaValue, { color: colors.text }]}>{bill.vendorName}</Text>
                </View>
              )}
              {bill.billNumber && (
                <View style={styles.metaItem}>
                  <Text style={[styles.metaLabel, { color: colors.textSecondary }]}>Bill / Invoice #</Text>
                  <Text style={[styles.metaValue, { color: colors.text }]}>{bill.billNumber}</Text>
                </View>
              )}
              {bill.accountNumber && (
                <View style={styles.metaItem}>
                  <Text style={[styles.metaLabel, { color: colors.textSecondary }]}>Account #</Text>
                  <Text style={[styles.metaValue, { color: colors.text }]}>{bill.accountNumber}</Text>
                </View>
              )}
            </View>
          </View>
        )}

        {/* Smart Insights Section */}
        <View style={styles.section}>
          <View style={styles.sectionHeaderRow}>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>Smart Insights</Text>
            <View style={[styles.aiBadge, { backgroundColor: colors.accentDim, borderColor: colors.accent + '40' }]}>
              <Ionicons name="sparkles" size={10} color={colors.accent} />
              <Text style={[styles.aiBadgeText, { color: colors.accent }]}>AI</Text>
            </View>
          </View>
          <View style={[styles.insightCard, { backgroundColor: colors.accentDim, borderWidth: 1, borderColor: colors.accent + '30' }]}>
            <View style={styles.insightGradient}>
              <View style={[styles.insightIconWrap, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <Ionicons name="trending-up-outline" size={24} color={colors.accent} />
              </View>
              <View style={styles.insightContent}>
                <Text style={[styles.insightTitle, { color: colors.text }]}>Predicted Savings</Text>
                <Text style={[styles.insightDesc, { color: colors.textSecondary }]}>
                  Paying this {repeatLabel.toLowerCase()} reduces late fees by approx. ₹150 yearly.
                </Text>
              </View>
              </View>
            </View>
        </View>

        {/* Payment History Section */}
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>Payment History</Text>
          <View style={[styles.historyCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            {loadingHistory ? (
              <PremiumLoader size={40} />
            ) : history.length === 0 ? (
              <View style={{ padding: 20, alignItems: 'center' }}>
                <Text style={{ color: colors.textTertiary, fontFamily: 'Inter_500Medium', fontSize: 13 }}>
                  No payment history yet.
                </Text>
              </View>
            ) : (
              history.map((item, idx) => (
                <View key={item._id} style={[styles.historyRow, { borderBottomColor: colors.border }, idx === history.length - 1 && { borderBottomWidth: 0 }]}>
                  <View style={[styles.historyIconWrap, { backgroundColor: getActionColor(item.action).bg }]}>
                    <Ionicons name={getActionIcon(item.action)} size={18} color={getActionColor(item.action).text} />
                  </View>
                  <View style={styles.historyInfo}>
                    <Text style={[styles.historyDate, { color: colors.text }]}>
                      {new Date(item.date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                    </Text>
                    <Text style={[styles.historyStatus, { color: getActionColor(item.action).text }]}>
                      {item.action.toUpperCase()}
                    </Text>
                  </View>
                  {item.amount ? (
                    <Text style={[styles.historyAmount, { color: colors.text }]}>{formatAmount(item.amount)}</Text>
                  ) : (
                    <Text style={[styles.historyStatus, { color: colors.textSecondary }]}>{item.note}</Text>
                  )}
                </View>
              ))
            )}
            <Pressable
              style={[styles.viewMoreBtn, isSeniorMode && { paddingVertical: 18 }]}
              onPress={() => router.push({ pathname: '/bill-history/[billId]', params: { billId: bill.id } } as any)}
            >
              <Text style={[styles.viewMoreText, { color: colors.accent }]}>View Full History</Text>
              <Ionicons name="chevron-forward" size={14} color={colors.accent} />
            </Pressable>
          </View>
        </View>

        {/* Bill Image / Official Document */}
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>{bill.imageUrl ? 'Official Bill' : 'Smart Summary'}</Text>
          {bill.imageUrl ? (
            <Pressable onPress={() => setShowBillImageModal(true)} style={styles.billImageContainer}>
              <Image source={{ uri: bill.imageUrl }} style={styles.billImage} resizeMode="cover" />
              <View style={[styles.billImageOverlay, { backgroundColor: 'rgba(0,0,0,0.4)' }]}>
                <Ionicons name="expand-outline" size={24} color="#FFFFFF" />
                <Text style={styles.billImageOverlayText}>View Full Bill</Text>
              </View>
            </Pressable>
          ) : (
            <View style={[styles.emptyBillCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <View style={[styles.emptyBillIconWrap, { backgroundColor: colors.bg }]}>
                <Ionicons name="document-text-outline" size={32} color={colors.textTertiary} />
              </View>
              <Text style={[styles.emptyBillTitle, { color: colors.text }]}>Digital Summary Available</Text>
              <Text style={[styles.emptyBillDesc, { color: colors.textSecondary }]}>No physical scan attached. AI has summarized the intent as {intent}.</Text>
              <Pressable
                style={[styles.addScanBtnPremium, { backgroundColor: colors.accent }]}
                onPress={() => router.push(`/scan-bill?billId=${bill.id}`)}
              >
                <View style={styles.addScanGradient}>
                  <Ionicons name="camera" size={18} color="#FFFFFF" />
                  <Text style={styles.addScanBtnTextPremium}>Attach Official Bill Scan</Text>
                </View>
              </Pressable>
            </View>
          )}
        </View>
      </ScrollView>

      {/* Floating Bottom Action Bar */}
      <View style={[styles.bottomBar, { backgroundColor: colors.card, borderTopColor: colors.border, paddingBottom: Math.max(insets.bottom, 16) }]}>
        {/* Primary Action Row */}
        <Pressable
          style={[styles.bottomBtnMain, { backgroundColor: isPaid ? '#94A3B8' : '#10B981' }, isSeniorMode && { height: 74, borderRadius: 20 }]}
          onPress={onToggleDone}
        >
          <Ionicons name={isPaid ? "refresh-outline" : "checkmark-circle-outline"} size={isSeniorMode ? 32 : 22} color="#FFFFFF" />
          <Text 
            style={[styles.bottomBtnTextMain, isSeniorMode && { fontSize: 20 }]}
            numberOfLines={1}
            adjustsFontSizeToFit
          >
            {isPaid 
              ? (bill.amount > 0 ? 'Mark Unpaid' : 'Mark Not Done') 
              : (bill.amount > 0 ? 'Mark as Paid' : 'Mark as Done')
            }
          </Text>
        </Pressable>

        {/* Secondary Actions Row */}
        <View style={styles.secondaryActionsRow}>
          <Pressable
            style={[styles.bottomBtn, { backgroundColor: colors.cardElevated }, isSeniorMode && { height: 64, borderRadius: 16 }]}
            onPress={() => setShowSnoozeModal(true)}
          >
            <Ionicons name="notifications-off-outline" size={isSeniorMode ? 28 : 20} color={colors.textSecondary} />
            <Text
              style={[styles.bottomBtnText, { color: colors.textSecondary }, isSeniorMode && { fontSize: 18 }]}
              numberOfLines={1}
              adjustsFontSizeToFit
            >
              Snooze
            </Text>
          </Pressable>

          {bill.status === 'cancelled' ? (
            <Pressable
              style={[styles.bottomBtn, { backgroundColor: colors.accentBlueDim }]}
              onPress={() => uncancelReminder(bill.id)}
            >
              <Ionicons name="arrow-undo-outline" size={20} color={colors.accentBlue} />
              <Text style={[styles.bottomBtnText, { color: colors.accentBlue }]}>Restore</Text>
            </Pressable>
          ) : (
            <Pressable
              style={[styles.bottomBtn, { backgroundColor: colors.dangerDim }]}
              onPress={() => cancelReminder(bill.id)}
            >
              <Ionicons name="close-outline" size={20} color={colors.danger} />
              <Text 
                style={[styles.bottomBtnText, { color: '#EF4444' }]}
                numberOfLines={1}
                adjustsFontSizeToFit
              >
                Cancel
              </Text>
            </Pressable>
          )}
        </View>
      </View>

      {/* Edit modal removed in favor of full screen app/edit-reminder.tsx */}

      {/* Repeat picker modal */}
      <CustomModal visible={showRepeatPickerModal} onClose={() => setShowRepeatPickerModal(false)} showCloseButton={false}>
        <Text style={[styles.modalTitle, { color: colors.text }]}>Repeat</Text>
        <ScrollView style={{ maxHeight: 260 }}>
          {REPEAT_OPTIONS.map((opt) => {
            const active = opt.key === draftRepeat;
            return (
              <Pressable
                key={opt.key}
                onPress={() => setDraftRepeat(opt.key)}
                style={[styles.repeatRow, active && { backgroundColor: colors.accentDim }]}
              >
                <Text style={[styles.repeatLabel, active && { color: colors.accent, fontFamily: 'Inter_600SemiBold' }, { color: colors.text }]}>
                  {opt.label}
                </Text>
                {active ? <Ionicons name="checkmark" size={16} color={colors.accent} /> : null}
              </Pressable>
            );
          })}
        </ScrollView>
        <View style={styles.modalActionsRow}>
          <Pressable onPress={() => setShowRepeatPickerModal(false)} style={styles.modalTextButton}>
            <Text style={[styles.modalTextButtonLabel, { color: colors.textTertiary }]}>Cancel</Text>
          </Pressable>
          <Pressable
            onPress={() => {
              setTempRepeat(draftRepeat);
              setShowRepeatPickerModal(false);
            }}
            style={[styles.modalPrimaryButton, { backgroundColor: colors.accent }]}
          >
            <Text style={[styles.modalPrimaryButtonLabel, { color: '#FFFFFF' }]}>Save</Text>
          </Pressable>
        </View>
      </CustomModal>

      {/* Snooze modal */}
      <CustomModal visible={showSnoozeModal} onClose={() => setShowSnoozeModal(false)}>
        <Text style={[styles.sheetTitle, { color: colors.text }]}>Snooze reminder</Text>
        <Text style={[styles.sheetSubtitle, { color: colors.textSecondary }]}>Remind me again in…</Text>

        <View style={styles.snoozeGrid}>
          {[
            { days: 1, label: '1 Day', icon: 'sunny' as const, accent: '#EA580C' },
            { days: 2, label: '2 Days', icon: 'partly-sunny' as const, accent: '#F59E0B' },
            { days: 3, label: '3 Days', icon: 'cloud' as const, accent: '#3B82F6' },
            { days: 7, label: '1 Week', icon: 'calendar' as const, accent: '#7C3AED' },
          ].map((opt) => (
            <Pressable
              key={opt.days}
              onPress={() => onSnooze(opt.days)}
              style={[
                styles.snoozeOption,
                { backgroundColor: colors.inputBg, borderColor: colors.border },
              ]}
            >
              <View style={[styles.snoozeIconWrap, { backgroundColor: opt.accent + '15' }]}>
                <Ionicons name={opt.icon} size={18} color={opt.accent} />
              </View>
              <Text style={[styles.snoozeOptionText, { color: colors.text }]}>{opt.label}</Text>
              <Ionicons name="chevron-forward" size={16} color={colors.textTertiary} />
            </Pressable>
          ))}
        </View>
      </CustomModal>

      {/* Bill image modal with zoom */}
      <CustomModal visible={showBillImageModal} onClose={() => setShowBillImageModal(false)} fullScreen={true}>
          <Pressable style={styles.imageModalCloseBtn} onPress={() => {
            setShowBillImageModal(false);
            scale.value = 1; // Reset zoom
          }}>
            <Ionicons name="close" size={30} color="#FFFFFF" />
          </Pressable>
          
          <View style={styles.imageModalContainer}>
            <GestureDetector gesture={pinchGesture}>
              <Animated.View style={[styles.imageModalImageWrapper, animatedImageStyle]}>
                {bill.imageUrl && (
                  <Image 
                    source={{ uri: bill.imageUrl }} 
                    style={styles.imageModalImageFull} 
                    resizeMode="contain" 
                  />
                )}
              </Animated.View>
            </GestureDetector>
          </View>
      </CustomModal>

      </View>
    </GestureHandlerRootView>
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
  container: { flex: 1, backgroundColor: '#F8FAFC' },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  loadingText: {
    marginTop: 10,
    fontFamily: 'Inter_600SemiBold',
    fontSize: 14,
    color: '#64748B',
  },
  headerOuter: {
    backgroundColor: '#1E1B4B',
    borderBottomLeftRadius: 40,
    borderBottomRightRadius: 40,
    overflow: 'hidden',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.05)',
  },
  headerGradient: {
    paddingHorizontal: 20,
    paddingBottom: 40,
  },
  headerDecoration1: {
    position: 'absolute',
    top: -50,
    right: -50,
    width: 200,
    height: 200,
    borderRadius: 100,
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  headerDecoration2: {
    position: 'absolute',
    bottom: -80,
    left: -20,
    width: 150,
    height: 150,
    borderRadius: 75,
    backgroundColor: 'rgba(255,255,255,0.05)',
  },
  headerCatIconPos: {
    position: 'absolute',
    top: 40,
    right: 20,
    opacity: 0.8,
  },
  headerTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 10,
  },
  headerBackBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerEditBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitleMain: {
    fontFamily: 'Inter_700Bold',
    fontSize: 18,
    color: '#FFFFFF',
  },
  headerHero: {
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 30,
  },
  heroAmountBadge: {
    backgroundColor: 'rgba(255,255,255,0.15)',
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.25)',
  },
  heroAmount: {
    fontFamily: 'Inter_900Black',
    fontSize: 48,
    color: '#FFFFFF',
  },
  heroName: {
    fontFamily: 'Inter_700Bold',
    fontSize: 22,
    color: '#FFFFFF',
    marginTop: 12,
    textAlign: 'center',
  },
  heroStatusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 20,
    marginTop: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  heroStatusText: {
    fontFamily: 'Inter_700Bold',
    fontSize: 12,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  contentScroll: {
    flex: 1,
    paddingHorizontal: 20,
    marginTop: 12,
  },
  mainCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 28,
    padding: 24,
    borderWidth: 1,
    borderColor: '#F1F5F9',
    gap: 20,
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  infoIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
  infoTextWrap: {
    flex: 1,
  },
  infoLabel: {
    fontFamily: 'Inter_500Medium',
    fontSize: 12,
    color: '#64748B',
    marginBottom: 2,
  },
  infoValue: {
    fontFamily: 'Inter_700Bold',
    fontSize: 15,
    color: '#1E293B',
  },
  statusBadge: {
    alignSelf: 'flex-start',
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 99,
    marginTop: 2,
  },
  statusBadgeText: {
    fontFamily: 'Inter_700Bold',
    fontSize: 11,
    textTransform: 'uppercase',
  },
  section: {
    marginTop: 32,
  },
  sectionTitle: {
    fontFamily: 'Inter_700Bold',
    fontSize: 16,
    color: '#1E293B',
    marginBottom: 12,
    paddingLeft: 4,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 12,
  },
  aiBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#F5F3FF',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#DDD6FE',
  },
  aiBadgeText: {
    fontFamily: 'Inter_800ExtraBold',
    fontSize: 10,
    color: '#7C3AED',
  },
  insightCard: {
    borderRadius: 24,
    overflow: 'hidden',
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#F1F5F9',
  },
  insightGradient: {
    padding: 20,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  insightIconWrap: {
    width: 48,
    height: 48,
    borderRadius: 16,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#F1F5F9',
  },
  insightContent: {
    flex: 1,
  },
  insightTitle: {
    fontFamily: 'Inter_700Bold',
    fontSize: 15,
    color: '#1E293B',
    marginBottom: 2,
  },
  insightDesc: {
    fontFamily: 'Inter_500Medium',
    fontSize: 13,
    color: '#64748B',
    lineHeight: 18,
  },
  historyCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 24,
    padding: 16,
    borderWidth: 1,
    borderColor: '#F1F5F9',
  },
  historyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#F8FAFC',
    gap: 14,
  },
  historyIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: '#F0FDF4',
    alignItems: 'center',
    justifyContent: 'center',
  },
  historyInfo: {
    flex: 1,
  },
  historyDate: {
    fontFamily: 'Inter_700Bold',
    fontSize: 14,
    color: '#1E293B',
  },
  historyStatus: {
    fontFamily: 'Inter_500Medium',
    fontSize: 12,
    color: '#10B981',
    marginTop: 1,
  },
  historyAmount: {
    fontFamily: 'Inter_800ExtraBold',
    fontSize: 15,
    color: '#1E293B',
  },
  viewMoreBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingTop: 12,
  },
  viewMoreText: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 13,
    color: '#64748B',
  },
  emptyBillCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 24,
    padding: 30,
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#F1F5F9',
    borderStyle: 'dashed',
  },
  emptyBillIconWrap: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: '#F8FAFC',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  emptyBillTitle: {
    fontFamily: 'Inter_700Bold',
    fontSize: 16,
    color: '#1E293B',
    marginBottom: 6,
  },
  emptyBillDesc: {
    fontFamily: 'Inter_500Medium',
    fontSize: 13,
    color: '#64748B',
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 20,
  },
  addScanBtnPremium: {
    marginTop: 16,
    borderRadius: 14,
    overflow: 'hidden',
  },
  addScanGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    paddingHorizontal: 20,
    gap: 10,
  },
  addScanBtnTextPremium: {
    fontFamily: 'Inter_700Bold',
    fontSize: 15,
    color: '#FFFFFF',
  },
  metaCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 16,
    gap: 14,
    borderWidth: 1,
    borderColor: '#F1F5F9',
  },
  metaItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  metaLabel: {
    fontFamily: 'Inter_500Medium',
    fontSize: 13,
    color: '#64748B',
  },
  metaValue: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 13,
    color: '#1E293B',
  },
  billImageContainer: {
    borderRadius: 20,
    overflow: 'hidden',
    height: 200,
    backgroundColor: '#000',
  },
  billImage: {
    width: '100%',
    height: '100%',
    opacity: 0.85,
  },
  billImageOverlay: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  billImageOverlayText: {
    color: '#FFFFFF',
    fontFamily: 'Inter_700Bold',
    fontSize: 14,
  },
  bottomBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: '#FFFFFF',
    paddingTop: 16,
    paddingHorizontal: 16,
    flexDirection: 'column',
    gap: 12,
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
  },
  bottomBtn: {
    flex: 1,
    height: 52,
    borderRadius: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  bottomBtnMain: {
    width: '100%',
    height: 60,
    borderRadius: 18,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  secondaryActionsRow: {
    flexDirection: 'row',
    gap: 12,
    width: '100%',
  },
  bottomBtnText: {
    fontFamily: 'Inter_700Bold',
    fontSize: 14,
    flexShrink: 1,
  },
  bottomBtnTextMain: {
    fontFamily: 'Inter_800ExtraBold',
    fontSize: 18,
    color: '#FFFFFF',
    flexShrink: 1,
  },
  modalBackdropFull: {
    flex: 1,
    backgroundColor: 'rgba(15,23,42,0.5)',
    justifyContent: 'flex-end',
  },
  fullSheet: {
    borderTopLeftRadius: 32,
    borderTopRightRadius: 32,
    height: '85%',
    paddingTop: 20,
  },
  sheetHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 24,
    marginBottom: 20,
  },
  sheetTitleBig: {
    fontFamily: 'Inter_800ExtraBold',
    fontSize: 24,
    color: '#1E293B',
  },
  sheetScroll: {
    flex: 1,
    paddingHorizontal: 24,
  },
  editGrid: {
    gap: 24,
    paddingBottom: 40,
  },
  editSection: {
    gap: 16,
  },
  editSectionTitle: {
    fontFamily: 'Inter_700Bold',
    fontSize: 14,
    color: '#64748B',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  inputGroup: {
    gap: 8,
  },
  inputLabel: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 13,
    color: '#475569',
    paddingLeft: 4,
  },
  textInput: {
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 16,
    padding: 16,
    fontFamily: 'Inter_600SemiBold',
    fontSize: 15,
    color: '#1E293B',
  },
  saveBtnAction: {
    margin: 24,
    marginTop: 0,
  },
  saveGradientAction: {
    height: 60,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveBtnTextAction: {
    fontFamily: 'Inter_800ExtraBold',
    fontSize: 18,
    color: '#FFFFFF',
  },
  imageModalBackdrop: {
    flex: 1,
    backgroundColor: '#000000',
  },
  imageModalCloseBtn: {
    position: 'absolute',
    top: 50,
    right: 25,
    zIndex: 10,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  imageModalContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  imageModalImageWrapper: {
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  imageModalImageFull: {
    width: '100%',
    height: '100%',
  },
  modalBackdropCentered: {
    flex: 1,
    backgroundColor: 'rgba(15,23,42,0.3)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  modalCardCentered: {
    width: '100%',
    backgroundColor: '#FFFFFF',
    borderRadius: 24,
    padding: 24,
    gap: 16,
  },
  modalTitle: {
    fontFamily: 'Inter_700Bold',
    fontSize: 18,
    color: '#1E293B',
    textAlign: 'center',
  },
  snoozeGrid: {
    gap: 12,
  },
  snoozeOption: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F8FAFC',
    padding: 16,
    borderRadius: 16,
    gap: 16,
  },
  snoozeIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  snoozeOptionText: {
    flex: 1,
    fontSize: 15,
    color: '#1E293B',
  },
  sheet: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 32,
    borderTopRightRadius: 32,
    padding: 24,
    paddingTop: 12,
  },
  sheetHandle: {
    width: 40,
    height: 4,
    backgroundColor: '#E2E8F0',
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: 20,
  },
  sheetTitle: {
    fontFamily: 'Inter_800ExtraBold',
    fontSize: 20,
    color: '#1E293B',
  },
  sheetSubtitle: {
    fontFamily: 'Inter_500Medium',
    fontSize: 14,
    color: '#64748B',
    marginTop: 4,
    marginBottom: 20,
  },
  timePickerWrap: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 4,
  },
  modalActionsRow: {
    marginTop: 8,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  modalTextButton: {
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  modalTextButtonLabel: {
    fontFamily: 'Inter_500Medium',
    fontSize: 14,
    color: '#6B7280',
  },
  modalPrimaryButton: {
    borderRadius: 999,
    paddingVertical: 10,
    paddingHorizontal: 20,
    backgroundColor: '#4F46E5',
  },
  modalPrimaryButtonLabel: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 14,
    color: '#FFFFFF',
  },
  repeatRow: {
    paddingVertical: 12,
    paddingHorizontal: 10,
    borderRadius: 14,
    borderWidth: 0,
    backgroundColor: '#F8FAFC',
    marginBottom: 8,
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  repeatRowActive: {
    backgroundColor: '#EEF2FF',
  },
  repeatLabel: {
    fontFamily: 'Inter_500Medium',
    fontSize: 14,
    color: '#111827',
  },
  repeatLabelActive: {
    color: '#4F46E5',
    fontFamily: 'Inter_600SemiBold',
  },
  errorBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 12,
    borderRadius: 12,
  },
  errorText: {
    fontFamily: 'Inter_500Medium',
    fontSize: 13,
    flex: 1,
  },
});

