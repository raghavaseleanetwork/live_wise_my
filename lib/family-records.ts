import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  pullRecords,
  pushCreate,
  pushDelete,
  pushPatch,
  type RecordKind,
} from '@/lib/family-records-sync';

/**
 * Family Hub — Phase 2, 3 & 4 data layer.
 *
 * Doctor Appointments, Health Monitoring, Medication Stock, Daily Routine
 * (Phase 2); Bill Management, Subscription Tracking, Expense Tracking,
 * Reminder Tasks, Insurance & Documents (Phase 3); and Call & Check-in,
 * Travel & Visits, Emergency Alerts, Custom Feature (Phase 4).
 *
 * ## Phase 5 (2026-08-01): records now sync to the server
 *
 * These used to be AsyncStorage-only. The backend endpoints existed and were
 * verified working, but nothing in the app ever called them, so records were
 * trapped on the device that created them: connected caregivers saw none of the
 * owner's appointments, and reinstalling the app destroyed everything.
 *
 * `lib/family-records-sync.ts` supplies the write-through. The per-kind
 * `load*` / `save*` / `add*` / `update*` / `delete*` API below is unchanged, so
 * no screen needed editing — the primitives underneath now reconcile with the
 * server and fall back to the cache when it is unreachable.
 *
 * Emergency alerts and the custom-feature config stay local-only: alerts are a
 * push concern rather than a record, and the config is a per-device UI
 * preference.
 */

function generateId(): string {
  return Date.now().toString() + Math.random().toString(36).slice(2, 9);
}

// ---------------------------------------------------------------------------
// Server-backed storage primitives
// ---------------------------------------------------------------------------

/**
 * Reads a list, preferring the server and falling back to the cache.
 *
 * A server response overwrites the cache so a second device's edits land
 * locally. When the server cannot be reached the cache is returned untouched —
 * an offline user sees their records, not an empty screen.
 */
/**
 * Drop records sharing an `id`, keeping the first.
 *
 * The server can legitimately return two rows with the same id: a queued write
 * that was retried (e.g. after the record-sync URLs were corrected) creates the
 * same record twice. Screens key their lists on `item.id`, so a duplicate id
 * raises React's "two children with the same key" error and can make rows
 * vanish or double up. Filtering here fixes every screen at once rather than
 * each list separately.
 */
function dedupeById<T>(items: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const item of items) {
    const id = (item as { id?: unknown })?.id;
    const k = id == null ? '' : String(id);
    if (k && seen.has(k)) continue;
    if (k) seen.add(k);
    out.push(item);
  }
  return out;
}

async function loadSynced<T>(memberId: string, kind: RecordKind, key: string): Promise<T[]> {
  const remote = await pullRecords<T>(memberId, kind);
  if (remote) {
    const clean = dedupeById(remote);
    try {
      await AsyncStorage.setItem(key, JSON.stringify(clean));
    } catch {
      // Cache write failure is not fatal; the data is already in hand.
    }
    return clean;
  }

  try {
    const raw = await AsyncStorage.getItem(key);
    return raw ? dedupeById(JSON.parse(raw) as T[]) : [];
  } catch {
    return [];
  }
}

/** Writes the local cache. The server is updated by the add/update/delete pair. */
async function saveLocal<T>(key: string, items: T[]): Promise<void> {
  await AsyncStorage.setItem(key, JSON.stringify(items));
}

/**
 * Reads the cache only, with no server round-trip.
 *
 * Mutations use this rather than `loadSynced` so that saving an edit cannot be
 * silently reverted by a slow fetch landing mid-write, and so an offline edit
 * doesn't stall behind a request that is going to fail anyway.
 */
async function loadCached<T>(key: string): Promise<T[]> {
  try {
    const raw = await AsyncStorage.getItem(key);
    // Deduped like `loadSynced`, so a cache written by an older build cannot
    // reintroduce duplicate ids into a mutation's read-modify-write cycle.
    return raw ? dedupeById(JSON.parse(raw) as T[]) : [];
  } catch {
    return [];
  }
}

/** Local-first create: cache immediately, then mirror to the server. */
async function addSynced<T extends { id: string }>(
  memberId: string,
  kind: RecordKind,
  key: string,
  record: T,
): Promise<T> {
  const items = await loadCached<T>(key);
  await saveLocal(key, [record, ...items]);
  await pushCreate(memberId, kind, record);
  return record;
}

/** Local-first delete. */
async function deleteSynced<T extends { id: string }>(
  memberId: string,
  kind: RecordKind,
  key: string,
  id: string,
): Promise<T[]> {
  const items = await loadCached<T>(key);
  const next = items.filter((item) => item.id !== id);
  await saveLocal(key, next);
  await pushDelete(memberId, kind, id);
  return next;
}

/**
 * Local-first edit.
 *
 * Only `patch` is sent, never the merged record: `PATCH` merges server-side, so
 * transmitting the whole object would let a form that omits a field overwrite
 * whatever another device set there.
 */
async function updateSynced<T extends { id: string; createdAt: string }>(
  memberId: string,
  kind: RecordKind,
  key: string,
  id: string,
  patch: Partial<T>,
): Promise<T[]> {
  const items = await loadCached<T>(key);
  const next = items.map((item) =>
    item.id === id ? { ...item, ...patch, id: item.id, createdAt: item.createdAt } : item,
  );
  await saveLocal(key, next);
  await pushPatch(memberId, kind, id, patch as object);
  return next;
}


// ---------------------------------------------------------------------------
// Doctor Appointments
// ---------------------------------------------------------------------------

export type AppointmentRecurrence = 'monthly' | 'quarterly' | 'every_6_months' | 'yearly';
export type AppointmentReminderLead = '1_day' | '3_hours' | '1_hour' | '30_min';

export interface Appointment {
  id: string;
  doctorName: string;
  specialty?: string;
  hospitalName?: string;
  date: string; // ISO — appointment date + time combined
  location?: string;
  notes?: string;
  isFollowUp: boolean;
  followUpDate?: string | null; // ISO
  isRecurring?: boolean;
  recurrence?: AppointmentRecurrence;
  reminderLead?: AppointmentReminderLead;
  completed: boolean;
  createdAt: string;
}

const APPT_KEY = (memberId: string) => `@lifewise_family_appointments_${memberId}`;

export async function loadAppointments(memberId: string): Promise<Appointment[]> {
  return loadSynced<Appointment>(memberId, 'appointments', APPT_KEY(memberId));
}

export async function saveAppointments(memberId: string, items: Appointment[]): Promise<void> {
  await saveLocal(APPT_KEY(memberId), items);
}

export async function addAppointment(
  memberId: string,
  data: Omit<Appointment, 'id' | 'createdAt' | 'completed'>,
): Promise<Appointment> {
  const record: Appointment = { ...data, id: generateId(), completed: false, createdAt: new Date().toISOString() };
  return addSynced(memberId, 'appointments', APPT_KEY(memberId), record);
}

export async function toggleAppointmentDone(memberId: string, id: string): Promise<Appointment[]> {
  const items = await loadCached<Appointment>(APPT_KEY(memberId));
  const current = items.find((a) => a.id === id);
  // Completion is a property of the record, not the viewer — the owner marking
  // an appointment done must show as done for every connected caregiver too.
  return updateSynced<Appointment>(memberId, 'appointments', APPT_KEY(memberId), id, {
    completed: !current?.completed,
  } as Partial<Appointment>);
}

export async function deleteAppointment(memberId: string, id: string): Promise<Appointment[]> {
  return deleteSynced<Appointment>(memberId, 'appointments', APPT_KEY(memberId), id);
}

export async function updateAppointment(
  memberId: string,
  id: string,
  patch: Partial<Appointment>,
): Promise<Appointment[]> {
  return updateSynced<Appointment>(memberId, 'appointments', APPT_KEY(memberId), id, patch);
}

// ---------------------------------------------------------------------------
// Health Monitoring
// ---------------------------------------------------------------------------

export type HealthMetricType = 'bp' | 'sugar' | 'weight' | 'temperature' | 'oxygen' | 'heart_rate' | 'cholesterol';
export type WeightUnit = 'kg' | 'lbs';
export type SugarReadingType = 'fasting' | 'post_meal';

