import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Family Hub — Phase 2, 3 & 4 local data layer.
 *
 * Doctor Appointments, Health Monitoring, Medication Stock, Daily Routine
 * (Phase 2); Bill Management, Subscription Tracking, Expense Tracking,
 * Reminder Tasks, Insurance & Documents (Phase 3); and Call & Check-in,
 * Travel & Visits, Emergency Alerts, Custom Feature (Phase 4) all store
 * their entries on-device (AsyncStorage), keyed per family member, exactly
 * like Phase 1's feature selection. This keeps every screen fully working
 * with no server dependency; Phase 5 documents how the backend team mirrors
 * this server-side later — including the one piece that's genuinely
 * backend-only: pushing Emergency Alerts to *other* family members' devices.
 */

function generateId(): string {
  return Date.now().toString() + Math.random().toString(36).slice(2, 9);
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
  try {
    const raw = await AsyncStorage.getItem(APPT_KEY(memberId));
    return raw ? (JSON.parse(raw) as Appointment[]) : [];
  } catch {
    return [];
  }
}

export async function saveAppointments(memberId: string, items: Appointment[]): Promise<void> {
  await AsyncStorage.setItem(APPT_KEY(memberId), JSON.stringify(items));
}

export async function addAppointment(
  memberId: string,
  data: Omit<Appointment, 'id' | 'createdAt' | 'completed'>,
): Promise<Appointment> {
  const items = await loadAppointments(memberId);
  const record: Appointment = { ...data, id: generateId(), completed: false, createdAt: new Date().toISOString() };
  await saveAppointments(memberId, [record, ...items]);
  return record;
}

export async function toggleAppointmentDone(memberId: string, id: string): Promise<Appointment[]> {
  const items = await loadAppointments(memberId);
  const next = items.map((a) => (a.id === id ? { ...a, completed: !a.completed } : a));
  await saveAppointments(memberId, next);
  return next;
}

export async function deleteAppointment(memberId: string, id: string): Promise<Appointment[]> {
  const items = await loadAppointments(memberId);
  const next = items.filter((a) => a.id !== id);
  await saveAppointments(memberId, next);
  return next;
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
  try {
    const raw = await AsyncStorage.getItem(HEALTH_KEY(memberId));
    return raw ? (JSON.parse(raw) as HealthLog[]) : [];
  } catch {
    return [];
  }
}

export async function saveHealthLogs(memberId: string, items: HealthLog[]): Promise<void> {
  await AsyncStorage.setItem(HEALTH_KEY(memberId), JSON.stringify(items));
}

export async function addHealthLog(
  memberId: string,
  data: Omit<HealthLog, 'id' | 'createdAt'>,
): Promise<HealthLog> {
  const items = await loadHealthLogs(memberId);
  const record: HealthLog = { ...data, id: generateId(), createdAt: new Date().toISOString() };
  const next = [record, ...items].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  await saveHealthLogs(memberId, next);
  return record;
}

export async function deleteHealthLog(memberId: string, id: string): Promise<HealthLog[]> {
  const items = await loadHealthLogs(memberId);
  const next = items.filter((h) => h.id !== id);
  await saveHealthLogs(memberId, next);
  return next;
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
  try {
    const raw = await AsyncStorage.getItem(STOCK_KEY(memberId));
    return raw ? (JSON.parse(raw) as MedicationStockItem[]) : [];
  } catch {
    return [];
  }
}

export async function saveStock(memberId: string, items: MedicationStockItem[]): Promise<void> {
  await AsyncStorage.setItem(STOCK_KEY(memberId), JSON.stringify(items));
}

export async function addStockItem(
  memberId: string,
  data: Omit<MedicationStockItem, 'id' | 'createdAt'>,
): Promise<MedicationStockItem> {
  const items = await loadStock(memberId);
  const record: MedicationStockItem = { ...data, id: generateId(), createdAt: new Date().toISOString() };
  await saveStock(memberId, [record, ...items]);
  return record;
}

export async function adjustStock(memberId: string, id: string, delta: number): Promise<MedicationStockItem[]> {
  const items = await loadStock(memberId);
  const next = items.map((s) =>
    s.id === id ? { ...s, quantityRemaining: Math.max(0, s.quantityRemaining + delta) } : s,
  );
  await saveStock(memberId, next);
  return next;
}

export async function deleteStockItem(memberId: string, id: string): Promise<MedicationStockItem[]> {
  const items = await loadStock(memberId);
  const next = items.filter((s) => s.id !== id);
  await saveStock(memberId, next);
  return next;
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
  try {
    const raw = await AsyncStorage.getItem(ROUTINE_KEY(memberId));
    return raw ? (JSON.parse(raw) as RoutineItem[]) : [];
  } catch {
    return [];
  }
}

export async function saveRoutines(memberId: string, items: RoutineItem[]): Promise<void> {
  await AsyncStorage.setItem(ROUTINE_KEY(memberId), JSON.stringify(items));
}

