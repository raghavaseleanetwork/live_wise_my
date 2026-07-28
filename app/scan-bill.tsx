import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Pressable,
  Platform,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
  Dimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BlurView } from 'expo-blur';
import Animated, { FadeInDown, FadeIn, SlideInUp } from 'react-native-reanimated';
import DateTimePicker from '@react-native-community/datetimepicker';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useTheme } from '@/lib/theme-context';
import { getApiUrl } from '@/lib/query-client';
import { useAuth } from '@/lib/auth-context';
import { useExpenses } from '@/lib/expense-context';
import { type CategoryType } from '@/lib/data';
import { useAlert } from '@/lib/alert-context';
import { useSubscription } from '@/lib/subscription-context';
import { usePaywall } from '@/lib/paywall-context';
import PremiumLoader from '@/components/PremiumLoader';
import { scheduleLocalNotification } from '@/lib/notifications';
import { useCurrency } from '@/lib/currency-context';
import CustomModal from '@/components/CustomModal';

type ScanStep = 'guide' | 'preview' | 'processing';

export default function ScanBillScreen() {
  const router = useRouter();
  const { billId, mode } = useLocalSearchParams<{ billId?: string; mode?: string }>();
  /**
   * `?mode=expense` means the user arrived via "Scan a receipt" (the FAB), so
   * saving an expense is the primary action. Re-scanning an existing bill
   * (`billId` present) always stays bill-first — that flow is an update.
   */
  const isExpenseMode = mode === 'expense' && !billId;
  const { colors, isDark } = useTheme();
  const { token } = useAuth();
  const { bills, refreshData, addTransaction } = useExpenses();
  const { formatAmount } = useCurrency();
  const { showAlert } = useAlert();
  const { checkLimit, incrementUsage } = useSubscription();
  const { presentPaywall } = usePaywall();
  const insets = useSafeAreaInsets();
  const existingBill = useMemo(() => 
    billId ? bills.find(b => b.id === billId) : null
  , [billId, bills]);
  const topInset = Platform.OS === 'web' ? 20 : insets.top;

  const [step, setStep] = useState<ScanStep>('guide');
  const [flashOn, setFlashOn] = useState(false);
  const cameraRef = useRef<CameraView>(null);
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const [photo, setPhoto] = useState<{
    uri: string;
    fileName?: string;
    mimeType?: string;
  } | null>(null);

  const [processingMsgIdx, setProcessingMsgIdx] = useState(0);
  const [showSuccessModal, setShowSuccessModal] = useState(false);
  const [editingData, setEditingData] = useState<any>(null);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [confidence, setConfidence] = useState<number | null>(null);
  const [isSavingExpense, setIsSavingExpense] = useState(false);
  const [isSavingReminder, setIsSavingReminder] = useState(false);
  /** Either save in flight — disables every button so neither can double-fire. */
  const isBusy = isSavingExpense || isSavingReminder;

  const rotationTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const PROCESS_MESSAGES = useMemo(
    () => [
      'Scanning your bill...',
      'Extracting bill details...',
      'Detecting bill format...',
      'Reading bill text...',
      'Checking due date...',
    ],
    [],
  );

  useEffect(() => {
    return () => {
      if (rotationTimerRef.current) clearInterval(rotationTimerRef.current);
    };
  }, []);

  // Gate: bill scan is monthly-metered (doc §5.1 — "4th bill scan" → paywall).
  // Returns true if the scan may proceed; records one use when it does.
  const guardScan = useCallback((): boolean => {
    const check = checkLimit('billScanPerMonth');
    if (!check.allowed && check.triggerKey) {
      presentPaywall(check.triggerKey);
      return false;
    }
    incrementUsage('billScanPerMonth');
    return true;
  }, [checkLimit, incrementUsage, presentPaywall]);

  const takePictureFromCamera = useCallback(async () => {
    if (!guardScan()) return;
    if (Platform.OS === 'web') {
      showAlert({
        title: 'Not supported',
        message: 'Camera capture is not supported on web in this flow.',
        type: 'info',
      });
      return;
    }

    if (!cameraPermission?.granted) {
      const res = await requestCameraPermission();
      if (!res.granted) {
        showAlert({
          title: 'Permission needed',
          message: 'Camera permission is required to scan bills.',
          type: 'warning',
        });
        return;
      }
    }

    try {
      const pic = await cameraRef.current?.takePictureAsync({ quality: 1.0 });
      if (!pic?.uri) {
        showAlert({
          title: 'Scan failed',
          message: 'Could not capture the photo. Please try again.',
          type: 'error',
        });
        return;
      }

      setStep('preview');
      setPhoto({
        uri: pic.uri,
        fileName: 'bill.jpg',
        mimeType: 'image/jpeg',
      });
    } catch {
      showAlert({
        title: 'Scan failed',
        message: 'Unexpected error while taking photo.',
        type: 'error',
      });
    }
  }, [cameraPermission, requestCameraPermission, guardScan]);

  const openGallery = useCallback(async () => {
    if (!guardScan()) return;
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 1.0,
    });

    if (result.canceled || !result.assets || !result.assets[0]) return;
    const asset = result.assets[0];
    if (!asset.uri) return;

    setStep('preview');
    setPhoto({
      uri: asset.uri,
      fileName: asset.fileName ?? 'bill.jpg',
      mimeType: asset.mimeType ?? 'image/jpeg',
    });
  }, [guardScan]);

  const startRotation = useCallback(() => {
    setProcessingMsgIdx(0);
    if (rotationTimerRef.current) clearInterval(rotationTimerRef.current);
    rotationTimerRef.current = setInterval(() => {
      setProcessingMsgIdx((i) => (i + 1) % PROCESS_MESSAGES.length);
    }, 450);
  }, [PROCESS_MESSAGES.length]);

  const stopRotation = useCallback(() => {
    if (rotationTimerRef.current) clearInterval(rotationTimerRef.current);
    rotationTimerRef.current = null;
  }, []);

  const scanPreview = useCallback(async () => {
    if (!photo || !token) {
      showAlert({
        title: 'Not ready',
        message: 'Please login again and try scanning.',
        type: 'warning',
      });
      return;
    }

    setStep('processing');
    setIsEditing(false);
    startRotation();
    try {
      const baseUrl = getApiUrl();
      const url = new URL('/api/bills/scan/preview', baseUrl).toString();

      const form = new FormData();
      form.append('image', {
        uri: photo.uri,
        name: photo.fileName || 'bill.jpg',
        type: photo.mimeType || 'image/jpeg',
      } as any);

      const res = await fetch(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      });

      if (!res.ok) {
        const json = await res.json().catch(() => null);
        const msg = json?.message ?? 'This does not look like a bill photo.';
        showAlert({
          title: 'Invalid Scan',
          message: msg,
          type: 'error',
          buttons: [
            {
              text: 'Try Again',
              onPress: () => {
                setStep('guide');
                setPhoto(null);
              },
            },
          ],
        });
        setStep('preview');
        return;
      }
      
      const resJson = await res.json();
      setEditingData(resJson.preview);
      setConfidence(resJson.metadata?.confidence || null);
      setShowSuccessModal(true);
    } catch {
      showAlert({
        title: 'Error',
        message: 'Network error while scanning bill. Please try again.',
        type: 'error',
      });
      setStep('preview');
    } finally {
      stopRotation();
    }
  }, [photo, token, startRotation, stopRotation]);

  /**
   * Save the scanned receipt as an EXPENSE rather than a future bill — Method 2
   * in the product doc. A receipt for something already paid (groceries, fuel,
   * a restaurant bill) is money already spent, so filing it as an upcoming bill
   * is wrong; only the amount/merchant/category from OCR carry over.
   */
  const commitExpense = useCallback(async () => {
    if (!editingData || !token || isSavingExpense) return;
    setIsSavingExpense(true);

    const amount = Number(editingData.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      setIsSavingExpense(false);
      showAlert({
        title: 'Amount missing',
        message: 'Could not read an amount from this receipt. Tap Edit to enter it.',
        type: 'warning',
      });
      return;
    }

    const created = await addTransaction({
      merchant: editingData.name || 'Scanned receipt',
      amount,
      category: (editingData.category as CategoryType) || 'others',
      // OCR reads the receipt's own date into `dueDate`; for an expense that is
      // the date it was spent. Fall back to today when the scan found no date.
      date: editingData.dueDate || new Date().toISOString(),
      description: editingData.name || '',
      source: 'scan',
    });

    setIsSavingExpense(false);

    if (!created) {
      showAlert({
        title: 'Could not save',
        message: 'The expense was not saved. Please check your connection and try again.',
        type: 'error',
      });
      return;
    }

    setShowSuccessModal(false);
    setStep('guide');
    setPhoto(null);
    showAlert({
      // Name the record type explicitly. These two flows differ only by a
      // secondary tap, so a vague "Saved!" hides a wrong-type save entirely.
      title: 'Expense saved',
      message: `${formatAmount(amount)} · ${
        editingData.name || 'Scanned receipt'
      }\n\nAdded to your expenses.`,
      type: 'success',
    });
  }, [editingData, token, addTransaction, showAlert, formatAmount, isSavingExpense]);

  const commitReminder = useCallback(async () => {
    if (!editingData || !token || isSavingReminder) return;

    // A ₹0 bill is not useful and is usually a low-confidence OCR miss (the
    // screenshot case: 40% score, amount read as 0). Ask for a real figure
    // instead of silently saving a reminder the user can't act on.
    if (!Number.isFinite(Number(editingData.amount)) || Number(editingData.amount) <= 0) {
      showAlert({
        title: 'Amount missing',
        message: 'Could not read an amount from this bill. Tap "Modify Details" to enter it.',
        type: 'warning',
      });
      return;
    }

    // Guard + spinner: this does a network round-trip and previously had no
    // loading state at all, so the button looked dead and a double-tap could
    // create two bills.
    setIsSavingReminder(true);
    try {
      const baseUrl = getApiUrl();
      if (billId && existingBill) {
        const url = new URL(`/api/bills/${billId}`, baseUrl).toString();
        const res = await fetch(url, {
          method: 'PUT',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            ...editingData,
            status: existingBill.status,
            isPaid: existingBill.isPaid
          }),
        });

        if (!res.ok) {
          const detail = await res.text().catch(() => '');
          console.error(`[ScanBill] Update failed HTTP ${res.status}:`, detail.slice(0, 300));
          throw new Error('Update failed');
        }
      } else {
        const url = new URL('/api/bills/scan/commit', baseUrl).toString();
        const res = await fetch(url, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ preview: editingData }),
        });

        if (!res.ok) {
          const detail = await res.text().catch(() => '');
          console.error(`[ScanBill] Save failed HTTP ${res.status}:`, detail.slice(0, 300));
          throw new Error('Save failed');
        }
        const created = await res.json();
        
        if (created?.dueDate) {
          await scheduleLocalNotification({
            title: `${created.name || 'Bill'} Due Soon`,
            body: `₹${created.amount ?? 0} due on ${new Date(created.dueDate).toLocaleDateString('en-IN')}`,
            data: { type: 'reminder', billId: created.id },
            triggerAt: new Date(created.dueDate),
          }).catch(() => {});
        }
        
        // Only jump to the bill detail screen when the user actually asked for
        // a bill. In expense mode the reminder is the secondary choice, so
        // hijacking navigation there is disorienting — confirm and stay put.
        if (!isExpenseMode) {
          router.replace(`/bill-details/${created.id}`);
        } else {
          showAlert({
            title: 'Bill reminder saved',
            message: `${created.name || 'Bill'}${
              created.dueDate
                ? ` · due ${new Date(created.dueDate).toLocaleDateString('en-IN')}`
                : ''
            }\n\nAdded to Reminders — not to your expenses.`,
            type: 'success',
          });
        }
      }

      await refreshData();
      setShowSuccessModal(false);
      setStep('guide');
      setPhoto(null);
    } catch (e) {
      showAlert({
        title: 'Could not save bill',
        message: 'Please check your connection and try again.',
        type: 'error',
      });
    } finally {
      setIsSavingReminder(false);
    }
  }, [
    editingData,
    token,
    billId,
    existingBill,
    refreshData,
    router,
    isExpenseMode,
    showAlert,
    isSavingReminder,
  ]);

  /**
   * Unambiguous wrappers for the two save actions.
   *
   * The buttons previously called `commitExpense` / `commitReminder` through a
   * `isExpenseMode ? a : b` ternary in two places, which meant reading the JSX
   * to know which record type a tap created — and a wrong `isExpenseMode`
   * silently inverted BOTH buttons. These log what they do, so a mis-save is
   * visible in the console instead of only in the database.
   */
  const saveAsExpense = useCallback(() => {
    console.log('[ScanBill] action=SAVE_EXPENSE (creates a transaction)');
    return commitExpense();
  }, [commitExpense]);

  const saveAsBillReminder = useCallback(() => {
    console.log('[ScanBill] action=SAVE_BILL_REMINDER (creates a bill)');
    return commitReminder();
  }, [commitReminder]);

  return (
    <View style={[styles.container, { backgroundColor: colors.bg, paddingBottom: 40 }]}>
      <Animated.View 
        entering={Platform.OS !== 'web' ? FadeInDown.duration(400) : undefined}
        style={[styles.header, { paddingTop: topInset + 12 }]}
      >
        <Pressable onPress={() => router.back()} hitSlop={12} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={24} color={colors.text} />
        </Pressable>
        <Text style={[styles.headerTitle, { color: colors.text }]}>Scan Bill</Text>
        <View style={styles.headerSpacer} />
      </Animated.View>

      <View style={styles.body}>
        {step === 'guide' && (
          <View style={styles.guideStepWrap}>
            {Platform.OS !== 'web' && cameraPermission?.granted ? (
              <CameraView
                ref={cameraRef}
                style={styles.camera}
                facing="back"
                flash={flashOn ? 'on' : 'off'}
              >
                <View style={styles.cameraOverlay}>
                  <View style={styles.cameraTop}>
                    <BlurView intensity={30} tint={isDark ? 'dark' : 'light'} style={styles.topInfoBlur}>
                      <Text style={[styles.guideTitle, { color: '#FFFFFF' }]}>
                        {billId ? 'Updating bill' : 'Scan Your Bill'}
                      </Text>
                      <Text style={[styles.guideSubtitle, { color: 'rgba(255,255,255,0.7)' }]}>
                        Keep bill flat & within corner marks
                      </Text>
                    </BlurView>
                  </View>

                  <View style={styles.cameraFrameCenter}>
                    <View style={styles.frameCornerTL} />
                    <View style={styles.frameCornerTR} />
                    <View style={styles.frameCornerBL} />
                    <View style={styles.frameCornerBR} />
                    <View style={styles.frameScanLine} />
                  </View>

                  <View style={styles.cameraBottomBar}>
                    <Pressable onPress={openGallery} style={styles.sideActionBtn}>
                      <Ionicons name="images" size={24} color="#FFFFFF" />
                      <Text style={styles.sideActionText}>Gallery</Text>
                    </Pressable>

                    <Pressable onPress={takePictureFromCamera} style={styles.mainCaptureBtn}>
                      <View style={styles.captureInner} />
                    </Pressable>

                    <Pressable 
                      onPress={() => setFlashOn(!flashOn)} 
                      style={[styles.sideActionBtn, flashOn && { backgroundColor: 'rgba(245,158,11,0.3)' }]}
                    >
                      <Ionicons name={flashOn ? "flash" : "flash-off"} size={24} color={flashOn ? "#F59E0B" : "#FFFFFF"} />
                      <Text style={[styles.sideActionText, flashOn && { color: "#F59E0B" }]}>Flash</Text>
                    </Pressable>
                  </View>
                </View>
              </CameraView>
            ) : (
              <Animated.View 
                entering={Platform.OS !== 'web' ? FadeInDown.delay(100).duration(500) : undefined}
                style={styles.center}
              >
                <View style={[styles.fallbackFrame, { borderColor: colors.border, backgroundColor: colors.card }]}>
                  <View style={[styles.fallbackIconWrap, { backgroundColor: colors.accentMintDim }]}>
                    <Ionicons name="camera" size={32} color={colors.accentMint} />
                  </View>
                  <Text style={[styles.fallbackTitle, { color: colors.text }]}>Camera Access Required</Text>
                  <Text style={[styles.fallbackSubtitle, { color: colors.textSecondary }]}>
                    Scan your physical bills to automatically extract details like amount, date, and items with AI.
                  </Text>
                  
                  <View style={styles.fallbackActions}>
                    <Pressable
                      style={[styles.primaryActionBtn, { backgroundColor: colors.accent }]}
                      onPress={() => Platform.OS === 'web' ? openGallery() : requestCameraPermission()}
                    >
                      <Ionicons name={Platform.OS === 'web' ? "images" : "camera"} size={20} color="#FFFFFF" />
                      <Text style={styles.primaryActionBtnText}>
                        {Platform.OS === 'web' ? 'Choose from Gallery' : 'Allow Camera'}
                      </Text>
                    </Pressable>

                    <Pressable 
                      onPress={openGallery} 
                      style={[styles.galleryActionBtn, { backgroundColor: colors.accentMintDim }]}
                    >
                      <Ionicons name="images-outline" size={20} color={colors.accentMint} />
                      <Text style={[styles.galleryActionBtnText, { color: colors.accentMint }]}>Upload from Gallery</Text>
                    </Pressable>
                  </View>
                </View>
              </Animated.View>
            )}
          </View>
        )}

        {step === 'preview' && photo && (
          <View style={styles.guideStepWrap}>
            <Text style={[styles.previewHint, { color: colors.textSecondary }]}>
              Make sure the amount and due date are clearly visible
            </Text>
            <Image source={{ uri: photo.uri }} style={styles.previewImage} resizeMode="contain" />
            <View style={styles.actionsRow}>
              <Pressable
                style={[styles.actionBtn, styles.actionBtnSecondary, { backgroundColor: colors.inputBg, borderColor: colors.border }]}
                onPress={() => { setPhoto(null); setStep('guide'); }}
              >
                <Ionicons name="camera-reverse-outline" size={18} color={colors.textSecondary} />
                <Text style={[styles.actionBtnText, { color: colors.textSecondary }]}>Retake</Text>
              </Pressable>

              <Pressable
                style={[styles.actionBtn, { backgroundColor: colors.accent }]}
                onPress={scanPreview}
              >
                <Ionicons name="sparkles" size={18} color="#FFFFFF" />
                <Text style={styles.actionBtnText}>Extract Details</Text>
              </Pressable>
            </View>
          </View>
        )}

        {step === 'processing' && (
          <View style={styles.center}>
            <PremiumLoader size={100} text={PROCESS_MESSAGES[processingMsgIdx]} />
            <Text style={[styles.processingTitle, { color: colors.textSecondary }]}>{PROCESS_MESSAGES[processingMsgIdx]}</Text>
            <Text style={[styles.processingSubtitle, { color: colors.textTertiary }]}>Extracting details with AI magic...</Text>
          </View>
        )}
      </View>

      <CustomModal visible={showSuccessModal} onClose={() => setShowSuccessModal(false)} showCloseButton={false}>
        <View style={styles.modalHeader}>
          <Text style={[styles.modalTitle, { color: colors.text }]}>{isEditing ? 'Edit Details' : 'Extraction Success'}</Text>
          <Text style={[styles.modalSubtitle, { color: colors.textSecondary }]}>
            {isEditing ? "Verify and correct details." : "AI successfully read your bill!"}
          </Text>
        </View>

        {!isEditing ? (
          <View style={styles.summaryContainer}>
            <View style={[styles.modernSummaryCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <View style={styles.modernSummaryTop}>
                <View style={[styles.brandIconWrap, { backgroundColor: colors.accentDim }]}>
                  <Ionicons name={editingData?.icon || 'receipt'} size={28} color={colors.accent} />
                </View>
                <View style={styles.brandInfo}>
                  <Text style={[styles.brandName, { color: colors.text }]} numberOfLines={1}>{editingData?.name || 'Bill Detected'}</Text>
                  <Text style={[styles.brandCategory, { color: colors.textTertiary }]}>{(editingData?.category || 'Utility').toUpperCase()}</Text>
                </View>
                {confidence !== null && (
                  <View style={[styles.statusTag, { backgroundColor: confidence >= 90 ? '#10B98115' : '#F59E0B15' }]}>
                    <Text style={[styles.statusTagText, { color: confidence >= 90 ? '#10B981' : '#F59E0B' }]}>{confidence}% Score</Text>
                  </View>
                )}
              </View>
              <View style={[styles.modernDivider, { backgroundColor: colors.border }]} />
              <View style={styles.modernSummaryGrid}>
                <View style={styles.modernGridItem}>
                  <Text style={styles.modernGridLabel}>AMOUNT DUE</Text>
                  <Text style={[styles.modernGridValue, { color: colors.text }]}>{formatAmount(editingData?.amount || 0)}</Text>
                </View>
                <View style={[styles.modernGridItem, { alignItems: 'flex-end' }]}>
                  <Text style={styles.modernGridLabel}>DUE DATE</Text>
                  <Text style={[styles.modernGridValue, { color: colors.textSecondary }]}>
                    {editingData?.dueDate ? new Date(editingData.dueDate).toLocaleDateString('en-IN') : 'N/A'}
                  </Text>
                </View>
              </View>
            </View>
            <Pressable style={[styles.modernEditBtn, { borderColor: colors.border }]} onPress={() => setIsEditing(true)}>
              <Ionicons name="create-outline" size={18} color={colors.accent} />
              <Text style={[styles.modernEditBtnText, { color: colors.accent }]}>Modify Details</Text>
            </Pressable>
          </View>
        ) : (
          <ScrollView style={styles.editScroll}>
            <View style={styles.editingForm}>
              <View style={styles.formSection}>
                <Text style={[styles.formSectionTitle, { color: colors.textTertiary }]}>PRIMARY DETAILS</Text>
                <Text style={[styles.formLabel, { color: colors.textSecondary }]}>Bill Name</Text>
                <TextInput
                  style={[styles.formInput, { color: colors.text, borderColor: colors.border, backgroundColor: colors.card }]}
                  value={editingData?.name}
                  placeholder="e.g. Electricity Board"
                  placeholderTextColor={colors.textTertiary}
                  onChangeText={(t) => setEditingData((prev: any) => ({ ...prev, name: t }))}
                />
                <View style={styles.formRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.formLabel, { color: colors.textSecondary }]}>Amount</Text>
                    <View style={[styles.amountFieldWrap, { borderColor: colors.border, backgroundColor: colors.card }]}>
                      <Text style={[styles.amountFieldPrefix, { color: colors.textSecondary }]}>₹</Text>
                      <TextInput
                        style={[styles.amountFieldInput, { color: colors.text }]}
                        value={editingData?.amount?.toString()}
                        placeholder="0"
                        placeholderTextColor={colors.textTertiary}
                        keyboardType="numeric"
                        onChangeText={(t) => setEditingData((prev: any) => ({ ...prev, amount: parseFloat(t) || 0 }))}
                      />
                    </View>
                  </View>
                  <View style={{ flex: 1.2 }}>
                    <Text style={[styles.formLabel, { color: colors.textSecondary }]}>Due Date</Text>
                    <Pressable
                      style={[styles.formInput, { borderColor: colors.border, backgroundColor: colors.card, justifyContent: 'center' }]}
                      onPress={() => setShowDatePicker(true)}
                    >
                      <Text style={{ color: editingData?.dueDate ? colors.text : colors.textTertiary }}>
                        {editingData?.dueDate ? new Date(editingData.dueDate).toLocaleDateString('en-IN') : 'Select date'}
                      </Text>
                    </Pressable>
                  </View>
                </View>
              </View>
            </View>
            <Pressable style={[styles.doneEditingBtn, { backgroundColor: colors.accentDim }]} onPress={() => setIsEditing(false)}>
              <Text style={[styles.doneEditingText, { color: colors.accent }]}>Apply Changes</Text>
            </Pressable>
          </ScrollView>
        )}

        {/*
          Primary action follows how the user arrived. From "Scan a receipt"
          (mode=expense) the receipt is money already spent, so Save Expense
          leads. From the home-screen "Scan Bills" circle it's a bill to pay.
        */}
        <View style={styles.modalFooter}>
          <Pressable
            style={[styles.cancelBtn, { borderColor: colors.border }]}
            onPress={() => setShowSuccessModal(false)}
            disabled={isBusy}
          >
            <Text style={[styles.cancelBtnText, { color: colors.textSecondary }]}>Discard</Text>
          </Pressable>
          <Pressable
            onPress={isExpenseMode ? saveAsExpense : saveAsBillReminder}
            disabled={isBusy}
            style={[styles.confirmBtn, { backgroundColor: colors.accent }, isBusy && { opacity: 0.7 }]}
          >
            <View style={styles.confirmGradient}>
              {/* Spinner tracks whichever action THIS button runs, not a fixed one. */}
              {(isExpenseMode ? isSavingExpense : isSavingReminder) ? (
                <ActivityIndicator size="small" color="#FFFFFF" />
              ) : (
                <>
                  <Ionicons
                    name={isExpenseMode ? 'wallet' : 'checkmark-circle'}
                    size={18}
                    color="#FFFFFF"
                  />
                  <Text style={styles.confirmBtnText}>
                    {isExpenseMode ? 'Save Expense' : billId ? 'Update Bill' : 'Save Bill'}
                  </Text>
                </>
              )}
            </View>
          </Pressable>
        </View>

        {/* The other option, always available for a new scan. */}
        {!billId && (
          <Pressable
            onPress={isExpenseMode ? saveAsBillReminder : saveAsExpense}
            disabled={isBusy}
            style={[styles.expenseAltBtn, { borderTopColor: colors.border }, isBusy && { opacity: 0.6 }]}
          >
            {(isExpenseMode ? isSavingReminder : isSavingExpense) ? (
              <ActivityIndicator size="small" color={colors.accent} />
            ) : (
              <>
                <Ionicons
                  name={isExpenseMode ? 'notifications-outline' : 'wallet-outline'}
                  size={15}
                  color={colors.accent}
                />
                <Text style={[styles.expenseAltText, { color: colors.accent }]}>
                  {isExpenseMode
                    ? 'Not paid yet — save as bill reminder'
                    : 'Already paid — save as expense'}
                </Text>
              </>
            )}
          </Pressable>
        )}

        {showDatePicker && (
          <DateTimePicker
            value={editingData?.dueDate ? new Date(editingData.dueDate) : new Date()}
            mode="date"
            onChange={(_, date) => {
              setShowDatePicker(false);
              if (date) setEditingData((prev: any) => ({ ...prev, dueDate: date.toISOString() }));
            }}
          />
        )}
      </CustomModal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    paddingBottom: 10,
    paddingHorizontal: 18,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerSpacer: { width: 40 },
  headerTitle: {
    fontFamily: 'Inter_700Bold',
    fontSize: 20,
    flex: 1,
    textAlign: 'center',
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: {
    flex: 1,
    paddingHorizontal: 18,
    paddingTop: 10,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  previewHint: {
    fontFamily: 'Inter_500Medium',
    fontSize: 13,
    textAlign: 'center',
    marginBottom: 12,
  },
  previewImage: {
    width: '100%',
    height: '70%',
    borderRadius: 24,
    backgroundColor: '#F8FAFC',
  },
  actionsRow: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 20,
  },
  actionBtn: {
    flex: 1,
    flexDirection: 'row',
    borderRadius: 16,
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  actionBtnSecondary: {
    borderWidth: 1,
  },
  actionBtnText: {
    fontFamily: 'Inter_700Bold',
    fontSize: 15,
    color: '#FFFFFF',
  },
  guideStepWrap: {
    flex: 1,
  },
  camera: {
    flex: 1,
    borderRadius: 24,
    overflow: 'hidden',
  },
  cameraOverlay: {
    flex: 1,
    paddingHorizontal: 20,
    paddingVertical: 24,
    justifyContent: 'space-between',
  },
  cameraTop: {
    alignItems: 'center',
    marginTop: 10,
  },
  topInfoBlur: {
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 20,
    alignItems: 'center',
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
  },
  guideTitle: {
    fontFamily: 'Inter_700Bold',
    fontSize: 16,
    letterSpacing: 0.5,
  },
  guideSubtitle: {
    fontFamily: 'Inter_400Regular',
    fontSize: 12,
    marginTop: 2,
    opacity: 0.8,
  },
  cameraFrameCenter: {
    width: '100%',
    aspectRatio: 3 / 4,
    justifyContent: 'center',
    alignItems: 'center',
    position: 'relative',
  },
  frameCornerTL: { position: 'absolute', top: 0, left: 0, width: 40, height: 40, borderTopWidth: 4, borderLeftWidth: 4, borderColor: '#FFFFFF', borderTopLeftRadius: 20 },
  frameCornerTR: { position: 'absolute', top: 0, right: 0, width: 40, height: 40, borderTopWidth: 4, borderRightWidth: 4, borderColor: '#FFFFFF', borderTopRightRadius: 20 },
  frameCornerBL: { position: 'absolute', bottom: 0, left: 0, width: 40, height: 40, borderBottomWidth: 4, borderLeftWidth: 4, borderColor: '#FFFFFF', borderBottomLeftRadius: 20 },
  frameCornerBR: { position: 'absolute', bottom: 0, right: 0, width: 40, height: 40, borderBottomWidth: 4, borderRightWidth: 4, borderColor: '#FFFFFF', borderBottomRightRadius: 20 },
  frameScanLine: {
    width: '90%',
    height: 2,
    backgroundColor: 'rgba(255,255,255,0.5)',
    position: 'absolute',
    top: '50%',
  },
  cameraBottomBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: 20,
  },
  mainCaptureBtn: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: 'rgba(255,255,255,0.3)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 4,
    borderColor: '#FFFFFF',
  },
  captureInner: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: '#FFFFFF',
  },
  sideActionBtn: {
    alignItems: 'center',
    justifyContent: 'center',
    width: 60,
    gap: 4,
  },
  sideActionText: {
    color: '#FFFFFF',
    fontFamily: 'Inter_600SemiBold',
    fontSize: 10,
    textTransform: 'uppercase',
  },
  fallbackFrame: {
    width: '100%',
    padding: 32,
    borderRadius: 32,
    alignItems: 'center',
    borderWidth: 1,
    borderStyle: 'dashed',
    maxWidth: 400,
  },
  fallbackIconWrap: {
    width: 64,
    height: 64,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  fallbackTitle: {
    fontFamily: 'Inter_700Bold',
    fontSize: 20,
    marginTop: 16,
    textAlign: 'center',
  },
  fallbackSubtitle: {
    fontFamily: 'Inter_400Regular',
    fontSize: 14,
    marginTop: 8,
    textAlign: 'center',
    lineHeight: 22,
  },
  fallbackActions: {
    width: '100%',
    gap: 12,
    marginTop: 32,
  },
  galleryActionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 24,
    paddingVertical: 14,
    borderRadius: 16,
    width: '100%',
    justifyContent: 'center',
  },
  galleryActionBtnText: {
    fontFamily: 'Inter_700Bold',
    fontSize: 15,
  },
  primaryActionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 24,
    paddingVertical: 14,
    borderRadius: 16,
    marginTop: 24,
    width: '100%',
    justifyContent: 'center',
  },
  primaryActionBtnText: {
    color: '#FFFFFF',
    fontFamily: 'Inter_700Bold',
    fontSize: 15,
  },
  secondaryActionBtn: {
    marginTop: 12,
    paddingVertical: 12,
    width: '100%',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 16,
  },
  secondaryActionBtnText: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 14,
  },
  processingTitle: {
    fontFamily: 'Inter_700Bold',
    fontSize: 18,
    marginTop: 24,
    textAlign: 'center',
  },
  processingSubtitle: {
    fontFamily: 'Inter_400Regular',
    fontSize: 14,
    marginTop: 8,
    textAlign: 'center',
    opacity: 0.6,
  },
  modalHeader: {
    paddingBottom: 20,
  },
  modalTitle: {
    fontFamily: 'Inter_700Bold',
    fontSize: 20,
    marginBottom: 4,
  },
  modalSubtitle: {
    fontFamily: 'Inter_400Regular',
    fontSize: 13,
    lineHeight: 18,
    opacity: 0.6,
  },
  summaryContainer: {
    gap: 16,
  },
  modernSummaryCard: {
    borderRadius: 20,
    borderWidth: 1,
    padding: 16,
  },
  modernSummaryTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  brandIconWrap: {
    width: 48,
    height: 48,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  brandInfo: {
    flex: 1,
    gap: 2,
  },
  brandName: {
    fontFamily: 'Inter_700Bold',
    fontSize: 16,
  },
  brandCategory: {
    fontFamily: 'Inter_500Medium',
    fontSize: 10,
    letterSpacing: 0.5,
  },
  statusTag: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  statusTagText: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 10,
  },
  modernDivider: {
    height: 1,
    marginVertical: 16,
  },
  modernSummaryGrid: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  modernGridItem: {
    gap: 4,
  },
  modernGridLabel: {
    fontFamily: 'Inter_500Medium',
    fontSize: 9,
    color: '#94A3B8',
    letterSpacing: 0.5,
  },
  modernGridValue: {
    fontFamily: 'Inter_700Bold',
    fontSize: 18,
  },
  modernEditBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginTop: 16,
    paddingVertical: 12,
    borderWidth: 1,
    borderRadius: 14,
    borderStyle: 'dashed',
  },
  modernEditBtnText: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 13,
  },
  editScroll: {
    maxHeight: 400,
  },
  editingForm: {
    gap: 16,
  },
  formSection: {
    gap: 12,
  },
  formSectionTitle: {
    fontFamily: 'Inter_700Bold',
    fontSize: 11,
    letterSpacing: 1,
  },
  formGroup: {
    gap: 6,
  },
  formRow: {
    flexDirection: 'row',
    gap: 12,
  },
  formLabel: {
    fontFamily: 'Inter_500Medium',
    fontSize: 12,
    marginBottom: 6,
  },
  formInput: {
    height: 50,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 14,
    fontFamily: 'Inter_600SemiBold',
    fontSize: 14,
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
  },
  amountFieldWrap: {
    height: 50,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 10,
  },
  amountFieldPrefix: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 14,
  },
  amountFieldInput: {
    flex: 1,
    fontFamily: 'Inter_600SemiBold',
    fontSize: 14,
    height: '100%',
    padding: 0,
  },
  doneEditingBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 24,
    paddingVertical: 14,
    borderRadius: 14,
  },
  doneEditingText: {
    fontFamily: 'Inter_700Bold',
    fontSize: 14,
  },
  modalFooter: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 24,
  },
  expenseAltBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    minHeight: 44,
    paddingTop: 14,
    marginTop: 16,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  expenseAltText: { fontSize: 13, fontWeight: '600' },
  cancelBtn: {
    flex: 1,
    height: 54,
    borderRadius: 16,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelBtnText: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 15,
  },
  confirmBtn: {
    flex: 1.5,
    height: 54,
    borderRadius: 16,
    overflow: 'hidden',
  },
  confirmGradient: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  confirmBtnText: {
    color: '#FFFFFF',
    fontFamily: 'Inter_700Bold',
    fontSize: 15,
  },
});
