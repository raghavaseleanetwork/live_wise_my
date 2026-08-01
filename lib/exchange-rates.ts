import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Exchange rates for display conversion.
 *
 * ## The invariant this whole file rests on
 *
 * **Every amount in this app is stored in INR and is never rewritten.**
 *
 * No transaction, bill, or budget carries a currency tag — not on the client,
 * not in the server schema (`server/routes.ts` has no currency column on any
 * record). A stored `100` is 100 rupees, always. Currency selection is a
 * *display* preference: it changes how that 100 is rendered, never what is
 * saved.
 *
 * That is a deliberate choice, and the alternative is worse. If changing the
 * display currency rewrote stored amounts, then switching INR → USD → INR would
 * round-trip every historical record through two conversions and quietly
 * corrupt the user's data — ₹100 comes back as ₹99.87. Worse, a rate that moves
 * overnight would silently restate what the user spent last year. Storing one
 * canonical currency and converting only at render is the only version of this
 * that is safe to run against real financial history.
 *
 * ## Consequence for input
 *
 * Amounts the user TYPES are interpreted in their selected currency and
 * converted to INR before saving — see `toBase()`. Otherwise a user on USD who
 * types "50" would save ₹50 and see it come back as $0.60.
 */

/** The currency every stored amount is denominated in. */
export const BASE_CURRENCY = 'INR';

/**
 * Fallback rates, expressed as "1 INR = X units of the target currency".
 *
 * These exist so the app is never unable to render a number: on a cold start
 * with no network and no cached rates, conversion still works. They are
 * approximate and WILL drift — `fetchRates()` replaces them whenever the
 * network allows, and `ratesAreStale()` lets the UI say so.
 *
 * Do not "correct" these by hand as rates move; that is what the fetch is for.
 */
const FALLBACK_RATES: Record<string, number> = {
  INR: 1,
  USD: 0.0116,
  EUR: 0.0107,
  GBP: 0.0092,
  JPY: 1.78,
  AUD: 0.0180,
  CAD: 0.0163,
};

export interface RateTable {
  /** "1 INR = rates[code]" for every supported currency. */
  rates: Record<string, number>;
  /** When these were fetched. ISO string. */
  fetchedAt: string;
  /** False when the values came from `FALLBACK_RATES` rather than the network. */
  isLive: boolean;
}

const CACHE_KEY = '@lifewise_exchange_rates';

/**
 * How long a fetched table is considered current.
 *
 * A day is the right granularity for personal expense tracking: intraday FX
 * moves are far smaller than the rounding the user sees, and refetching more
 * often would spend battery and quota to change the second decimal place.
 */
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

/**
 * Public, key-less endpoint. Chosen so the app has working conversion with no
 * signup and no secret to leak in a client bundle. If it is ever unreachable
 * the cached or fallback table is used, so this is not a hard dependency.
 */
const RATES_URL = `https://open.er-api.com/v6/latest/${BASE_CURRENCY}`;

export function fallbackTable(): RateTable {
  return {
    rates: { ...FALLBACK_RATES },
    // Epoch, not "now": these are not a successful fetch and must never look
    // fresh, or a failed first load would suppress refetching for a day.
    fetchedAt: new Date(0).toISOString(),
    isLive: false,
  };
}

export function ratesAreStale(table: RateTable | null): boolean {
  if (!table || !table.isLive) return true;
  const age = Date.now() - new Date(table.fetchedAt).getTime();
  return Number.isNaN(age) || age > MAX_AGE_MS;
}

export async function loadCachedRates(): Promise<RateTable | null> {
  try {
    const raw = await AsyncStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as RateTable;
    if (!parsed?.rates || typeof parsed.rates !== 'object') return null;
    return parsed;
  } catch {
    return null;
  }
}

async function saveRates(table: RateTable): Promise<void> {
  try {
    await AsyncStorage.setItem(CACHE_KEY, JSON.stringify(table));
  } catch {
    // A failed cache write costs one refetch, never a crash.
  }
}

/**
 * Fetches a fresh table. Returns null on any failure — callers keep using
 * whatever they already had rather than falling back to hardcoded numbers that
 * may be older than the cache.
 */
