import AsyncStorage from '@react-native-async-storage/async-storage';

import type { Bill, CategoryType, RepeatType } from '@/lib/data';
import { scheduleLocalNotification } from '@/lib/notifications';
import {
  loadAppointments,
  loadCheckins,
  loadFamilyBills,
  loadFamilyTasks,
  loadRoutines,
  loadStock,
  loadSubscriptions,
  loadTravelItems,
} from '@/lib/family-records';

/**
 * Family Hub → user reminders bridge.
 *
 * Family records live on-device, one AsyncStorage key per member per feature
 * (see `family-records.ts`). The user's own reminders live on the server behind
 * `/api/bills` and surface in the Bills tab. Before this module the two never
 * met: adding a doctor's appointment for your mother wrote a local row that
 * nothing else read, so it never appeared in the reminder list the user
 * actually checks and never fired a notification.
 *
 * Rather than give Family Hub its own parallel reminder list and scheduler,
 * every reminder-worthy family record is PROJECTED into the same `Bill` shape
 * the Bills tab already renders. One list, one notification path, one mental
 * model for the user.
 *
 * These projections are derived data, never edited directly: the family record
 * remains the source of truth and the projection is recomputed from it. That is
 * why they are rebuilt on read instead of being stored as their own rows — a
 * stored copy would drift the moment a record was edited or deleted elsewhere.
 *
 * `sourceKind` + `sourceId` identify which family record a projection came
 * from. They are what make edit/delete/dedupe possible, and what the backend
 * will key on when this moves server-side — see
 * `backend-team/app docs/FAMILY_REMINDERS_BACKEND_SPEC.md`.
 */

/** Family record types that project into reminders. */
export type FamilyReminderKind =
  | 'appointment'
  | 'medicine-stock'
  | 'family-bill'
  | 'subscription'
  | 'task'
  | 'routine'
  | 'checkin'
  | 'travel';

/**
 * A `Bill` that came from a family record rather than the user's own bill list.
 *
 * It is a real `Bill` structurally so every existing Bills-tab component renders
 * it with no branching; the extra fields mark its origin.
 */
export interface FamilyReminder extends Bill {
  memberId: string;
  memberName: string;
  sourceKind: FamilyReminderKind;
  sourceId: string;
}

/** Marks a projected id so it can never be confused with a server bill id. */
const ID_PREFIX = 'fam';

export function makeFamilyReminderId(
  memberId: string,
  kind: FamilyReminderKind,
  sourceId: string,
): string {
  return `${ID_PREFIX}:${kind}:${memberId}:${sourceId}`;
}

export function isFamilyReminderId(id: string): boolean {
  return id.startsWith(`${ID_PREFIX}:`);
}

// ---------------------------------------------------------------------------
// Per-kind presentation
// ---------------------------------------------------------------------------

/**
 * How each kind renders in the reminder list.
 *
 * `category` reuses the existing `CategoryType` values so the Bills tab's
 * colour and filter logic applies unchanged — no new category needed.
 */
const KIND_META: Record<
  FamilyReminderKind,
  { category: CategoryType; icon: string; label: string }
> = {
  appointment: { category: 'health', icon: 'medkit', label: 'Appointment' },
  'medicine-stock': { category: 'health', icon: 'medical', label: 'Medicine refill' },
  'family-bill': { category: 'bills', icon: 'receipt', label: 'Bill' },
  subscription: { category: 'subscriptions', icon: 'refresh', label: 'Subscription' },
  task: { category: 'tasks', icon: 'checkmark-circle', label: 'Task' },
  routine: { category: 'habits', icon: 'time', label: 'Routine' },
  checkin: { category: 'family', icon: 'call', label: 'Check-in' },
  travel: { category: 'travel', icon: 'airplane', label: 'Travel' },
};

export function familyReminderLabel(kind: FamilyReminderKind): string {
  return KIND_META[kind].label;
}