export async function addRoutine(
  memberId: string,
  data: Omit<RoutineItem, 'id' | 'createdAt' | 'enabled'>,
): Promise<RoutineItem> {
  const items = await loadRoutines(memberId);
  const record: RoutineItem = { ...data, id: generateId(), enabled: true, createdAt: new Date().toISOString() };
  await saveRoutines(memberId, [...items, record]);
  return record;
}

export async function toggleRoutine(memberId: string, id: string): Promise<RoutineItem[]> {
  const items = await loadRoutines(memberId);
  const next = items.map((r) => (r.id === id ? { ...r, enabled: !r.enabled } : r));
  await saveRoutines(memberId, next);
  return next;
}

export async function deleteRoutine(memberId: string, id: string): Promise<RoutineItem[]> {
  const items = await loadRoutines(memberId);
  const next = items.filter((r) => r.id !== id);
  await saveRoutines(memberId, next);
  return next;
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
  try {
    const raw = await AsyncStorage.getItem(FAMILY_BILL_KEY(memberId));
    return raw ? (JSON.parse(raw) as FamilyBill[]) : [];
  } catch {
    return [];
  }
}

export async function saveFamilyBills(memberId: string, items: FamilyBill[]): Promise<void> {
  await AsyncStorage.setItem(FAMILY_BILL_KEY(memberId), JSON.stringify(items));
}

export async function addFamilyBill(
  memberId: string,
  data: Omit<FamilyBill, 'id' | 'createdAt' | 'isPaid'>,
): Promise<FamilyBill> {
  const items = await loadFamilyBills(memberId);
  const record: FamilyBill = { ...data, id: generateId(), isPaid: false, createdAt: new Date().toISOString() };
  await saveFamilyBills(memberId, [record, ...items]);
  return record;
}

export async function toggleFamilyBillPaid(memberId: string, id: string): Promise<FamilyBill[]> {
  const items = await loadFamilyBills(memberId);
  const next = items.map((b) => (b.id === id ? { ...b, isPaid: !b.isPaid } : b));
  await saveFamilyBills(memberId, next);
  return next;
}

export async function deleteFamilyBill(memberId: string, id: string): Promise<FamilyBill[]> {
  const items = await loadFamilyBills(memberId);
  const next = items.filter((b) => b.id !== id);
  await saveFamilyBills(memberId, next);
  return next;
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
  try {
    const raw = await AsyncStorage.getItem(SUB_KEY(memberId));
    return raw ? (JSON.parse(raw) as FamilySubscription[]) : [];
  } catch {
    return [];
  }
}

export async function saveSubscriptions(memberId: string, items: FamilySubscription[]): Promise<void> {
  await AsyncStorage.setItem(SUB_KEY(memberId), JSON.stringify(items));
}

export async function addSubscription(
  memberId: string,
  data: Omit<FamilySubscription, 'id' | 'createdAt'>,
): Promise<FamilySubscription> {
  const items = await loadSubscriptions(memberId);
  const record: FamilySubscription = { ...data, id: generateId(), createdAt: new Date().toISOString() };
  await saveSubscriptions(memberId, [record, ...items]);
  return record;
}

export async function deleteSubscription(memberId: string, id: string): Promise<FamilySubscription[]> {
  const items = await loadSubscriptions(memberId);
  const next = items.filter((s) => s.id !== id);
  await saveSubscriptions(memberId, next);
  return next;
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
  try {
    const raw = await AsyncStorage.getItem(EXPENSE_KEY(memberId));
    return raw ? (JSON.parse(raw) as FamilyExpense[]) : [];
  } catch {
    return [];
  }
}

export async function saveFamilyExpenses(memberId: string, items: FamilyExpense[]): Promise<void> {
  await AsyncStorage.setItem(EXPENSE_KEY(memberId), JSON.stringify(items));
}

export async function addFamilyExpense(
  memberId: string,
  data: Omit<FamilyExpense, 'id' | 'createdAt'>,
): Promise<FamilyExpense> {
  const items = await loadFamilyExpenses(memberId);
  const record: FamilyExpense = { ...data, id: generateId(), createdAt: new Date().toISOString() };
  const next = [record, ...items].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  await saveFamilyExpenses(memberId, next);
  return record;
}

export async function deleteFamilyExpense(memberId: string, id: string): Promise<FamilyExpense[]> {
  const items = await loadFamilyExpenses(memberId);
  const next = items.filter((e) => e.id !== id);
  await saveFamilyExpenses(memberId, next);
  return next;
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
  try {
    const raw = await AsyncStorage.getItem(TASK_KEY(memberId));
    return raw ? (JSON.parse(raw) as FamilyTask[]) : [];
  } catch {
    return [];
  }
}

export async function saveFamilyTasks(memberId: string, items: FamilyTask[]): Promise<void> {
  await AsyncStorage.setItem(TASK_KEY(memberId), JSON.stringify(items));
}

