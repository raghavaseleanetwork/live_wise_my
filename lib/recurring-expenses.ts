/**
 * Recurring expense templates — Method 6 in the product doc.
 *
 * For predictable monthly outgoings (rent, EMI, subscriptions, fixed bills) the
 * user defines the expense once and the app offers it back on the due date.
 *
 * IMPORTANT — the doc says "App auto-adds it every month on the correct date",
 * but this deliberately does NOT auto-save. The doc's own step 2 says the push
 * reads "Tap to confirm or edit", and silently writing money movements the user
 * never approved is the kind of thing that erodes trust in the ledger. Rent is
 * also the field most likely to change month to month. So: the due date
 * produces a *pending* entry the user confirms with one tap.
 *
 * Templates are stored SERVER-SIDE via `/api/recurring`, so they sync across
 * devices and survive reinstall. `POST /api/recurring/:id/handled` only records
 * that a period was dealt with — it does not create a transaction. The confirmed
 * expense goes through `POST /api/transactions` like any other.
 */
import { CategoryType, PaymentMode } from './data';
import { apiRequest } from './query-client';

export interface RecurringExpense {
  id: string;
  name: string;
  amount: number;
  category: CategoryType;
  /** Day of month the expense falls due, 1-31. Server clamps to the month's length. */
  dayOfMonth: number;
  memberId?: string | null;
  paymentMode?: PaymentMode;
  /** ISO month key ("2026-07") of the last period the user confirmed or skipped. */
  lastHandledPeriod?: string | null;
  createdAt: string;
}

/** A template that has come due for a period the user has not yet acted on. */
export interface DueRecurringExpense {
  template: RecurringExpense;
  /** The period key this occurrence belongs to, e.g. "2026-07". */
  period: string;
  /** The date the occurrence was due, with dayOfMonth clamped to the month. */
  dueDate: Date;
}

function periodKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/**
 * Resolve a template's day-of-month against a real month. A template set to the
 * 31st must still fire in February, so the day is clamped to the month's length
 * rather than rolling into the next month. The server applies the same rule;
 * this keeps the UI correct without a round trip.
 */
function occurrenceDate(year: number, month: number, dayOfMonth: number): Date {
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  return new Date(year, month, Math.min(dayOfMonth, daysInMonth));
}

export async function loadRecurringExpenses(token: string | null): Promise<RecurringExpense[]> {
  if (!token) return [];
  try {
    const res = await apiRequest('GET', '/api/recurring', undefined, token);
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data) ? (data as RecurringExpense[]) : [];
  } catch {
    return [];
  }
}

export async function saveRecurringExpense(
  token: string | null,
  input: Omit<RecurringExpense, 'id' | 'createdAt' | 'lastHandledPeriod'>,
): Promise<RecurringExpense | null> {
  if (!token) return null;
  try {
    const res = await apiRequest(
      'POST',
      '/api/recurring',
      {
        ...input,
        // Clamp on the way out so a bad value never reaches the server.
        dayOfMonth: Math.min(31, Math.max(1, Math.round(input.dayOfMonth))),
      },
      token,
    );
    if (!res.ok) return null;
    return (await res.json()) as RecurringExpense;
  } catch {
    return null;
  }
}

export async function updateRecurringExpense(
  token: string | null,
  updated: RecurringExpense,
): Promise<boolean> {
  if (!token) return false;
  try {
    const res = await apiRequest('PUT', `/api/recurring/${updated.id}`, updated, token);
    return res.ok;
  } catch {
    return false;
  }
}

export async function deleteRecurringExpense(
  token: string | null,
  id: string,
): Promise<boolean> {
  if (!token) return false;
  try {
    const res = await apiRequest('DELETE', `/api/recurring/${id}`, undefined, token);
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Mark a template as dealt with for a period, so it stops being offered.
 * Used for both "confirmed" and "skipped" — the ledger records the difference,
 * the template only needs to know not to ask again this month.
 */
export async function markRecurringHandled(
  token: string | null,
  id: string,
  period: string,
): Promise<boolean> {
  if (!token) return false;
  try {
    const res = await apiRequest('POST', `/api/recurring/${id}/handled`, { period }, token);
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Templates whose due date has passed in the current period and which the user
 * has not yet confirmed or skipped. Derived from an already-fetched list so the
 * caller controls when the network is touched.
 *
 * Only the current period is considered. Catching up months of missed
 * occurrences would need a real scheduler on the server; offering to backfill
 * six months of rent from a stale template would do more harm than good.
 */
export function getDueRecurringExpenses(
  templates: RecurringExpense[],
  now: Date = new Date(),
): DueRecurringExpense[] {
  const period = periodKey(now);

  return templates.reduce<DueRecurringExpense[]>((due, template) => {
    if (template.lastHandledPeriod === period) return due;
    const dueDate = occurrenceDate(now.getFullYear(), now.getMonth(), template.dayOfMonth);
    // Compare by date only — an expense due today should appear from midnight,
    // not from whatever time of day the template happened to be created.
    const dueMidnight = new Date(dueDate.getFullYear(), dueDate.getMonth(), dueDate.getDate());
    const todayMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    if (dueMidnight.getTime() <= todayMidnight.getTime()) {
      due.push({ template, period, dueDate });
    }
    return due;
  }, []);
}

/**
 * Detect a repeating manual entry and suggest making it recurring — the doc's
 * "Smart suggestion: App detects repeating manual entries". Looks for the same
 * merchant at a similar amount in 2+ distinct recent months.
 */
export function suggestRecurringCandidate(
  transactions: { merchant: string; amount: number; date: string }[],
  existing: RecurringExpense[],
): { merchant: string; amount: number } | null {
  const byMerchant = new Map<string, { months: Set<string>; amounts: number[] }>();

  for (const t of transactions) {
    const key = t.merchant.trim().toLowerCase();
    if (!key) continue;
    if (existing.some((r) => r.name.trim().toLowerCase() === key)) continue;
    const entry = byMerchant.get(key) ?? { months: new Set<string>(), amounts: [] };
    entry.months.add(periodKey(new Date(t.date)));
    entry.amounts.push(t.amount);
    byMerchant.set(key, entry);
  }

  for (const [merchant, { months, amounts }] of byMerchant) {
    if (months.size < 2) continue;
    const avg = amounts.reduce((a, b) => a + b, 0) / amounts.length;
    // Require the amounts to be close together; a merchant visited monthly at
    // wildly different amounts (a supermarket) is not a fixed recurring expense.
    const withinBand = amounts.every((a) => Math.abs(a - avg) <= avg * 0.15);
    if (!withinBand) continue;
    return { merchant, amount: Math.round(avg) };
  }
  return null;
}