export interface HealthLog {
  id: string;
  type: HealthMetricType;
  /** e.g. "120/80" for BP, "98" for sugar (mg/dL), "72" for weight (kg) — kept
   * for display/back-compat; structured fields below are the source of truth
   * for BP/sugar/weight when present. */
  value: string;
  date: string; // ISO
  notes?: string;
  createdAt: string;
  // BP breakdown (PRD: Systolic + Diastolic + Pulse).
  systolic?: number;
  diastolic?: number;
  pulse?: number;
  // Sugar breakdown (PRD: Fasting/Post-meal toggle).
  sugarReadingType?: SugarReadingType;
  // Weight breakdown (PRD: unit toggle).
  weightUnit?: WeightUnit;
  // Normal-range alert (PRD: "user sets target range; app alerts if out of range").
  targetRangeLow?: number;
  targetRangeHigh?: number;
}

const HEALTH_KEY = (memberId: string) => `@lifewise_family_health_${memberId}`;

export const HEALTH_METRIC_LABELS: Record<HealthMetricType, { label: string; unit: string; icon: string }> = {
  bp: { label: 'Blood Pressure', unit: 'mmHg', icon: 'heart' },
  sugar: { label: 'Blood Sugar', unit: 'mg/dL', icon: 'water' },
  weight: { label: 'Weight', unit: 'kg', icon: 'body' },
  temperature: { label: 'Temperature', unit: '°F', icon: 'thermometer' },
  oxygen: { label: 'Oxygen Level', unit: '%', icon: 'pulse' },
  heart_rate: { label: 'Heart Rate', unit: 'bpm', icon: 'heart-circle' },
  cholesterol: { label: 'Cholesterol', unit: 'mg/dL', icon: 'flask' },
};

/** Whether a reading falls outside its member-set target range, for the PRD's out-of-range alert. */
export function isHealthLogOutOfRange(log: HealthLog): boolean {
  if (log.targetRangeLow == null || log.targetRangeHigh == null) return false;
  const numeric = log.type === 'bp' ? log.systolic : Number(log.value);
  if (numeric == null || Number.isNaN(numeric)) return false;
  return numeric < log.targetRangeLow || numeric > log.targetRangeHigh;
}

export async function loadHealthLogs(memberId: string): Promise<HealthLog[]> {
  const items = await loadSynced<HealthLog>(memberId, 'health', HEALTH_KEY(memberId));
  // Newest reading first. Sorted on read because the server returns insertion
  // order, and this list is always shown chronologically.
  return items.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
}

export async function saveHealthLogs(memberId: string, items: HealthLog[]): Promise<void> {
  await saveLocal(HEALTH_KEY(memberId), items);
}

export async function addHealthLog(
  memberId: string,
  data: Omit<HealthLog, 'id' | 'createdAt'>,
): Promise<HealthLog> {
  const record: HealthLog = { ...data, id: generateId(), createdAt: new Date().toISOString() };
  return addSynced(memberId, 'health', HEALTH_KEY(memberId), record);
}

export async function deleteHealthLog(memberId: string, id: string): Promise<HealthLog[]> {
  return deleteSynced<HealthLog>(memberId, 'health', HEALTH_KEY(memberId), id);
}

// ---------------------------------------------------------------------------
// Medication Stock
// ---------------------------------------------------------------------------

export interface StockPurchaseLogEntry {
  id: string;
  quantityAdded: number;
  purchasedAt: string; // ISO
}

export interface MedicationStockItem {
  id: string;
  medicineName: string;
  /** Set when linked to an actual Medicine Tracking entry (PRD: "Links to Module 1 data"). */
  linkedMedicineId?: string | null;
  /** Doses remaining, e.g. tablets left. */
  quantityRemaining: number;
  /** Below this, the item is flagged as low stock. */
  lowStockThreshold: number;
  /** How many doses are used per day, to estimate days-left. */
  dailyUsage: number;
  pharmacyName?: string;
  purchaseLog?: StockPurchaseLogEntry[];
  createdAt: string;
}

const STOCK_KEY = (memberId: string) => `@lifewise_family_stock_${memberId}`;

export async function loadStock(memberId: string): Promise<MedicationStockItem[]> {
  return loadSynced<MedicationStockItem>(memberId, 'stock', STOCK_KEY(memberId));
}

export async function saveStock(memberId: string, items: MedicationStockItem[]): Promise<void> {
  await saveLocal(STOCK_KEY(memberId), items);
}

export async function addStockItem(
  memberId: string,
  data: Omit<MedicationStockItem, 'id' | 'createdAt'>,
): Promise<MedicationStockItem> {
  const record: MedicationStockItem = { ...data, id: generateId(), createdAt: new Date().toISOString() };
  return addSynced(memberId, 'stock', STOCK_KEY(memberId), record);
}

export async function adjustStock(memberId: string, id: string, delta: number): Promise<MedicationStockItem[]> {
  const items = await loadCached<MedicationStockItem>(STOCK_KEY(memberId));
  const current = items.find((s) => s.id === id);
  if (!current) return items;
  return updateSynced<MedicationStockItem>(memberId, 'stock', STOCK_KEY(memberId), id, {
    quantityRemaining: Math.max(0, current.quantityRemaining + delta),
  });
}

/** Records a restock (PRD: "Purchase Log — Record when new stock is purchased") and adds it to the running total. */
export async function logStockPurchase(memberId: string, id: string, quantityAdded: number): Promise<MedicationStockItem[]> {
  const items = await loadCached<MedicationStockItem>(STOCK_KEY(memberId));
  const current = items.find((s) => s.id === id);
  if (!current) return items;
  const entry: StockPurchaseLogEntry = { id: generateId(), quantityAdded, purchasedAt: new Date().toISOString() };
  return updateSynced<MedicationStockItem>(memberId, 'stock', STOCK_KEY(memberId), id, {
    quantityRemaining: Math.max(0, current.quantityRemaining + quantityAdded),
    purchaseLog: [entry, ...(current.purchaseLog ?? [])].slice(0, 20),
  });
}

export async function deleteStockItem(memberId: string, id: string): Promise<MedicationStockItem[]> {
  return deleteSynced<MedicationStockItem>(memberId, 'stock', STOCK_KEY(memberId), id);
}

export async function updateStockItem(
  memberId: string,
  id: string,
  patch: Partial<MedicationStockItem>,
): Promise<MedicationStockItem[]> {
  return updateSynced<MedicationStockItem>(memberId, 'stock', STOCK_KEY(memberId), id, patch);
}

export function daysOfStockLeft(item: MedicationStockItem): number | null {
  if (item.dailyUsage <= 0) return null;
  return Math.floor(item.quantityRemaining / item.dailyUsage);
}

export function isLowStock(item: MedicationStockItem): boolean {
  return item.quantityRemaining <= item.lowStockThreshold;
}

// ---------------------------------------------------------------------------
// Daily Routine
// ---------------------------------------------------------------------------

export type RoutineType = 'wakeup' | 'sleep' | 'walk' | 'custom';

export interface RoutineItem {
  id: string;
  type: RoutineType;
  label: string;
  /** "HH:MM AM/PM" */
  time: string;
  /**
   * Days of week this repeats on, 0=Sun..6=Sat. Empty = every day.
   *
   * Matches `CheckinItem.days` deliberately, so both kinds share one scheduling
   * path in `family-reminders.ts`. Optional because records written by earlier
   * builds have no such field; readers must treat `undefined` as "every day"
   * rather than "no days", or every existing routine would stop firing.
   */
  days?: number[];
  enabled: boolean;
  /** ISO dates (YYYY-MM-DD) marked done, for compliance % and streaks. */
  completedDates?: string[];
  createdAt: string;
}

const ROUTINE_KEY = (memberId: string) => `@lifewise_family_routine_${memberId}`;

/** Percentage of the last 7 days this routine was marked done, for the PRD's "Weekly Compliance %". */
export function routineWeeklyCompliance(item: RoutineItem): number {
  const dates = item.completedDates ?? [];
  if (dates.length === 0) return 0;
  const sevenDaysAgo = Date.now() - 7 * 86400000;
  const recent = dates.filter((d) => new Date(d).getTime() >= sevenDaysAgo);
  return Math.round((recent.length / 7) * 100);
}

export const ROUTINE_TYPE_LABELS: Record<RoutineType, { label: string; icon: string }> = {
  wakeup: { label: 'Wake-up', icon: 'sunny' },
  sleep: { label: 'Sleep', icon: 'moon' },
  walk: { label: 'Walking', icon: 'walk' },
  custom: { label: 'Custom', icon: 'time' },
};

export async function loadRoutines(memberId: string): Promise<RoutineItem[]> {
  return loadSynced<RoutineItem>(memberId, 'routines', ROUTINE_KEY(memberId));
}

