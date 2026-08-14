import React, { useMemo, useEffect, useState } from 'react';
import { View, Text, StyleSheet, Pressable, Platform, TextInput, Modal, ScrollView } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import DatePickerModal from '@/components/DatePickerModal';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '@/lib/theme-context';
import { useExpenses } from '@/lib/expense-context';
import { type Bill, type RepeatType, type ReminderType, type CategoryType, CATEGORIES } from '@/lib/data';
import { parseVoiceExpense } from '@/lib/parse-voice-expense';
import { Audio } from 'expo-av';
import { getApiUrl, apiRequest } from '@/lib/query-client';
import { useAuth } from '@/lib/auth-context';
import { useSubscription } from '@/lib/subscription-context';
import { usePaywall } from '@/lib/paywall-context';
import { scheduleLocalNotification } from '@/lib/notifications';
import AsyncStorage from '@react-native-async-storage/async-storage';
import PremiumLoader from '@/components/PremiumLoader';
import CustomModal from '@/components/CustomModal';
import { useAlert } from '@/lib/alert-context';

type VoiceState = 'idle' | 'recording' | 'review' | 'transcribing' | 'confirming';

interface ParsedReminder {
  title: string;
  date?: Date;
  timeLabel?: string;
  repeatType: RepeatType;
  reminderType: ReminderType;
  amount?: number;
}

function timeLabelFromDate(d: Date) {
  const hour24 = d.getHours();
  const minute = d.getMinutes();
  const hour12 = ((hour24 + 11) % 12) + 1;
  const suffix = hour24 >= 12 ? 'PM' : 'AM';
  const mm = String(minute).padStart(2, '0');
  return `${hour12}:${mm} ${suffix}`;
}

const TIME_OPTIONS: { id: string; label: string; hour?: number; minute?: number }[] = [
  { id: '6am', label: '6:00 AM', hour: 6, minute: 0 },
  { id: '9am', label: '9:00 AM', hour: 9, minute: 0 },
  { id: '12pm', label: '12:00 PM', hour: 12, minute: 0 },
  { id: '3pm', label: '3:00 PM', hour: 15, minute: 0 },
  { id: '6pm', label: '6:00 PM', hour: 18, minute: 0 },
  { id: '9pm', label: '9:00 PM', hour: 21, minute: 0 },
  { id: 'custom', label: 'Custom…' },
];

const REPEAT_OPTION_IDS: RepeatType[] = ['none', 'daily', 'weekly', 'monthly', 'yearly'];

function extractAmountFromText(text: string): number | null {
  const t = String(text || '');

  // Prefer explicit currency markers (₹ / rs / rupees / rupia / rupaiya).
  const currencyRegexes: RegExp[] = [
    /(?:₹|rs\.?|rupees?|rupia|rupaiya|rupaiye|paisa)\s*([0-9][0-9,]*\.?[0-9]*)/i,
    /([0-9][0-9,]*\.?[0-9]*)\s*(?:₹|rs\.?|rupees?|rupia|rupaiya|rupaiye|paisa)/i,
  ];
  for (const rx of currencyRegexes) {
    const m = t.match(rx);
    if (m?.[1]) {
      const raw = m[1].replace(/,/g, '');
      const n = Number(raw);
      if (Number.isFinite(n) && n > 0) return n;
    }
  }

  // Fallback: pick a likely "amount-like" number (>= 100) with >= 3 digits.
  const nums = Array.from(t.matchAll(/([0-9][0-9,]*\.?[0-9]*)/g))
    .map((m) => (m[1] || '').replace(/,/g, ''))
    .map((s) => Number(s))
    .filter((n) => Number.isFinite(n) && n >= 100 && n <= 1_000_000_000)
    .sort((a, b) => b - a);
  return nums.length ? nums[0] : null;
}

function categoryFromSpeech(text: string, reminderType: ReminderType): CategoryType {
  const t = String(text || '').toLowerCase();

  // Bills & utilities.
  if (/(rent|bill|electricity|internet|wifi|phone|water|gas|utility|insurance)/i.test(t)) return 'bills';

  // Healthcare.
  if (/(health|medicine|doctor|hospital|clinic|vitamin|sugar|bp|blood pressure|mg)/i.test(t)) return 'health';

  // Habits / wellness (map to healthcare visual style).
  if (/(habit|exercise|workout|gym|water|walk|yoga|meditate|meditation)/i.test(t)) return 'health';

  // Travel / events often have no amount (map to "others").
  if (/(travel|trip|flight|hotel|vacation|event|birthday|wedding|anniversary|party)/i.test(t)) return 'others';

  // Family / tasks / work are general reminders.
  if (/(family|parents|wife|husband|kids|children|brother|sister|task|todo|to-do|meeting|deadline|work|office)/i.test(t)) return 'others';

  // Finance / investment.
  if (/(finance|investment|sip|mutual|stocks?|shares?|fd|fixed deposit|savings|loan|mortgage|interest)/i.test(t)) return 'investment';

  // Education.
  if (/(school|college|exam|tuition|course|fees|class)/i.test(t)) return 'education';

  // Finance / investment.
  if (/(investment|sip|mutual|stocks?|shares?|fd|fixed deposit|savings|loan|mortgage)/i.test(t)) return 'investment';

  // Subscriptions (map to entertainment category in this app).
  if (/(subscription|netflix|spotify|prime|membership)/i.test(t)) return 'entertainment';

  // Default fallback based on AI reminderType.
  if (reminderType === 'bill') return 'bills';
  if (reminderType === 'subscription') return 'entertainment';
  return 'others';
}

type ReminderIntent =
  | 'all'
  | 'bills'
  | 'health'
  | 'family'
  | 'work'
  | 'tasks'
  | 'subscriptions'
  | 'finance'
  | 'habits'
  | 'travel'
  | 'events'
  | 'custom';