export async function fetchRates(): Promise<RateTable | null> {
  try {
    const controller = new AbortController();
    // Conversion is never blocking — a cached or fallback table is always
    // available — so a slow network must not leave this hanging.
    const timeout = setTimeout(() => controller.abort(), 10000);
    const res = await fetch(RATES_URL, { signal: controller.signal });
    clearTimeout(timeout);

    if (!res.ok) return null;
    const json = (await res.json()) as { result?: string; rates?: Record<string, number> };
    if (json.result !== 'success' || !json.rates) return null;

    // Keep only the currencies the app offers, and only sane values. A missing
    // or zero rate would produce Infinity/NaN on conversion.
    const rates: Record<string, number> = { [BASE_CURRENCY]: 1 };
    for (const code of Object.keys(FALLBACK_RATES)) {
      const value = json.rates[code];
      if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
        rates[code] = value;
      }
    }

    const table: RateTable = {
      rates,
      fetchedAt: new Date().toISOString(),
      isLive: true,
    };
    await saveRates(table);
    return table;
  } catch {
    return null;
  }
}

/**
 * Converts a stored (INR) amount into `code` for display.
 *
 * Falls back to the identity when a rate is missing rather than throwing or
 * returning 0 — showing the unconverted number is wrong, but showing ₹0 for a
 * real expense is worse and looks like data loss.
 */
export function fromBase(amount: number, code: string, table: RateTable | null): number {
  if (code === BASE_CURRENCY) return amount;
  const rate = table?.rates?.[code];
  if (!rate || !Number.isFinite(rate)) return amount;
  return amount * rate;
}

// ---------------------------------------------------------------------------
// Historical rates
// ---------------------------------------------------------------------------

/**
 * Rates on specific past dates, so an expense is converted at the rate that
 * applied on the day it happened rather than today's.
 *
 * Why this matters: with a single current rate, last year's ₹10,000 grocery
 * bill is restated every time the rupee moves. A user reviewing their 2025
 * spending in USD would see the totals shift month to month even though not one
 * transaction changed. Reports become impossible to reconcile against anything.
 *
 * Keyed `YYYY-MM-DD`. Day granularity is right for personal finance — intraday
 * movement is far below the rounding the user sees.
 */
export type HistoricalRates = Record<string, Record<string, number>>;

const HISTORY_KEY = '@lifewise_exchange_rate_history';

/**
 * How many past days to keep. Two years covers the reporting ranges the app
 * offers (up to a year, plus year-on-year comparison) without letting the cache
 * grow without bound.
 */
const MAX_HISTORY_DAYS = 730;