export async function saveRoutines(memberId: string, items: RoutineItem[]): Promise<void> {
  await saveLocal(ROUTINE_KEY(memberId), items);
}

export async function addRoutine(
  memberId: string,
  data: Omit<RoutineItem, 'id' | 'createdAt' | 'enabled'>,
): Promise<RoutineItem> {
  const items = await loadCached<RoutineItem>(ROUTINE_KEY(memberId));
  const record: RoutineItem = { ...data, id: generateId(), enabled: true, createdAt: new Date().toISOString() };
  // Routines append rather than prepend — the list reads as a day's schedule,
  // so a new entry belongs at the end.
  await saveLocal(ROUTINE_KEY(memberId), [...items, record]);
  await pushCreate(memberId, 'routines', record);
  return record;
}

export async function toggleRoutine(memberId: string, id: string): Promise<RoutineItem[]> {
  const items = await loadCached<RoutineItem>(ROUTINE_KEY(memberId));
  const current = items.find((r) => r.id === id);
  return updateSynced<RoutineItem>(memberId, 'routines', ROUTINE_KEY(memberId), id, {
    enabled: !current?.enabled,
  });
}

export async function deleteRoutine(memberId: string, id: string): Promise<RoutineItem[]> {
  return deleteSynced<RoutineItem>(memberId, 'routines', ROUTINE_KEY(memberId), id);
}

/** Marks today complete for a routine item (PRD: "Completion Tracking — Tap to mark done"). */
export async function markRoutineDoneToday(memberId: string, id: string): Promise<RoutineItem[]> {
  const items = await loadCached<RoutineItem>(ROUTINE_KEY(memberId));
  const current = items.find((r) => r.id === id);
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const dates = current?.completedDates ?? [];
  if (dates.includes(today)) return items; // already marked today
  return updateSynced<RoutineItem>(memberId, 'routines', ROUTINE_KEY(memberId), id, {
    completedDates: [...dates, today].slice(-90), // keep a rolling ~3 months
  });
}

export async function updateRoutine(
  memberId: string,
  id: string,
  patch: Partial<RoutineItem>,
): Promise<RoutineItem[]> {
  return updateSynced<RoutineItem>(memberId, 'routines', ROUTINE_KEY(memberId), id, patch);
}

// ---------------------------------------------------------------------------
// Bill Management (per family member — electricity, medical, insurance bills)
// ---------------------------------------------------------------------------

export type FamilyBillCategory =
  | 'electricity'
  | 'gas'
  | 'water'
  | 'internet'
  | 'mobile_postpaid'
  | 'cable_tv'
  | 'society_maintenance'
  | 'rent'
  | 'loan_emi'
  | 'credit_card'
  | 'medical'
  | 'insurance'
  | 'other';

export type BillPaymentMethod = 'upi' | 'net_banking' | 'credit_card' | 'auto_debit' | 'cash';

export interface FamilyBill {
  id: string;
  name: string;
  amount: number;
  dueDate: string; // ISO
  category: FamilyBillCategory;
  accountNumber?: string;
  paymentMethod?: BillPaymentMethod;
  /** Days before dueDate to fire the primary reminder. */
  reminderDaysBefore?: number;
  /** Extra reminder on the due date itself, per the PRD's "Additional Reminder" toggle. */
  dayOfReminderEnabled?: boolean;
  isPaid: boolean;
  createdAt: string;
}

const FAMILY_BILL_KEY = (memberId: string) => `@lifewise_family_bills_${memberId}`;

export async function loadFamilyBills(memberId: string): Promise<FamilyBill[]> {
  return loadSynced<FamilyBill>(memberId, 'bills', FAMILY_BILL_KEY(memberId));
}

export async function saveFamilyBills(memberId: string, items: FamilyBill[]): Promise<void> {
  await saveLocal(FAMILY_BILL_KEY(memberId), items);
}

export async function addFamilyBill(
  memberId: string,
  data: Omit<FamilyBill, 'id' | 'createdAt' | 'isPaid'>,
): Promise<FamilyBill> {
  const record: FamilyBill = { ...data, id: generateId(), isPaid: false, createdAt: new Date().toISOString() };
  return addSynced(memberId, 'bills', FAMILY_BILL_KEY(memberId), record);
}

export async function toggleFamilyBillPaid(memberId: string, id: string): Promise<FamilyBill[]> {
  const items = await loadCached<FamilyBill>(FAMILY_BILL_KEY(memberId));
  const current = items.find((b) => b.id === id);
  return updateSynced<FamilyBill>(memberId, 'bills', FAMILY_BILL_KEY(memberId), id, {
    isPaid: !current?.isPaid,
  });
}

export async function deleteFamilyBill(memberId: string, id: string): Promise<FamilyBill[]> {
  return deleteSynced<FamilyBill>(memberId, 'bills', FAMILY_BILL_KEY(memberId), id);
}

export async function updateFamilyBill(
  memberId: string,
  id: string,
  patch: Partial<FamilyBill>,
): Promise<FamilyBill[]> {
  return updateSynced<FamilyBill>(memberId, 'bills', FAMILY_BILL_KEY(memberId), id, patch);
}

// ---------------------------------------------------------------------------
// Subscription Tracking
// ---------------------------------------------------------------------------

export type SubscriptionCategory = 'entertainment' | 'productivity' | 'health' | 'education' | 'other';
export type SubscriptionPaymentMethod = 'upi' | 'net_banking' | 'credit_card' | 'debit_card' | 'other';

export interface FamilySubscription {
  id: string;
  serviceName: string;
  planType?: string;
  amount: number;
  renewalDate: string; // ISO
  cycle: 'monthly' | 'quarterly' | 'yearly';
  autoRenews?: boolean;
  paymentMethod?: SubscriptionPaymentMethod;
  /** Days before renewal to fire the reminder. */
  reminderDaysBefore?: number;
  category: SubscriptionCategory;
  createdAt: string;
}

const SUB_KEY = (memberId: string) => `@lifewise_family_subscriptions_${memberId}`;

export async function loadSubscriptions(memberId: string): Promise<FamilySubscription[]> {
  return loadSynced<FamilySubscription>(memberId, 'subscriptions', SUB_KEY(memberId));
}

export async function saveSubscriptions(memberId: string, items: FamilySubscription[]): Promise<void> {
  await saveLocal(SUB_KEY(memberId), items);
}

export async function addSubscription(
  memberId: string,
  data: Omit<FamilySubscription, 'id' | 'createdAt'>,
): Promise<FamilySubscription> {
  const record: FamilySubscription = { ...data, id: generateId(), createdAt: new Date().toISOString() };
  return addSynced(memberId, 'subscriptions', SUB_KEY(memberId), record);
}

export async function deleteSubscription(memberId: string, id: string): Promise<FamilySubscription[]> {
  return deleteSynced<FamilySubscription>(memberId, 'subscriptions', SUB_KEY(memberId), id);
}

export async function updateSubscription(
  memberId: string,
  id: string,
  patch: Partial<FamilySubscription>,
): Promise<FamilySubscription[]> {
  return updateSynced<FamilySubscription>(memberId, 'subscriptions', SUB_KEY(memberId), id, patch);
}

/** Days until renewal; negative means overdue. */
export function daysUntilRenewal(sub: FamilySubscription): number {
  const diff = new Date(sub.renewalDate).getTime() - Date.now();
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
}

// ---------------------------------------------------------------------------
// Expense Tracking (per family member)
// ---------------------------------------------------------------------------

export interface FamilyExpense {
  id: string;
  description: string;
  amount: number;
  date: string; // ISO
  category: 'food' | 'shopping' | 'transport' | 'health' | 'other';
  createdAt: string;
}

const EXPENSE_KEY = (memberId: string) => `@lifewise_family_expenses_${memberId}`;

export async function loadFamilyExpenses(memberId: string): Promise<FamilyExpense[]> {
  const items = await loadSynced<FamilyExpense>(memberId, 'expenses', EXPENSE_KEY(memberId));
  // Newest first — sorted on read since the server returns insertion order.
  return items.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
}

export async function saveFamilyExpenses(memberId: string, items: FamilyExpense[]): Promise<void> {
  await saveLocal(EXPENSE_KEY(memberId), items);
}

export async function addFamilyExpense(
  memberId: string,
  data: Omit<FamilyExpense, 'id' | 'createdAt'>,
): Promise<FamilyExpense> {
  const record: FamilyExpense = { ...data, id: generateId(), createdAt: new Date().toISOString() };
  return addSynced(memberId, 'expenses', EXPENSE_KEY(memberId), record);
}

