import React, { useState, useMemo, useRef, useCallback } from 'react';
import {
  StyleSheet,
  Text,
  View,
  FlatList,
  Pressable,
  Platform,
  TextInput,
  KeyboardAvoidingView as RNKeyboardAvoidingView,
} from 'react-native';
// Guarded seam: the library's version in a dev/production build, React
// Native's own in Expo Go, which has no native module for it.
import { KeyboardAvoidingView as NativeKeyboardAvoidingView } from '@/lib/keyboard-controller';

const KeyboardAvoidingView = NativeKeyboardAvoidingView ?? RNKeyboardAvoidingView;
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { useTheme } from '@/lib/theme-context';
import { useCurrency } from '@/lib/currency-context';
import { useExpenses } from '@/lib/expense-context';
import { useAuth } from '@/lib/auth-context';
import { useSubscription } from '@/lib/subscription-context';
import { usePaywall } from '@/lib/paywall-context';
import { apiRequest } from '@/lib/query-client';
import { CATEGORIES, CategoryType, getMonthlySpending } from '@/lib/data';

interface Message {
  id: string;
  text: string;
  isUser: boolean;
  cards?: AnalysisCard[];
}

interface AnalysisCard {
  label: string;
  value: string;
  icon: string;
  color: string;
}

function buildLocalAssistantReply(
  query: string,
  monthlySpend: number,
  monthlyBudget: number,
  billsDue: number,
  topMerchant: string | null,
): string {
  const q = query.toLowerCase();
  const budgetLeft = Math.max(0, monthlyBudget - monthlySpend);
  const budgetUsedPct = monthlyBudget > 0 ? Math.round((monthlySpend / monthlyBudget) * 100) : 0;

  if (q.includes('budget') || q.includes('afford') || q.includes('buy')) {
    return `Budget check: You used about ${budgetUsedPct}% of your monthly budget. Remaining is ${budgetLeft.toLocaleString('en-IN')}. Keep bills due (${billsDue}) in mind before big purchases.`;
  }
  if (q.includes('merchant') || q.includes('where')) {
    return topMerchant
      ? `Your top merchant this period is ${topMerchant}. We can reduce spend there with a weekly cap.`
      : 'I do not have enough merchant data yet. Add a few more transactions and ask again.';
  }
  if (q.includes('saving') || q.includes('savings')) {
    return `You currently have about ${budgetLeft.toLocaleString('en-IN')} left from budget. Set aside a fixed percentage every week to improve savings consistency.`;
  }

  return `Quick summary: spent ${monthlySpend.toLocaleString('en-IN')} this month, ${billsDue} bill reminders due, and ${budgetLeft.toLocaleString('en-IN')} budget left.`;
}

const QUICK_CHIPS = [
  { label: 'Can I buy?', query: 'afford' },
  { label: 'Food spending', query: 'food' },
  { label: 'Savings status', query: 'savings' },
  { label: 'Spending trends', query: 'trends' },
  { label: 'Top merchants', query: 'merchants' },
  { label: 'Budget check', query: 'budget' },
];

