import Colors from '@/constants/colors';

export type CategoryType = 'health' | 'bills' | 'family' | 'work' | 'tasks' | 'subscriptions' | 'finance' | 'habits' | 'travel' | 'events' | 'food' | 'shopping' | 'transport' | 'entertainment' | 'education' | 'investment' | 'other_expense' | 'others';

/**
 * Categories that must never be treated as a money leak. `other_expense` is the
 * user's explicit "this is not wasteful spending" escape hatch — person-to-person
 * transfers, lending money, moving funds between own accounts.
 *
 * NOTE: this list is advisory on the client. Leak detection actually runs on the
 * server (`GET /api/leaks`), which has its own exclusion list. Both must agree.
 * See `backend-team/OTHER-EXPENSE-CATEGORY-backend-requirements.md`.
 */
export const LEAK_EXEMPT_CATEGORIES: CategoryType[] = ['investment', 'other_expense'];

/** True when a transaction in this category should be skipped by leaks analysis. */
export function isLeakExempt(category?: CategoryType | string | null): boolean {
  return LEAK_EXEMPT_CATEGORIES.includes(String(category || '') as CategoryType);
}

export type ReminderType = 'bill' | 'subscription' | 'custom';
export type RepeatType = 'none' | 'daily' | 'weekly' | 'monthly' | 'yearly';
export type ReminderStatus = 'active' | 'paid' | 'snoozed' | 'cancelled';

export type PaymentMode = 'upi' | 'cash' | 'card' | 'netbanking';

/** How an expense got into the app. Mirrors the 6 entry methods in the product doc. */
export type ExpenseSource = 'manual' | 'sms' | 'scan' | 'voice' | 'import' | 'recurring';

export interface Transaction {
  id: string;
  merchant: string;
  amount: number;
  category: CategoryType;
  date: string;
  upiId: string;
  isDebit: boolean;
  description: string;
  /** Family member this expense belongs to. null/undefined = unassigned (legacy rows, or self). */
  memberId?: string | null;
  paymentMode?: PaymentMode;
  receiptUrl?: string;
  source?: ExpenseSource;
}

export interface Bill {
  id: string;
  name: string;
  amount: number;
  dueDate: string;
  category: CategoryType;
  isPaid: boolean;
  icon: string;
  reminderType: ReminderType;
  repeatType: RepeatType;
  status: ReminderStatus;
  snoozedUntil?: string;
  reminderDaysBefore: number[];
  // For scan-bill reminders.
  imageUrl?: string;
  imageKey?: string;
  source?: string;
  // New details
  vendorName?: string;
  billDate?: string;
  billNumber?: string;
  accountNumber?: string;
  lateFee?: number;
  taxAmount?: number;
  phoneNumber?: string;
  /**
   * Set when this reminder was projected from a Family Hub record rather than
   * created directly. `memberId` is whose it is; `sourceKind`/`sourceId` point
   * back at the originating family record so the projection can be matched to
   * it on edit and delete. See `lib/family-reminders.ts`.
   */
  memberId?: string | null;
  sourceKind?: string;
  sourceId?: string;
}

export interface MoneyLeak {
  id: string;
  merchant: string;
  category: CategoryType;
  frequency: string;
  monthlyEstimate: number;
  yearlyPrediction: number;
  transactionCount: number;
  suggestion: string;
}

export interface ReminderSettings {
  defaultReminderDays: number[];
  soundEnabled: boolean;
  vibrationEnabled: boolean;
}

export const DEFAULT_REMINDER_SETTINGS: ReminderSettings = {
  defaultReminderDays: [3, 1, 0],
  soundEnabled: true,
  vibrationEnabled: true,
};

export const CATEGORIES: Record<CategoryType, { label: string; color: string; icon: string }> = {
  health: { label: 'Health', color: Colors.categories.health, icon: 'medkit' },
  bills: { label: 'Bills', color: Colors.categories.bills, icon: 'flash' },
  family: { label: 'Family', color: Colors.categories.family, icon: 'people' },
  work: { label: 'Work', color: Colors.categories.work, icon: 'briefcase' },
  tasks: { label: 'Tasks', color: Colors.categories.tasks, icon: 'list' },
  subscriptions: { label: 'Subscriptions', color: Colors.categories.subscriptions, icon: 'refresh' },
  finance: { label: 'Finance', color: Colors.categories.finance, icon: 'wallet' },
  habits: { label: 'Habits', color: Colors.categories.habits, icon: 'calendar' },
  travel: { label: 'Travel', color: Colors.categories.travel, icon: 'airplane' },
  events: { label: 'Events', color: Colors.categories.events, icon: 'calendar-clear' },
  food: { label: 'Food', color: '#F97316', icon: 'fast-food' },
  shopping: { label: 'Shopping', color: '#EC4899', icon: 'cart' },
  transport: { label: 'Transport', color: '#3B82F6', icon: 'car' },
  entertainment: { label: 'Fun', color: '#6366F1', icon: 'film' },
  education: { label: 'Education', color: '#6366F1', icon: 'book' },
  investment: { label: 'Investment', color: '#10B981', icon: 'trending-up' },
  other_expense: { label: 'Other Expense', color: '#0EA5E9', icon: 'swap-horizontal' },
  others: { label: 'Others', color: '#6B7280', icon: 'apps' },
};

export interface ReportsData {
  period: { start: string; end: string };
  income: number;
  expense: number;
  previousIncome: number;
  previousExpense: number;
  categories: Record<string, { total: number; count: number }>;
  previousCategories: Record<string, { total: number; count: number }>;
  bills: {
    total: number;
    paid: number;
    ratio: number;
  };
}

export interface LifeScoreData {
  score: number;
  breakdown: {
    spending: number;
    bills: number;
    health: number;
  };
  updatedAt: string;
}