export async function deleteFamilyExpense(memberId: string, id: string): Promise<FamilyExpense[]> {
  return deleteSynced<FamilyExpense>(memberId, 'expenses', EXPENSE_KEY(memberId), id);
}

export async function updateFamilyExpense(
  memberId: string,
  id: string,
  patch: Partial<FamilyExpense>,
): Promise<FamilyExpense[]> {
  return updateSynced<FamilyExpense>(memberId, 'expenses', EXPENSE_KEY(memberId), id, patch);
}

export function totalThisMonth(expenses: FamilyExpense[]): number {
  const now = new Date();
  return expenses
    .filter((e) => {
      const d = new Date(e.date);
      return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
    })
    .reduce((sum, e) => sum + e.amount, 0);
}

// ---------------------------------------------------------------------------
// Reminder Tasks (general daily tasks, distinct from bills/medicine)
// ---------------------------------------------------------------------------

export interface FamilyTask {
  id: string;
  title: string;
  dueDate?: string | null; // ISO, optional
  completed: boolean;
  createdAt: string;
}

const TASK_KEY = (memberId: string) => `@lifewise_family_tasks_${memberId}`;

export async function loadFamilyTasks(memberId: string): Promise<FamilyTask[]> {
  return loadSynced<FamilyTask>(memberId, 'tasks', TASK_KEY(memberId));
}

export async function saveFamilyTasks(memberId: string, items: FamilyTask[]): Promise<void> {
  await saveLocal(TASK_KEY(memberId), items);
}

export async function addFamilyTask(
  memberId: string,
  data: Omit<FamilyTask, 'id' | 'createdAt' | 'completed'>,
): Promise<FamilyTask> {
  const record: FamilyTask = { ...data, id: generateId(), completed: false, createdAt: new Date().toISOString() };
  return addSynced(memberId, 'tasks', TASK_KEY(memberId), record);
}

export async function toggleFamilyTask(memberId: string, id: string): Promise<FamilyTask[]> {
  const items = await loadCached<FamilyTask>(TASK_KEY(memberId));
  const current = items.find((t) => t.id === id);
  return updateSynced<FamilyTask>(memberId, 'tasks', TASK_KEY(memberId), id, {
    completed: !current?.completed,
  });
}

export async function deleteFamilyTask(memberId: string, id: string): Promise<FamilyTask[]> {
  return deleteSynced<FamilyTask>(memberId, 'tasks', TASK_KEY(memberId), id);
}

export async function updateFamilyTask(
  memberId: string,
  id: string,
  patch: Partial<FamilyTask>,
): Promise<FamilyTask[]> {
  return updateSynced<FamilyTask>(memberId, 'tasks', TASK_KEY(memberId), id, patch);
}

// ---------------------------------------------------------------------------
// Insurance & Documents
// ---------------------------------------------------------------------------

export type FamilyDocumentType =
  | 'aadhaar'
  | 'pan'
  | 'passport'
  | 'driving_license'
  | 'birth_certificate'
  | 'marriage_certificate'
  | 'property'
  | 'vehicle_rc'
  | 'insurance'
  | 'medical'
  | 'other';

export type DocumentExpiryReminderLead = '6_months' | '3_months' | '1_month';

export interface FamilyDocument {
  id: string;
  title: string;
  type: FamilyDocumentType;
  documentNumber?: string;
  issueDate?: string | null; // ISO
  expiryDate?: string | null; // ISO
  expiryReminderLead?: DocumentExpiryReminderLead;
  /** Policy/renewal reminder date, if applicable — kept for back-compat with
   * records saved before expiryDate/expiryReminderLead existed. */
  reminderDate?: string | null; // ISO
  notes?: string;
  createdAt: string;
}

const DOC_KEY = (memberId: string) => `@lifewise_family_documents_${memberId}`;

export const DOCUMENT_TYPE_LABELS: Record<FamilyDocumentType, { label: string; icon: string }> = {
  aadhaar: { label: 'Aadhaar Card', icon: 'card' },
  pan: { label: 'PAN Card', icon: 'card' },
  passport: { label: 'Passport', icon: 'airplane' },
  driving_license: { label: 'Driving License', icon: 'car' },
  birth_certificate: { label: 'Birth Certificate', icon: 'document-text' },
  marriage_certificate: { label: 'Marriage Certificate', icon: 'document-text' },
  property: { label: 'Property Documents', icon: 'home' },
  vehicle_rc: { label: 'Vehicle RC', icon: 'car-sport' },
  insurance: { label: 'Insurance Policy', icon: 'shield-checkmark' },
  medical: { label: 'Medical Record', icon: 'medkit' },
  other: { label: 'Other', icon: 'document' },
};

export async function loadFamilyDocuments(memberId: string): Promise<FamilyDocument[]> {
  return loadSynced<FamilyDocument>(memberId, 'documents', DOC_KEY(memberId));
}

export async function saveFamilyDocuments(memberId: string, items: FamilyDocument[]): Promise<void> {
  await saveLocal(DOC_KEY(memberId), items);
}

export async function addFamilyDocument(
  memberId: string,
  data: Omit<FamilyDocument, 'id' | 'createdAt'>,
): Promise<FamilyDocument> {
  const record: FamilyDocument = { ...data, id: generateId(), createdAt: new Date().toISOString() };
  return addSynced(memberId, 'documents', DOC_KEY(memberId), record);
}

export async function deleteFamilyDocument(memberId: string, id: string): Promise<FamilyDocument[]> {
  return deleteSynced<FamilyDocument>(memberId, 'documents', DOC_KEY(memberId), id);
}

export async function updateFamilyDocument(
  memberId: string,
  id: string,
  patch: Partial<FamilyDocument>,
): Promise<FamilyDocument[]> {
  return updateSynced<FamilyDocument>(memberId, 'documents', DOC_KEY(memberId), id, patch);
}

// ---------------------------------------------------------------------------
// Call & Check-in
// ---------------------------------------------------------------------------

export type CheckinFrequency = 'daily' | 'every_2_days' | 'weekly' | 'custom';
export type CheckinCallType = 'regular_call' | 'video_call' | 'whatsapp_call';

export interface CheckinItem {
  id: string;
  label: string;
  /** "HH:MM AM/PM" */
  time: string;
  /** Days of week this repeats on, 0=Sun..6=Sat. Empty = every day. */
  days: number[];
  frequency?: CheckinFrequency;
  callType?: CheckinCallType;
  contactNumber?: string;
  /** PRD: follow-up alert if not marked "Called" within 2 hours of the scheduled time. */
  missedCallAlertEnabled?: boolean;
  enabled: boolean;
  lastDoneAt?: string | null;
  createdAt: string;
}

const CHECKIN_KEY = (memberId: string) => `@lifewise_family_checkins_${memberId}`;

export async function loadCheckins(memberId: string): Promise<CheckinItem[]> {
  return loadSynced<CheckinItem>(memberId, 'checkins', CHECKIN_KEY(memberId));
}

export async function saveCheckins(memberId: string, items: CheckinItem[]): Promise<void> {
  await saveLocal(CHECKIN_KEY(memberId), items);
}

export async function addCheckin(
  memberId: string,
  data: Omit<CheckinItem, 'id' | 'createdAt' | 'enabled' | 'lastDoneAt'>,
): Promise<CheckinItem> {
  const items = await loadCached<CheckinItem>(CHECKIN_KEY(memberId));
  const record: CheckinItem = { ...data, id: generateId(), enabled: true, lastDoneAt: null, createdAt: new Date().toISOString() };
  // Appended, like routines — the list reads as a daily schedule.
  await saveLocal(CHECKIN_KEY(memberId), [...items, record]);
  await pushCreate(memberId, 'checkins', record);
  return record;
}

export async function markCheckinDone(memberId: string, id: string): Promise<CheckinItem[]> {
  // Shared state: a caregiver marking the check-in done must clear it for the
  // owner too, so this syncs rather than staying on one device.
  return updateSynced<CheckinItem>(memberId, 'checkins', CHECKIN_KEY(memberId), id, {
    lastDoneAt: new Date().toISOString(),
  });
}

export async function toggleCheckin(memberId: string, id: string): Promise<CheckinItem[]> {
  const items = await loadCached<CheckinItem>(CHECKIN_KEY(memberId));
  const current = items.find((c) => c.id === id);
  return updateSynced<CheckinItem>(memberId, 'checkins', CHECKIN_KEY(memberId), id, {
    enabled: !current?.enabled,
  });
}

