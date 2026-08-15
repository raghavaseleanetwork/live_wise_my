import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View, ScrollView, Pressable, TextInput, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import DateTimePicker from '@react-native-community/datetimepicker';
import { useTranslation } from 'react-i18next';

import { useTheme } from '@/lib/theme-context';
import { useCurrency } from '@/lib/currency-context';
import { FamilySubscription, SubscriptionCategory, SubscriptionPaymentMethod, addSubscription, loadSubscriptions, updateSubscription } from '@/lib/family-records';

const POPULAR_SERVICES = ['Netflix', 'Amazon Prime', 'Disney+ Hotstar', 'Spotify', 'YouTube Premium', 'Jio Cinema', 'SonyLiv', 'Zee5', 'iCloud', 'Google One'];
const CATEGORIES: SubscriptionCategory[] = ['entertainment', 'productivity', 'health', 'education', 'other'];
const PAYMENT_METHODS: SubscriptionPaymentMethod[] = ['upi', 'net_banking', 'credit_card', 'debit_card', 'other'];
const REMINDER_DAYS_OPTIONS = [3, 7];

export default function AddSubscriptionScreen() {
  const router = useRouter();
  const { memberId, memberName, editId } = useLocalSearchParams<{ memberId: string; memberName?: string; editId?: string }>();
  const insets = useSafeAreaInsets();
  const { colors, isDark } = useTheme();
  const { convertForStorage, convertForDisplay, symbol } = useCurrency();
  const { t } = useTranslation();

  const [showDatePicker, setShowDatePicker] = useState(false);
  const [serviceName, setServiceName] = useState('');
  const [isCustomService, setIsCustomService] = useState(false);
  const [planType, setPlanType] = useState('');
  const [amount, setAmount] = useState('');
  // Nothing preselected on a new subscription; editing seeds it from the record.
  const [cycle, setCycle] = useState<FamilySubscription['cycle'] | null>(null);
  const [autoRenews, setAutoRenews] = useState(true);
  const [paymentMethod, setPaymentMethod] = useState<SubscriptionPaymentMethod | null>(null);
  const [reminderDaysBefore, setReminderDaysBefore] = useState<number>(3);
  const [category, setCategory] = useState<SubscriptionCategory>('entertainment');
  const [renewalDate, setRenewalDate] = useState(new Date());
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const isEditing = !!editId;

  // Seed the form from the record being edited.
  useEffect(() => {
    if (!editId || !memberId) return;
    let cancelled = false;
    (async () => {
      const items = await loadSubscriptions(String(memberId));
      const found = items.find((x) => x.id === String(editId));
      if (!found || cancelled) return;
      setServiceName(found.serviceName);
      setIsCustomService(!POPULAR_SERVICES.includes(found.serviceName));
      setPlanType(found.planType ?? '');
      setAmount(String(Math.round(convertForDisplay(found.amount) * 100) / 100));
      setCycle(found.cycle);
      setAutoRenews(found.autoRenews ?? true);
      setPaymentMethod(found.paymentMethod ?? null);
      setReminderDaysBefore(found.reminderDaysBefore ?? 3);
      setCategory(found.category);
      setRenewalDate(new Date(found.renewalDate));
    })();
    return () => { cancelled = true; };
  }, [editId, memberId]);

  const handleSave = async () => {
    if (!cycle) {
      setError(t('familySubscriptions.errorSelectCycle'));
      return;
    }
    if (!serviceName.trim()) {
      setError(t('familySubscriptions.errorEnterName'));
      return;
    }
    const amt = parseFloat(amount);
    if (!amount.trim() || Number.isNaN(amt) || amt <= 0) {
      setError(t('familySubscriptions.errorInvalidAmount'));
      return;
    }
    if (!memberId || saving) return;
    setSaving(true);
    const data = {
      serviceName: serviceName.trim(),
      planType: planType.trim(),
      // Typed in the user's display currency; stored in INR like every amount.
      amount: convertForStorage(amt),
      cycle,
      autoRenews,
      paymentMethod: paymentMethod ?? undefined,
      reminderDaysBefore,
      category,
      renewalDate: renewalDate.toISOString(),
    };
    if (isEditing) {
      await updateSubscription(String(memberId), String(editId), data);
    } else {
      await addSubscription(String(memberId), data);
    }
    router.back();
  };

  const headerHeight = 110 + insets.top;

  return (
    <View style={[styles.container, { backgroundColor: colors.bg }]}>
      <LinearGradient colors={colors.heroGradient as any} style={[styles.header, { height: headerHeight, paddingTop: insets.top }]}>
        <View style={styles.headerTop}>
          <Pressable onPress={() => router.back()} style={styles.backBtn} hitSlop={12}>
            <Ionicons name="chevron-back" size={24} color={colors.text} />
          </Pressable>
          <Text style={[styles.headerTitle, { color: colors.text }]}>{isEditing ? t('familySubscriptions.editHeaderTitle') : t('familySubscriptions.newHeaderTitle')}</Text>
          <View style={styles.backBtn} />
        </View>
        {memberName ? <Text style={[styles.headerSubtitle, { color: colors.textSecondary }]}>{t('familySubscriptions.forMember', { name: memberName })}</Text> : null}
      </LinearGradient>

      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: insets.bottom + 40 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        {!!error && <Text style={[styles.errorText, { color: colors.danger }]}>{error}</Text>}

        <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>{t('familySubscriptions.serviceNameLabel')}</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipScroll} contentContainerStyle={styles.chipRow}>
          {POPULAR_SERVICES.map((s) => (
            <Pressable
              key={s}
              onPress={() => { setServiceName(s); setIsCustomService(false); }}
              style={[styles.smallChip, { backgroundColor: colors.inputBg, borderColor: colors.border }, !isCustomService && serviceName === s && { backgroundColor: colors.accent, borderColor: colors.accent }]}
            >
              <Text style={[styles.smallChipText, { color: !isCustomService && serviceName === s ? '#FFF' : colors.textSecondary }]}>{s}</Text>
            </Pressable>
          ))}
          <Pressable
            onPress={() => { setIsCustomService(true); setServiceName(''); }}
            style={[styles.smallChip, { backgroundColor: colors.inputBg, borderColor: colors.border }, isCustomService && { backgroundColor: colors.accent, borderColor: colors.accent }]}
          >
            <Text style={[styles.smallChipText, { color: isCustomService ? '#FFF' : colors.textSecondary }]}>{t('familySubscriptions.customService')}</Text>
          </Pressable>
        </ScrollView>
        {isCustomService && (
          <TextInput
            style={[styles.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.inputBg, marginTop: 8 }]}
            value={serviceName}
            onChangeText={setServiceName}
            placeholder={t('familySubscriptions.serviceNamePlaceholder')}
            placeholderTextColor={colors.textTertiary}
            autoFocus
          />
        )}

        <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>{t('familySubscriptions.planTypeLabel')}</Text>
        <TextInput
          style={[styles.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.inputBg }]}
          value={planType}
          onChangeText={setPlanType}
          placeholder={t('familySubscriptions.planTypePlaceholder')}
          placeholderTextColor={colors.textTertiary}
        />

        <View style={styles.formRow}>
          <View style={{ flex: 1 }}>
            <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>{t('familySubscriptions.amountLabel')}</Text>
            <View style={[styles.amountWrap, { borderColor: colors.border, backgroundColor: colors.inputBg }]}>
              <Text style={[styles.amountPrefix, { color: colors.textSecondary }]}>{symbol}</Text>
              <TextInput
                style={[styles.amountInput, { color: colors.text }]}
                value={amount}
                onChangeText={setAmount}
                placeholder="0"
                placeholderTextColor={colors.textTertiary}
                keyboardType="numeric"
              />
            </View>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>{t('familySubscriptions.renewalDateLabel')}</Text>
            <Pressable onPress={() => setShowDatePicker(true)} style={[styles.input, { borderColor: colors.border, backgroundColor: colors.inputBg, justifyContent: 'center' }]}>
              <Text style={{ color: colors.text }}>{renewalDate.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</Text>
            </Pressable>
          </View>
        </View>

        <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>{t('familySubscriptions.billingCycleLabel')}</Text>
        <View style={styles.typeRow}>
          {(['monthly', 'quarterly', 'yearly'] as const).map((c) => (
            <Pressable key={c} onPress={() => setCycle(c)} style={[styles.typeChip, { backgroundColor: colors.inputBg, borderColor: colors.border }, cycle === c && { backgroundColor: colors.accent, borderColor: colors.accent }]}>
              <Text style={[styles.typeChipText, { color: cycle === c ? '#FFF' : colors.textSecondary }]}>{t(`familySubscriptions.cycle.${c}`)}</Text>
            </Pressable>
          ))}
        </View>

        <Pressable onPress={() => setAutoRenews(!autoRenews)} style={styles.toggleRow}>
          <Ionicons name={autoRenews ? 'checkbox' : 'square-outline'} size={22} color={autoRenews ? colors.accent : colors.textTertiary} />
          <Text style={[styles.toggleLabel, { color: colors.text }]}>{t('familySubscriptions.autoRenewsLabel')}</Text>
        </Pressable>

        <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>{t('familySubscriptions.paymentMethodLabel')}</Text>
        <View style={styles.chipRow}>
          {PAYMENT_METHODS.map((pm) => (
            <Pressable
              key={pm}
              onPress={() => setPaymentMethod(paymentMethod === pm ? null : pm)}
              style={[styles.smallChip, { backgroundColor: colors.inputBg, borderColor: colors.border }, paymentMethod === pm && { backgroundColor: colors.accent, borderColor: colors.accent }]}
            >
              <Text style={[styles.smallChipText, { color: paymentMethod === pm ? '#FFF' : colors.textSecondary }]}>{t(`familySubscriptions.paymentMethod.${pm}`)}</Text>
            </Pressable>
          ))}
        </View>

        <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>{t('familySubscriptions.reminderLabel')}</Text>
        <View style={styles.chipRow}>
          {REMINDER_DAYS_OPTIONS.map((d) => (
            <Pressable
              key={d}
              onPress={() => setReminderDaysBefore(d)}
              style={[styles.smallChip, { backgroundColor: colors.inputBg, borderColor: colors.border }, reminderDaysBefore === d && { backgroundColor: colors.accent, borderColor: colors.accent }]}
            >
              <Text style={[styles.smallChipText, { color: reminderDaysBefore === d ? '#FFF' : colors.textSecondary }]}>{t('familySubscriptions.daysBefore', { count: d })}</Text>
            </Pressable>
          ))}
        </View>

        <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>{t('familySubscriptions.categoryLabel')}</Text>
        <View style={styles.chipRow}>
          {CATEGORIES.map((c) => (
            <Pressable
              key={c}
              onPress={() => setCategory(c)}
              style={[styles.smallChip, { backgroundColor: colors.inputBg, borderColor: colors.border }, category === c && { backgroundColor: colors.accent, borderColor: colors.accent }]}
            >
              <Text style={[styles.smallChipText, { color: category === c ? '#FFF' : colors.textSecondary }]}>{t(`familySubscriptions.category.${c}`)}</Text>
            </Pressable>
          ))}
        </View>

        <Pressable onPress={handleSave} disabled={saving} style={[styles.primaryBtn, { backgroundColor: colors.accent, opacity: saving ? 0.6 : 1 }]}>
          <Text style={styles.primaryBtnLabel}>{isEditing ? t('familySubscriptions.saveChanges') : t('common.save')}</Text>
        </Pressable>
      </ScrollView>

      {showDatePicker && (
        <DateTimePicker
          value={renewalDate}
          mode="date"
          display={Platform.OS === 'ios' ? 'spinner' : 'default'}
          themeVariant={isDark ? 'dark' : 'light'}
          onChange={(event, date) => { setShowDatePicker(false); if (date) setRenewalDate(date); }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { paddingHorizontal: 20, justifyContent: 'center', borderBottomLeftRadius: 32, borderBottomRightRadius: 32 },
  headerTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  backBtn: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontFamily: 'Inter_700Bold', fontSize: 17, flex: 1, textAlign: 'center' },
  headerSubtitle: { fontFamily: 'Inter_500Medium', fontSize: 13, marginTop: 4, textAlign: 'center' },
  primaryBtn: { borderRadius: 14, paddingVertical: 15, alignItems: 'center', marginTop: 28 },
  primaryBtnLabel: { fontFamily: 'Inter_700Bold', fontSize: 15, color: '#FFF' },
  errorText: { fontFamily: 'Inter_500Medium', fontSize: 13, marginBottom: 10, textAlign: 'center' },
  fieldLabel: { fontFamily: 'Inter_600SemiBold', fontSize: 12, marginBottom: 6, marginTop: 10 },
  input: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontFamily: 'Inter_500Medium', fontSize: 14 },
  formRow: { flexDirection: 'row', gap: 12 },
  amountWrap: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, gap: 4 },
  amountPrefix: { fontFamily: 'Inter_600SemiBold', fontSize: 14 },
  amountInput: { flex: 1, fontFamily: 'Inter_500Medium', fontSize: 14, paddingVertical: 12 },
  typeRow: { flexDirection: 'row', gap: 8 },
  typeChip: { flex: 1, paddingVertical: 10, borderRadius: 12, borderWidth: 1, alignItems: 'center' },
  typeChipText: { fontFamily: 'Inter_600SemiBold', fontSize: 12 },
  chipScroll: { marginHorizontal: -20 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: 20 },
  smallChip: { paddingVertical: 8, paddingHorizontal: 12, borderRadius: 10, borderWidth: 1 },
  smallChipText: { fontFamily: 'Inter_600SemiBold', fontSize: 12 },
  toggleRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 16, marginBottom: 6 },
  toggleLabel: { fontFamily: 'Inter_500Medium', fontSize: 14 },
});
