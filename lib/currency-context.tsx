import React, { createContext, useContext, useState, useEffect, useCallback, useMemo, ReactNode } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  BASE_CURRENCY,
  backfillHistoryFromServer,
  fallbackTable,
  fetchRates,
  fromBase,
  fromBaseOn,
  loadCachedRates,
  loadHistory,
  ratesAreStale,
  recordTodaysRates,
  toBase,
  type HistoricalRates,
  type RateTable,
} from '@/lib/exchange-rates';
import { fetchRateHistory } from '@/lib/exchange-rates-api';

export interface CurrencyOption {
  symbol: string;
  code: string;
  name: string;
}

export const CURRENCIES: CurrencyOption[] = [
  { symbol: '₹', code: 'INR', name: 'Indian Rupee' },
  { symbol: '$', code: 'USD', name: 'US Dollar' },
  { symbol: '€', code: 'EUR', name: 'Euro' },
  { symbol: '£', code: 'GBP', name: 'British Pound' },
  { symbol: '¥', code: 'JPY', name: 'Japanese Yen' },
  { symbol: 'A$', code: 'AUD', name: 'Australian Dollar' },
  { symbol: 'C$', code: 'CAD', name: 'Canadian Dollar' },
];

interface CurrencyContextValue {
  symbol: string;
  code: string;
  setCurrency: (code: string) => void;
  /** Formats a stored (INR) amount in the user's currency. */
  formatAmount: (amount: number) => string;
  formatCompactAmount: (amount: number) => string;
  currentCurrency: CurrencyOption;
  /**
   * Converts a stored INR amount into the display currency as a raw number.
   * For the rare caller that needs the value rather than a formatted string —
   * chart axes, CSV export, an input's initial text.
   */
  convertForDisplay: (amount: number) => number;
  /**
   * Converts a user-entered amount from the display currency into INR for
   * storage. **Every input path that saves an amount must call this**, or a
   * user on USD typing "50" saves ₹50.
   */
  convertForStorage: (amount: number) => number;
  /** True when rates are missing or over a day old, so the UI can say so. */
  isRateStale: boolean;
  ratesUpdatedAt: string | null;
  refreshRates: () => Promise<void>;
  /**
   * Formats a stored (INR) amount using the rate that applied on `date`, so a
   * past expense is not restated every time the rupee moves. Use this wherever
   * the amount belongs to a dated record — transactions, bills, reports.
   */
  formatAmountOn: (amount: number, date: Date | string) => string;
  /** `formatAmountOn` as a raw number, for charts and totals. */
  convertForDisplayOn: (amount: number, date: Date | string) => number;
  /**
   * Formats a value that has ALREADY been converted — symbol and grouping only,
   * no further conversion.
   *
   * Needed for totals built by summing `convertForDisplayOn` per row. Passing
   * such a total to `formatAmount` would convert it a second time.
   */
  formatConverted: (value: number) => string;
  /**
   * Merges the server's 2-year rate history into the local store, so
   * transactions predating this install convert at their own date's rate
   * instead of today's.
   *
   * Takes a token because `CurrencyProvider` sits OUTSIDE `AuthProvider` (see
   * `app/_layout.tsx`) and so cannot call `useAuth` itself. Runs once per
   * install; safe to call repeatedly.
   */
  backfillRateHistory: (token: string | null) => Promise<void>;
}

const CurrencyContext = createContext<CurrencyContextValue | null>(null);

const STORAGE_KEY = '@lifewise_currency';