/** PRD: "If not marked 'Called' within 2 hours, send follow-up reminder." */
export function isCheckinMissed(item: CheckinItem): boolean {
  if (!item.missedCallAlertEnabled || !item.enabled) return false;
  const parts = /^(\d{1,2}):(\d{2})\s*(AM|PM)$/i.exec(item.time?.trim() ?? '');
  if (!parts) return false;
  let hours = Number(parts[1]) % 12;
  if (parts[3].toUpperCase() === 'PM') hours += 12;
  const scheduled = new Date();
  scheduled.setHours(hours, Number(parts[2]), 0, 0);
  if (scheduled.getTime() > Date.now()) return false; // not due yet today
  const doneToday = item.lastDoneAt && new Date(item.lastDoneAt).toDateString() === new Date().toDateString();
  if (doneToday) return false;
  return (Date.now() - scheduled.getTime()) / (1000 * 60 * 60) >= 2;
}

export async function deleteCheckin(memberId: string, id: string): Promise<CheckinItem[]> {
  return deleteSynced<CheckinItem>(memberId, 'checkins', CHECKIN_KEY(memberId), id);
}

export async function updateCheckin(
  memberId: string,
  id: string,
  patch: Partial<CheckinItem>,
): Promise<CheckinItem[]> {
  return updateSynced<CheckinItem>(memberId, 'checkins', CHECKIN_KEY(memberId), id, patch);
}

// ---------------------------------------------------------------------------
// Travel & Visits
// ---------------------------------------------------------------------------

export type TravelType = 'doctor_visit' | 'family_visit' | 'trip';

export type TravelRecurrence = 'weekly' | 'monthly' | 'yearly';

export interface TravelItem {
  id: string;
  type: TravelType;
  title: string;
  date: string; // ISO — visit date + time combined
  location?: string;
  notes?: string;
  isRecurring?: boolean;
  recurrence?: TravelRecurrence;
  /** Hours before the visit to fire the reminder. */
  reminderHoursBefore?: number;
  /** For trips: when the traveller returns. */
  returnDate?: string | null; // ISO
  /** Other family member ids also travelling/visiting. */
  companionMemberIds?: string[];
  completed: boolean;
  createdAt: string;
}

const TRAVEL_KEY = (memberId: string) => `@lifewise_family_travel_${memberId}`;

export const TRAVEL_TYPE_LABELS: Record<TravelType, { label: string; icon: string }> = {
  doctor_visit: { label: 'Doctor Visit', icon: 'medkit' },
  family_visit: { label: 'Family Visit', icon: 'people' },
  trip: { label: 'Trip', icon: 'airplane' },
};

export async function loadTravelItems(memberId: string): Promise<TravelItem[]> {
  return loadSynced<TravelItem>(memberId, 'travel', TRAVEL_KEY(memberId));
}

export async function saveTravelItems(memberId: string, items: TravelItem[]): Promise<void> {
  await saveLocal(TRAVEL_KEY(memberId), items);
}

export async function addTravelItem(
  memberId: string,
  data: Omit<TravelItem, 'id' | 'createdAt' | 'completed'>,
): Promise<TravelItem> {
  const record: TravelItem = { ...data, id: generateId(), completed: false, createdAt: new Date().toISOString() };
  return addSynced(memberId, 'travel', TRAVEL_KEY(memberId), record);
}

export async function toggleTravelItem(memberId: string, id: string): Promise<TravelItem[]> {
  const items = await loadCached<TravelItem>(TRAVEL_KEY(memberId));
  const current = items.find((t) => t.id === id);
  return updateSynced<TravelItem>(memberId, 'travel', TRAVEL_KEY(memberId), id, {
    completed: !current?.completed,
  });
}

export async function deleteTravelItem(memberId: string, id: string): Promise<TravelItem[]> {
  return deleteSynced<TravelItem>(memberId, 'travel', TRAVEL_KEY(memberId), id);
}

export async function updateTravelItem(
  memberId: string,
  id: string,
  patch: Partial<TravelItem>,
): Promise<TravelItem[]> {
  return updateSynced<TravelItem>(memberId, 'travel', TRAVEL_KEY(memberId), id, patch);
}

// ---------------------------------------------------------------------------
// Emergency Alerts
//
// Two pieces, per the product spec:
//  1. "Notify family if medicine is missed" / "no activity detected" —
//     detection logic below runs ON-DEVICE and fires a local notification.
//     This genuinely works today, no backend needed.
//  2. Actually delivering that alert to *other* family members' phones needs
//     server-side push notifications (this device doesn't have their push
//     token). That half is out of scope for local storage and is documented
//     for the backend team in Phase 5.
// ---------------------------------------------------------------------------

export interface EmergencySettings {
  missedMedicineAlertEnabled: boolean;
  /** Hours after a missed dose before treating it as an emergency. */
  missedMedicineThresholdHours: number;
  noActivityAlertEnabled: boolean;
  /** Days with zero logged activity (medicine/health/checkin) before alerting. */
  noActivityThresholdDays: number;
}

const EMERGENCY_SETTINGS_KEY = (memberId: string) => `@lifewise_family_emergency_${memberId}`;
const EMERGENCY_LOG_KEY = (memberId: string) => `@lifewise_family_emergency_log_${memberId}`;

export const DEFAULT_EMERGENCY_SETTINGS: EmergencySettings = {
  missedMedicineAlertEnabled: true,
  missedMedicineThresholdHours: 4,
  noActivityAlertEnabled: true,
  noActivityThresholdDays: 2,
};

export interface EmergencyLogEntry {
  id: string;
  kind: 'missed_medicine' | 'no_activity';
  message: string;
  createdAt: string;
  acknowledged: boolean;
}

export async function loadEmergencySettings(memberId: string): Promise<EmergencySettings> {
  try {
    const raw = await AsyncStorage.getItem(EMERGENCY_SETTINGS_KEY(memberId));
    return raw ? { ...DEFAULT_EMERGENCY_SETTINGS, ...JSON.parse(raw) } : { ...DEFAULT_EMERGENCY_SETTINGS };
  } catch {
    return { ...DEFAULT_EMERGENCY_SETTINGS };
  }
}

export async function saveEmergencySettings(memberId: string, settings: EmergencySettings): Promise<void> {
  await AsyncStorage.setItem(EMERGENCY_SETTINGS_KEY(memberId), JSON.stringify(settings));
}

export async function loadEmergencyLog(memberId: string): Promise<EmergencyLogEntry[]> {
  try {
    const raw = await AsyncStorage.getItem(EMERGENCY_LOG_KEY(memberId));
    return raw ? (JSON.parse(raw) as EmergencyLogEntry[]) : [];
  } catch {
    return [];
  }
}

export async function saveEmergencyLog(memberId: string, items: EmergencyLogEntry[]): Promise<void> {
  await AsyncStorage.setItem(EMERGENCY_LOG_KEY(memberId), JSON.stringify(items));
}

export async function addEmergencyLogEntry(
  memberId: string,
  kind: EmergencyLogEntry['kind'],
  message: string,
): Promise<EmergencyLogEntry[]> {
  const items = await loadEmergencyLog(memberId);
  const record: EmergencyLogEntry = { id: generateId(), kind, message, createdAt: new Date().toISOString(), acknowledged: false };
  const next = [record, ...items].slice(0, 50); // keep log bounded
  await saveEmergencyLog(memberId, next);
  return next;
}

export async function acknowledgeEmergencyLogEntry(memberId: string, id: string): Promise<EmergencyLogEntry[]> {
  const items = await loadEmergencyLog(memberId);
  const next = items.map((e) => (e.id === id ? { ...e, acknowledged: true } : e));
  await saveEmergencyLog(memberId, next);
  return next;
}

// ---------------------------------------------------------------------------
// Emergency medical profile (PRD Module 4, added 2026-08-14)
//
// Unlike EmergencySettings above (a per-device alert-threshold preference),
// this is data a caregiver needs to see too — allergies, contacts, blood
// group — so it's synced like every other Family Hub record, not local-only.
// ---------------------------------------------------------------------------

export interface EmergencyContact {
  id: string;
  name: string;
  phone: string;
  relation: string;
}

export interface EmergencyMedicalProfile {
  /** Up to 5, per the PRD. */
  contacts: EmergencyContact[];
  /** Falls back to the member's own bloodGroup field if unset here. */
  bloodGroup?: string;
  knownAllergies?: string;
  existingMedicalConditions?: string;
  currentMedicationsNote?: string;
  doctorName?: string;
  doctorPhone?: string;
  hospitalPreference?: string;
  insurancePolicyNumber?: string;
}