export default function AssistantScreen() {
  const insets = useSafeAreaInsets();
  const { colors, isDark } = useTheme();
  const { formatAmount } = useCurrency();
  const { transactions, bills, leaks, monthlyBudget } = useExpenses();
  const { token } = useAuth();
  const { checkLimit, incrementUsage } = useSubscription();
  const { presentPaywall } = usePaywall();
  const [messages, setMessages] = useState<Message[]>([
    {
      id: '0',
      text: 'Hi! I\'m your LifeWise Assistant. I can help you make smarter financial decisions. Ask me anything about your spending!',
      isUser: false,
    },
  ]);
  const [inputText, setInputText] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const flatListRef = useRef<FlatList>(null);

  const topInset = Platform.OS === 'web' ? 67 : insets.top;
  const bottomInset = Platform.OS === 'web' ? 34 : Math.max(insets.bottom, 20);

  const monthlySpend = useMemo(() => getMonthlySpending(transactions), [transactions]);

  const categoryTotals = useMemo(() => {
    const totals: Partial<Record<CategoryType, number>> = {};
    transactions.forEach(tx => {
      if (tx.isDebit) {
        totals[tx.category] = (totals[tx.category] || 0) + tx.amount;
      }
    });
    return totals;
  }, [transactions]);

  const merchantTotals = useMemo(() => {
    const map: Record<string, number> = {};
    transactions.forEach(tx => {
      map[tx.merchant] = (map[tx.merchant] || 0) + tx.amount;
    });
    return Object.entries(map).sort(([, a], [, b]) => b - a).slice(0, 5);
  }, [transactions]);
  const handleSend = useCallback(
    async (text?: string) => {
      const query = text || inputText.trim();
      if (!query || !token || isTyping) return;

      // Gate: WiseAI chat is monthly-metered (doc §5.1 — "6th WiseAI message"
      // → paywall). Count only the user's sent messages toward the limit.
      const check = checkLimit('wiseAiPerMonth');
      if (!check.allowed && check.triggerKey) {
        presentPaywall(check.triggerKey);
        return;
      }
      incrementUsage('wiseAiPerMonth');

      const userMsg: Message = {
        id: Date.now().toString(),
        text: query,
        isUser: true,
      };

      // Optimistically add user message
      setMessages(prev => [...prev, userMsg]);
      setInputText('');
      setIsTyping(true);

      // Build conversation history including latest user message
      const history = [...messages, userMsg];

      try {
        const payload = {
          messages: history.map(m => ({
            role: m.isUser ? ('user' as const) : ('assistant' as const),
            content: m.text,
          })),
        };

        const res = await apiRequest('POST', '/api/assistant/chat', payload, token);
        if (!res.ok) {
          throw new Error(`Assistant API failed (${res.status})`);
        }

        const data = await res.json();
        const replyText: string =
          typeof data.reply === 'string'
            ? data.reply
            : 'Sorry, I could not generate a response right now.';

        const botMsg: Message = {
          id: (Date.now() + 1).toString(),
          text: replyText,
          isUser: false,
        };

        setMessages(prev => [...prev, botMsg]);
      } catch (e) {
        console.error('Assistant error', e);
        const billsDue = bills.filter((b) => !b.isPaid && b.status !== 'paid').length;
        const topMerchant = merchantTotals.length > 0 ? merchantTotals[0][0] : null;
        const fallback = buildLocalAssistantReply(query, monthlySpend, monthlyBudget, billsDue, topMerchant);
        const errorMsg: Message = {
          id: (Date.now() + 2).toString(),
          text: fallback,
          isUser: false,
        };
        setMessages(prev => [...prev, errorMsg]);
      } finally {
        setIsTyping(false);
      }

      setTimeout(() => {
        flatListRef.current?.scrollToEnd({ animated: true });
      }, 120);
    },
    [inputText, token, messages, bills, merchantTotals, monthlySpend, monthlyBudget, isTyping, checkLimit, incrementUsage, presentPaywall],
  );

  const handleBack = () => {
    if (router.canGoBack()) router.back();
    else router.replace('/(tabs)');
  };

  const renderMessage = ({ item, index }: { item: Message; index: number }) => (
    <Animated.View
      entering={Platform.OS !== 'web' ? FadeInDown.delay(index * 30).duration(300) : undefined}
      style={[styles.msgRow, item.isUser && styles.msgRowUser]}
    >
      {!item.isUser && (
        <View style={[styles.botAvatar, { backgroundColor: colors.accentDim }]}>
          <Ionicons name="sparkles" size={16} color={colors.accent} />
        </View>
      )}
      <View style={[
        styles.msgBubble,
        item.isUser
          ? { backgroundColor: colors.accent }
          : { backgroundColor: colors.card, borderColor: colors.border, borderWidth: 1 },
      ]}>
        <Text style={[
          styles.msgText,
          { color: item.isUser ? '#FFFFFF' : colors.text },
        ]}>
          {item.text}
        </Text>
        {item.cards && (
          <View style={styles.cardsGrid}>
            {item.cards.map((card, idx) => (
              <View key={idx} style={[styles.analysisCard, { backgroundColor: card.color + '10', borderColor: card.color + '20' }]}>
                <View style={[styles.analysisIconWrap, { backgroundColor: card.color + '15' }]}>
                  <Ionicons name={card.icon as any} size={16} color={card.color} />
                </View>
                <Text style={[styles.analysisLabel, { color: colors.textSecondary }]}>{card.label}</Text>
                <Text style={[styles.analysisValue, { color: colors.text }]}>{card.value}</Text>
              </View>
            ))}
          </View>
        )}
      </View>
    </Animated.View>
  );

  return (
    <KeyboardAvoidingView style={[styles.container, { backgroundColor: colors.bg }]} behavior="padding" keyboardVerticalOffset={0}>
      <View style={[styles.header, { paddingTop: topInset + 12, backgroundColor: colors.bg, borderBottomColor: colors.border }]}>
        <Pressable onPress={handleBack} hitSlop={10}>
          <Ionicons name="arrow-back" size={24} color={colors.text} />
        </Pressable>
        <View style={styles.headerCenter}>
          <Text style={[styles.headerTitle, { color: colors.text }]}>Decision Assistant</Text>
          <Text style={[styles.headerSubtitle, { color: colors.textTertiary }]}>AI-powered insights</Text>
        </View>
        <View style={{ width: 24 }} />
      </View>

      <FlatList
        ref={flatListRef}
        data={messages}
        renderItem={renderMessage}
        keyExtractor={item => item.id}
        contentContainerStyle={styles.messageList}
        showsVerticalScrollIndicator={false}
        ListHeaderComponent={
          <View style={styles.chipsSection}>
            <Text style={[styles.chipsSectionTitle, { color: colors.textTertiary }]}>Quick questions</Text>
            <View style={styles.chipsRow}>
              {QUICK_CHIPS.map(chip => (
                <Pressable
                  key={chip.query}
                  onPress={() => handleSend(chip.label)}
                  style={[styles.quickChip, { backgroundColor: colors.card, borderColor: colors.border }]}
                >
                  <Text style={[styles.quickChipText, { color: colors.accent }]}>{chip.label}</Text>
                </Pressable>
              ))}
            </View>
          </View>
        }
      />

      {isTyping && (
        <View style={[styles.typingRow, { paddingBottom: bottomInset - 6 }]}>
          <View style={[styles.botAvatar, { backgroundColor: colors.accentDim }]}>
            <Ionicons name="sparkles" size={16} color={colors.accent} />
          </View>
          <View style={[styles.msgBubble, { backgroundColor: colors.card, borderColor: colors.border, borderWidth: 1 }]}>
            <Text style={[styles.msgText, { color: colors.textSecondary }]}>Assistant is typing…</Text>
          </View>
        </View>
      )}

      <View style={[styles.inputBar, { backgroundColor: colors.card, borderTopColor: colors.border, paddingBottom: bottomInset }]}>
        <TextInput
          style={[styles.input, { backgroundColor: colors.inputBg, borderColor: colors.inputBorder, color: colors.text }]}
          value={inputText}
          onChangeText={setInputText}
          placeholder="Ask about your finances..."
          placeholderTextColor={colors.textTertiary}
          onSubmitEditing={() => handleSend()}
          returnKeyType="send"
        />
        <Pressable onPress={() => handleSend()} style={styles.sendBtnWrap}>
          <LinearGradient colors={[...colors.buttonGradient] as [string, string]} style={styles.sendBtn}>
            <Ionicons name="send" size={18} color="#FFFFFF" />
          </LinearGradient>
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingBottom: 12, borderBottomWidth: 1 },
  headerCenter: { alignItems: 'center' },
  headerTitle: { fontFamily: 'Inter_700Bold', fontSize: 18 },
  headerSubtitle: { fontFamily: 'Inter_400Regular', fontSize: 11, marginTop: 2 },
  messageList: { paddingHorizontal: 16, paddingBottom: 8 },
  chipsSection: { paddingVertical: 16, gap: 10 },
  chipsSectionTitle: { fontFamily: 'Inter_500Medium', fontSize: 12 },
  chipsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  quickChip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 16, borderWidth: 1 },
  quickChipText: { fontFamily: 'Inter_600SemiBold', fontSize: 13 },
  msgRow: { flexDirection: 'row', marginBottom: 16, gap: 10, alignItems: 'flex-start' },
  typingRow: { flexDirection: 'row', marginHorizontal: 16, marginBottom: 8, gap: 10, alignItems: 'flex-start' },
  msgRowUser: { justifyContent: 'flex-end' },
  botAvatar: { width: 32, height: 32, borderRadius: 12, alignItems: 'center', justifyContent: 'center', marginTop: 2 },
  msgBubble: { maxWidth: '80%', borderRadius: 18, padding: 14 },
  msgText: { fontFamily: 'Inter_400Regular', fontSize: 14, lineHeight: 21 },
  cardsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 },
  analysisCard: { flex: 1, minWidth: 90, borderRadius: 14, padding: 12, borderWidth: 1, gap: 6, alignItems: 'center' },
  analysisIconWrap: { width: 32, height: 32, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  analysisLabel: { fontFamily: 'Inter_400Regular', fontSize: 10, textAlign: 'center' },
  analysisValue: { fontFamily: 'Inter_700Bold', fontSize: 14, textAlign: 'center' },
  inputBar: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingTop: 12, gap: 10, borderTopWidth: 1 },
  input: { flex: 1, borderRadius: 16, borderWidth: 1, paddingHorizontal: 16, paddingVertical: 12, fontFamily: 'Inter_400Regular', fontSize: 15 },
  sendBtnWrap: { borderRadius: 14, overflow: 'hidden' },
  sendBtn: { width: 44, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
});