/**
 * Default lead times per kind, in days before the due date.
 *
 * Deliberately not the user's global `defaultReminderDays` ([3, 1, 0]): that is
 * tuned for bills, where three days' notice to arrange payment is useful. A
 * daily routine or check-in reminded about three days early is noise, so
 * recurring same-day kinds get `[0]`.
 */
const KIND_LEAD_DAYS: Record<FamilyReminderKind, number[]> = {
  appointment: [1, 0],
  'medicine-stock': [3, 1],
  'family-bill': [3, 1, 0],
  subscription: [3, 1],
  task: [1, 0],
  routine: [0],
  checkin: [0],
  travel: [1, 0],
};

// ---------------------------------------------------------------------------
// Time helpers
// ---------------------------------------------------------------------------

/**
 * Resolves a `"HH:MM AM/PM"` clock time (routines, check-ins) to the next
 * occurrence at or after now.
 *
 * Routines and check-ins store a wall-clock time with no date because they
 * repeat daily. A reminder needs a concrete instant, so today's occurrence is
 * used while it is still ahead, otherwise tomorrow's.
 */
function nextOccurrenceOfClockTime(time: string, from: Date = new Date()): Date | null {
  const match = /^(\d{1,2}):(\d{2})\s*(AM|PM)?$/i.exec(time.trim());
  if (!match) return null;

  let hours = Number(match[1]);
  const minutes = Number(match[2]);
  const meridiem = match[3]?.toUpperCase();

  if (Number.isNaN(hours) || Number.isNaN(minutes)) return null;
  if (minutes > 59) return null;

  if (meridiem === 'PM' && hours < 12) hours += 12;
  if (meridiem === 'AM' && hours === 12) hours = 0;
  if (hours > 23) return null;

  const at = new Date(from);
  at.setHours(hours, minutes, 0, 0);
  if (at.getTime() <= from.getTime()) at.setDate(at.getDate() + 1);
  return at;
}

/** Projected refill date for a medication, from stock left and daily usage. */
function refillDateFor(item: {
  quantityRemaining: number;
  dailyUsage: number;
  lowStockThreshold?: number;
}): Date | null {
  if (!(item.dailyUsage > 0)) return null;
  // Remind when stock reaches the low-stock line, not when it hits zero —
  // by zero it is already too late to reorder.
  const buffer = item.lowStockThreshold ?? 0;
  const usableUnits = item.quantityRemaining - buffer;
  const daysLeft = Math.floor(usableUnits / item.dailyUsage);
  const at = new Date();
  at.setDate(at.getDate() + Math.max(0, daysLeft));
  at.setHours(9, 0, 0, 0);
  return at;
}

// ---------------------------------------------------------------------------
// Projection
// ---------------------------------------------------------------------------

interface ProjectionInput {
  memberId: string;
  memberName: string;
  kind: FamilyReminderKind;
  sourceId: string;
  title: string;
  dueDate: Date;
  amount?: number;
  repeatType?: RepeatType;
  isDone?: boolean;
}

function project(input: ProjectionInput): FamilyReminder {
  const meta = KIND_META[input.kind];
  return {
    id: makeFamilyReminderId(input.memberId, input.kind, input.sourceId),
    // The member's name is carried in the title because the Bills tab renders
    // one flat list — without it "Blood test" gives no clue whose it is.
    name: `${input.title} · ${input.memberName}`,
    amount: input.amount ?? 0,
    dueDate: input.dueDate.toISOString(),
    category: meta.category,
    isPaid: input.isDone ?? false,
    icon: meta.icon,
    reminderType: input.kind === 'subscription' ? 'subscription' : 'custom',
    repeatType: input.repeatType ?? 'none',
    status: input.isDone ? 'paid' : 'active',
    reminderDaysBefore: KIND_LEAD_DAYS[input.kind],
    source: 'family',
    memberId: input.memberId,
    memberName: input.memberName,
    sourceKind: input.kind,
    sourceId: input.sourceId,
  };
}