const EMERGENCY_PROFILE_KEY = (memberId: string) => `@lifewise_family_emergency_profile_${memberId}`;

const EMPTY_EMERGENCY_PROFILE: EmergencyMedicalProfile = { contacts: [] };

/** Same single-profile-per-member sync pattern as Study/Diet — see their comments. */
export async function loadEmergencyMedicalProfile(memberId: string): Promise<EmergencyMedicalProfile> {
  const remote = await loadSynced<EmergencyMedicalProfile>(memberId, 'emergencyProfile', EMERGENCY_PROFILE_KEY(memberId));
  if (remote && remote.length > 0) return { ...EMPTY_EMERGENCY_PROFILE, ...remote[0] };
  try {
    const raw = await AsyncStorage.getItem(EMERGENCY_PROFILE_KEY(memberId));
    return raw ? { ...EMPTY_EMERGENCY_PROFILE, ...JSON.parse(raw) } : { ...EMPTY_EMERGENCY_PROFILE };
  } catch {
    return { ...EMPTY_EMERGENCY_PROFILE };
  }
}

export async function saveEmergencyMedicalProfile(memberId: string, profile: EmergencyMedicalProfile): Promise<void> {
  await saveLocal(EMERGENCY_PROFILE_KEY(memberId), [{ ...profile, id: memberId }] as unknown as EmergencyMedicalProfile[]);
  await pushCreate(memberId, 'emergencyProfile', { id: memberId, ...profile } as unknown as { id: string });
}

/**
 * Checks a member's medicines for any dose that's overdue by more than the
 * configured threshold and hasn't been logged as taken today. Returns the
 * medicine names currently considered "missed."
 */
export function findMissedMedicines(
  medicines: Array<{ name: string; lastStatus?: string; lastTakenAt?: string | null; slots?: { morning?: string | null; noon?: string | null; evening?: string | null } }>,
  thresholdHours: number,
): string[] {
  const now = new Date();
  const missed: string[] = [];

  medicines.forEach((med) => {
    if (!med.slots) return;
    const slotTimes = [med.slots.morning, med.slots.noon, med.slots.evening].filter(Boolean) as string[];
    if (slotTimes.length === 0) return;

    const takenRecently =
      !!med.lastTakenAt &&
      med.lastStatus === 'taken' &&
      (now.getTime() - new Date(med.lastTakenAt).getTime()) / (1000 * 60 * 60) < 24;

    if (takenRecently) return;

    // If any of today's slot times has passed by more than the threshold,
    // and it hasn't been marked taken recently, flag it.
    const isOverdue = slotTimes.some((slotTime) => {
      const parsed = parseSlotTimeToday(slotTime);
      if (!parsed) return false;
      const hoursSince = (now.getTime() - parsed.getTime()) / (1000 * 60 * 60);
      return hoursSince > thresholdHours;
    });

    if (isOverdue) missed.push(med.name);
  });

  return missed;
}

function parseSlotTimeToday(slotTime: string): Date | null {
  const match = /^(\d{1,2}):(\d{2})\s*(AM|PM)$/i.exec(slotTime.trim());
  if (!match) return null;
  let hours = parseInt(match[1], 10);
  const minutes = parseInt(match[2], 10);
  const isPM = match[3].toUpperCase() === 'PM';
  if (isPM && hours !== 12) hours += 12;
  if (!isPM && hours === 12) hours = 0;
  const result = new Date();
  result.setHours(hours, minutes, 0, 0);
  return result;
}

// ---------------------------------------------------------------------------
// Custom Feature (user-defined tracker)
// ---------------------------------------------------------------------------

export type CustomFieldType = 'text' | 'date' | 'time' | 'number';

export interface CustomFieldDef {
  id: string;
  label: string;
  type: CustomFieldType;
}

export interface CustomFeatureConfig {
  /** User-chosen name for this custom tracker, e.g. "Physiotherapy Sessions". */
  name: string;
  icon: string;
  /** User-defined fields (PRD: "label + value type: text/date/time/number"). */
  customFields?: CustomFieldDef[];
  reminderEnabled?: boolean;
  /** "HH:MM AM/PM" for the custom reminder time. */
  reminderTime?: string;
  frequency?: 'daily' | 'weekly' | 'monthly' | 'custom';
}

export interface CustomTrackerItem {
  id: string;
  title: string;
  date: string; // ISO
  completed: boolean;
  /** Keyed by CustomFieldDef.id. */
  fieldValues?: Record<string, string>;
  createdAt: string;
}

const CUSTOM_CONFIG_KEY = (memberId: string) => `@lifewise_family_custom_config_${memberId}`;
const CUSTOM_ITEMS_KEY = (memberId: string) => `@lifewise_family_custom_items_${memberId}`;

export async function loadCustomConfig(memberId: string): Promise<CustomFeatureConfig | null> {
  try {
    const raw = await AsyncStorage.getItem(CUSTOM_CONFIG_KEY(memberId));
    return raw ? (JSON.parse(raw) as CustomFeatureConfig) : null;
  } catch {
    return null;
  }
}

export async function saveCustomConfig(memberId: string, config: CustomFeatureConfig): Promise<void> {
  await AsyncStorage.setItem(CUSTOM_CONFIG_KEY(memberId), JSON.stringify(config));
}

export async function loadCustomItems(memberId: string): Promise<CustomTrackerItem[]> {
  try {
    const raw = await AsyncStorage.getItem(CUSTOM_ITEMS_KEY(memberId));
    return raw ? (JSON.parse(raw) as CustomTrackerItem[]) : [];
  } catch {
    return [];
  }
}

export async function saveCustomItems(memberId: string, items: CustomTrackerItem[]): Promise<void> {
  await AsyncStorage.setItem(CUSTOM_ITEMS_KEY(memberId), JSON.stringify(items));
}

export async function addCustomItem(
  memberId: string,
  title: string,
  fieldValues?: Record<string, string>,
): Promise<CustomTrackerItem> {
  const items = await loadCustomItems(memberId);
  const record: CustomTrackerItem = { id: generateId(), title, completed: false, date: new Date().toISOString(), fieldValues, createdAt: new Date().toISOString() };
  await saveCustomItems(memberId, [record, ...items]);
  return record;
}

export async function toggleCustomItem(memberId: string, id: string): Promise<CustomTrackerItem[]> {
  const items = await loadCustomItems(memberId);
  const next = items.map((i) => (i.id === id ? { ...i, completed: !i.completed } : i));
  await saveCustomItems(memberId, next);
  return next;
}

export async function deleteCustomItem(memberId: string, id: string): Promise<CustomTrackerItem[]> {
  const items = await loadCustomItems(memberId);
  const next = items.filter((i) => i.id !== id);
  await saveCustomItems(memberId, next);
  return next;
}

// ---------------------------------------------------------------------------
// Diet & Meal Planning (PRD Module 12)
// ---------------------------------------------------------------------------

export type DietType = 'normal' | 'diabetic' | 'low_salt' | 'low_fat' | 'vegetarian' | 'vegan' | 'custom';

export const DIET_TYPE_LABELS: Record<DietType, string> = {
  normal: 'Normal',
  diabetic: 'Diabetic',
  low_salt: 'Low Salt',
  low_fat: 'Low Fat',
  vegetarian: 'Vegetarian',
  vegan: 'Vegan',
  custom: 'Custom',
};

export type MealSlot = 'breakfast' | 'lunch' | 'evening_snack' | 'dinner';

export interface MealPlanEntry {
  /** "HH:MM AM/PM" */
  time: string;
  notes?: string;
  reminderEnabled: boolean;
}

/** Optional day-wise structured plan, PRD: "Weekly Meal Plan — Day-wise table (optional)". */
export interface WeeklyMealPlanDay {
  day: number; // 0=Sun..6=Sat
  meals: Partial<Record<MealSlot, string>>;
}

export interface DietProfile {
  dietType: DietType;
  customDietName?: string;
  meals: Partial<Record<MealSlot, MealPlanEntry>>;
  dailyCalorieTarget?: number | null;
  foodRestrictions?: string;
  waterIntakeReminderEnabled: boolean;
  waterIntakeReminderHourly?: number;
  doctorNotes?: string;
  weeklyPlan: WeeklyMealPlanDay[];
}

