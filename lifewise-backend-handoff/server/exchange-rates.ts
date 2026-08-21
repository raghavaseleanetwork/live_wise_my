// Daily INR exchange rate history. Source: Frankfurter (ECB reference rates,
// free, no API key). Rates are stored once per calendar day and never
// rewritten — a past day's rate is immutable, so caching is safe forever.
//
// Rate direction: rate means "1 INR = `rate` units of `currency`" (base=INR).
// USD should sit around 0.011, JPY around 1.8 — if USD comes out near 86,
// the direction has been inverted somewhere.

export const SUPPORTED_CURRENCIES = ['USD', 'EUR', 'GBP', 'JPY', 'AUD', 'CAD'] as const;
export type SupportedCurrency = (typeof SUPPORTED_CURRENCIES)[number];

export const CURRENCY_SYMBOLS: Record<'INR' | SupportedCurrency, string> = {
  INR: '₹',
  USD: '$',
  EUR: '€',
  GBP: '£',
  JPY: '¥',
  AUD: 'A$',
  CAD: 'C$',
};

// Matches Intl locale conventions per currency (JPY has no decimal subunit).
const CURRENCY_LOCALES: Record<'INR' | SupportedCurrency, { locale: string; maximumFractionDigits: number }> = {
  INR: { locale: 'en-IN', maximumFractionDigits: 2 },
  USD: { locale: 'en-US', maximumFractionDigits: 2 },
  EUR: { locale: 'de-DE', maximumFractionDigits: 2 },
  GBP: { locale: 'en-GB', maximumFractionDigits: 2 },
  JPY: { locale: 'ja-JP', maximumFractionDigits: 0 },
  AUD: { locale: 'en-AU', maximumFractionDigits: 2 },
  CAD: { locale: 'en-CA', maximumFractionDigits: 2 },
};

export function isSupportedPreferredCurrency(code: any): code is 'INR' | SupportedCurrency {
  return code === 'INR' || (SUPPORTED_CURRENCIES as readonly string[]).includes(code);
}

export function formatAmountForCurrency(amount: number, currency: 'INR' | SupportedCurrency): string {
  const cfg = CURRENCY_LOCALES[currency] || CURRENCY_LOCALES.INR;
  return amount.toLocaleString(cfg.locale, { maximumFractionDigits: cfg.maximumFractionDigits });
}

const FRANKFURTER_BASE = 'https://api.frankfurter.dev/v1';
const symbolsParam = SUPPORTED_CURRENCIES.join(',');

function toDateKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

// Fetches and upserts the rate for a single date. Used by the daily job.
// A day with no published rate (weekend/holiday) is left absent, matching
// the "omit rather than send nulls" rule the client's fallback relies on.
export async function fetchAndStoreRateForDate(
  ratesCollection: any,
  dateKey: string,
): Promise<boolean> {
  const res = await fetch(`${FRANKFURTER_BASE}/${dateKey}?base=INR&symbols=${symbolsParam}`);
  if (!res.ok) return false;
  const json: any = await res.json();
  if (!json?.rates || json.date !== dateKey) return false; // no rate published for this date

  await ratesCollection.updateOne(
    { date: dateKey },
    { $set: { date: dateKey, base: 'INR', rates: json.rates, updatedAt: new Date() } },
    { upsert: true },
  );
  return true;
}

// One-time/backfill: fetches a whole date range in a single request and
// upserts every day Frankfurter returns data for.
export async function backfillRateRange(
  ratesCollection: any,
  fromDateKey: string,
  toDateKey: string,
): Promise<number> {
  const res = await fetch(`${FRANKFURTER_BASE}/${fromDateKey}..${toDateKey}?base=INR&symbols=${symbolsParam}`);
  if (!res.ok) throw new Error(`Frankfurter range fetch failed: ${res.status}`);
  const json: any = await res.json();
  const days = Object.entries(json?.rates || {});
  if (!days.length) return 0;

  const ops = days.map(([date, rates]) => ({
    updateOne: {
      filter: { date },
      update: { $set: { date, base: 'INR', rates, updatedAt: new Date() } },
      upsert: true,
    },
  }));
  await ratesCollection.bulkWrite(ops);
  return ops.length;
}

export function startDailyExchangeRateJob(ratesCollection: any) {
  const CHECK_INTERVAL_MS = 60 * 60 * 1000; // hourly; the fetch itself is a no-op once today's rate is stored
  let running = false;

  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const todayKey = toDateKey(new Date());
      const existing = await ratesCollection.findOne({ date: todayKey });
      if (existing) return;
      const stored = await fetchAndStoreRateForDate(ratesCollection, todayKey);
      if (stored) {
        console.log(`[ExchangeRates] Stored rate for ${todayKey}`);
      } else {
        // Not published yet today (ECB publishes on a delay) or a holiday —
        // yesterday's row (already stored) remains the most recent fallback.
        console.log(`[ExchangeRates] No rate published yet for ${todayKey}`);
      }
    } catch (err) {
      console.error('[ExchangeRates] Daily job error:', err);
    } finally {
      running = false;
    }
  };

  tick();
  setInterval(tick, CHECK_INTERVAL_MS);
}

// Looks up the most recent rate at or before `dateKey` — never a future date,
// which would value a past expense using a rate that didn't exist yet.
export async function getRateOnOrBefore(
  ratesCollection: any,
  dateKey: string,
): Promise<{ date: string; rates: Record<string, number> } | null> {
  const docs = await ratesCollection
    .find({ date: { $lte: dateKey } })
    .sort({ date: -1 })
    .limit(1)
    .toArray();
  const doc = docs[0];
  return doc ? { date: doc.date, rates: doc.rates } : null;
}