/**
 * Builds every reminder for one member from their stored family records.
 *
 * Completed records are projected with `isDone: true` rather than dropped, so
 * they land in the Reminders tab's "Completed" section. Dropping them made a
 * reminder *vanish* when it was ticked off, which reads as data loss — the user
 * gets no confirmation the thing they just did was recorded.
 *
 * Records with no usable date are still skipped: there is nothing to schedule
 * or sort them by. Recurring kinds (routine, check-in) are included while
 * enabled — "completed" is not a state they have, since they recur.
 */
export async function buildRemindersForMember(
  memberId: string,
  memberName: string,
): Promise<FamilyReminder[]> {
  const [appointments, stock, bills, subscriptions, tasks, routines, checkins, travel] =
    await Promise.all([
      loadAppointments(memberId),
      loadStock(memberId),
      loadFamilyBills(memberId),
      loadSubscriptions(memberId),
      loadFamilyTasks(memberId),
      loadRoutines(memberId),
      loadCheckins(memberId),
      loadTravelItems(memberId),
    ]);

  const out: FamilyReminder[] = [];
  const base = { memberId, memberName };

  for (const a of appointments) {
    out.push(
      project({
        ...base,
        kind: 'appointment',
        sourceId: a.id,
        title: `Dr. ${a.doctorName}`.replace(/^Dr\. Dr\.?\s*/i, 'Dr. '),
        dueDate: new Date(a.date),
        isDone: a.completed,
      }),
    );
  }

  for (const m of stock) {
    const at = refillDateFor(m);
    if (!at) continue;
    out.push({
      ...project({
        ...base,
        kind: 'medicine-stock',
        sourceId: m.id,
        title: `Refill ${m.medicineName}`,
        dueDate: at,
      }),
    });
  }

  for (const b of bills) {
    out.push(
      project({
        ...base,
        kind: 'family-bill',
        sourceId: b.id,
        title: b.name,
        dueDate: new Date(b.dueDate),
        amount: b.amount,
        repeatType: 'monthly',
        isDone: b.isPaid,
      }),
    );
  }

  for (const s of subscriptions) {
    out.push(
      project({
        ...base,
        kind: 'subscription',
        sourceId: s.id,
        title: s.serviceName,
        dueDate: new Date(s.renewalDate),
        amount: s.amount,
        repeatType: s.cycle === 'yearly' ? 'yearly' : 'monthly',
      }),
    );
  }

  for (const t of tasks) {
    // Tasks are the one kind where the date is optional. A task with no due
    // date cannot be scheduled, so it stays in Family Hub only.
    if (!t.dueDate) continue;
    out.push(
      project({
        ...base,
        kind: 'task',
        sourceId: t.id,
        title: t.title,
        dueDate: new Date(t.dueDate),
        isDone: t.completed,
      }),
    );
  }

  for (const r of routines) {
    if (!r.enabled) continue;
    const at = nextOccurrenceOfClockTime(r.time);
    if (!at) continue;
    out.push(
      project({
        ...base,
        kind: 'routine',
        sourceId: r.id,
        title: r.label,
        dueDate: at,
        repeatType: 'daily',
      }),
    );
  }

  for (const c of checkins) {
    if (!c.enabled) continue;
    const at = nextOccurrenceOfClockTime(c.time);
    if (!at) continue;
    out.push(
      project({
        ...base,
        kind: 'checkin',
        sourceId: c.id,
        title: c.label,
        dueDate: at,
        repeatType: 'daily',
      }),
    );
  }

  for (const t of travel) {
    out.push(
      project({
        ...base,
        kind: 'travel',
        sourceId: t.id,
        title: t.title,
        dueDate: new Date(t.date),
        isDone: t.completed,
      }),
    );
  }

  // Drop anything whose date failed to parse rather than emitting an
  // "Invalid Date" row into the user's reminder list.
  return out.filter((r) => !Number.isNaN(new Date(r.dueDate).getTime()));
}

