import React, { createContext, useContext, useState, useEffect, useMemo, useCallback, useRef, ReactNode } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Alert, Linking, Platform } from 'react-native';
import { router } from 'expo-router';
import {
  Transaction,
  Bill,
  MoneyLeak,
  ReminderSettings,
  DEFAULT_REMINDER_SETTINGS,
  ReportsData,
  LifeScoreData,
  CategoryType,
  PaymentMode,
  ExpenseSource,
} from './data';
import { getApiUrl } from './query-client';
import { useAuth } from './auth-context';
import { useAlert } from './alert-context';
import { readSmsFromDeviceWithMeta, requestSmsPermissionDetails } from './sms-reader';
import { parseSmsToTransactions } from './parse-sms';
import { performSmsSync, SmsSyncPhase } from './sms-sync-task';

const STORAGE_KEYS = {
  BUDGET: '@lifewise_budget',
  REMINDER_SETTINGS: '@lifewise_reminder_settings',
};

/**
 * What the app needs to create an expense. `merchant` and `amount` are the only
 * fields the server requires; everything else has a sensible default applied in
 * addTransaction() so callers (Quick Add, scan, voice, import) stay simple.
 */
export interface ExpenseDraft {
  merchant: string;
  amount: number;
  category?: CategoryType;
  date?: string;
  memberId?: string | null;
  paymentMode?: PaymentMode;
  description?: string;
  receiptUrl?: string;
  source?: ExpenseSource;
  upiId?: string;
  /**
   * Content hash identifying this row across repeated imports. Sent so the
   * server can upsert instead of inserting — see EXPENSE_ENTRY_BACKEND_TODO.md §2.
   * Omitted for manually-entered expenses.
   */
  dedupeKey?: string;
}

interface ExpenseContextValue {
  transactions: Transaction[];
  bills: Bill[];
  leaks: MoneyLeak[];
  isLoading: boolean;
  isSyncingSms: boolean;
  smsSyncPhase: SmsSyncPhase;
  smsSyncStatus: string | null;
  smsSyncProgressCurrent: number | null;
  smsSyncProgressTotal: number | null;
  smsSyncDetail: string | null;
  smsSampleSenders: string[];
  lastSmsReadCount: number | null;
  lastSmsSyncCount: number | null;
  toggleBillPaid: (billId: string) => void;
  refreshData: () => void;
  syncSmsFromDevice: () => Promise<void>;
  /** Create a single expense (Quick Add, scan, voice). Returns null on failure. */
  addTransaction: (draft: ExpenseDraft) => Promise<Transaction | null>;
  /** Create many expenses at once (CSV / PDF statement import). Returns the saved count. */
  addTransactionsBulk: (drafts: ExpenseDraft[]) => Promise<number>;
  monthlyBudget: number;
  setMonthlyBudget: (budget: number) => void;
  quickAddReminder: (text: string) => Promise<void>;
  addReminder: (bill: Omit<Bill, 'id'>) => Promise<Bill | null>;
  editReminder: (bill: Bill) => void;
  deleteReminder: (billId: string) => void;
  snoozeReminder: (billId: string, days: number, minutes?: number) => void;
  cancelReminder: (billId: string) => void;
  uncancelReminder: (billId: string) => void;
  reminderSettings: ReminderSettings;
  updateReminderSettings: (settings: ReminderSettings) => void;
  lifeScore: LifeScoreData | null;
  getReports: (start: string, end: string) => Promise<ReportsData | null>;
}

const ExpenseContext = createContext<ExpenseContextValue | null>(null);

/**
 * Creation time encoded in a Mongo ObjectId, or null for any other id shape.
 *
 * `Bill` has no `createdAt` field and the server does not send one, so the id
 * is the only recency signal available. A 24-char hex ObjectId carries a
 * 4-byte unix timestamp in its first 8 characters.
 *
 * Family Hub projections (`fam:...`) and any client-generated id return null
 * and are treated as equal, leaving their relative order untouched.
 */
function creationTimeFromId(id: string): number | null {
  if (!/^[0-9a-f]{24}$/i.test(id)) return null;
  const seconds = parseInt(id.slice(0, 8), 16);
  return Number.isFinite(seconds) ? seconds * 1000 : null;
}