const DIET_PROFILE_KEY = (memberId: string) => `@lifewise_family_diet_profile_${memberId}`;

const EMPTY_DIET_PROFILE: DietProfile = {
  dietType: 'normal',
  meals: {},
  waterIntakeReminderEnabled: false,
  weeklyPlan: [],
};

/** Same single-profile-per-member pattern as Study & Education — see its comment. */
export async function loadDietProfile(memberId: string): Promise<DietProfile> {
  const remote = await loadSynced<DietProfile>(memberId, 'diet', DIET_PROFILE_KEY(memberId));
  if (remote && remote.length > 0) return { ...EMPTY_DIET_PROFILE, ...remote[0] };
  try {
    const raw = await AsyncStorage.getItem(DIET_PROFILE_KEY(memberId));
    return raw ? { ...EMPTY_DIET_PROFILE, ...JSON.parse(raw) } : { ...EMPTY_DIET_PROFILE };
  } catch {
    return { ...EMPTY_DIET_PROFILE };
  }
}

export async function saveDietProfile(memberId: string, profile: DietProfile): Promise<void> {
  await saveLocal(DIET_PROFILE_KEY(memberId), [{ ...profile, id: memberId }] as unknown as DietProfile[]);
  await pushCreate(memberId, 'diet', { id: memberId, ...profile } as unknown as { id: string });
}

// ---------------------------------------------------------------------------
// Fitness Tracking (PRD Module 15)
// ---------------------------------------------------------------------------

export type WorkoutType = 'walking' | 'running' | 'yoga' | 'gym' | 'swimming' | 'cycling' | 'other';

export const WORKOUT_TYPE_LABELS: Record<WorkoutType, { label: string; icon: string }> = {
  walking: { label: 'Walking', icon: 'walk' },
  running: { label: 'Running', icon: 'walk' },
  yoga: { label: 'Yoga', icon: 'body' },
  gym: { label: 'Gym', icon: 'barbell' },
  swimming: { label: 'Swimming', icon: 'water' },
  cycling: { label: 'Cycling', icon: 'bicycle' },
  other: { label: 'Other', icon: 'fitness' },
};

export interface FitnessItem {
  id: string;
  workoutType: WorkoutType;
  /** Days of week this repeats on, 0=Sun..6=Sat. Empty = every day. */
  days: number[];
  /** "HH:MM AM/PM" */
  time: string;
  durationGoalMinutes?: number | null;
  stepCountGoal?: number | null;
  isRestDay?: boolean;
  notes?: string;
  reminderEnabled: boolean;
  /** Consecutive days completed, most recent streak. */
  streak: number;
  lastDoneAt?: string | null;
  createdAt: string;
}

const FITNESS_KEY = (memberId: string) => `@lifewise_family_fitness_${memberId}`;

export async function loadFitnessItems(memberId: string): Promise<FitnessItem[]> {
  return loadSynced<FitnessItem>(memberId, 'fitness', FITNESS_KEY(memberId));
}

export async function saveFitnessItems(memberId: string, items: FitnessItem[]): Promise<void> {
  await saveLocal(FITNESS_KEY(memberId), items);
}

export async function addFitnessItem(
  memberId: string,
  data: Omit<FitnessItem, 'id' | 'createdAt' | 'streak' | 'lastDoneAt'>,
): Promise<FitnessItem> {
  const record: FitnessItem = { ...data, id: generateId(), streak: 0, lastDoneAt: null, createdAt: new Date().toISOString() };
  return addSynced(memberId, 'fitness', FITNESS_KEY(memberId), record);
}

export async function markFitnessDone(memberId: string, id: string): Promise<FitnessItem[]> {
  const items = await loadCached<FitnessItem>(FITNESS_KEY(memberId));
  const current = items.find((f) => f.id === id);
  const today = new Date().toDateString();
  const lastDone = current?.lastDoneAt ? new Date(current.lastDoneAt).toDateString() : null;
  const yesterday = new Date(Date.now() - 86400000).toDateString();
  // Consecutive-day streak: continues only if the last completion was yesterday,
  // resets to 1 if there was a gap, and is a no-op if already done today.
  const nextStreak = lastDone === today ? (current?.streak ?? 0) : lastDone === yesterday ? (current?.streak ?? 0) + 1 : 1;
  return updateSynced<FitnessItem>(memberId, 'fitness', FITNESS_KEY(memberId), id, {
    lastDoneAt: new Date().toISOString(),
    streak: nextStreak,
  });
}

export async function deleteFitnessItem(memberId: string, id: string): Promise<FitnessItem[]> {
  return deleteSynced<FitnessItem>(memberId, 'fitness', FITNESS_KEY(memberId), id);
}

export async function updateFitnessItem(
  memberId: string,
  id: string,
  patch: Partial<FitnessItem>,
): Promise<FitnessItem[]> {
  return updateSynced<FitnessItem>(memberId, 'fitness', FITNESS_KEY(memberId), id, patch);
}

// ---------------------------------------------------------------------------
// Study & Education (PRD Module 16)
// ---------------------------------------------------------------------------

export type StudyItemType = 'subject' | 'exam' | 'event' | 'fee';

export interface StudySubject {
  id: string;
  name: string;
  /** "HH:MM AM/PM" study-schedule time, one slot per subject (PRD: Day + Time). */
  scheduleDays: number[];
  scheduleTime: string;
  homeworkReminderEnabled: boolean;
  homeworkReminderTime?: string;
  createdAt: string;
}

export interface StudyExam {
  id: string;
  subject: string;
  examDate: string; // ISO
  board?: string;
  /** Reminder lead times in days before the exam, e.g. [7, 3, 1]. */
  reminderDaysBefore: number[];
  createdAt: string;
}

export interface StudyEvent {
  id: string;
  title: string;
  eventDate: string; // ISO
  notes?: string;
  createdAt: string;
}

export interface StudyFee {
  id: string;
  title: string;
  amount: number;
  dueDate: string; // ISO
  isPaid: boolean;
  createdAt: string;
}

export interface StudyProfile {
  grade: string;
  subjects: StudySubject[];
  exams: StudyExam[];
  events: StudyEvent[];
  fees: StudyFee[];
}

const STUDY_PROFILE_KEY = (memberId: string) => `@lifewise_family_study_profile_${memberId}`;

const EMPTY_STUDY_PROFILE: StudyProfile = { grade: '', subjects: [], exams: [], events: [], fees: [] };

/**
 * Study & Education bundles four sub-lists (subjects/exams/events/fees) under
 * one member-level grade. Kept as a single synced record — like Custom
 * Feature's config — rather than four separate `RecordKind`s, since the PRD
 * treats them as one module's internal structure, not independent lists a
 * caregiver would filter separately.
 */
export async function loadStudyProfile(memberId: string): Promise<StudyProfile> {
  const remote = await loadSynced<StudyProfile>(memberId, 'study', STUDY_PROFILE_KEY(memberId));
  // The server returns a list per RecordKind; Study stores its one profile
  // object as the sole item in that list so it can reuse the same sync path.
  if (remote && remote.length > 0) return { ...EMPTY_STUDY_PROFILE, ...remote[0] };
  try {
    const raw = await AsyncStorage.getItem(STUDY_PROFILE_KEY(memberId));
    return raw ? { ...EMPTY_STUDY_PROFILE, ...JSON.parse(raw) } : { ...EMPTY_STUDY_PROFILE };
  } catch {
    return { ...EMPTY_STUDY_PROFILE };
  }
}

export async function saveStudyProfile(memberId: string, profile: StudyProfile): Promise<void> {
  await saveLocal(STUDY_PROFILE_KEY(memberId), [{ ...profile, id: memberId }] as unknown as StudyProfile[]);
  await pushCreate(memberId, 'study', { id: memberId, ...profile } as unknown as { id: string });
}

// ---------------------------------------------------------------------------
// Mental Health & Wellness (PRD Module 17)
// ---------------------------------------------------------------------------

export type MoodValue = 1 | 2 | 3 | 4 | 5;

export interface MoodLog {
  id: string;
  mood: MoodValue;
  note?: string;
  loggedAt: string; // ISO
  createdAt: string;
}

export interface WellnessReminder {
  id: string;
  kind: 'meditation' | 'breathing' | 'journal' | 'self_care' | 'therapy';
  title: string;
  /** "HH:MM AM/PM" for time-based reminders. */
  time?: string;
  /** Frequency in days for breathing-exercise style reminders (PRD: Toggle + Frequency). */
  frequencyDays?: number;
  /** Therapy/counselling session fields (PRD: Date + time + doctor name). */
  sessionDate?: string; // ISO
  doctorName?: string;
  enabled: boolean;
  createdAt: string;
}

