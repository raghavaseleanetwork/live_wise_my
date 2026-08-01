import { apiRequest } from '@/lib/query-client';

/**
 * Server-provided exchange rate history.
 *
 * The client records a rate snapshot each day it runs (`recordTodaysRates`),
 * but that only ever accumulates forward from install. The public rate endpoint
 * the app uses has no historical API, so rates from before the install are
 * simply unknowable on-device — and every transaction older than that falls
 * back to today's rate, restating what the user spent.
 *
 * The backend backfilled two years and updates daily, so this closes that gap.
 * See `backend-team/app docs/CURRENCY_BACKEND_NOTE.md` §4.
 */

export interface RateHistoryResponse {
  base: string;
  rates: Record<string, Record<string, number>>;
}

/**
 * Fetches `[from, to]` inclusive, both `YYYY-MM-DD`.
 *
 * Returns null on any failure. Callers keep whatever history they already have
 * rather than treating "unreachable" as "no rates exist".
 *
 * Days with no published rate (weekends, ECB holidays) are absent from the
 * response rather than null — the consumer's "fall back to the most recent
 * earlier day" rule handles those, which is why they must not be invented here.
 */
export async function fetchRateHistory(
  from: string,
  to: string,
  token: string | null,
): Promise<Record<string, Record<string, number>> | null> {
  if (!token) return null;
  try {
    const res = await apiRequest(
      'GET',
      `/api/exchange-rates/history?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
      undefined,
      token,
    );
    if (!res.ok) return null;
    const data = (await res.json()) as RateHistoryResponse;

    // The server documents base INR, matching how amounts are stored. If that
    // ever changed, every converted amount would be silently wrong by orders of
    // magnitude, so refuse the payload rather than apply it.
    if (data?.base !== 'INR' || !data.rates || typeof data.rates !== 'object') {
      return null;
    }
    return data.rates;
  } catch {
    return null;
  }
}