/** Builds reminders across every member, newest due first. */
export async function buildAllFamilyReminders(
  members: { id: string; name: string }[],
): Promise<FamilyReminder[]> {
  const perMember = await Promise.all(
    members.map((m) => buildRemindersForMember(m.id, m.name)),
  );
  return perMember
    .flat()
    .sort((a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime());
}

// ---------------------------------------------------------------------------
// Notification scheduling
// ---------------------------------------------------------------------------

/**
 * Ids already scheduled, so re-entering a screen does not stack duplicate
 * notifications for the same record.
 *
 * Persisted rather than in-memory because the projection is rebuilt on every
 * app launch; an in-memory set would forget on restart and re-schedule
 * everything each cold start.
 */
const SCHEDULED_KEY = '@lifewise_family_reminder_scheduled';

/**
 * Set once the server projection has been reached successfully; from then on
 * the backend scheduler owns these reminders and local scheduling must stop or
 * every reminder fires twice. Written by `lib/family-reminders-api.ts`.
 *
 * Read here via a local constant rather than importing that module, so this
 * file — the offline path — has no runtime dependency on the network path.
 */
const SERVER_SCHEDULING_KEY = '@lifewise_family_reminders_server_scheduling';

async function isServerSchedulingActive(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(SERVER_SCHEDULING_KEY)) === 'true';
  } catch {
    // Unknown state: keep scheduling locally. A duplicate notification is a
    // smaller failure than a medicine reminder that never arrives.
    return false;
  }
}

async function loadScheduled(): Promise<Record<string, string>> {
  try {
    const raw = await AsyncStorage.getItem(SCHEDULED_KEY);
    return raw ? (JSON.parse(raw) as Record<string, string>) : {};
  } catch {
    return {};
  }
}

async function saveScheduled(map: Record<string, string>): Promise<void> {
  try {
    await AsyncStorage.setItem(SCHEDULED_KEY, JSON.stringify(map));
  } catch {
    // A failed write costs a duplicate notification, never a crash.
  }
}

/**
 * Schedules local notifications for reminders that don't have one yet.
 *
 * Keyed on reminder id + due date, so editing a record's date re-schedules it
 * while merely re-opening the screen does not. Past-due lead times are skipped:
 * `scheduleLocalNotification` fires those immediately, which would mean a burst
 * of alerts for a bill added the day it is due.
 *
 * **No-ops once the server scheduler has taken over.** The backend pushes these
 * same reminders, so scheduling locally as well notifies the user twice for one
 * appointment. This check is the client half of that cutover.
 */
export async function scheduleFamilyReminderNotifications(
  reminders: FamilyReminder[],
): Promise<void> {
  if (await isServerSchedulingActive()) return;

  const scheduled = await loadScheduled();
  let changed = false;

  for (const reminder of reminders) {
    if (reminder.isPaid) continue;

    const due = new Date(reminder.dueDate);
    if (Number.isNaN(due.getTime())) continue;

    const stamp = `${due.toISOString()}|${reminder.name}`;
    if (scheduled[reminder.id] === stamp) continue;

    for (const daysBefore of reminder.reminderDaysBefore) {
      const at = new Date(due);
      at.setDate(at.getDate() - daysBefore);
      if (at.getTime() <= Date.now()) continue;

      await scheduleLocalNotification({
        title: `${familyReminderLabel(reminder.sourceKind)} · ${reminder.memberName}`,
        body:
          daysBefore === 0
            ? `${reminder.name.split(' · ')[0]} is due today`
            : `${reminder.name.split(' · ')[0]} in ${daysBefore} day${daysBefore === 1 ? '' : 's'}`,
        triggerAt: at,
        data: {
          type: 'family-reminder',
          memberId: reminder.memberId,
          sourceKind: reminder.sourceKind,
          sourceId: reminder.sourceId,
        },
      });
    }

    scheduled[reminder.id] = stamp;
    changed = true;
  }

  if (changed) await saveScheduled(scheduled);
}

/**
 * Rebuilds projections for every member and schedules any new notifications.
 * The single entry point screens call.
 */
export async function syncFamilyReminders(
  members: { id: string; name: string }[],
): Promise<FamilyReminder[]> {
  const reminders = await buildAllFamilyReminders(members);
  await scheduleFamilyReminderNotifications(reminders);
  return reminders;
}