export const REMINDER_TYPE_CONFIG: Record<ReminderType, { label: string; icon: string; color: string }> = {
  bill: { label: 'Bill', icon: 'receipt', color: Colors.categories.bills },
  subscription: { label: 'Subscription', icon: 'refresh', color: Colors.categories.subscriptions },
  custom: { label: 'Custom', icon: 'create', color: Colors.dark.accentBlue },
};

export const REPEAT_OPTIONS: { key: RepeatType; label: string }[] = [
  { key: 'none', label: 'One-time' },
  { key: 'daily', label: 'Daily' },
  { key: 'weekly', label: 'Weekly' },
  { key: 'monthly', label: 'Monthly' },
  { key: 'yearly', label: 'Yearly' },
];

export const ICON_OPTIONS = [
  'flash', 'wifi', 'phone-portrait', 'home', 'play', 'musical-notes',
  'barbell', 'shield-checkmark', 'card', 'water', 'car', 'cart',
  'film', 'book', 'medkit', 'game-controller', 'newspaper', 'globe',
  'bulb', 'airplane',
];

export function generateId(): string {
  return Date.now().toString() + Math.random().toString(36).substr(2, 9);
}

export function formatCurrency(amount: number): string {
  if (amount >= 100000) {
    return `${(amount / 100000).toFixed(1)}L`;
  }
  if (amount >= 1000) {
    return amount.toLocaleString('en-IN');
  }
  return amount.toString();
}

/**
 * Format a Date as a calendar day (`YYYY-MM-DD`) in the *local* timezone.
 *
 * `toISOString().split('T')[0]` is the obvious-looking version of this and is
 * wrong everywhere east of UTC: a date picker hands back local midnight, which
 * in IST (UTC+5:30) converts to 18:30 the previous day in UTC, so the stored
 * day lands one behind what the user tapped. Calendar dates like a birthday
 * have no time or zone attached, so they must never round-trip through UTC.
 */
export function toLocalDateString(date: Date): string {
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

/**
 * Parse a `YYYY-MM-DD` calendar day into a Date at *local* midnight.
 *
 * The inverse of `toLocalDateString`, and needed for the same reason: `new
 * Date('2011-12-03')` is defined to parse as UTC midnight, which reads back as
 * the 2nd in any timezone behind UTC and shifts the picker a day each time it
 * reopens. Falls back to the platform parser for full timestamps.
 */
export function fromLocalDateString(value: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec((value || '').trim());
  if (!match) return new Date(value);
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

export const BLOOD_GROUPS = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'] as const;
export type BloodGroup = (typeof BLOOD_GROUPS)[number];

/**
 * Whole years elapsed since a `YYYY-MM-DD` date of birth, as of today.
 * Returns `null` when there's no date to work from, so callers can render a
 * placeholder instead of "0" for a member with no DOB set yet.
 */
export function calculateAge(dateOfBirth?: string | null): number | null {
  if (!dateOfBirth) return null;
  const dob = fromLocalDateString(dateOfBirth);
  if (Number.isNaN(dob.getTime())) return null;
  const today = new Date();
  let age = today.getFullYear() - dob.getFullYear();
  const monthDiff = today.getMonth() - dob.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < dob.getDate())) {
    age--;
  }
  return age >= 0 ? age : null;
}

export function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));

  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days} days ago`;

  return date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

export function formatTime(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
}

export function getDateLabel(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const txDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const diff = Math.floor((today.getTime() - txDate.getTime()) / (1000 * 60 * 60 * 24));

  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  return date.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });
}

export function getCategoryBreakdown(transactions: Transaction[]): { category: CategoryType; total: number; percentage: number }[] {
  const totals: Partial<Record<CategoryType, number>> = {};
  let grandTotal = 0;

  transactions.forEach(tx => {
    if (tx.isDebit) {
      const cat = (CATEGORIES[tx.category] ? tx.category : 'others') as CategoryType;
      totals[cat] = (totals[cat] || 0) + tx.amount;
      grandTotal += tx.amount;
    }
  });

  return Object.entries(totals)
    .map(([cat, total]) => ({
      category: cat as CategoryType,
      total: total as number,
      percentage: grandTotal > 0 ? ((total as number) / grandTotal) * 100 : 0,
    }))
    .sort((a, b) => b.total - a.total);
}

export function getTodaySpending(transactions: Transaction[]): number {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  return transactions
    .filter(tx => {
      const txDate = new Date(tx.date);
      const txDay = new Date(txDate.getFullYear(), txDate.getMonth(), txDate.getDate());
      return txDay.getTime() === today.getTime() && tx.isDebit;
    })
    .reduce((sum, tx) => sum + tx.amount, 0);
}

export function getMonthlySpending(transactions: Transaction[], month?: number, year?: number): number {
  const now = new Date();
  const m = month ?? now.getMonth();
  const y = year ?? now.getFullYear();

  return transactions
    .filter(tx => {
      const d = new Date(tx.date);
      return d.getMonth() === m && d.getFullYear() === y && tx.isDebit;
    })
    .reduce((sum, tx) => sum + tx.amount, 0);
}

export type GreetingPeriod = 'morning' | 'afternoon' | 'evening';

export function getGreetingPeriod(): GreetingPeriod {
  const hour = new Date().getHours();
  if (hour < 12) return 'morning';
  if (hour < 17) return 'afternoon';
  return 'evening';
}

export function getGreeting(): string {
  const period = getGreetingPeriod();
  if (period === 'morning') return 'Good Morning';
  if (period === 'afternoon') return 'Good Afternoon';
  return 'Good Evening';
}

export function getDaysUntil(dateStr: string): number {
  const now = new Date();
  const due = new Date(dateStr);
  const diff = due.getTime() - now.getTime();
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
}
