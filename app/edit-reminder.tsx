import React, { useState, useEffect } from 'react';
import {
  StyleSheet,
  Text,
  View,
  ScrollView,
  Pressable,
  TextInput,
  Platform,
  KeyboardAvoidingView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import DateTimePicker from '@react-native-community/datetimepicker';
import Animated, { FadeInDown, FadeInUp } from 'react-native-reanimated';

import { useTheme } from '@/lib/theme-context';
import { useExpenses } from '@/lib/expense-context';
import { useCurrency } from '@/lib/currency-context';
import { useSubscription } from '@/lib/subscription-context';
import { usePaywall } from '@/lib/paywall-context';
import { 
  Bill, 
  CategoryType, 
  RepeatType, 
  CATEGORIES, 
  REPEAT_OPTIONS, 
  ICON_OPTIONS,
  REMINDER_TYPE_CONFIG
} from '@/lib/data';
import { getIntentPolicy, getReminderIntentFromBill } from '@/lib/reminder-intent';
import CategoryIcon from '@/components/CategoryIcon';

const CATEGORY_OPTIONS: { key: CategoryType; label: string }[] = [
  { key: 'bills', label: 'Bills & Utilities' },
  { key: 'entertainment', label: 'Entertainment' },
  { key: 'food', label: 'Food & Dining' },
  { key: 'health', label: 'Healthcare' },
  { key: 'shopping', label: 'Shopping' },
  { key: 'education', label: 'Education' },
  { key: 'investment', label: 'Investment' },
  { key: 'transport', label: 'Transport' },
  { key: 'others', label: 'Others' },
];

export default function EditReminderScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const { colors, isDark } = useTheme();
  const { bills, addReminder, editReminder, reminderSettings } = useExpenses();
  const { formatAmount, convertForDisplay, convertForStorage, symbol } = useCurrency();
  const { checkLimit } = useSubscription();
  const { presentPaywall } = usePaywall();

  // Find the bill if editing
  const existingBill = id ? bills.find(b => b.id === id) : null;

  // Form State
  const [name, setName] = useState('');
  const [amount, setAmount] = useState('');
  // Nothing preselected on a new reminder; editing seeds both from the record.
  const [category, setCategory] = useState<CategoryType | null>(null);
  const [repeatType, setRepeatType] = useState<RepeatType | null>(null);
  const [dueDate, setDueDate] = useState<Date>(new Date());
  const [selectedIcon, setSelectedIcon] = useState('flash');
  const [error, setError] = useState('');

  // UI State
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [showTimePicker, setShowTimePicker] = useState(false);
  const [showIconPicker, setShowIconPicker] = useState(false);

  useEffect(() => {
    if (existingBill) {
      setName(existingBill.name);
      // Stored in INR; the field shows the user's currency, so convert on the
      // way in as well as out or an edit silently restates the amount.
      setAmount(String(Math.round(convertForDisplay(existingBill.amount) * 100) / 100));
      setCategory(existingBill.category);
      setRepeatType(existingBill.repeatType);
      setDueDate(new Date(existingBill.dueDate));
      setSelectedIcon(existingBill.icon);
    }
  }, [existingBill, convertForDisplay]);

  const handleSave = async () => {
    if (!name.trim()) {
      setError('Please enter a name');
      return;
    }
    if (!category) {
      setError('Please select a category');
      return;
    }
    if (!repeatType) {
      setError('Please select how often this repeats');
      return;
    }

    // Gate: creating a NEW reminder beyond the plan's total shows the paywall
    // (doc §5.1 — "11th reminder on Free"). Editing an existing one is exempt.
    if (!existingBill) {
      const check = checkLimit('reminders', bills.length);
      if (!check.allowed && check.triggerKey) {
        presentPaywall(check.triggerKey);
        return;
      }
    }

    const amt = parseFloat(amount) || 0;
    const reminderType = category === 'bills' ? 'bill' : category === 'entertainment' ? 'subscription' : 'custom';

    const billData: any = {
      name: name.trim(),
      amount: convertForStorage(amt),
      category,
      repeatType,
      dueDate: dueDate.toISOString(),
      icon: selectedIcon,
      reminderType,
      isPaid: existingBill ? existingBill.isPaid : false,
      status: existingBill ? existingBill.status : 'active',
      reminderDaysBefore: existingBill ? existingBill.reminderDaysBefore : reminderSettings.defaultReminderDays,
    };

    if (existingBill) {
      await editReminder({ ...existingBill, ...billData });
    } else {
      await addReminder(billData);
    }

    router.back();
  };

  const headerHeight = 132 + insets.top;

  return (
    <View style={[styles.container, { backgroundColor: colors.bg }]}>
      <KeyboardAvoidingView 
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'} 
        style={{ flex: 1 }}
      >
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: insets.bottom + 100 }}>
          {/* Header */}
          <View style={[styles.header, { height: headerHeight, paddingTop: insets.top, backgroundColor: colors.accent }]}>
            <View style={styles.headerTop}>
              <Pressable onPress={() => router.back()} style={styles.backBtn}>
                <Ionicons name="chevron-back" size={24} color="#FFFFFF" />
              </Pressable>
              <Text style={[styles.headerTitle, { color: '#FFFFFF' }]}>
                {existingBill ? 'Edit Reminder' : 'New Reminder'}
              </Text>
              <View style={{ width: 40 }} />
            </View>

            <View style={styles.headerNameBlock}>
              <TextInput
                style={[styles.nameInput, { color: '#FFFFFF', writingDirection: 'ltr' }]}
                value={name}
                onChangeText={setName}
                placeholder="Name of Reminder"
                placeholderTextColor="rgba(255,255,255,0.4)"
                autoFocus={!existingBill}
                textAlign="center"
                textAlignVertical="center"
                multiline={false}
                numberOfLines={1}
                scrollEnabled={true}
                returnKeyType="done"
              />
              <View style={[styles.nameUnderline, { backgroundColor: '#FFFFFF', opacity: 0.3 }]} />
            </View>
          </View>

          {/* Form Content */}
          <View style={styles.form}>
            {error ? (
              <Animated.View entering={FadeInDown} style={[styles.errorBox, { backgroundColor: colors.dangerDim }]}>
                <Ionicons name="alert-circle" size={18} color={colors.danger} />
                <Text style={[styles.errorText, { color: colors.danger }]}>{error}</Text>
              </Animated.View>
            ) : null}

            {/* Amount & Date Card */}
            <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <View style={styles.fieldRow}>
                <View style={styles.field}>
                  <Text style={[styles.label, { color: colors.textSecondary }]}>Amount</Text>
                  <View style={styles.amountInputContainer}>
                    <Text style={[styles.currencySymbol, { color: colors.text }]}>{symbol}</Text>
                    <TextInput
                      style={[styles.amountInput, { color: colors.text }]}
                      value={amount}
                      onChangeText={setAmount}
                      keyboardType="numeric"
                      placeholder="0"
                      placeholderTextColor={colors.textTertiary}
                    />
                  </View>
                </View>
                <View style={[styles.divider, { backgroundColor: colors.border }]} />
                <Pressable onPress={() => setShowDatePicker(true)} style={styles.field}>
                  <Text style={[styles.label, { color: colors.textSecondary }]}>Due Date</Text>
                  <Text style={[styles.valueText, { color: colors.text }]}>
                    {dueDate.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                  </Text>
                </Pressable>
              </View>

              <View style={[styles.horizontalDivider, { backgroundColor: colors.border }]} />

              <View style={styles.fieldRow}>
                <Pressable onPress={() => setShowTimePicker(true)} style={styles.field}>
                  <Text style={[styles.label, { color: colors.textSecondary }]}>Alert Time</Text>
                  <Text style={[styles.valueText, { color: colors.text }]}>
                    {dueDate.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })}
                  </Text>
                </Pressable>
                <View style={[styles.divider, { backgroundColor: colors.border }]} />
                <View style={styles.field}>
                  <Text style={[styles.label, { color: colors.textSecondary }]}>Icon</Text>
                  <Pressable onPress={() => setShowIconPicker(!showIconPicker)} style={styles.iconSelection}>
                    <Ionicons name={selectedIcon as any} size={22} color={colors.accent} />
                    <Ionicons name="chevron-down" size={14} color={colors.textTertiary} style={{ marginLeft: 6 }} />
                  </Pressable>
                </View>
              </View>
            </View>

            {showIconPicker && (
              <Animated.View entering={FadeInDown} style={styles.iconPickerGrid}>
                {ICON_OPTIONS.map(icon => (
                  <Pressable 
                    key={icon} 
                    onPress={() => { setSelectedIcon(icon); setShowIconPicker(false); }}
                    style={[styles.iconItem, { backgroundColor: selectedIcon === icon ? colors.accentDim : colors.inputBg }]}
                  >
                    <Ionicons name={icon as any} size={24} color={selectedIcon === icon ? colors.accent : colors.textSecondary} />
                  </Pressable>
                ))}
              </Animated.View>
            )}

            {/* Repeat Selection */}
            <Text style={[styles.sectionTitle, { color: colors.textSecondary }]}>Recurrence</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.repeatScroll}>
              {REPEAT_OPTIONS.map(opt => (
                <Pressable
                  key={opt.key}
                  onPress={() => {
                    setRepeatType(opt.key);
                    if (opt.key === 'weekly' || opt.key === 'monthly') {
                      setShowDatePicker(true);
                    }
                  }}
                  style={[
                    styles.chip, 
                    { backgroundColor: colors.card, borderColor: colors.border },
                    repeatType === opt.key && { backgroundColor: colors.accent, borderColor: colors.accent }
                  ]}
                >
                  <Text style={[styles.chipText, { color: colors.textSecondary }, repeatType === opt.key && { color: '#FFF' }]}>
                    {opt.label}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>

            {/* Category Grid */}
            <Text style={[styles.sectionTitle, { color: colors.textSecondary }]}>Category</Text>
            <View style={styles.categoryGrid}>
              {CATEGORY_OPTIONS.map(opt => {
                const isSelected = category === opt.key;
                const catColor = CATEGORIES[opt.key]?.color || colors.accent;
                return (
                  <Pressable
                    key={opt.key}
                    onPress={() => setCategory(opt.key)}
                    style={[
                      styles.categoryCard, 
                      { backgroundColor: colors.card, borderColor: colors.border },
                      isSelected && { borderColor: catColor, backgroundColor: catColor + '10' }
                    ]}
                  >
                    <CategoryIcon category={opt.key} size={24} color={isSelected ? catColor : colors.textTertiary} />
                    <Text 
                      style={[styles.categoryLabel, { color: colors.textSecondary }, isSelected && { color: catColor, fontFamily: 'Inter_600SemiBold' }]}
                      numberOfLines={1}
                    >
                      {opt.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
        </ScrollView>

        {/* Floating Save Button */}
        <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, 16) }]}>
          <Pressable onPress={handleSave} style={[styles.saveBtn, { backgroundColor: colors.accent }]}>
            <View style={styles.saveGradient}>
              <Ionicons name="checkmark-circle" size={24} color="#FFF" />
              <Text style={styles.saveBtnText}>Save Reminder</Text>
            </View>
          </Pressable>
        </View>

        {/* Date/Time Pickers */}
        {showDatePicker && (
          <>
            {(repeatType === 'weekly' || repeatType === 'monthly') && Platform.OS === 'ios' && (
              <Text style={[styles.datePickerHint, { color: colors.textSecondary }]}>
                {repeatType === 'weekly'
                  ? 'Choose the day of the week this repeats on'
                  : 'Choose the date of the month this repeats on'}
              </Text>
            )}
            <DateTimePicker
              value={dueDate}
              mode="date"
              display={Platform.OS === 'ios' ? 'spinner' : 'default'}
              onChange={(event, date) => {
                if (Platform.OS === 'android') setShowDatePicker(false);
                if (date) {
                  const newDate = new Date(dueDate);
                  newDate.setFullYear(date.getFullYear(), date.getMonth(), date.getDate());
                  setDueDate(newDate);
                }
              }}
            />
          </>
        )}
        {showTimePicker && (
          <DateTimePicker
            value={dueDate}
            mode="time"
            display={Platform.OS === 'ios' ? 'spinner' : 'default'}
            onChange={(event, date) => {
              if (Platform.OS === 'android') setShowTimePicker(false);
              if (date) {
                const newDate = new Date(dueDate);
                newDate.setHours(date.getHours(), date.getMinutes());
                setDueDate(newDate);
              }
            }}
          />
        )}
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    paddingHorizontal: 20,
    justifyContent: 'center',
    borderBottomLeftRadius: 32,
    borderBottomRightRadius: 32,
  },
  headerTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 12,
    marginBottom: 20,
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    flex: 1,
    textAlign: 'center',
    fontFamily: 'Inter_700Bold',
    fontSize: 20,
  },
  headerNameBlock: {
    marginTop: 8,
    alignItems: 'center',
  },
  nameInput: {
    fontFamily: 'Inter_700Bold',
    fontSize: 24,
    paddingVertical: 10,
    textAlign: 'center',
    writingDirection: 'ltr',
    width: '100%',
    minWidth: 200,
  },
  nameUnderline: {
    height: 3,
    width: 60,
    borderRadius: 2,
    alignSelf: 'center',
  },
  form: {
    paddingTop: 20,
    paddingHorizontal: 20,
  },
  datePickerHint: {
    fontFamily: 'Inter_500Medium',
    fontSize: 13,
    textAlign: 'center',
    paddingTop: 12,
    paddingHorizontal: 20,
  },
  errorBox: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderRadius: 12,
    marginBottom: 20,
  },
  errorText: {
    marginLeft: 8,
    fontFamily: 'Inter_500Medium',
    fontSize: 14,
  },
  card: {
    borderWidth: 1,
    padding: 16,
    paddingHorizontal: 20,
    marginBottom: 20,
  },
  fieldRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  field: {
    flex: 1,
    paddingVertical: 8,
  },
  divider: {
    width: 1,
    height: 40,
    marginHorizontal: 15,
  },
  horizontalDivider: {
    height: 1,
    width: '100%',
    marginVertical: 10,
  },
  label: {
    fontFamily: 'Inter_500Medium',
    fontSize: 12,
    marginBottom: 6,
    letterSpacing: 0.5,
  },
  amountInputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 30,
  },
  currencySymbol: {
    fontFamily: 'Inter_700Bold',
    fontSize: 18,
    marginRight: 4,
    includeFontPadding: false,
  },
  amountInput: {
    fontFamily: 'Inter_700Bold',
    fontSize: 20,
    minWidth: 60,
    includeFontPadding: false,
    padding: 0,
    margin: 0,
    height: 30,
  },
  valueText: {
    fontFamily: 'Inter_700Bold',
    fontSize: 20,
    includeFontPadding: false,
    textAlignVertical: 'center',
    height: 30,
    lineHeight: 30,
  },
  iconSelection: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 30,
  },
  iconPickerGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    marginBottom: 24,
    justifyContent: 'space-between',
    padding: 10,
  },
  iconItem: {
    width: 48,
    height: 48,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sectionTitle: {
    fontFamily: 'Inter_700Bold',
    fontSize: 13,
    marginBottom: 16,
    letterSpacing: 1,
  },
  repeatScroll: {
    gap: 10,
    marginBottom: 30,
    paddingRight: 20,
  },
  chip: {
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 14,
    borderWidth: 1,
  },
  chipText: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 14,
  },
  categoryGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    justifyContent: 'flex-start',
  },
  categoryCard: {
    width: '31%',
    aspectRatio: 1,
    borderRadius: 16,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    padding: 10,
  },
  categoryLabel: {
    fontSize: 11,
    fontFamily: 'Inter_500Medium',
    textAlign: 'center',
  },
  footer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 20,
    paddingTop: 10,
  },
  saveBtn: {
    height: 64,
    borderRadius: 16,
    overflow: 'hidden',
  },
  saveGradient: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  saveBtnText: {
    color: '#FFF',
    fontFamily: 'Inter_700Bold',
    fontSize: 18,
  },
});