export function CurrencyProvider({ children }: { children: ReactNode }) {
  const [code, setCode] = useState(BASE_CURRENCY);
  const [rateTable, setRateTable] = useState<RateTable>(() => fallbackTable());
  const [history, setHistory] = useState<HistoricalRates>({});

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY).then(stored => {
      if (stored && CURRENCIES.find(c => c.code === stored)) {
        setCode(stored);
      }
    }).catch(() => {});
  }, []);

  // Cache first so amounts render with real rates on the very first frame,
  // then refresh in the background if that cache is stale.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [cached, storedHistory] = await Promise.all([loadCachedRates(), loadHistory()]);
      if (!cancelled) {
        if (cached) setRateTable(cached);
        setHistory(storedHistory);
      }
      if (ratesAreStale(cached)) {
        const fresh = await fetchRates();
        if (fresh) {
          // Record before setting state so today's rate is in history the first
          // time anything renders with it.
          const updated = await recordTodaysRates(fresh);
          if (!cancelled) {
            setRateTable(fresh);
            setHistory(updated);
          }
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const backfillRateHistory = useCallback(async (token: string | null) => {
    if (!token) return;
    const merged = await backfillHistoryFromServer((from, to) =>
      fetchRateHistory(from, to, token),
    );
    if (merged) setHistory(merged);
  }, []);

  const refreshRates = useCallback(async () => {
    const fresh = await fetchRates();
    if (fresh) {
      const updated = await recordTodaysRates(fresh);
      setRateTable(fresh);
      setHistory(updated);
    }
  }, []);

  const setCurrency = useCallback((newCode: string) => {
    setCode(newCode);
    AsyncStorage.setItem(STORAGE_KEY, newCode).catch(() => {});
    // Switching currency is the moment a stale rate is most visible, so take
    // the opportunity to refresh. Fire-and-forget: the switch must feel instant.
    void refreshRates();
  }, [refreshRates]);

  const currentCurrency = useMemo(() =>
    CURRENCIES.find(c => c.code === code) || CURRENCIES[0],
    [code]
  );

  const convertForDisplay = useCallback(
    (amount: number) => fromBase(amount, code, rateTable),
    [code, rateTable],
  );

  const convertForStorage = useCallback(
    (amount: number) => toBase(amount, code, rateTable),
    [code, rateTable],
  );

  /**
   * Decimal places for the display currency.
   *
   * Whole units only for INR and JPY: rupee amounts in this app are everyday
   * spending where paise are noise, and the yen has no minor unit at all.
   * Everything else gets 2, because $1.16 rendered as "$1" is a visible loss of
   * precision on a small amount.
   */
  const decimalsFor = (target: string) => (target === 'INR' || target === 'JPY' ? 0 : 2);

  /**
   * Renders an already-converted value. Shared by the dated and undated
   * formatters so they cannot drift apart in symbol, grouping, or decimals.
   */
  const render = useCallback((value: number): string => {
    const sym = currentCurrency.symbol;
    const decimals = decimalsFor(code);

    // Lakh is an Indian-numbering convention. Applying it to dollars ("$1.2L")
    // is meaningless, so the compact form is INR-only; other currencies use
    // grouped digits here and get K/M/B in formatCompactAmount.
    if (code === 'INR' && value >= 100000) {
      return `${sym}${(value / 100000).toFixed(1)}L`;
    }

    return `${sym}${value.toLocaleString(code === 'INR' ? 'en-IN' : 'en-US', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    })}`;
  }, [code, currentCurrency]);

  const formatAmount = useCallback(
    (amount: number): string => render(fromBase(amount, code, rateTable)),
    [render, code, rateTable],
  );

  const convertForDisplayOn = useCallback(
    (amount: number, date: Date | string) =>
      fromBaseOn(amount, code, date, history, rateTable),
    [code, history, rateTable],
  );

  const formatAmountOn = useCallback(
    (amount: number, date: Date | string): string => render(convertForDisplayOn(amount, date)),
    [render, convertForDisplayOn],
  );

  const formatCompactAmount = useCallback((amount: number): string => {
    const sym = currentCurrency.symbol;
    const value = fromBase(amount, code, rateTable);

    // Below the abbreviation threshold the full number is short enough to read.
    if (value < 10000) {
      return formatAmount(amount);
    }

    if (code === 'INR') {
      if (value >= 10000000) return `${sym}${(value / 10000000).toFixed(1)}Cr`;
      if (value >= 100000) return `${sym}${(value / 100000).toFixed(1)}L`;
      return `${sym}${(value / 1000).toFixed(1)}K`;
    }

    if (value >= 1000000000) return `${sym}${(value / 1000000000).toFixed(1)}B`;
    if (value >= 1000000) return `${sym}${(value / 1000000).toFixed(1)}M`;
    return `${sym}${(value / 1000).toFixed(1)}K`;
  }, [code, currentCurrency, rateTable, formatAmount]);

  const value = useMemo(() => ({
    symbol: currentCurrency.symbol,
    code,
    setCurrency,
    formatAmount,
    formatCompactAmount,
    currentCurrency,
    convertForDisplay,
    convertForStorage,
    isRateStale: ratesAreStale(rateTable),
    ratesUpdatedAt: rateTable.isLive ? rateTable.fetchedAt : null,
    refreshRates,
    formatAmountOn,
    convertForDisplayOn,
    formatConverted: render,
    backfillRateHistory,
  }), [
    code, currentCurrency, setCurrency, formatAmount, formatCompactAmount,
    convertForDisplay, convertForStorage, rateTable, refreshRates,
    formatAmountOn, convertForDisplayOn, render, backfillRateHistory,
  ]);

  return (
    <CurrencyContext.Provider value={value}>
      {children}
    </CurrencyContext.Provider>
  );
}

export function useCurrency() {
  const context = useContext(CurrencyContext);
  if (!context) {
    throw new Error('useCurrency must be used within a CurrencyProvider');
  }
  return context;
}
