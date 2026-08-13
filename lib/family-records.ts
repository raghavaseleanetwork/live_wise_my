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

export interface Appointment {
  id: string;
  doctorName: string;
  specialty?: string;
  date: string; // ISO
  location?: string;
  notes?: string;
  isFollowUp: boolean;
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

export type HealthMetricType = 'bp' | 'sugar' | 'weight';

export interface HealthLog {
  id: string;
  type: HealthMetricType;
  /** e.g. "120/80" for BP, "98" for sugar (mg/dL), "72" for weight (kg) */
  value: string;
  date: string; // ISO
  notes?: string;
  createdAt: string;
}

const HEALTH_KEY = (memberId: string) => `@lifewise_family_health_${memberId}`;

export const HEALTH_METRIC_LABELS: Record<HealthMetricType, { label: string; unit: string; icon: string }> = {
  bp: { label: 'Blood Pressure', unit: 'mmHg', icon: 'heart' },
  sugar: { label: 'Blood Sugar', unit: 'mg/dL', icon: 'water' },
  weight: { label: 'Weight', unit: 'kg', icon: 'body' },
};

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

export interface MedicationStockItem {
  id: string;
  medicineName: string;
  /** Doses remaining, e.g. tablets left. */
  quantityRemaining: number;
  /** Below this, the item is flagged as low stock. */
  lowStockThreshold: number;
  /** How many doses are used per day, to estimate days-left. */
  dailyUsage: number;
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
  createdAt: string;
}

const ROUTINE_KEY = (memberId: string) => `@lifewise_family_routine_${memberId}`;

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

export interface FamilyBill {
  id: string;
  name: string;
  amount: number;
  dueDate: string; // ISO
  category: 'electricity' | 'medical' | 'insurance' | 'other';
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

export interface FamilySubscription {
  id: string;
  serviceName: string;
  amount: number;
  renewalDate: string; // ISO
  cycle: 'monthly' | 'yearly';
  category: 'ott' | 'utility' | 'other';
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

export interface FamilyDocument {
  id: string;
  title: string;
  type: 'insurance' | 'id' | 'medical' | 'other';
  /** Policy/renewal reminder date, if applicable. */
  reminderDate?: string | null; // ISO
  notes?: string;
  createdAt: string;
}

const DOC_KEY = (memberId: string) => `@lifewise_family_documents_${memberId}`;

export const DOCUMENT_TYPE_LABELS: Record<FamilyDocument['type'], { label: string; icon: string }> = {
  insurance: { label: 'Insurance Policy', icon: 'shield-checkmark' },
  id: { label: 'ID Document', icon: 'card' },
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

export interface CheckinItem {
  id: string;
  label: string;
  /** "HH:MM AM/PM" */
  time: string;
  /** Days of week this repeats on, 0=Sun..6=Sat. Empty = every day. */
  days: number[];
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

export interface TravelItem {
  id: string;
  type: TravelType;
  title: string;
  date: string; // ISO
  location?: string;
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

export interface CustomFeatureConfig {
  /** User-chosen name for this custom tracker, e.g. "Physiotherapy Sessions". */
  name: string;
  icon: string;
}

export interface CustomTrackerItem {
  id: string;
  title: string;
  date: string; // ISO
  completed: boolean;
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
): Promise<CustomTrackerItem> {
  const items = await loadCustomItems(memberId);
  const record: CustomTrackerItem = { id: generateId(), title, completed: false, date: new Date().toISOString(), createdAt: new Date().toISOString() };
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