export async function addFamilyTask(
  memberId: string,
  data: Omit<FamilyTask, 'id' | 'createdAt' | 'completed'>,
): Promise<FamilyTask> {
  const items = await loadFamilyTasks(memberId);
  const record: FamilyTask = { ...data, id: generateId(), completed: false, createdAt: new Date().toISOString() };
  await saveFamilyTasks(memberId, [record, ...items]);
  return record;
}

export async function toggleFamilyTask(memberId: string, id: string): Promise<FamilyTask[]> {
  const items = await loadFamilyTasks(memberId);
  const next = items.map((t) => (t.id === id ? { ...t, completed: !t.completed } : t));
  await saveFamilyTasks(memberId, next);
  return next;
}

export async function deleteFamilyTask(memberId: string, id: string): Promise<FamilyTask[]> {
  const items = await loadFamilyTasks(memberId);
  const next = items.filter((t) => t.id !== id);
  await saveFamilyTasks(memberId, next);
  return next;
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
  try {
    const raw = await AsyncStorage.getItem(DOC_KEY(memberId));
    return raw ? (JSON.parse(raw) as FamilyDocument[]) : [];
  } catch {
    return [];
  }
}

export async function saveFamilyDocuments(memberId: string, items: FamilyDocument[]): Promise<void> {
  await AsyncStorage.setItem(DOC_KEY(memberId), JSON.stringify(items));
}

export async function addFamilyDocument(
  memberId: string,
  data: Omit<FamilyDocument, 'id' | 'createdAt'>,
): Promise<FamilyDocument> {
  const items = await loadFamilyDocuments(memberId);
  const record: FamilyDocument = { ...data, id: generateId(), createdAt: new Date().toISOString() };
  await saveFamilyDocuments(memberId, [record, ...items]);
  return record;
}

export async function deleteFamilyDocument(memberId: string, id: string): Promise<FamilyDocument[]> {
  const items = await loadFamilyDocuments(memberId);
  const next = items.filter((d) => d.id !== id);
  await saveFamilyDocuments(memberId, next);
  return next;
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
  try {
    const raw = await AsyncStorage.getItem(CHECKIN_KEY(memberId));
    return raw ? (JSON.parse(raw) as CheckinItem[]) : [];
  } catch {
    return [];
  }
}

export async function saveCheckins(memberId: string, items: CheckinItem[]): Promise<void> {
  await AsyncStorage.setItem(CHECKIN_KEY(memberId), JSON.stringify(items));
}

export async function addCheckin(
  memberId: string,
  data: Omit<CheckinItem, 'id' | 'createdAt' | 'enabled' | 'lastDoneAt'>,
): Promise<CheckinItem> {
  const items = await loadCheckins(memberId);
  const record: CheckinItem = { ...data, id: generateId(), enabled: true, lastDoneAt: null, createdAt: new Date().toISOString() };
  await saveCheckins(memberId, [...items, record]);
  return record;
}

export async function markCheckinDone(memberId: string, id: string): Promise<CheckinItem[]> {
  const items = await loadCheckins(memberId);
  const next = items.map((c) => (c.id === id ? { ...c, lastDoneAt: new Date().toISOString() } : c));
  await saveCheckins(memberId, next);
  return next;
}

export async function toggleCheckin(memberId: string, id: string): Promise<CheckinItem[]> {
  const items = await loadCheckins(memberId);
  const next = items.map((c) => (c.id === id ? { ...c, enabled: !c.enabled } : c));
  await saveCheckins(memberId, next);
  return next;
}

export async function deleteCheckin(memberId: string, id: string): Promise<CheckinItem[]> {
  const items = await loadCheckins(memberId);
  const next = items.filter((c) => c.id !== id);
  await saveCheckins(memberId, next);
  return next;
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
  try {
    const raw = await AsyncStorage.getItem(TRAVEL_KEY(memberId));
    return raw ? (JSON.parse(raw) as TravelItem[]) : [];
  } catch {
    return [];
  }
}

export async function saveTravelItems(memberId: string, items: TravelItem[]): Promise<void> {
  await AsyncStorage.setItem(TRAVEL_KEY(memberId), JSON.stringify(items));
}

export async function addTravelItem(
  memberId: string,
  data: Omit<TravelItem, 'id' | 'createdAt' | 'completed'>,
): Promise<TravelItem> {
  const items = await loadTravelItems(memberId);
  const record: TravelItem = { ...data, id: generateId(), completed: false, createdAt: new Date().toISOString() };
  await saveTravelItems(memberId, [record, ...items]);
  return record;
}

export async function toggleTravelItem(memberId: string, id: string): Promise<TravelItem[]> {
  const items = await loadTravelItems(memberId);
  const next = items.map((t) => (t.id === id ? { ...t, completed: !t.completed } : t));
  await saveTravelItems(memberId, next);
  return next;
}

export async function deleteTravelItem(memberId: string, id: string): Promise<TravelItem[]> {
  const items = await loadTravelItems(memberId);
  const next = items.filter((t) => t.id !== id);
  await saveTravelItems(memberId, next);
  return next;
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