/**
 * Newest-created first, preserving the server's relative order for anything
 * without a decodable timestamp.
 *
 * Note this orders by *creation*, not due date — the Reminders screen applies
 * its own due-date sort on top. This only decides which reminder wins when two
 * are otherwise equal, and guarantees a freshly added one is never buried.
 */
export function sortBillsNewestFirst(items: Bill[]): Bill[] {
  return items
    .map((bill, index) => ({ bill, index }))
    .sort((a, b) => {
      const at = creationTimeFromId(a.bill.id);
      const bt = creationTimeFromId(b.bill.id);
      // Undecodable ids keep their incoming order rather than jumping to an end.
      if (at === null || bt === null) return a.index - b.index;
      return bt - at;
    })
    .map((entry) => entry.bill);
}

async function fetchWithAuth(token: string | null, path: string, options?: RequestInit): Promise<Response> {
  const baseUrl = getApiUrl();
  const url = new URL(path, baseUrl).toString();
  const headers: Record<string, string> = { ...(options?.headers as Record<string, string>) };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(url, { ...options, headers });
  return res;
}

export function ExpenseProvider({ children }: { children: ReactNode }) {
  const { token } = useAuth();
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [bills, setBills] = useState<Bill[]>([]);
  const [leaks, setLeaks] = useState<MoneyLeak[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSyncingSms, setIsSyncingSms] = useState(false);
  /** Guards against overlapping syncs. See `syncSmsFromDevice`. */
  const smsSyncInFlight = useRef(false);
  const [smsSyncPhase, setSmsSyncPhase] = useState<SmsSyncPhase>('idle');
  const [smsSyncStatus, setSmsSyncStatus] = useState<string | null>(null);
  const [smsSyncProgressCurrent, setSmsSyncProgressCurrent] = useState<number | null>(null);
  const [smsSyncProgressTotal, setSmsSyncProgressTotal] = useState<number | null>(null);
  const [smsSyncDetail, setSmsSyncDetail] = useState<string | null>(null);
  const [smsSampleSenders, setSmsSampleSenders] = useState<string[]>([]);
  const [lastSmsReadCount, setLastSmsReadCount] = useState<number | null>(null);
  const [lastSmsSyncCount, setLastSmsSyncCount] = useState<number | null>(null);
  const [monthlyBudget, setMonthlyBudgetState] = useState(100000);
  const [reminderSettings, setReminderSettings] = useState<ReminderSettings>(DEFAULT_REMINDER_SETTINGS);
  const [lifeScore, setLifeScore] = useState<LifeScoreData | null>(null);
  const { showAlert } = useAlert();

  const loadData = useCallback(async () => {
    if (!token) {
      setTransactions([]);
      setBills([]);
      setLeaks([]);
      setIsLoading(false);
      return;
    }
    try {
      setIsLoading(true);
      // Load from AsyncStorage as a fast fallback/cached state
      const [budgetStored, settingsStored] = await Promise.all([
        AsyncStorage.getItem(STORAGE_KEYS.BUDGET),
        AsyncStorage.getItem(STORAGE_KEYS.REMINDER_SETTINGS),
      ]);
      if (budgetStored != null) setMonthlyBudgetState(JSON.parse(budgetStored));
      if (settingsStored) setReminderSettings(JSON.parse(settingsStored));

      const [txRes, billsRes, leaksRes, settingsRes] = await Promise.all([
        fetchWithAuth(token, '/api/transactions'),
        fetchWithAuth(token, '/api/bills'),
        fetchWithAuth(token, '/api/leaks'),
        fetchWithAuth(token, '/api/settings'),
      ]);

      if (txRes.ok) {
        const data = (await txRes.json()) as Transaction[];
        setTransactions(
          data.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()),
        );
      }
      else setTransactions([]);
      if (billsRes.ok) {
        // Newest first, like transactions above. The server returns insertion
        // order, so without this a refresh puts the most recently added
        // reminder back at the bottom of the list.
        const data = (await billsRes.json()) as Bill[];
        setBills(Array.isArray(data) ? sortBillsNewestFirst(data) : []);
      }
      else setBills([]);
      if (leaksRes.ok) setLeaks(await leaksRes.json());
      else setLeaks([]);
      
      if (settingsRes.ok) {
        const settings = await settingsRes.json();
        if (settings.monthlyBudget != null) {
          setMonthlyBudgetState(settings.monthlyBudget);
          AsyncStorage.setItem(STORAGE_KEYS.BUDGET, JSON.stringify(settings.monthlyBudget));
        }
        if (settings.reminderSettings) {
          setReminderSettings(settings.reminderSettings);
          AsyncStorage.setItem(STORAGE_KEYS.REMINDER_SETTINGS, JSON.stringify(settings.reminderSettings));
        }
      }
    } catch (e) {
      setTransactions([]);
      setBills([]);
      setLeaks([]);
    } finally {
      setIsLoading(false);
    }
  }, [token]);

  const syncSmsFromDevice = useCallback(async () => {
    if (!token) return;
    // Re-entrancy guard. Auto-sync-on-open, the foreground listener and
    // pull-to-refresh can all fire within a few hundred ms of each other; two
    // concurrent runs would read the same window and race on the sync
    // watermark. A ref, not `isSyncingSms` — state isn't updated in time to
    // block a second call made in the same tick.
    if (smsSyncInFlight.current) return;
    smsSyncInFlight.current = true;
    setIsSyncingSms(true);
    setSmsSyncStatus('Preparing SMS sync...');
    setSmsSyncProgressCurrent(null);
    setSmsSyncProgressTotal(null);
    setSmsSampleSenders([]);
    setLastSmsReadCount(null);
    setLastSmsSyncCount(null);
    try {
      if (Platform.OS !== 'android') {
        // iOS sandboxes the SMS inbox — no third-party app can read it (doc §1).
        // Point at the entry methods that DO work rather than dead-ending: an
        // "unsupported" alert with no alternative just tells the user to give up.
        showAlert({
          title: 'Auto Track works differently here',
          message:
            'Apple does not let any app read your SMS. Instead, import your bank statement — one CSV export fills in a whole month at once. You can also scan receipts or speak an expense.',
          type: 'info',
          buttons: [
            { text: 'Not now', style: 'cancel' },
            { text: 'Import statement', onPress: () => router.push('/import-statement') },
          ],
        });
        setSmsSyncStatus('On iPhone, import a bank statement or add expenses by scan/voice.');
        setSmsSyncProgressCurrent(null);
        setSmsSyncProgressTotal(null);
        setLastSmsReadCount(0);
        setLastSmsSyncCount(0);
        await loadData();
        return;
      }

      setSmsSyncStatus('Requesting SMS permission...');
      const permission = await requestSmsPermissionDetails();
      if (permission.status !== 'granted') {
        if (permission.status === 'never_ask_again') {
          showAlert({
            title: 'Permission blocked',
            message: 'SMS permission is blocked. Please open Settings > Permissions and allow SMS.',
            type: 'warning',
            buttons: [
              { text: 'Cancel', style: 'cancel' },
              {
                text: 'Open Settings',
                onPress: () => {
                  Linking.openSettings().catch(() => { });
                },
              },
            ],
          });
        } else {
          showAlert({
            title: 'Permission needed',
            message: 'Please allow SMS permission to enable Auto Track.',
            type: 'info',
          });
        }
        setSmsSyncStatus(permission.message);
        setSmsSyncProgressCurrent(null);
        setSmsSyncProgressTotal(null);
        setLastSmsReadCount(0);
        setLastSmsSyncCount(0);
        await loadData();
        return;
      }

      setSmsSyncPhase('fetching');
      setSmsSyncStatus('Reading SMS inbox...');

      console.log('[SMS-Debug] Starting sync...');
      const syncResult = await performSmsSync(token, (prog) => {
        setSmsSyncPhase(prog.phase);
        if (prog.phase === 'fetching') {
          setSmsSyncStatus('Reading SMS inbox...');
        } else if (prog.phase === 'parsing') {
          setSmsSyncStatus(`Identifying transactions...`);
          setSmsSyncProgressTotal(prog.total || null);
        } else if (prog.phase === 'uploading') {
          setSmsSyncStatus('Securely syncing to cloud...');
          setSmsSyncProgressCurrent(prog.current || null);
          setSmsSyncProgressTotal(prog.total || null);
          setSmsSyncDetail(prog.detail || null);
        }
      });

      console.log('[SMS-Debug] Sync result:', syncResult);
      
      if (syncResult.success) {
        setLastSmsSyncCount(syncResult.synced);
        setSmsSyncPhase('completed');
        setSmsSyncStatus(`Sync complete. ${syncResult.synced} transactions synced.`);
        
        // Show the new transactions FIRST. AI categorization re-labels hundreds
        // of rows and can take a long time (or stall); awaiting it before
        // loadData() left the screen showing the pre-sync state — ₹0 and an
        // empty list — while the banner said hundreds had been added.
        await loadData();

        // Then refine categories in the background and refresh again when done.
        // Not awaited: the data is already correct on screen, only the category
        // labels improve.
        if (syncResult.synced > 0) {
          setSmsSyncStatus('Polishing categories with AI...');
          fetchWithAuth(token, '/api/transactions/categorize-others', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
          })
            .then(() => loadData())
            .catch((e) => console.error('[AI] categorization trigger error:', e));
        }
        // Reset phase after delay if synced something, or keep idle
        setTimeout(() => setSmsSyncPhase('idle'), 5000);
      } else {
        setSmsSyncPhase('error');
        // Name the actual cause. A 401 means the saved session is no longer
        // valid (e.g. the app was pointed at a different backend), which has
        // nothing to do with SMS permissions — blaming permissions here sent
        // real debugging down the wrong path.
        const { status, error: readError } = syncResult;
        if (status === 401 || status === 403) {
          setSmsSyncStatus('Your session has expired. Please sign out and sign in again.');
          showAlert({
            title: 'Session expired',
            message: 'Please sign out and sign in again, then retry Auto Track.',
            type: 'warning',
          });
        } else if (readError) {
          // The inbox could not be read at all — a missing native module (Expo
          // Go) or a revoked permission. Say so, instead of the generic
          // "check your connection", which points at the wrong thing entirely.
          setSmsSyncStatus(readError);
          showAlert({
            title: 'Could not read SMS',
            message: readError,
            type: 'warning',
          });
        } else {
          setSmsSyncStatus(
            status
              ? `Auto Track failed (server error ${status}). Please try again.`
              : 'Auto Track failed. Please check your connection and try again.',
          );
        }
        // Clear the error banner too. Without this the failure state was never
        // reset, so a single failed sync left the banner pinned to the home
        // screen until the app was restarted.
        setTimeout(() => setSmsSyncPhase('idle'), 6000);
      }
    } catch (err) {
      console.error('SMS sync error:', err);
      setSmsSyncPhase('error');
      setSmsSyncStatus('SMS sync failed unexpectedly.');
      setTimeout(() => setSmsSyncPhase('idle'), 6000);
      await loadData();
    } finally {
      smsSyncInFlight.current = false;
      setIsSyncingSms(false);
    }
  }, [token, loadData]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const toggleBillPaid = useCallback(async (billId: string) => {
    if (!token) return;
    const bill = bills.find((b) => b.id === billId);
    if (!bill) return;
    const oldBills = [...bills];
    const status: 'active' | 'paid' = bill.isPaid ? 'active' : 'paid';
    const updated = { ...bill, isPaid: !bill.isPaid, status };
    
    // Optimistic Update
    setBills((prev) => prev.map((b) => (b.id === billId ? updated : b)));
    try {
      const res = await fetchWithAuth(token, `/api/bills/${billId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updated),
      });
      if (res.ok) setBills((prev) => prev.map((b) => (b.id === billId ? updated : b)));
      else setBills(oldBills);
    } catch {
      setBills(oldBills);
    }
  }, [token, bills]);

  const addReminder = useCallback(async (billData: Omit<Bill, 'id'>): Promise<Bill | null> => {
    if (!token) return null;
    try {
      const res = await fetchWithAuth(token, '/api/bills', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(billData),
      });
      if (res.ok) {
        const created = await res.json();
        // Prepend, not append: a just-created reminder belongs at the head of
        // the list. Appending buried it at the bottom, which read as "my
        // reminder wasn't saved".
        setBills((prev) => [created, ...prev]);
        return created as Bill;
      }
    } catch {
      // optional: add locally with generateId for optimistic UI
    }
    return null;
  }, [token]);

  const editReminder = useCallback(async (updatedBill: Bill) => {
    if (!token) return;
    try {
      const res = await fetchWithAuth(token, `/api/bills/${updatedBill.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updatedBill),
      });
      if (res.ok) setBills((prev) => prev.map((b) => (b.id === updatedBill.id ? updatedBill : b)));
    } catch {
      setBills((prev) => prev.map((b) => (b.id === updatedBill.id ? updatedBill : b)));
    }
  }, [token]);

  const deleteReminder = useCallback(async (billId: string) => {
    if (!token) return;
    try {
      const res = await fetchWithAuth(token, `/api/bills/${billId}`, { method: 'DELETE' });
      if (res.ok) setBills((prev) => prev.filter((b) => b.id !== billId));
    } catch {
      setBills((prev) => prev.filter((b) => b.id !== billId));
    }
  }, [token]);

  const snoozeReminder = useCallback(async (billId: string, days: number, minutes?: number) => {
    if (!token) return;
    const oldBills = [...bills];
    
    // Optimistic Update: Remove from dashboard immediately
    setBills((prev) => prev.map((b) => {
      if (b.id === billId) {
        const snoozeMs = (minutes || days * 24 * 60) * 60 * 1000;
        const snoozedUntil = new Date(Date.now() + snoozeMs).toISOString();
        return { ...b, status: 'snoozed', snoozedUntil, isPaid: false };
      }
      return b;
    }));

    try {
      const res = await fetchWithAuth(token, `/api/bills/${billId}/actions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'snooze', days, minutes }),
      });
      if (!res.ok) {
        setBills(oldBills);
      }
    } catch (err) {
      console.error('Snooze error:', err);
      setBills(oldBills);
    }
  }, [token, bills]);

  const cancelReminder = useCallback(async (billId: string) => {
    if (!token) return;
    const oldBills = [...bills];

    // Optimistic Update
    setBills((prev) => prev.map((b) => (b.id === billId ? { ...b, status: 'cancelled', isPaid: false } : b)));

    try {
      const res = await fetchWithAuth(token, `/api/bills/${billId}/actions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'cancel' }),
      });
      if (!res.ok) {
        setBills(oldBills);
      }
    } catch (err) {
      console.error('Cancel error:', err);
      setBills(oldBills);
    }
  }, [token, bills]);

  const uncancelReminder = useCallback(async (billId: string) => {
    if (!token) return;
    try {
      const res = await fetchWithAuth(token, `/api/bills/${billId}/actions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'uncancel' }),
      });
      if (res.ok) {
        setBills((prev) => prev.map((b) => (b.id === billId ? { ...b, status: 'active', isPaid: false } : b)));
      }
    } catch (err) {
      console.error('Uncancel error:', err);
    }
  }, [token]);

  const quickAddReminder = useCallback(
    async (text: string) => {
      if (!token || !text.trim()) return;
      try {
        const res = await fetchWithAuth(token, '/api/reminders/quick-add', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text }),
        });
        if (res.ok) {
          const created = await res.json();
          setBills((prev) => [...prev, created]);
        }
      } catch {
        // ignore, user will still have manual flows
      }
    },
    [token],
  );

  /**
   * Normalise a draft into the POST /api/transactions payload. memberId,
   * paymentMode, receiptUrl and source are all persisted and echoed back by the
   * backend now (see EXPENSE_ENTRY_BACKEND_TODO.md §1) — no local merge needed.
   */
  const buildPayload = useCallback((draft: ExpenseDraft) => ({
    merchant: draft.merchant.trim(),
    amount: draft.amount,
    category: draft.category || 'others',
    date: draft.date || new Date().toISOString(),
    upiId: draft.upiId || '',
    isDebit: true,
    description: draft.description || '',
    memberId: draft.memberId ?? null,
    paymentMode: draft.paymentMode || 'upi',
    receiptUrl: draft.receiptUrl || '',
    source: draft.source || 'manual',
    // Only present for imports; a manual entry has nothing stable to hash.
    ...(draft.dedupeKey ? { dedupeKey: draft.dedupeKey } : {}),
  }), []);

  const addTransaction = useCallback(
    async (draft: ExpenseDraft): Promise<Transaction | null> => {
      if (!token) return null;
      if (!draft.merchant?.trim() || !Number.isFinite(draft.amount) || draft.amount <= 0) {
        return null;
      }
      const payload = buildPayload(draft);
      try {
        const res = await fetchWithAuth(token, '/api/transactions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        if (!res.ok) return null;

        const created = (await res.json()) as Transaction;
        setTransactions((prev) =>
          [created, ...prev].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()),
        );
        return created;
      } catch {
        return null;
      }
    },
    [token, buildPayload],
  );

  const addTransactionsBulk = useCallback(
    async (drafts: ExpenseDraft[]): Promise<number> => {
      if (!token || drafts.length === 0) return 0;
      const valid = drafts.filter(
        (d) => d.merchant?.trim() && Number.isFinite(d.amount) && d.amount > 0,
      );
      if (valid.length === 0) return 0;

      try {
        const res = await fetchWithAuth(token, '/api/transactions/bulk', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ transactions: valid.map(buildPayload) }),
        });
        if (!res.ok) return 0;

        const { saved } = (await res.json()) as { saved: number; skipped: number; failed: number };
        // The bulk endpoint returns counts, not the created rows, so there is
        // nothing to splice into local state optimistically — reload from the
        // server instead. A statement import is not latency-sensitive enough
        // to be worth a fabricated optimistic list.
        if (saved > 0) await loadData();
        return saved;
      } catch {
        return 0;
      }
    },
    [token, buildPayload, loadData],
  );

  const refreshData = useCallback(async () => {
    await loadData();
  }, [loadData]);

  const setMonthlyBudget = useCallback(async (budget: number) => {
    setMonthlyBudgetState(budget);
    await AsyncStorage.setItem(STORAGE_KEYS.BUDGET, JSON.stringify(budget));
    if (token) {
      try {
        await fetchWithAuth(token, '/api/settings', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ monthlyBudget: budget }),
        });
      } catch {
        // ignore
      }
    }
  }, [token]);

  const updateReminderSettings = useCallback(async (settings: ReminderSettings) => {
    setReminderSettings(settings);
    await AsyncStorage.setItem(STORAGE_KEYS.REMINDER_SETTINGS, JSON.stringify(settings));
    if (token) {
      try {
        await fetchWithAuth(token, '/api/settings', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ reminderSettings: settings }),
        });
      } catch {
        // ignore
      }
    }
  }, [token]);

  const getReports = useCallback(async (start: string, end: string): Promise<ReportsData | null> => {
    if (!token) return null;
    try {
      const res = await fetchWithAuth(token, `/api/reports?start=${start}&end=${end}`);
      if (res.ok) return await res.json();
    } catch {
      // ignore
    }
    return null;
  }, [token]);

  const value = useMemo(
    () => ({
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
      smsSampleSenders,
      lastSmsReadCount,
      lastSmsSyncCount,
      toggleBillPaid,
      refreshData,
      syncSmsFromDevice,
      addTransaction,
      addTransactionsBulk,
      monthlyBudget,
      setMonthlyBudget,
      quickAddReminder,
      addReminder,
      editReminder,
      deleteReminder,
      snoozeReminder,
      cancelReminder,
      uncancelReminder,
      reminderSettings,
      updateReminderSettings,
      lifeScore,
      getReports,
    }),
    [
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
      smsSampleSenders,
      lastSmsReadCount,
      lastSmsSyncCount,
      monthlyBudget,
      reminderSettings,
      toggleBillPaid,
      refreshData,
      syncSmsFromDevice,
      addTransaction,
      addTransactionsBulk,
      setMonthlyBudget,
      quickAddReminder,
      addReminder,
      editReminder,
      deleteReminder,
      snoozeReminder,
      cancelReminder,
      uncancelReminder,
      updateReminderSettings,
      lifeScore,
      getReports,
    ]
  );

  return <ExpenseContext.Provider value={value}>{children}</ExpenseContext.Provider>;
}

export function useExpenses() {
  const context = useContext(ExpenseContext);
  if (!context) {
    throw new Error('useExpenses must be used within an ExpenseProvider');
  }
  return context;
}