function inferIntentFromText(text: string, aiReminderType: ReminderType): ReminderIntent {
  const t = String(text || '').toLowerCase();

  if (/(subscription|netflix|spotify|prime|membership)/i.test(t)) return 'subscriptions';
  if (/(rent|electricity|water|gas|internet|wifi|phone|utility|insurance|bill)/i.test(t)) return 'bills';
  if (/(finance|investment|sip|mutual|stocks?|shares?|fd|fixed deposit|savings|loan|mortgage|interest)/i.test(t)) return 'finance';

  if (/(health|medicine|doctor|hospital|clinic|vitamin|sugar|bp|blood pressure|mg)/i.test(t)) return 'health';
  if (/(habit|exercise|workout|gym|water|walk|yoga|meditate|meditation)/i.test(t)) return 'habits';

  if (/(family|parents|wife|husband|kids|children|brother|sister)/i.test(t)) return 'family';
  if (/(task|todo|to-do|deadline|assignment|submit|finish)/i.test(t)) return 'tasks';
  if (/(work|office|meeting|report)/i.test(t)) return 'work';

  if (/(travel|trip|flight|hotel|vacation|tour|airport)/i.test(t)) return 'travel';
  if (/(event|birthday|wedding|anniversary|party|ceremony)/i.test(t)) return 'events';

  // Fallback to AI parse.
  if (aiReminderType === 'bill') return 'bills';
  if (aiReminderType === 'subscription') return 'subscriptions';
  return 'custom';
}

function policyForIntent(intent: ReminderIntent): {
  showDue: boolean;
  showRepeat: boolean;
  forcedRepeatType?: RepeatType;
  defaultRepeatType?: RepeatType;
  reminderTypeOverride?: ReminderType;
  shouldHaveAmount: boolean;
  categoryOverride?: CategoryType;
  iconOverride?: string;
} {
  switch (intent) {
    case 'health':
      return {
        showDue: false, // per your image table: Due = X, Repeat = check
        showRepeat: true,
        defaultRepeatType: 'daily',
        forcedRepeatType: 'daily',
        reminderTypeOverride: 'custom',
        shouldHaveAmount: false,
        categoryOverride: 'health',
        iconOverride: 'medkit',
      };
    case 'habits':
      return {
        showDue: false, // Due = X
        showRepeat: true,
        defaultRepeatType: 'daily',
        forcedRepeatType: 'daily',
        reminderTypeOverride: 'custom',
        shouldHaveAmount: false,
        categoryOverride: 'health',
        iconOverride: 'water',
      };
    case 'bills':
      return {
        showDue: true,
        showRepeat: true,
        reminderTypeOverride: 'bill',
        shouldHaveAmount: true,
        categoryOverride: 'bills',
        iconOverride: 'receipt',
      };
    case 'subscriptions':
      return {
        showDue: true,
        showRepeat: true,
        reminderTypeOverride: 'subscription',
        shouldHaveAmount: true,
        categoryOverride: 'entertainment',
        iconOverride: 'refresh',
      };
    case 'finance':
      return {
        showDue: true,
        showRepeat: true,
        reminderTypeOverride: 'bill',
        shouldHaveAmount: true,
        categoryOverride: 'investment',
        iconOverride: 'trending-up',
      };
    case 'tasks':
      return {
        showDue: true,
        showRepeat: false, // Repeat = X
        forcedRepeatType: 'none',
        reminderTypeOverride: 'custom',
        shouldHaveAmount: false,
        categoryOverride: 'others',
        iconOverride: 'shield-checkmark',
      };
    case 'travel':
      return {
        showDue: true,
        showRepeat: false, // Repeat = X
        forcedRepeatType: 'none',
        reminderTypeOverride: 'custom',
        shouldHaveAmount: false,
        categoryOverride: 'others',
        iconOverride: 'globe',
      };
    case 'events':
      return {
        showDue: true,
        showRepeat: true, // Repeat visible because it’s forced yearly
        forcedRepeatType: 'yearly',
        reminderTypeOverride: 'custom',
        shouldHaveAmount: false,
        categoryOverride: 'others',
        iconOverride: 'film',
      };
    case 'family':
      return {
        showDue: true,
        showRepeat: true, // optional repeat in your image => we allow repeat picker
        reminderTypeOverride: 'custom',
        shouldHaveAmount: false,
        categoryOverride: 'others',
        iconOverride: 'people',
      };
    case 'work':
      return {
        showDue: true,
        showRepeat: true,
        reminderTypeOverride: 'custom',
        shouldHaveAmount: false,
        categoryOverride: 'others',
        iconOverride: 'newspaper',
      };
    case 'all':
    case 'custom':
    default:
      return {
        showDue: true,
        showRepeat: true,
        reminderTypeOverride: undefined,
        shouldHaveAmount: false,
        categoryOverride: undefined,
        iconOverride: undefined,
      };
  }
}

const REPEAT_LABEL_KEYS: Record<RepeatType, string> = {
  none: 'voiceReminder.repeatOneTime',
  daily: 'voiceReminder.repeatDaily',
  weekly: 'voiceReminder.repeatWeekly',
  monthly: 'voiceReminder.repeatMonthly',
  yearly: 'voiceReminder.repeatYearly',
};

function parsedFromServer(p: {
  title: string;
  isoDate: string;
  hour: number;
  minute: number;
  repeatType: RepeatType;
  reminderType: ReminderType;
  amount?: number | null;
}): ParsedReminder {
  const dt = new Date(`${p.isoDate}T00:00:00.000Z`);
  if (!Number.isNaN(dt.getTime())) {
    dt.setHours(p.hour ?? 9, p.minute ?? 0, 0, 0);
  }
  return {
    title: String(p.title || 'Reminder'),
    date: Number.isNaN(dt.getTime()) ? undefined : dt,
    timeLabel: Number.isNaN(dt.getTime()) ? undefined : timeLabelFromDate(dt),
    repeatType: p.repeatType || 'none',
    reminderType: p.reminderType || 'custom',
    amount: typeof p.amount === 'number' ? p.amount : undefined,
  };
}

