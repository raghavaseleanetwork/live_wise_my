import AsyncStorage from '@react-native-async-storage/async-storage';

import type { Bill, CategoryType, RepeatType } from '@/lib/data';
import {
  cancelScheduledNotifications,
  getScheduledNotificationIds,
  scheduleLocalNotification,
  scheduleRepeatingLocalNotification,
} from '@/lib/notifications';
import {
  loadAppointments,
  loadCheckins,
  loadFamilyBills,
  loadFamilyTasks,
  loadRoutines,
  loadStock,
  loadSubscriptions,
  loadTravelItems,
  type AppointmentReminderLead,
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
  /**
   * The member's profile photo, for reminder cards that show who a reminder is
   * for (Home dashboard). Optional: absent on reminders projected before this
   * field existed, and on members with no photo — `Avatar` falls back to a
   * coloured initial either way, so no caller needs to branch on it.
   */
  memberAvatarUrl?: string | null;
  sourceKind: FamilyReminderKind;
  sourceId: string;
  /**
   * Recurrence, present only on kinds that repeat on a wall clock (routine,
   * check-in).
   *
   * `dueDate` on those kinds is a *derived* value — "the next time this
   * happens" — computed at projection time so the row can be sorted and
   * rendered alongside dated reminders. It is not the schedule. Scheduling off
   * `dueDate` is what made a daily routine fire exactly once; the schedule is
   * this field, and it is what `scheduleFamilyReminderNotifications` uses.
   *
   * `weekdays` is 0=Sun..6=Sat; empty means every day.
   */
  recurrence?: {
    hour: number;
    minute: number;
    weekdays: number[];
  };
  /**
   * Lead offsets in minutes before `dueDate`, for records whose own reminder
   * setting is finer than whole days (appointments: 3h/1h/30min; travel: an
   * hours-before choice).
   *
   * When present this REPLACES `reminderDaysBefore` for scheduling. It exists
   * because the user picks these values in the add screens and they were
   * previously dropped on the floor — a "30 min before" appointment still
   * notified a whole day early.
   */
  leadMinutes?: number[];
  /**
   * Whether the source record carries a real, user-chosen clock time.
   *
   * Sent by the server (`GET /api/reminders/family`) so the 9 AM correction
   * does not have to be guessed from the timestamp. Guessing is wrong for
   * server rows specifically: they arrive as UTC ISO strings, so a date-only
   * record stored at midnight UTC parses to 05:30 local in IST — "not
   * midnight", which would suppress the correction and fire the reminder at
   * 05:30. When absent (local projection, older server) `hasTimeOfDay` is the
   * fallback.
   */
  hasExplicitTime?: boolean;
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
  // Not `KIND_META[kind].label` — the server projects kinds this client may not
  // know yet (it added 'insurance' and 'custom' ahead of the app), and an
  // unknown key made this read `.label` of undefined and throw. A reminder from
  // a newer server must degrade to a readable label, never crash the screen.
  const meta = KIND_META[kind as keyof typeof KIND_META];
  if (meta) return meta.label;
  return String(kind)
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
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

/**
 * Hour of the day a *date-only* reminder fires.
 *
 * Kinds like bills, subscriptions, tasks and medicine refills carry a date with
 * no meaningful time — the picker writes midnight. Subtracting whole days from
 * that (`setDate(getDate() - n)`) preserves the time-of-day, so every one of
 * these reminders fired at 00:00: a "1 day before" bill reminder arrived at
 * midnight the night before, which the user reads as "at the wrong time" or
 * misses entirely while asleep.
 *
 * 9 AM local is the notify hour instead. Only applied when the source record
 * genuinely has no time of its own (see `hasTimeOfDay`) — an appointment at
 * 14:30 keeps 14:30.
 */
const DEFAULT_NOTIFY_HOUR = 9;

/**
 * Whether a date carries a real, user-chosen time of day.
 *
 * Date-only records are written as local midnight by the date pickers, so
 * "midnight" is the marker for "no time was chosen". A record genuinely set to
 * 00:00 is indistinguishable from one with no time — treating it as date-only
 * moves it to 9 AM, which is the better outcome either way.
 */
function hasTimeOfDay(d: Date): boolean {
  return d.getHours() !== 0 || d.getMinutes() !== 0;
}

/** Human phrasing for a minute-based lead, e.g. "in 30 minutes" / "tomorrow". */
function describeLeadMinutes(minutes: number): string {
  if (minutes <= 0) return 'is starting now';
  if (minutes < 60) return `in ${minutes} minutes`;
  if (minutes < 24 * 60) {
    const h = Math.round(minutes / 60);
    return `in ${h} hour${h === 1 ? '' : 's'}`;
  }
  const d = Math.round(minutes / (24 * 60));
  return d === 1 ? 'is tomorrow' : `in ${d} days`;
}

/**
 * Lead offsets in MINUTES, for records whose own reminder setting is finer than
 * a whole day.
 *
 * `reminderDaysBefore` cannot express these: the appointment screen offers
 * "3 hours / 1 hour / 30 min" and the travel screen offers an hours-before
 * choice. Both were written to storage by the UI and then silently dropped by
 * this projection, so the user's explicit choice never affected delivery.
 *
 * When present this REPLACES the day-based leads for that reminder.
 */
const APPOINTMENT_LEAD_MINUTES: Record<AppointmentReminderLead, number> = {
  '1_day': 24 * 60,
  '3_hours': 3 * 60,
  '1_hour': 60,
  '30_min': 30,
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
function parseClockTime(time: string): { hour: number; minute: number } | null {
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

  return { hour: hours, minute: minutes };
}

/**
 * Normalises a stored `days` array to the 0..6 values the schedulers expect.
 *
 * `undefined` (records written before routines had days) and `[]` both mean
 * "every day" — the meaning the field already carries in storage. Treating
 * `undefined` as "no days" would silently stop every pre-existing routine.
 */
function normaliseWeekdays(days: number[] | undefined): number[] {
  if (!Array.isArray(days)) return [];
  return [...new Set(days.filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort();
}

/**
 * Resolves a `"HH:MM AM/PM"` clock time to the next occurrence at or after now,
 * restricted to `weekdays` when given.
 *
 * Used only for display and sorting — the actual notification schedule comes
 * from the `recurrence` field, not from this date. Without the weekday filter a
 * Monday-only check-in showed "due tomorrow" on a Thursday, which is simply
 * false.
 */
function nextOccurrenceOfClockTime(
  time: string,
  weekdays: number[] = [],
  from: Date = new Date(),
): Date | null {
  const parsed = parseClockTime(time);
  if (!parsed) return null;

  const at = new Date(from);
  at.setHours(parsed.hour, parsed.minute, 0, 0);
  if (at.getTime() <= from.getTime()) at.setDate(at.getDate() + 1);

  if (weekdays.length === 0) return at;

  // Walk forward to the first selected weekday. Seven steps is always enough:
  // any non-empty subset of 0..6 is hit within a week.
  for (let i = 0; i < 7; i += 1) {
    if (weekdays.includes(at.getDay())) return at;
    at.setDate(at.getDate() + 1);
  }
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
  memberAvatarUrl?: string | null;
  kind: FamilyReminderKind;
  sourceId: string;
  title: string;
  dueDate: Date;
  amount?: number;
  repeatType?: RepeatType;
  isDone?: boolean;
  recurrence?: { hour: number; minute: number; weekdays: number[] };
  leadMinutes?: number[];
  hasExplicitTime?: boolean;
}

/** Safe defaults for a kind this build does not know (e.g. added server-side first). */
const FALLBACK_KIND_META = { category: 'others' as CategoryType, icon: 'notifications', label: 'Reminder' };
const FALLBACK_LEAD_DAYS = [1, 0];

function project(input: ProjectionInput): FamilyReminder {
  const meta = KIND_META[input.kind] ?? FALLBACK_KIND_META;
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
    reminderDaysBefore: KIND_LEAD_DAYS[input.kind] ?? FALLBACK_LEAD_DAYS,
    source: 'family',
    memberId: input.memberId,
    memberName: input.memberName,
    memberAvatarUrl: input.memberAvatarUrl ?? null,
    sourceKind: input.kind,
    sourceId: input.sourceId,
    ...(input.recurrence ? { recurrence: input.recurrence } : {}),
    ...(input.leadMinutes?.length ? { leadMinutes: input.leadMinutes } : {}),
    ...(input.hasExplicitTime === undefined ? {} : { hasExplicitTime: input.hasExplicitTime }),
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
  memberAvatarUrl?: string | null,
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
  const base = { memberId, memberName, memberAvatarUrl };

  for (const a of appointments) {
    out.push(
      project({
        ...base,
        kind: 'appointment',
        sourceId: a.id,
        title: `Dr. ${a.doctorName}`.replace(/^Dr\. Dr\.?\s*/i, 'Dr. '),
        dueDate: new Date(a.date),
        isDone: a.completed,
        // The user picked this on the add screen ("1 day / 3 hours / 1 hour /
        // 30 min"). It was stored and then ignored by scheduling until now.
        leadMinutes: [APPOINTMENT_LEAD_MINUTES[a.reminderLead ?? '1_day']],
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
    // The bill screen lets the user choose their own lead ("3 days before")
    // plus an optional extra reminder on the due date itself. Both were stored
    // and then overwritten by the generic [3, 1, 0] default here.
    const billLeads =
      b.reminderDaysBefore == null
        ? undefined
        : [b.reminderDaysBefore, ...(b.dayOfReminderEnabled ? [0] : [])];
    out.push({
      ...project({
        ...base,
        kind: 'family-bill',
        sourceId: b.id,
        hasExplicitTime: false,
        title: b.name,
        dueDate: new Date(b.dueDate),
        amount: b.amount,
        repeatType: 'monthly',
        isDone: b.isPaid,
      }),
      ...(billLeads
        ? { reminderDaysBefore: [...new Set(billLeads)].sort((x, y) => y - x) }
        : {}),
    });
  }

  for (const s of subscriptions) {
    out.push(
      project({
        ...base,
        kind: 'subscription',
        sourceId: s.id,
        hasExplicitTime: false,
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
        hasExplicitTime: false,
        title: t.title,
        dueDate: new Date(t.dueDate),
        isDone: t.completed,
      }),
    );
  }

  for (const r of routines) {
    if (!r.enabled) continue;
    const clock = parseClockTime(r.time);
    if (!clock) continue;
    const weekdays = normaliseWeekdays(r.days);
    const at = nextOccurrenceOfClockTime(r.time, weekdays);
    if (!at) continue;
    out.push(
      project({
        ...base,
        kind: 'routine',
        sourceId: r.id,
        title: r.label,
        dueDate: at,
        repeatType: weekdays.length ? 'weekly' : 'daily',
        recurrence: { ...clock, weekdays },
      }),
    );
  }

  for (const c of checkins) {
    if (!c.enabled) continue;
    const clock = parseClockTime(c.time);
    if (!clock) continue;
    const weekdays = normaliseWeekdays(c.days);
    const at = nextOccurrenceOfClockTime(c.time, weekdays);
    if (!at) continue;
    out.push(
      project({
        ...base,
        kind: 'checkin',
        sourceId: c.id,
        title: c.label,
        dueDate: at,
        repeatType: weekdays.length ? 'weekly' : 'daily',
        recurrence: { ...clock, weekdays },
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
        // Same as appointments: the travel screen's hours-before choice was
        // written to storage but never reached the scheduler.
        leadMinutes: [(t.reminderHoursBefore ?? 24) * 60],
      }),
    );
  }

  // Drop anything whose date failed to parse rather than emitting an
  // "Invalid Date" row into the user's reminder list.
  return out.filter((r) => !Number.isNaN(new Date(r.dueDate).getTime()));
}

/** Builds reminders across every member, newest due first. */
export async function buildAllFamilyReminders(
  members: { id: string; name: string; avatarUrl?: string | null }[],
): Promise<FamilyReminder[]> {
  const perMember = await Promise.all(
    members.map((m) => buildRemindersForMember(m.id, m.name, m.avatarUrl)),
  );

  // Collapse by reminder id before returning.
  //
  // The id is deterministic — `fam:<kind>:<memberId>:<sourceId>` — so two
  // reminders can only collide when the same source record was projected twice:
  // a duplicated source row, or the same member arriving from both the owned
  // and shared lists. Screens key their lists on this id, so a collision raises
  // React's "two children with the same key" error and can drop or double rows.
  const byId = new Map<string, FamilyReminder>();
  for (const reminder of perMember.flat()) {
    if (!byId.has(reminder.id)) byId.set(reminder.id, reminder);
  }

  return [...byId.values()].sort(
    (a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime(),
  );
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
 * OS notification ids for repeating reminders, keyed by reminder id.
 *
 * Repeating triggers never expire on their own, so unlike one-shot reminders
 * they must be explicitly cancellable. Without this map, deleting a routine or
 * changing its time would leave the original notification firing forever with
 * nothing in the app able to stop it — the ids would be lost on reload.
 */
const REPEATING_IDS_KEY = '@lifewise_family_reminder_repeating_ids';

async function loadRepeatingIds(): Promise<Record<string, string[]>> {
  try {
    const raw = await AsyncStorage.getItem(REPEATING_IDS_KEY);
    return raw ? (JSON.parse(raw) as Record<string, string[]>) : {};
  } catch {
    return {};
  }
}

async function saveRepeatingIds(map: Record<string, string[]>): Promise<void> {
  try {
    await AsyncStorage.setItem(REPEATING_IDS_KEY, JSON.stringify(map));
  } catch {
    // Same trade-off as `saveScheduled`: never fatal.
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
/**
 * Serialises scheduling runs.
 *
 * `useFamilyReminders` refreshes from both a `useEffect` and a `useFocusEffect`,
 * and several screens mount the hook at once, so this function is routinely
 * entered two or three times concurrently. Each run does
 * read-ledger -> arm -> write-ledger with awaits throughout, so concurrent runs
 * interleave disastrously:
 *
 *   A reads {} -> arms X
 *   B reads {} (still stale) -> arms Y
 *   A writes {id: [X]}
 *   B writes {id: [Y]}          <- X is now orphaned in the OS
 *
 * and worse, the orphan sweep at the end runs against a ledger that no longer
 * matches what the OS holds, so it cancels notifications that were just armed.
 * That is why a check-in logged "ARM REPEATING ... ids=1" twice and then never
 * fired: the second run's sweep cancelled the first run's live trigger.
 *
 * Chaining on a shared promise makes the read-modify-write atomic with respect
 * to other runs, at the cost of the later ones simply waiting.
 */
let schedulingChain: Promise<void> = Promise.resolve();

export async function scheduleFamilyReminderNotifications(
  reminders: FamilyReminder[],
): Promise<void> {
  const run = schedulingChain.then(
    () => scheduleFamilyReminderNotificationsInner(reminders),
    () => scheduleFamilyReminderNotificationsInner(reminders),
  );
  // Keep the chain alive even if this run throws, or one failure would wedge
  // every later sync.
  schedulingChain = run.catch(() => {});
  return run;
}

async function scheduleFamilyReminderNotificationsInner(
  reminders: FamilyReminder[],
): Promise<void> {
  const serverActive = await isServerSchedulingActive();
  console.log(
    `[FamReminder] sync: ${reminders.length} reminders, serverSchedulingActive=${serverActive}`,
  );
  if (serverActive) {
    console.log('[FamReminder] ABORT: server scheduling latched -> nothing scheduled locally');
    return;
  }

  const scheduled = await loadScheduled();
  const repeating = await loadRepeatingIds();

  // What the OS actually holds. The ledger alone is not trustworthy: a
  // notification can be missing from the OS while the ledger still claims it is
  // scheduled (it fired, the user cleared it, or an earlier concurrent run
  // cancelled it). Because the ledger's stamp check short-circuits arming, that
  // drift is permanent -- the reminder is never re-armed and silently never
  // fires again. Verifying against this set makes the ledger self-healing.
  //
  // null means the module is unavailable, so nothing can be verified; in that
  // case the ledger is trusted as before rather than re-arming blindly.
  const osIds = await getScheduledNotificationIds();
  console.log(
    `[FamReminder] OS currently holds ${osIds === null ? 'unknown' : osIds.size} scheduled notification(s); ledger has ${Object.keys(scheduled).length} entr(ies)`,
  );
  let changed = false;
  let repeatingChanged = false;

  for (const reminder of reminders) {
    if (reminder.isPaid) continue;

    // Recurring kinds (routine, check-in) take the repeating path.
    //
    // These must NOT be scheduled from `dueDate`: that is only "the next
    // occurrence", so a one-shot trigger built from it fires once and the
    // reminder never repeats again. An OS-level DAILY/WEEKLY trigger keeps
    // firing without the app being opened, which is the whole point.
    if (reminder.recurrence) {
      const { hour, minute } = reminder.recurrence;
      // Re-normalised rather than trusted: this projection may have come from
      // the server (`/api/reminders/family`), which could omit `weekdays` or
      // send values outside 0..6. A bad value here would either throw or
      // schedule a reminder on the wrong day.
      const weekdays = normaliseWeekdays(reminder.recurrence.weekdays);
      if (!Number.isInteger(hour) || hour < 0 || hour > 23) continue;
      if (!Number.isInteger(minute) || minute < 0 || minute > 59) continue;

      const stamp = `repeat|${hour}:${minute}|${weekdays.join(',')}|${reminder.name}`;
      // Unchanged AND still present in the OS -> genuinely nothing to do.
      const knownIds = repeating[reminder.id] ?? [];
      const stillScheduled =
        osIds === null || (knownIds.length > 0 && knownIds.every((id) => osIds.has(id)));
      if (scheduled[reminder.id] === stamp && stillScheduled) continue;
      if (scheduled[reminder.id] === stamp && !stillScheduled) {
        console.log(
          `[FamReminder] RE-ARM "${reminder.name.split(' · ')[0]}" — ledger said scheduled but OS does not hold it`,
        );
      }

      // The time or selected days changed, so the old triggers are wrong.
      // Cancel before re-arming or the user gets both the old and new times.
      await cancelScheduledNotifications(repeating[reminder.id] ?? []);

      const label = reminder.name.split(' · ')[0];
      const ids = await scheduleRepeatingLocalNotification({
        title: `${familyReminderLabel(reminder.sourceKind)} · ${reminder.memberName}`,
        body:
          reminder.sourceKind === 'checkin'
            ? `Time to check in with ${reminder.memberName}`
            : `${label} — it's time`,
        hour,
        minute,
        weekdays,
        data: {
          type: 'family-reminder',
          memberId: reminder.memberId,
          sourceKind: reminder.sourceKind,
          sourceId: reminder.sourceId,
        },
      });

      console.log(
        `[FamReminder] ARM REPEATING "${label}" ${hour}:${String(minute).padStart(2, '0')} weekdays=[${weekdays.join(',')}] ids=${ids.length}`,
      );
      repeating[reminder.id] = ids;
      repeatingChanged = true;
      scheduled[reminder.id] = stamp;
      changed = true;
      continue;
    }

    const due = new Date(reminder.dueDate);
    if (Number.isNaN(due.getTime())) continue;

    const label = reminder.name.split(' · ')[0];
    const title = `${familyReminderLabel(reminder.sourceKind)} · ${reminder.memberName}`;
    const data = {
      type: 'family-reminder',
      memberId: reminder.memberId,
      sourceKind: reminder.sourceKind,
      sourceId: reminder.sourceId,
    };

    // Minute-precision leads (appointments, travel) replace the day-based ones.
    // The stamp includes which path was taken and the exact offsets, so editing
    // a record's reminder setting re-arms instead of being skipped as unchanged.
    const useMinutes = !!reminder.leadMinutes?.length;
    const offsets = useMinutes ? reminder.leadMinutes! : reminder.reminderDaysBefore;
    const stamp = `${due.toISOString()}|${reminder.name}|${useMinutes ? 'm' : 'd'}:${offsets.join(',')}`;
    if (scheduled[reminder.id] === stamp) continue;

    for (const offset of offsets) {
      const at = new Date(due);
      if (useMinutes) {
        at.setMinutes(at.getMinutes() - offset);
      } else {
        at.setDate(at.getDate() - offset);
        // A date-only record is stored at local midnight, so subtracting whole
        // days leaves the reminder at 00:00 — the user is asleep. Move it to a
        // sane hour. Records with a real time (an appointment at 14:30) keep it.
        //
        // The server states this outright via `hasExplicitTime`; only fall back
        // to inferring it from the timestamp when the field is absent, since
        // that inference misreads UTC-midnight server rows as having a time.
        const explicit = reminder.hasExplicitTime ?? hasTimeOfDay(due);
        if (!explicit) at.setHours(DEFAULT_NOTIFY_HOUR, 0, 0, 0);
      }
      if (at.getTime() <= Date.now()) {
        console.log(
          `[FamReminder] SKIP (past) "${label}" offset=${offset}${useMinutes ? 'min' : 'd'} -> ${at.toString()}`,
        );
        continue;
      }
      console.log(
        `[FamReminder] ARM "${label}" offset=${offset}${useMinutes ? 'min' : 'd'} -> ${at.toString()}`,
      );

      await scheduleLocalNotification({
        title,
        body: useMinutes
          ? `${label} ${describeLeadMinutes(offset)}`
          : offset === 0
            ? `${label} is due today`
            : `${label} in ${offset} day${offset === 1 ? '' : 's'}`,
        triggerAt: at,
        data,
      });
    }

    scheduled[reminder.id] = stamp;
    changed = true;
  }

  // Cancel repeats whose source record is gone.
  //
  // A repeating trigger outlives the record that created it: deleting a routine
  // or switching it off removes it from the projection, but the OS keeps firing
  // the notification forever. Anything in the ledger that is no longer a live
  // recurring reminder is an orphan and must be cancelled here — this is the
  // only place that can still see its notification ids.
  const liveRepeating = new Set(
    reminders.filter((r) => r.recurrence && !r.isPaid).map((r) => r.id),
  );
  // Only sweep against a projection that actually saw the records. An empty
  // `reminders` array means the caller had nothing to project (a failed fetch,
  // a logged-out moment, a race with member loading) -- NOT that every routine
  // was deleted. Cancelling on that would silently wipe every live repeating
  // trigger the user has, and nothing would re-arm them until they next edited
  // the record, because the ledger is cleared here too.
  const sweepOrphans = reminders.length > 0;
  for (const [reminderId, ids] of Object.entries(repeating)) {
    if (!sweepOrphans) break;
    if (liveRepeating.has(reminderId)) continue;
    console.log(`[FamReminder] CANCEL orphan ${reminderId} (${ids.length} ids)`);
    await cancelScheduledNotifications(ids);
    delete repeating[reminderId];
    delete scheduled[reminderId];
    repeatingChanged = true;
    changed = true;
  }

  if (changed) await saveScheduled(scheduled);
  if (repeatingChanged) await saveRepeatingIds(repeating);
}

/**
 * Rebuilds projections for every member and schedules any new notifications.
 * The single entry point screens call.
 */
export async function syncFamilyReminders(
  members: { id: string; name: string; avatarUrl?: string | null }[],
): Promise<FamilyReminder[]> {
  const reminders = await buildAllFamilyReminders(members);
  await scheduleFamilyReminderNotifications(reminders);
  return reminders;
}