const MOOD_LOG_KEY = (memberId: string) => `@lifewise_family_mood_logs_${memberId}`;
const WELLNESS_KEY = (memberId: string) => `@lifewise_family_wellness_${memberId}`;

export async function loadMoodLogs(memberId: string): Promise<MoodLog[]> {
  return loadSynced<MoodLog>(memberId, 'moodLogs', MOOD_LOG_KEY(memberId));
}

export async function addMoodLog(memberId: string, mood: MoodValue, note?: string): Promise<MoodLog> {
  const record: MoodLog = { id: generateId(), mood, note, loggedAt: new Date().toISOString(), createdAt: new Date().toISOString() };
  return addSynced(memberId, 'moodLogs', MOOD_LOG_KEY(memberId), record);
}

export async function deleteMoodLog(memberId: string, id: string): Promise<MoodLog[]> {
  return deleteSynced<MoodLog>(memberId, 'moodLogs', MOOD_LOG_KEY(memberId), id);
}

export async function loadWellnessReminders(memberId: string): Promise<WellnessReminder[]> {
  return loadSynced<WellnessReminder>(memberId, 'wellness', WELLNESS_KEY(memberId));
}

export async function addWellnessReminder(
  memberId: string,
  data: Omit<WellnessReminder, 'id' | 'createdAt' | 'enabled'>,
): Promise<WellnessReminder> {
  const record: WellnessReminder = { ...data, id: generateId(), enabled: true, createdAt: new Date().toISOString() };
  return addSynced(memberId, 'wellness', WELLNESS_KEY(memberId), record);
}

export async function toggleWellnessReminder(memberId: string, id: string): Promise<WellnessReminder[]> {
  const items = await loadCached<WellnessReminder>(WELLNESS_KEY(memberId));
  const current = items.find((w) => w.id === id);
  return updateSynced<WellnessReminder>(memberId, 'wellness', WELLNESS_KEY(memberId), id, {
    enabled: !current?.enabled,
  });
}

export async function deleteWellnessReminder(memberId: string, id: string): Promise<WellnessReminder[]> {
  return deleteSynced<WellnessReminder>(memberId, 'wellness', WELLNESS_KEY(memberId), id);
}

export async function updateWellnessReminder(
  memberId: string,
  id: string,
  patch: Partial<WellnessReminder>,
): Promise<WellnessReminder[]> {
  return updateSynced<WellnessReminder>(memberId, 'wellness', WELLNESS_KEY(memberId), id, patch);
}

// ---------------------------------------------------------------------------
// Vehicle Management (PRD Module 18)
// ---------------------------------------------------------------------------

export type VehicleType = 'car' | 'bike' | 'scooter' | 'other';

export const VEHICLE_TYPE_LABELS: Record<VehicleType, { label: string; icon: string }> = {
  car: { label: 'Car', icon: 'car' },
  bike: { label: 'Bike', icon: 'bicycle' },
  scooter: { label: 'Scooter', icon: 'bicycle' },
  other: { label: 'Other', icon: 'car-sport' },
};

export interface VehicleItem {
  id: string;
  vehicleType: VehicleType;
  name: string;
  registrationNumber?: string;
  insuranceExpiry?: string | null; // ISO
  pucExpiry?: string | null; // ISO
  /** Service can be date-based or KM-based per the PRD; stored as free text when KM-based. */
  serviceDueDate?: string | null; // ISO
  serviceDueNote?: string;
  loanEmiAmount?: number | null;
  loanEmiDueDate?: string | null; // ISO
  createdAt: string;
}

export interface FuelLogEntry {
  id: string;
  vehicleId: string;
  date: string; // ISO
  litres: number;
  cost: number;
  createdAt: string;
}

const VEHICLE_KEY = (memberId: string) => `@lifewise_family_vehicles_${memberId}`;
const FUEL_LOG_KEY = (memberId: string) => `@lifewise_family_fuel_log_${memberId}`;

export async function loadVehicles(memberId: string): Promise<VehicleItem[]> {
  return loadSynced<VehicleItem>(memberId, 'vehicles', VEHICLE_KEY(memberId));
}

export async function addVehicle(
  memberId: string,
  data: Omit<VehicleItem, 'id' | 'createdAt'>,
): Promise<VehicleItem> {
  const record: VehicleItem = { ...data, id: generateId(), createdAt: new Date().toISOString() };
  return addSynced(memberId, 'vehicles', VEHICLE_KEY(memberId), record);
}

export async function deleteVehicle(memberId: string, id: string): Promise<VehicleItem[]> {
  return deleteSynced<VehicleItem>(memberId, 'vehicles', VEHICLE_KEY(memberId), id);
}

export async function updateVehicle(
  memberId: string,
  id: string,
  patch: Partial<VehicleItem>,
): Promise<VehicleItem[]> {
  return updateSynced<VehicleItem>(memberId, 'vehicles', VEHICLE_KEY(memberId), id, patch);
}

export async function loadFuelLog(memberId: string, vehicleId: string): Promise<FuelLogEntry[]> {
  const all = await loadSynced<FuelLogEntry>(memberId, 'fuelLog', FUEL_LOG_KEY(memberId));
  return all.filter((f) => f.vehicleId === vehicleId);
}

export async function addFuelLogEntry(
  memberId: string,
  data: Omit<FuelLogEntry, 'id' | 'createdAt'>,
): Promise<FuelLogEntry> {
  const record: FuelLogEntry = { ...data, id: generateId(), createdAt: new Date().toISOString() };
  return addSynced(memberId, 'fuelLog', FUEL_LOG_KEY(memberId), record);
}

// ---------------------------------------------------------------------------
// Home Maintenance (PRD Module 19)
// ---------------------------------------------------------------------------

export type HomeTaskType = 'ac_service' | 'water_purifier' | 'pest_control' | 'plumbing' | 'electrical' | 'painting' | 'other';

export const HOME_TASK_TYPE_LABELS: Record<HomeTaskType, { label: string; icon: string }> = {
  ac_service: { label: 'AC Service', icon: 'snow' },
  water_purifier: { label: 'Water Purifier Service', icon: 'water' },
  pest_control: { label: 'Pest Control', icon: 'bug' },
  plumbing: { label: 'Plumbing', icon: 'water' },
  electrical: { label: 'Electrical', icon: 'flash' },
  painting: { label: 'Painting', icon: 'color-palette' },
  other: { label: 'Other', icon: 'home' },
};

export type HomeTaskFrequency = 'monthly' | 'quarterly' | 'yearly' | 'custom';

export interface HomeMaintenanceItem {
  id: string;
  taskType: HomeTaskType;
  taskName: string;
  vendorName?: string;
  vendorPhone?: string;
  lastDoneDate?: string | null; // ISO
  nextDueDate?: string | null; // ISO
  frequency?: HomeTaskFrequency;
  hasAmc: boolean;
  amcExpiryDate?: string | null; // ISO
  cost?: number | null;
  createdAt: string;
}

const HOME_MAINTENANCE_KEY = (memberId: string) => `@lifewise_family_home_maintenance_${memberId}`;

export async function loadHomeMaintenanceItems(memberId: string): Promise<HomeMaintenanceItem[]> {
  return loadSynced<HomeMaintenanceItem>(memberId, 'homeMaintenance', HOME_MAINTENANCE_KEY(memberId));
}

export async function addHomeMaintenanceItem(
  memberId: string,
  data: Omit<HomeMaintenanceItem, 'id' | 'createdAt'>,
): Promise<HomeMaintenanceItem> {
  const record: HomeMaintenanceItem = { ...data, id: generateId(), createdAt: new Date().toISOString() };
  return addSynced(memberId, 'homeMaintenance', HOME_MAINTENANCE_KEY(memberId), record);
}

export async function deleteHomeMaintenanceItem(memberId: string, id: string): Promise<HomeMaintenanceItem[]> {
  return deleteSynced<HomeMaintenanceItem>(memberId, 'homeMaintenance', HOME_MAINTENANCE_KEY(memberId), id);
}

export async function updateHomeMaintenanceItem(
  memberId: string,
  id: string,
  patch: Partial<HomeMaintenanceItem>,
): Promise<HomeMaintenanceItem[]> {
  return updateSynced<HomeMaintenanceItem>(memberId, 'homeMaintenance', HOME_MAINTENANCE_KEY(memberId), id, patch);
}