export default function VoiceReminderScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  /**
   * `?mode=expense` means the user arrived via "Speak an expense" (the FAB), so
   * logging an expense is the primary action and the reminder becomes secondary.
   * Arriving without it (the home-screen "Voice Reminder" circle) keeps the
   * original reminder-first behaviour.
   */
  const { mode } = useLocalSearchParams<{ mode?: string }>();
  const isExpenseMode = mode === 'expense';
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const { token } = useAuth();
  const { checkLimit, incrementUsage } = useSubscription();
  const { presentPaywall } = usePaywall();
  const { addReminder, reminderSettings, addTransaction } = useExpenses();
  /** Family members, used to resolve a spoken "Papa"/"Mummy" to a real member. */
  const [voiceMembers, setVoiceMembers] = useState<
    { id: string; name: string; relationship: string }[]
  >([]);
  const { showAlert } = useAlert();
  const [state, setState] = useState<VoiceState>('idle');
  const [spokenText, setSpokenText] = useState('');
  const [draftText, setDraftText] = useState('');
  const [isEditing, setIsEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recording, setRecording] = useState<Audio.Recording | null>(null);
  const [isOfflineSaved, setIsOfflineSaved] = useState(false);
  const [detectedLanguage, setDetectedLanguage] = useState<string | null>(null);
  const [serverParsed, setServerParsed] = useState<ParsedReminder | null>(null);
  const [showTimePicker, setShowTimePicker] = useState(false);
  const [tempTime, setTempTime] = useState<Date | null>(null);
  const [showRepeatPicker, setShowRepeatPicker] = useState(false);
  const [tempRepeat, setTempRepeat] = useState<RepeatType>('none');

  const ringPulse = useSharedValue(1);
  const micScale = useSharedValue(1);

  const ringStyle = useAnimatedStyle(() => ({
    transform: [{ scale: ringPulse.value }],
    opacity: state === 'recording' ? 0.9 : 0.35,
  }));

  const micStyle = useAnimatedStyle(() => ({
    transform: [{ scale: micScale.value }],
  }));

  const parsed = useMemo(() => {
    if (serverParsed) return serverParsed;
    return null;
  }, [serverParsed]);

  const headerTop = Platform.OS === 'web' ? 40 : insets.top + 8;

  useEffect(() => {
    return () => {
      // Cleanup recording if screen unmounts mid-record
      if (recording) {
        recording.stopAndUnloadAsync().catch(() => {});
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Family members, so a spoken "Papa ke liye" can be attributed to a real member.
  useEffect(() => {
    if (!token) return;
    let mounted = true;
    (async () => {
      try {
        const res = await apiRequest('GET', '/api/family', undefined, token);
        if (!res.ok) return;
        const data = (await res.json()) as { id: string; name: string; relationship: string }[];
        if (mounted) setVoiceMembers(Array.isArray(data) ? data : []);
      } catch {
        if (mounted) setVoiceMembers([]);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [token]);

  async function handleStartRecording() {
    // Gate: voice reminder is monthly-metered (doc §5.1 — "6th voice reminder
    // in month" → paywall). Uses the same recommended-plan trigger as reminders.
    const check = checkLimit('voiceReminderPerMonth');
    if (!check.allowed) {
      presentPaywall(check.triggerKey ?? 'eleventhReminder');
      return;
    }
    incrementUsage('voiceReminderPerMonth');
    setError(null);
    setDetectedLanguage(null);
    setServerParsed(null);
    setIsEditing(false);
    setDraftText('');
    setSpokenText('');
    setState('recording');
    ringPulse.value = withRepeat(
      withSequence(withTiming(1.08, { duration: 800 }), withTiming(1, { duration: 800 })),
      -1,
      true,
    );
    micScale.value = withRepeat(
      withSequence(withTiming(1.05, { duration: 700 }), withTiming(1, { duration: 700 })),
      -1,
      true,
    );

    try {
      const perm = await Audio.requestPermissionsAsync();
      if (!perm.granted) {
        setError(t('voiceReminder.errorMicPermission'));
        setState('idle');
        return;
      }

      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
      });

      const rec = new Audio.Recording();
      // Enable metering so the pulse feels "live" while recording.
      await rec.prepareToRecordAsync({
        ...Audio.RecordingOptionsPresets.HIGH_QUALITY,
        android: {
          ...(Audio.RecordingOptionsPresets.HIGH_QUALITY.android as any),
          isMeteringEnabled: true,
        },
        ios: {
          ...(Audio.RecordingOptionsPresets.HIGH_QUALITY.ios as any),
          isMeteringEnabled: true,
        },
      } as any);
      await rec.startAsync();
      setRecording(rec);
    } catch {
      setError(t('voiceReminder.errorMicUnavailable'));
      setState('idle');
    }
  }

  async function handleStopRecording() {
    const rec = recording;
    setRecording(null);
    if (!rec) {
      setState('idle');
      return;
    }

    setState('transcribing');
    try {
      await rec.stopAndUnloadAsync();
      const uri = rec.getURI();
      if (!uri) {
        setError(t('voiceReminder.errorNoAudio'));
        setState('idle');
        return;
      }

      if (!token) {
        setError(t('voiceReminder.errorPleaseLogin'));
        setState('idle');
        return;
      }

      const baseUrl = getApiUrl();
      const url = new URL('/api/reminders/voice/parse', baseUrl).toString();
      const form = new FormData();
      // RN/Expo multipart uploads are most reliable with { uri, name, type }
      // (Blob uploads often fail on Android with "Network request failed")
      form.append('audio', {
        uri,
        name: 'voice.m4a',
        type: 'audio/m4a',
      } as any);

      const res = await fetch(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      });

      if (!res.ok) {
        const body = await res.text().catch(() => '');
        // Log the FULL body — a 403 here carries the transcription provider's
        // own error text, which is what the backend team needs to act on.
        // Truncating it hid exactly the detail that identifies the cause.
        console.error(`[Voice] Transcribe failed HTTP ${res.status}`);
        console.error('[Voice] Server said:', body);
        let msg = t('voiceReminder.errorGenericProcessing');
        try {
          msg = JSON.parse(body)?.message || msg;
        } catch {
          // non-JSON error page — keep the generic message
        }
        // Only 401 means "your login is bad". A 403 on this route is the
        // SERVER being refused by the transcription provider (bad/revoked
        // OpenAI key, or no credit) — telling the user to sign in again for
        // that is wrong and sends them chasing a problem they cannot fix.
        if (res.status === 401) {
          msg = t('voiceReminder.errorSessionExpired');
        } else if (res.status === 403 || res.status === 500) {
          msg = t('voiceReminder.errorServerUnavailable');
        }
        setError(msg);
        setState('idle');
        return;
      }

      const json = (await res.json()) as {
        text?: string;
        language?: string | null;
        parsed?: {
          title: string;
          isoDate: string;
          hour: number;
          minute: number;
          repeatType: RepeatType;
          reminderType: ReminderType;
          amount?: number | null;
        };
      };

      const text = (json.text || '').trim();
      if (!text) {
        setError(t('voiceReminder.errorNotUnderstood'));
        setState('idle');
        return;
      }
      setSpokenText(text);
      setDraftText(text);
      setIsEditing(false);
      setDetectedLanguage(json.language || null);

      if (json.parsed?.isoDate) {
        setServerParsed(parsedFromServer(json.parsed));
      } else {
        setServerParsed(null);
      }

      setError(null);
      setState('review');
    } catch (e: any) {
      const msg = String(e?.message || '');
      if (/network request failed/i.test(msg)) {
        setError(t('voiceReminder.errorBackendUnreachable'));
      } else {
        setError(t('voiceReminder.errorMicOrNetwork'));
      }
      setState('idle');
    } finally {
      // Return app audio mode to playback-friendly defaults after recording.
      Audio.setAudioModeAsync({
        allowsRecordingIOS: false,
        playsInSilentModeIOS: true,
      }).catch(() => {});
    }
  }

  async function reparseDraftWithBackend(nextText: string) {
    if (!token) return;
    try {
      const baseUrl = getApiUrl();
      const url = new URL('/api/reminders/parse', baseUrl).toString();
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ text: nextText }),
      });
      if (!res.ok) return;
      const json = (await res.json()) as {
        title: string;
        isoDate: string;
        hour: number;
        minute: number;
        repeatType: RepeatType;
        reminderType: ReminderType;
        amount?: number | null;
      };
      if (json?.isoDate) setServerParsed(parsedFromServer(json));
    } catch {
      // ignore, keep previous parse
    }
  }

  /**
   * Save the spoken phrase as an EXPENSE — Method 3 in the product doc.
   *
   * The transcript is parsed on-device by `parseVoiceExpense` (no extra API
   * call). Reaching this point means an amount was found, since the button is
   * hidden otherwise: a voice expense with no amount has nothing to save, and
   * the doc is explicit that low confidence must not silently guess.
   */
  async function handleSaveAsExpense() {
    const spoken = (isEditing ? draftText : spokenText).trim();
    if (!spoken) return;

    const guess = parseVoiceExpense(spoken, (c) => CATEGORIES[c].label);
    if (guess.amount == null || guess.amount <= 0) {
      setError(t('voiceReminder.errorNoAmountHeard'));
      return;
    }

    setState('confirming');
    // A spoken kinship term ("Papa") is matched against real family members;
    // an unmatched name is dropped rather than invented.
    const matchedMember = guess.memberName
      ? voiceMembers.find((m) =>
          m.name.toLowerCase().includes(guess.memberName!.toLowerCase()) ||
          guess.memberName!.toLowerCase().includes(m.name.toLowerCase()) ||
          m.relationship.toLowerCase() === guess.memberName!.toLowerCase(),
        )
      : undefined;

    const created = await addTransaction({
      merchant: guess.merchant || CATEGORIES[guess.category].label,
      amount: guess.amount,
      category: guess.category,
      memberId: matchedMember?.id ?? null,
      description: spoken,
      source: 'voice',
    });

    if (!created) {
      setState('review');
      setError(t('voiceReminder.errorCouldNotSaveExpense'));
      return;
    }

    setSpokenText('');
    setDraftText('');
    setIsEditing(false);
    setServerParsed(null);
    setError(null);
    setState('idle');
    showAlert({
      title: t('voiceReminder.expenseSavedTitle'),
      message: `₹${guess.amount.toLocaleString('en-IN')} · ${CATEGORIES[guess.category].label}${
        matchedMember ? ` · ${matchedMember.name}` : ''
      }`,
      type: 'success',
    });
  }

  async function handleConfirm() {
    const effective =
      parsed ??
      (spokenText.trim()
        ? {
            title: spokenText.trim(),
            date: new Date(),
            timeLabel: timeLabelFromDate(new Date()),
            repeatType: 'none' as RepeatType,
            reminderType: 'custom' as ReminderType,
          }
        : null);

    if (!effective) {
      setError(t('voiceReminder.errorCouldNotUnderstandReminder'));
      return;
    }
    setState('confirming');
    try {
      const now = new Date();
      const baseDate = effective.date ?? now;
      const dueDateIso = baseDate.toISOString();
      const spoken = spokenText.trim();
      const intent = inferIntentFromText(spoken, effective.reminderType);
      const p = policyForIntent(intent);

      const reminderTypeFinal = p.reminderTypeOverride ?? effective.reminderType;
      const repeatTypeFinal =
        p.forcedRepeatType ??
        (p.defaultRepeatType && effective.repeatType === 'none' ? p.defaultRepeatType : effective.repeatType);

      const computedCategory = p.categoryOverride ?? categoryFromSpeech(spoken, reminderTypeFinal);
      const computedIconByCategory =
        computedCategory === 'bills'
          ? 'receipt'
          : computedCategory === 'health'
            ? 'medkit'
            : computedCategory === 'education'
              ? 'book'
              : computedCategory === 'investment'
                ? 'trending-up'
                : computedCategory === 'entertainment'
                  ? 'refresh'
                  : 'create';
      const computedIcon = p.iconOverride ?? computedIconByCategory;

      const extractedAmount = effective.amount ?? (p.shouldHaveAmount ? (extractAmountFromText(spoken) ?? 0) : 0);

      const newBill: Omit<Bill, 'id'> = {
        name: effective.title,
        amount: extractedAmount,
        dueDate: dueDateIso,
        category: computedCategory,
        isPaid: false,
        icon: computedIcon,
        reminderType: reminderTypeFinal,
        repeatType: repeatTypeFinal,
        status: 'active',
        reminderDaysBefore: reminderSettings.defaultReminderDays ?? [1, 0],
      };
      // Save to backend (best-effort). If offline, we still store locally.
      const created = await addReminder(newBill);

      // Local notification (best-effort)
      if (effective.date) {
        const dueDate = new Date(dueDateIso);
        await scheduleLocalNotification({
          title: t('voiceReminder.notificationTitle'),
          body: effective.title,
          data: { type: 'reminder', billId: created?.id },
          triggerAt: dueDate,
        }).catch(() => {});
      }

      // Offline fallback: persist the draft so it can be recreated later if network fails.
      // (We can't reliably detect offline here; this is a lightweight safety net.)
      await AsyncStorage.setItem(
        '@lifewise_last_voice_reminder_draft',
        JSON.stringify({ at: Date.now(), bill: newBill }),
      ).catch(() => {});
      setIsOfflineSaved(true);

      if (created?.id) {
        router.replace(`/bill-details/${created.id}`);
      } else {
        router.back();
      }
    } catch {
      setError(t('voiceReminder.errorCouldNotCreateReminder'));
      setState('review');
    }
  }

  const titleLine =
    state === 'recording'
      ? t('voiceReminder.stageRecording')
      : state === 'transcribing'
        ? t('voiceReminder.stageProcessing')
      : state === 'review'
        ? t('voiceReminder.stageReview')
        : t('voiceReminder.stageIdle');

  const showTranscript = state === 'review' && !!(isEditing ? draftText.trim() : spokenText.trim());
  const heroText = (isEditing ? draftText : spokenText).trim();
  const canInteract = state !== 'transcribing' && state !== 'confirming';
  const hasTranscript = !!spokenText.trim();

  /**
   * On-device expense reading of the same transcript. Non-null only when an
   * amount was found, which is what gates the "save as expense" action.
   */
  const voiceExpenseGuess = useMemo(() => {
    const text = heroText;
    if (!text) return null;
    const guess = parseVoiceExpense(text, (c) => CATEGORIES[c].label);
    return guess.amount != null && guess.amount > 0 ? guess : null;
  }, [heroText]);

  const effectiveParsed = parsed ?? (spokenText.trim()
    ? {
        title: spokenText.trim(),
        date: new Date(),
        timeLabel: timeLabelFromDate(new Date()),
        repeatType: 'none' as RepeatType,
        reminderType: 'custom' as ReminderType,
      }
    : null);

  const policyIntent = inferIntentFromText(
    isEditing ? draftText : spokenText,
    (effectiveParsed?.reminderType ?? 'custom') as ReminderType,
  );
  const policy = policyForIntent(policyIntent);

  const effectiveParsedForUI = effectiveParsed
    ? {
        ...effectiveParsed,
        reminderType: policy.reminderTypeOverride ?? effectiveParsed.reminderType,
        repeatType:
          policy.forcedRepeatType ??
          (policy.defaultRepeatType && effectiveParsed.repeatType === 'none'
            ? policy.defaultRepeatType
            : effectiveParsed.repeatType),
      }
    : null;

  return (
    <View style={[styles.container, { backgroundColor: colors.bg }]}>
      <View style={[styles.header, { paddingTop: headerTop }]}>
        <Pressable onPress={() => router.back()} hitSlop={12} disabled={!canInteract}>
          <Text style={[styles.headerCancel, { color: colors.textSecondary }]}>{t('common.cancel')}</Text>
        </Pressable>
        <Text style={[styles.headerTitle, { color: colors.text }]}>
          {isExpenseMode ? t('voiceReminder.titleExpense') : t('voiceReminder.titleReminder')}
        </Text>
        <View style={{ width: 56 }} />
      </View>

      <View style={[styles.content, { paddingBottom: Math.max(insets.bottom, 12) }]}>
        <View style={styles.centerStage}>
          <Pressable
            onPress={state === 'recording' ? handleStopRecording : handleStartRecording}
            hitSlop={20}
            disabled={!canInteract}
          >
            <View style={[styles.micOuterShadow, { backgroundColor: colors.accentDim, borderWidth: 1, borderColor: colors.accent + '30' }]}>
              <View style={[styles.micOuterGradient, { backgroundColor: colors.accent }]}>
                <Animated.View style={[styles.micInner, { backgroundColor: colors.card }, micStyle]}>
                  {state === 'transcribing' ? (
                    <PremiumLoader size={30} compact />
                  ) : (
                    <Ionicons
                      name={state === 'recording' ? 'stop' : 'mic'}
                      size={40}
                      color={colors.accent}
                    />
                  )}
                </Animated.View>
              </View>
            </View>
          </Pressable>

          <Text style={[styles.stageTitle, { color: colors.text }]}>{titleLine}</Text>

          <View style={styles.transcriptWrap}>
            {isEditing ? (
              <TextInput
                value={draftText}
                onChangeText={setDraftText}
                placeholder={t('voiceReminder.typePlaceholder')}
                placeholderTextColor={colors.textTertiary}
                style={[styles.transcriptInput, { backgroundColor: colors.card, borderColor: colors.border, color: colors.text }]}
                multiline
                autoFocus
              />
            ) : (
              <Text
                style={[styles.transcriptHero, { color: colors.text }, !showTranscript && { color: colors.textTertiary, fontFamily: 'Inter_600SemiBold' }]}
                numberOfLines={5}
              >
                {state === 'recording'
                  ? t('voiceReminder.listening')
                  : state === 'transcribing'
                    ? t('voiceReminder.transcribing')
                    : showTranscript
                      ? heroText
                      : t('voiceReminder.tapMicPrompt')}
              </Text>
            )}
          </View>

          {!!error && <Text style={styles.errorText}>{error}</Text>}
          {state === 'review' && detectedLanguage && (
            <Text style={[styles.langPill, { backgroundColor: colors.accentDim, borderColor: colors.accent + '40', color: colors.accent }]}>{t('voiceReminder.detectedLanguage', { language: detectedLanguage.toUpperCase() })}</Text>
          )}
        </View>

        <View style={styles.bottomSheet}>
          {state === 'review' && effectiveParsedForUI ? (
            <View style={[styles.confirmCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Text style={[styles.confirmTitle, { color: colors.text }]} numberOfLines={1}>{effectiveParsedForUI.title}</Text>
              {!isEditing && (
                <View style={[styles.schedulePanel, { backgroundColor: colors.cardElevated }]}>
                  {policy.showDue && (
                    <Pressable
                      style={styles.scheduleRow}
                      onPress={() => {
                        if (!canInteract) return;
                        setTempTime(effectiveParsedForUI.date ?? new Date());
                        setShowTimePicker(true);
                      }}
                    >
                      <View style={styles.scheduleLeft}>
                        <Ionicons name="time" size={16} color={colors.accent} />
                        <Text style={[styles.scheduleLabel, { color: colors.accent }]}>{t('voiceReminder.scheduleTime')}</Text>
                      </View>
                      <View style={styles.scheduleRight}>
                        <Text style={[styles.scheduleValue, { color: colors.text }]}>
                          {effectiveParsedForUI.timeLabel || t('voiceReminder.scheduleSelectTime')}
                        </Text>
                        <Ionicons name="chevron-down" size={16} color={colors.textTertiary} />
                      </View>
                    </Pressable>
                  )}

                  {policy.showDue && policy.showRepeat && <View style={[styles.scheduleDivider, { backgroundColor: colors.border }]} />}

                  {effectiveParsedForUI.amount !== undefined && effectiveParsedForUI.amount > 0 && (
                    <View style={styles.scheduleRow}>
                      <View style={styles.scheduleLeft}>
                        <Ionicons name="cash" size={16} color={colors.accent} />
                        <Text style={[styles.scheduleLabel, { color: colors.accent }]}>{t('voiceReminder.scheduleAmount')}</Text>
                      </View>
                      <View style={styles.scheduleRight}>
                        <Text style={[styles.scheduleValue, { color: '#10B981', fontWeight: '700' }]}>
                          ₹{effectiveParsedForUI.amount || 0}
                        </Text>
                      </View>
                    </View>
                  )}

                  {policy.showRepeat && (
                    <>
                      <View style={[styles.scheduleDivider, { backgroundColor: colors.border }]} />
                      <Pressable
                        style={styles.scheduleRow}
                        onPress={() => {
                          if (!canInteract) return;
                          if (policy.forcedRepeatType) return; // fixed repeat categories are not editable here
                          setTempRepeat(effectiveParsedForUI.repeatType);
                          setShowRepeatPicker(true);
                        }}
                      >
                        <View style={styles.scheduleLeft}>
                          <Ionicons name="repeat" size={16} color={colors.accent} />
                          <Text style={[styles.scheduleLabel, { color: colors.accent }]}>{t('voiceReminder.scheduleRepeat')}</Text>
                        </View>
                        <View style={styles.scheduleRight}>
                          <Text style={[styles.scheduleValue, { color: colors.text }]}>
                            {t(REPEAT_LABEL_KEYS[effectiveParsedForUI.repeatType])}
                          </Text>
                          <Ionicons name="chevron-down" size={16} color={colors.textTertiary} />
                        </View>
                      </Pressable>
                    </>
                  )}
                </View>
              )}
            </View>
          ) : null}

          {state === 'review' && hasTranscript && (
            <View style={styles.actionsRow}>
              <Pressable
                onPress={async () => {
                  if (!canInteract) return;
                  if (!isEditing) {
                    setDraftText(spokenText);
                    setIsEditing(true);
                    return;
                  }
                  setSpokenText(draftText);
                  setIsEditing(false);
                  await reparseDraftWithBackend(draftText);
                }}
                style={[styles.secondaryBtn, !showTranscript && { opacity: 0.45 }]}
                disabled={!showTranscript || !canInteract}
              >
                <Ionicons name={isEditing ? 'checkmark' : 'pencil'} size={16} color="#FFFFFF" />
                <Text style={styles.secondaryBtnText}>{isEditing ? t('voiceReminder.actionDone') : t('voiceReminder.actionEdit')}</Text>
              </Pressable>

              <Pressable
                onPress={() => {
                  if (!canInteract) return;
                  setSpokenText('');
                  setDraftText('');
                  setIsEditing(false);
                  setDetectedLanguage(null);
                  setServerParsed(null);
                  setError(null);
                  setState('idle');
                }}
                style={styles.ghostBtn}
                disabled={!canInteract}
              >
                <Ionicons name="refresh" size={16} color="#FFFFFF" />
                <Text style={styles.ghostBtnText}>{t('voiceReminder.actionReset')}</Text>
              </Pressable>
            </View>
          )}

          {/*
            Button order flips with `mode`. Arriving from "Speak an expense"
            makes the expense the primary action; arriving from the home-screen
            "Voice Reminder" circle keeps the reminder primary. Same screen,
            emphasis matched to how the user got here.
          */}
          {isExpenseMode ? (
            <>
              <Pressable
                disabled={!voiceExpenseGuess || !canInteract || state !== 'review'}
                onPress={handleSaveAsExpense}
                style={[
                  styles.primaryBtn,
                  { backgroundColor: '#4F46E5' },
                  (!voiceExpenseGuess || !canInteract) && { opacity: 0.5 },
                ]}
              >
                <Text style={styles.primaryBtnText}>
                  {state === 'confirming'
                    ? t('voiceReminder.saving')
                    : voiceExpenseGuess
                      ? t('voiceReminder.saveExpenseWithAmount', { amount: `₹${voiceExpenseGuess.amount!.toLocaleString('en-IN')}` })
                      : t('voiceReminder.sayAmountToSave')}
                </Text>
              </Pressable>

              {state === 'review' && effectiveParsed && (
                <Pressable
                  onPress={handleConfirm}
                  disabled={!canInteract}
                  style={[styles.expenseAltBtn, { borderColor: colors.border }]}
                >
                  <Ionicons name="notifications-outline" size={15} color={colors.text} />
                  <Text style={[styles.expenseAltText, { color: colors.text }]}>
                    {t('voiceReminder.notSpentYetSaveReminder')}
                  </Text>
                </Pressable>
              )}
            </>
          ) : (
            <>
              <Pressable
                disabled={!effectiveParsed || !canInteract || state !== 'review'}
                onPress={handleConfirm}
                style={[
                  styles.primaryBtn,
                  { backgroundColor: '#4F46E5' },
                  (!effectiveParsed || !canInteract) && { opacity: 0.5 }
                ]}
              >
                <Text style={styles.primaryBtnText}>
                  {state === 'confirming' ? t('voiceReminder.saving') : t('voiceReminder.saveReminder')}
                </Text>
              </Pressable>

              {/*
                "Already spent" branch — Method 3. Offered only when the phrase
                actually contains an amount, so the user is never shown a save
                action that cannot succeed.
              */}
              {state === 'review' && voiceExpenseGuess && (
                <Pressable
                  onPress={handleSaveAsExpense}
                  disabled={!canInteract}
                  style={[styles.expenseAltBtn, { borderColor: colors.border }]}
                >
                  <Ionicons name="wallet-outline" size={15} color={colors.text} />
                  <Text style={[styles.expenseAltText, { color: colors.text }]}>
                    {t('voiceReminder.alreadySpentSaveExpense', { amount: `₹${voiceExpenseGuess.amount!.toLocaleString('en-IN')}` })}
                  </Text>
                </Pressable>
              )}
            </>
          )}
        </View>
      </View>

      {/* Time picker dropdown */}
      <DatePickerModal
        visible={showTimePicker}
        onClose={() => setShowTimePicker(false)}
        title={t('voiceReminder.selectTimeTitle')}
        mode="time"
        value={tempTime ?? new Date()}
        onConfirm={(picked) => {
          setTempTime(picked);
          setServerParsed((prev) => {
            const base = prev?.date ?? new Date();
            const next = new Date(base);
            next.setHours(picked.getHours(), picked.getMinutes(), 0, 0);
            const baseParsed = prev ?? {
              title: spokenText.trim() || 'Reminder',
              date: new Date(),
              timeLabel: timeLabelFromDate(new Date()),
              repeatType: effectiveParsedForUI?.repeatType ?? ('none' as RepeatType),
              reminderType: effectiveParsedForUI?.reminderType ?? ('custom' as ReminderType),
            };
            return {
              ...baseParsed,
              date: next,
              timeLabel: timeLabelFromDate(next),
            };
          });
        }}
      />

      {/* Repeat picker dropdown */}
      <CustomModal visible={showRepeatPicker} onClose={() => setShowRepeatPicker(false)} showCloseButton={false}>
        <Text style={[styles.modalTitle, { color: colors.text }]}>{t('voiceReminder.repeatModalTitle')}</Text>
        <ScrollView style={{ maxHeight: 260 }}>
          {REPEAT_OPTION_IDS.map((id) => {
            const isActive = tempRepeat === id;
            return (
              <Pressable
                key={id}
                onPress={() => setTempRepeat(id)}
                style={[styles.repeatRow, isActive && { backgroundColor: `${colors.accent}15` }]}
              >
                <Text style={[styles.repeatLabel, { color: isActive ? colors.accent : colors.text }, isActive && { fontFamily: 'Inter_600SemiBold' }]}>
                  {t(REPEAT_LABEL_KEYS[id])}
                </Text>
                {isActive ? <Ionicons name="checkmark" size={16} color={colors.accent} /> : null}
              </Pressable>
            );
          })}
        </ScrollView>
        <View style={styles.modalActionsRow}>
          <Pressable onPress={() => setShowRepeatPicker(false)} style={styles.modalTextButton}>
            <Text style={[styles.modalTextButtonLabel, { color: colors.textTertiary }]}>{t('common.cancel')}</Text>
          </Pressable>
          <Pressable
            onPress={() => {
              setServerParsed((prev) => {
                const baseParsed = prev ?? {
                  title: spokenText.trim() || 'Reminder',
                  date: effectiveParsedForUI?.date ?? new Date(),
                  timeLabel: effectiveParsedForUI?.timeLabel ?? timeLabelFromDate(new Date()),
                  repeatType: effectiveParsedForUI?.repeatType ?? ('none' as RepeatType),
                  reminderType: effectiveParsedForUI?.reminderType ?? ('custom' as ReminderType),
                };
                return {
                  ...baseParsed,
                  repeatType: tempRepeat,
                };
              });
              setShowRepeatPicker(false);
            }}
            style={[styles.modalPrimaryButton, { backgroundColor: colors.accent }]}
          >
            <Text style={[styles.modalPrimaryButtonLabel, { color: '#FFFFFF' }]}>{t('common.save')}</Text>
          </Pressable>
        </View>
      </CustomModal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    paddingHorizontal: 20,
    paddingBottom: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerCancel: {
    fontFamily: 'Inter_500Medium',
    fontSize: 14,
    color: '#6B7280',
  },
  headerTitle: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 16,
    color: '#111827',
  },
  content: {
    flex: 1,
    paddingHorizontal: 20,
  },
  centerStage: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 10,
  },
  micOuter: {
    width: 140,
    height: 140,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#EEF2FF',
    borderWidth: 0,
    overflow: 'hidden',
  },
  micOuterShadow: {
    width: 152,
    height: 152,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  micOuterGradient: {
    width: 152,
    height: 152,
    borderRadius: 999,
    padding: 3,
    alignItems: 'center',
    justifyContent: 'center',
  },
  micInner: {
    width: 100,
    height: 100,
    borderRadius: 50,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
    borderWidth: 0,
    // No shadows/elevation in this modern light UI
    position: 'relative',
  },
  stageTitle: {
    marginTop: 18,
    marginBottom: 0,
    fontFamily: 'Inter_700Bold',
    fontSize: 22,
    color: '#111827',
    letterSpacing: -0.3,
    textAlign: 'center',
  },
  stageSubtitle: {
    marginTop: 6,
    fontFamily: 'Inter_400Regular',
    fontSize: 13,
    color: 'rgba(255,255,255,0.68)',
    textAlign: 'center',
  },
  transcriptWrap: {
    marginTop: 22,
    width: '100%',
    paddingHorizontal: 8,
  },
  transcriptHero: {
    fontFamily: 'Inter_700Bold',
    fontSize: 28,
    lineHeight: 34,
    color: '#111827',
    textAlign: 'center',
    letterSpacing: -0.6,
  },
  transcriptHeroPlaceholder: {
    color: '#9CA3AF',
    fontFamily: 'Inter_600SemiBold',
  },
  transcriptInput: {
    minHeight: 110,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: '#111827',
    fontFamily: 'Inter_500Medium',
    fontSize: 16,
    lineHeight: 22,
    textAlign: 'center',
  },
  errorText: {
    marginTop: 14,
    fontFamily: 'Inter_500Medium',
    fontSize: 12,
    textAlign: 'center',
    color: '#DC2626',
  },
  langPill: {
    marginTop: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: '#EEF2FF',
    borderWidth: 1,
    borderColor: '#C7D2FE',
    color: '#4F46E5',
    fontFamily: 'Inter_600SemiBold',
    fontSize: 12,
    overflow: 'hidden',
  },
  bottomSheet: {
    paddingTop: 12,
    paddingBottom: 4,
  },
  confirmCard: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    backgroundColor: '#FFFFFF',
    padding: 14,
    marginBottom: 12,
  },
  confirmTitle: {
    fontFamily: 'Inter_700Bold',
    fontSize: 16,
    color: '#111827',
    marginBottom: 10,
    letterSpacing: -0.2,
  },
  confirmMetaRow: {
    flexDirection: 'row',
    gap: 12,
  },
  schedulePanel: {
    marginTop: 8,
    borderRadius: 16,
    backgroundColor: '#F2F7FF',
    borderWidth: 0,
    paddingVertical: 6,
  },
  scheduleRow: {
    paddingHorizontal: 12,
    paddingVertical: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  scheduleLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  scheduleRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  scheduleLabel: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 13,
    color: '#4F46E5',
  },
  scheduleValue: {
    fontFamily: 'Inter_700Bold',
    fontSize: 13,
    color: '#111827',
  },
  scheduleDivider: {
    height: 1,
    backgroundColor: '#DBEAFE',
    marginHorizontal: 12,
  },
  dropdownRow: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 12,
    paddingVertical: 12,
    marginTop: 4,
  },
  dropdownLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  dropdownRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  dropdown: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'stretch',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    marginTop: 4,
    backgroundColor: '#FFFFFF',
    overflow: 'hidden',
  },
  dropdownAccent: {
    width: 6,
    backgroundColor: '#A855F7',
    alignSelf: 'stretch',
  },
  dropdownBody: {
    flex: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  dropdownLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 4,
  },
  dropdownLabel: {
    fontFamily: 'Inter_500Medium',
    fontSize: 11,
    color: '#6B7280',
  },
  dropdownValueRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  dropdownValueText: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 13,
    color: '#111827',
  },
  actionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    marginBottom: 10,
  },
  secondaryBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderRadius: 14,
    borderWidth: 0,
    backgroundColor: '#4F46E5',
    paddingVertical: 12,
    paddingHorizontal: 0,
  },
  secondaryBtnText: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 13,
    color: '#FFFFFF',
  },
  ghostBtn: {
    flexDirection: 'row',
    paddingVertical: 12,
    paddingHorizontal: 0,
    borderRadius: 14,
    borderWidth: 0,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#E11D48',
    flex: 1,
    gap: 8,
  },
  ghostBtnText: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 13,
    color: '#FFFFFF',
  },
  primaryBtn: {
    borderRadius: 16,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryBtnText: {
    fontFamily: 'Inter_800ExtraBold',
    fontSize: 15,
    color: '#FFFFFF',
    letterSpacing: 0.3,
  },
  expenseAltBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    minHeight: 44,
    paddingVertical: 12,
    marginTop: 10,
    borderRadius: 16,
    borderWidth: 1,
  },
  expenseAltText: {
    fontFamily: 'Inter_800ExtraBold',
    fontSize: 13,
    letterSpacing: 0.2,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(15,23,42,0.18)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  modalCard: {
    width: '100%',
    borderRadius: 22,
    backgroundColor: '#FFFFFF',
    borderWidth: 0,
    padding: 16,
  },
  modalTitle: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 15,
    color: '#111827',
    textAlign: 'center',
    marginBottom: 8,
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
    paddingVertical: 8,
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
  },
  repeatRowActive: {
    backgroundColor: '#EEF2FF',
    borderColor: 'transparent',
  },
  repeatLabel: {
    fontFamily: 'Inter_500Medium',
    fontSize: 14,
    color: '#111827',
  },
  repeatLabelActive: {
    fontFamily: 'Inter_600SemiBold',
    color: '#4F46E5',
  },
});