/** `YYYY-MM-DD` in local time — matches how the app buckets dates elsewhere. */
export function dateKey(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  if (Number.isNaN(d.getTime())) return '';
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${month}-${day}`;
}

export async function loadHistory(): Promise<HistoricalRates> {
  try {
    const raw = await AsyncStorage.getItem(HISTORY_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as HistoricalRates;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export async function saveHistory(history: HistoricalRates): Promise<void> {
  try {
    // Trim oldest first. Keys are `YYYY-MM-DD`, so lexicographic sort is
    // chronological — no date parsing needed.
    const keys = Object.keys(history).sort();
    const trimmed =
      keys.length <= MAX_HISTORY_DAYS
        ? history
        : keys.slice(keys.length - MAX_HISTORY_DAYS).reduce<HistoricalRates>((acc, k) => {
            acc[k] = history[k];
            return acc;
          }, {});
    await AsyncStorage.setItem(HISTORY_KEY, JSON.stringify(trimmed));
  } catch {
    // A failed write costs precision on old rows, never a crash.
  }
}

/** Set once the server's backfill has been merged, so it runs only once. */
const BACKFILL_KEY = '@lifewise_exchange_rate_backfilled';

/**
 * Merges the server's rate history into the local store.
 *
 * This fills the one gap the client cannot close on its own: `recordTodaysRates`
 * only accumulates from install day forward, and the public rate API has no
 * historical endpoint (verified — date-specific queries 404). So without this,
 * every transaction older than the install still falls back to today's rate,
 * which is exactly the restatement problem historical rates exist to prevent.
 *
 * Runs once. A past day's rate is immutable, so re-fetching it would spend
 * bandwidth to write identical values.
 *
 * Local entries win on conflict: `recordTodaysRates` wrote them from a live
 * reading on the day itself, which is at least as good as the server's row, and
 * preferring the server would rewrite history the user has already seen.
 */
export async function backfillHistoryFromServer(
  fetchRange: (from: string, to: string) => Promise<Record<string, Record<string, number>> | null>,
): Promise<HistoricalRates | null> {
  try {
    if ((await AsyncStorage.getItem(BACKFILL_KEY)) === 'true') return null;

    const to = new Date();
    const from = new Date();
    from.setDate(from.getDate() - MAX_HISTORY_DAYS);

    const serverRates = await fetchRange(dateKey(from), dateKey(to));
    if (!serverRates) return null;

    const history = await loadHistory();
    for (const [day, rates] of Object.entries(serverRates)) {
      if (history[day]) continue;
      // Guard the same way `fetchRates` does — a zero or non-finite rate would
      // produce Infinity/NaN downstream.
      const clean: Record<string, number> = {};
      for (const [code, value] of Object.entries(rates)) {
        if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
          clean[code] = value;
        }
      }
      if (Object.keys(clean).length) history[day] = clean;
    }

    await saveHistory(history);
    await AsyncStorage.setItem(BACKFILL_KEY, 'true');
    return history;
  } catch {
    // Backfill is an accuracy improvement, never a requirement — the app falls
    // back to the current rate exactly as it did before this feature.
    return null;
  }
}

/**
 * Records today's rates into the history. Called whenever a live table is
 * fetched, so the app accumulates an accurate record from the day it is
 * installed forward.
 *
 * Today's entry is overwritten rather than skipped if present: a later fetch on
 * the same day is a better reading than an earlier one.
 */
export async function recordTodaysRates(table: RateTable): Promise<HistoricalRates> {
  if (!table.isLive) return loadHistory();
  const history = await loadHistory();
  history[dateKey(new Date())] = { ...table.rates };
  await saveHistory(history);
  return history;
}

/**
 * The rate for `code` on `date`, or null if unknown.
 *
 * Falls back to the most recent EARLIER entry when the exact day is missing —
 * weekends and holidays have no published rate, and Friday's rate is the right
 * answer for Saturday. Never looks forward: using a future rate to value a past
 * expense is the restatement problem this module exists to avoid.
 */
export function rateOn(
  date: Date | string,
  code: string,
  history: HistoricalRates,
): number | null {
  if (code === BASE_CURRENCY) return 1;
  const key = dateKey(date);
  if (!key) return null;

  const exact = history[key]?.[code];
  if (typeof exact === 'number' && Number.isFinite(exact) && exact > 0) return exact;

  let best: string | null = null;
  for (const k of Object.keys(history)) {
    if (k <= key && (best === null || k > best)) best = k;
  }
  if (!best) return null;

  const rate = history[best]?.[code];
  return typeof rate === 'number' && Number.isFinite(rate) && rate > 0 ? rate : null;
}

/**
 * Converts a stored INR amount using the rate that applied on `date`.
 *
 * Falls back to the current table when history has nothing at or before that
 * date — the common case for records predating installation. That is the same
 * behaviour as before this feature existed, so nothing regresses; the app
 * simply gets more accurate as history accumulates.
 */
export function fromBaseOn(
  amount: number,
  code: string,
  date: Date | string,
  history: HistoricalRates,
  current: RateTable | null,
): number {
  if (code === BASE_CURRENCY) return amount;
  const historical = rateOn(date, code, history);
  if (historical !== null) return amount * historical;
  return fromBase(amount, code, current);
}

/**
 * Converts a user-entered amount in `code` back to INR for storage.
 * The exact inverse of `fromBase` — every input path must apply this.
 */
export function toBase(amount: number, code: string, table: RateTable | null): number {
  if (code === BASE_CURRENCY) return amount;
  const rate = table?.rates?.[code];
  if (!rate || !Number.isFinite(rate) || rate === 0) return amount;
  return amount / rate;
}
