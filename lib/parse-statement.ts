/**
 * Bank statement CSV/Excel parsing — Method 5 in the product doc.
 *
 * Written by hand rather than pulling in Papa Parse because bank CSV exports are
 * simple (no embedded newlines in practice, one header row) and the column-
 * mapping problem — which is the actual hard part — is not something a CSV
 * library solves for you.
 *
 * The doc rates CSV as "near 100% accurate since it's structured data" and
 * recommends it over PDF for exactly that reason. This module handles the
 * formats HDFC / ICICI / Axis / SBI / Kotak actually emit, which differ mostly
 * in column naming and in whether debit and credit are separate columns or one
 * signed amount.
 *
 * Nothing here touches the network. PDF is a separate path (server-side; see
 * EXPENSE_ENTRY_BACKEND_TODO.md §4) because React Native cannot extract PDF text.
 */
import { CategoryType } from './data';

export interface ParsedStatementRow {
  /** Stable id for list keys and selection state. Not sent to the server. */
  id: string;
  /** ISO date string. */
  date: string;
  description: string;
  amount: number;
  isDebit: boolean;
  category: CategoryType;
  /** True when the row's date or amount had to be guessed; surfaced in the UI. */
  uncertain: boolean;
}

export interface ParseStatementResult {
  rows: ParsedStatementRow[];
  /** Header names we mapped, for the "detected columns" line in the UI. */
  mapping: { date?: string; description?: string; amount?: string; debit?: string; credit?: string };
  /** Rows present in the file that could not be understood. */
  skipped: number;
  totalDataRows: number;
  error?: string;
}

/* ------------------------------------------------------------------ *
 * CSV tokenising
 * ------------------------------------------------------------------ */

/**
 * Split one CSV line, honouring double-quoted fields and "" escapes.
 * Bank descriptions frequently contain commas ("PAYMENT TO XYZ, MUMBAI").
 */
function splitCsvLine(line: string, delimiter: string): string[] {
  const out: string[] = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === delimiter) {
      out.push(field.trim());
      field = '';
    } else {
      field += ch;
    }
  }
  out.push(field.trim());
  return out;
}

/**
 * Guess the delimiter. Indian bank exports are usually comma, but tab and
 * semicolon both appear (the latter from Excel saved in some locales).
 */
function detectDelimiter(sample: string): string {
  const candidates = [',', '\t', ';', '|'];
  let best = ',';
  let bestCount = 0;
  for (const d of candidates) {
    // Count on the header-ish region only; body rows can skew this.
    const count = (sample.split('\n').slice(0, 5).join('\n').match(new RegExp(`\\${d}`, 'g')) || []).length;
    if (count > bestCount) {
      bestCount = count;
      best = d;
    }
  }
  return best;
}

/* ------------------------------------------------------------------ *
 * Column mapping
 * ------------------------------------------------------------------ */

const DATE_HEADERS = /^(txn|transaction|value|tran|post(ing)?|book(ing)?)?\s*[-_ ]?date$|^date$|^date of transaction$|^txn dt$/i;
const DESC_HEADERS = /^(narration|description|particulars|remarks|details|transaction details|narrative|transaction remarks)$/i;
const DEBIT_HEADERS = /^(debit|withdrawal|withdrawal amt\.?|withdrawal amount|dr|debit amount|paid out)$/i;
const CREDIT_HEADERS = /^(credit|deposit|deposit amt\.?|deposit amount|cr|credit amount|paid in)$/i;
const AMOUNT_HEADERS = /^(amount|amt|transaction amount|txn amount|amount \(inr\)|amount\(inr\))$/i;

/** Find the header row. Some banks prepend account-summary junk lines. */
function findHeaderRow(lines: string[], delimiter: string): number {
  for (let i = 0; i < Math.min(lines.length, 25); i++) {
    const cells = splitCsvLine(lines[i], delimiter).map((c) => c.replace(/\s+/g, ' ').trim());
    const hasDate = cells.some((c) => DATE_HEADERS.test(c));
    const hasMoney = cells.some(
      (c) => DEBIT_HEADERS.test(c) || CREDIT_HEADERS.test(c) || AMOUNT_HEADERS.test(c),
    );
    if (hasDate && hasMoney) return i;
  }
  return -1;
}

/* ------------------------------------------------------------------ *
 * Value coercion
 * ------------------------------------------------------------------ */

/**
 * Build an ISO string for a calendar date at UTC midnight.
 *
 * `new Date(y, m, d).toISOString()` is WRONG here: it interprets the parts as
 * local time then serialises to UTC, so in India (UTC+5:30) midnight becomes
 * 18:30 the previous day — every imported row lands a day early, and rows on the
 * 1st land in the previous month. A statement date is a calendar date with no
 * timezone, so it is pinned to UTC midnight.
 */
function isoCalendarDate(year: number, monthIndex: number, day: number): string | null {
  const ms = Date.UTC(year, monthIndex, day);
  if (Number.isNaN(ms)) return null;
  const d = new Date(ms);
  // Reject values that rolled over (e.g. 31 Feb) rather than silently shifting.
  if (d.getUTCMonth() !== ((monthIndex % 12) + 12) % 12 || d.getUTCDate() !== day) return null;
  return d.toISOString();
}

/**
 * Parse an Indian bank date. Ambiguity is real: 01/02/2026 is 1 Feb in every
 * Indian statement format (DD/MM), never 2 Jan — so day-first is assumed rather
 * than handed to `new Date()`, which would read it as US month-first.
 */
function parseStatementDate(raw: string): { iso: string; certain: boolean } | null {
  const value = raw.trim();
  if (!value) return null;

  const MONTHS: Record<string, number> = {
    jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
    jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
  };

  // DD-MMM-YY / DD-MMM-YYYY  (e.g. 05-Jul-26, 05 Jul 2026) — unambiguous.
  const named = value.match(/^(\d{1,2})[-/ ]([A-Za-z]{3,})[-/ ](\d{2,4})$/);
  if (named) {
    const month = MONTHS[named[2].slice(0, 3).toLowerCase()];
    if (month != null) {
      let year = Number(named[3]);
      if (year < 100) year += year < 70 ? 2000 : 1900;
      const iso = isoCalendarDate(year, month, Number(named[1]));
      if (iso) return { iso, certain: true };
    }
  }

  // YYYY-MM-DD — unambiguous.
  const ymd = value.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  if (ymd) {
    const iso = isoCalendarDate(Number(ymd[1]), Number(ymd[2]) - 1, Number(ymd[3]));
    if (iso) return { iso, certain: true };
  }

  // DD/MM/YY(YY) — day-first, per Indian convention.
  const dmy = value.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/);
  if (dmy) {
    const day = Number(dmy[1]);
    const month = Number(dmy[2]);
    let year = Number(dmy[3]);
    if (year < 100) year += year < 70 ? 2000 : 1900;
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      const iso = isoCalendarDate(year, month - 1, day);
      // Flag when the pair is ambiguous (both <= 12) — the value is still used,
      // but the UI marks the row so the user can eyeball it.
      if (iso) return { iso, certain: day > 12 };
    }
  }

  return null;
}

/** Strip currency symbols, thousands separators, Dr/Cr suffixes and brackets. */
function parseMoney(raw: string): { value: number; negative: boolean } | null {
  let text = raw.trim();
  if (!text || /^[-–—]$/.test(text)) return null;

  // Accounting negatives: (1,234.00)
  const bracketed = /^\(.*\)$/.test(text);
  // Explicit Dr/Cr markers used by several Indian banks.
  const drMarker = /\bdr\b\.?$/i.test(text);
  const crMarker = /\bcr\b\.?$/i.test(text);

  text = text
    .replace(/^\(|\)$/g, '')
    .replace(/\b(dr|cr)\b\.?/gi, '')
    .replace(/(?:inr|rs\.?|₹)/gi, '')
    .replace(/,/g, '')
    .replace(/\s+/g, '')
    .trim();

  if (!text || !/^-?\d*\.?\d+$/.test(text)) return null;
  const num = Number(text);
  if (!Number.isFinite(num) || num === 0) return null;

  const negative = bracketed || drMarker || num < 0;
  return { value: Math.abs(num), negative: negative && !crMarker };
}

/* ------------------------------------------------------------------ *
 * Categorisation
 * ------------------------------------------------------------------ */

/**
 * Merchant-keyword categorisation, per the doc's Method 4 Step 3
 * ("SWIGGY → Food, PETROL PUMP → Transport, MEDPLUS → Medicine, ...").
 * Runs on-device so the review list is populated instantly; the server's AI
 * pass can refine anything left as `others` after the rows are saved.
 */
const MERCHANT_RULES: { category: CategoryType; re: RegExp }[] = [
  { category: 'food', re: /\b(swiggy|zomato|blinkit|zepto|instamart|bigbasket|dominos|pizza|mcdonald|kfc|starbucks|cafe|restaurant|hotel|dmart|d-mart|reliance fresh|more retail|grofers|licious|bakery|dairy|milk|amul)\b/i },
  { category: 'transport', re: /\b(uber|ola|rapido|petrol|diesel|fuel|hpcl|iocl|bpcl|indian oil|hp petrol|shell|nayara|irctc|railway|redbus|metro|fastag|parking|toll)\b/i },
  { category: 'health', re: /\b(medplus|apollo|pharmeasy|netmeds|1mg|tata 1mg|hospital|clinic|diagnostic|pathology|lab|medical|pharmacy|chemist|dental|doctor)\b/i },
  { category: 'subscriptions', re: /\b(netflix|hotstar|disney|prime video|spotify|youtube premium|google one|icloud|dropbox|adobe|microsoft 365|office 365|canva|zee5|sonyliv|jiocinema|audible)\b/i },
  { category: 'bills', re: /\b(rent|maintenance|society charges|electricity|dgvcl|mgvcl|pgvcl|ugvcl|adani electricity|tata power|bses|torrent power|mseb|kseb|tneb|bescom|gas|indane|hp gas|bharat gas|water tax|municipal|broadband|airtel|jio|vodafone|vi |bsnl|act fibernet|hathway|recharge|dth|tatasky|d2h)\b/i },
  { category: 'shopping', re: /\b(amazon|flipkart|myntra|ajio|meesho|nykaa|tatacliq|snapdeal|croma|reliance digital|vijay sales|decathlon|lifestyle|pantaloons|westside|max fashion|ikea)\b/i },
  { category: 'entertainment', re: /\b(bookmyshow|pvr|inox|cinepolis|cinema|gaming|steam|playstation|xbox|nintendo)\b/i },
  { category: 'education', re: /\b(school|college|university|tuition|coaching|byju|unacademy|vedantu|udemy|coursera|upgrad|fees|examination)\b/i },
  { category: 'travel', re: /\b(makemytrip|goibibo|cleartrip|yatra|easemytrip|indigo|air india|vistara|spicejet|akasa|oyo|airbnb|booking\.com|agoda|travel)\b/i },
  { category: 'investment', re: /\b(zerodha|groww|upstox|angel one|kuvera|coin|mutual fund|sip |nps |ppf|elss|smallcase|nippon|hdfc amc|icici pru|sbi mf)\b/i },
  { category: 'finance', re: /\b(emi|loan|interest|insurance|lic |premium|policy|credit card payment|cc payment|atm|cash withdrawal|charges|fee|gst|tax)\b/i },
  { category: 'family', re: /\b(gift|donation|temple|trust)\b/i },
];

export function categoriseDescription(description: string): CategoryType {
  for (const { category, re } of MERCHANT_RULES) {
    if (re.test(description)) return category;
  }
  return 'others';
}

/** Collapse bank noise into something readable in a list row. */
export function cleanDescription(raw: string): string {
  let text = raw.replace(/\s+/g, ' ').trim();
  // Drop the transport prefixes Indian statements lead with.
  text = text.replace(/^(UPI|IMPS|NEFT|RTGS|POS|ATW|ATM|ACH|MMT|INF|BIL|TPT|CMS|ECS|NACH)[-/ ]+/i, '');
  // UPI narrations are pipe-delimited; the second field is usually the payee.
  if (text.includes('|')) {
    const parts = text.split('|').map((p) => p.trim()).filter(Boolean);
    const named = parts.find((p) => /[a-z]{3,}/i.test(p) && !/^\d+$/.test(p) && !/@/.test(p));
    if (named) text = named;
  }
  // Strip a trailing reference number.
  text = text.replace(/[-/ ]+\d{6,}$/, '').trim();
  return (text || raw.trim()).slice(0, 70);
}

/* ------------------------------------------------------------------ *
 * Entry point
 * ------------------------------------------------------------------ */

export function parseStatementCsv(content: string): ParseStatementResult {
  const empty: ParseStatementResult = {
    rows: [],
    mapping: {},
    skipped: 0,
    totalDataRows: 0,
  };

  const text = content.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  const lines = text.split('\n').filter((l) => l.trim() !== '');
  if (lines.length < 2) {
    return { ...empty, error: 'This file has no transaction rows.' };
  }

  const delimiter = detectDelimiter(text);
  const headerIndex = findHeaderRow(lines, delimiter);
  if (headerIndex === -1) {
    return {
      ...empty,
      error:
        'Could not find a transaction table in this file. It needs a header row with a date column and an amount (or debit/credit) column.',
    };
  }

  const headers = splitCsvLine(lines[headerIndex], delimiter).map((h) =>
    h.replace(/\s+/g, ' ').trim(),
  );

  const mapping: ParseStatementResult['mapping'] = {};
  let dateIdx = -1;
  let descIdx = -1;
  let debitIdx = -1;
  let creditIdx = -1;
  let amountIdx = -1;

  headers.forEach((h, i) => {
    if (dateIdx === -1 && DATE_HEADERS.test(h)) { dateIdx = i; mapping.date = h; return; }
    if (descIdx === -1 && DESC_HEADERS.test(h)) { descIdx = i; mapping.description = h; return; }
    if (debitIdx === -1 && DEBIT_HEADERS.test(h)) { debitIdx = i; mapping.debit = h; return; }
    if (creditIdx === -1 && CREDIT_HEADERS.test(h)) { creditIdx = i; mapping.credit = h; return; }
    if (amountIdx === -1 && AMOUNT_HEADERS.test(h)) { amountIdx = i; mapping.amount = h; return; }
  });

  if (dateIdx === -1 || (debitIdx === -1 && creditIdx === -1 && amountIdx === -1)) {
    return {
      ...empty,
      error: 'This file is missing a date column or an amount column.',
    };
  }

  // No description column is survivable — fall back to the widest text column.
  if (descIdx === -1) {
    descIdx = headers.findIndex(
      (_, i) => i !== dateIdx && i !== debitIdx && i !== creditIdx && i !== amountIdx,
    );
  }

  const rows: ParsedStatementRow[] = [];
  let skipped = 0;
  let totalDataRows = 0;

  for (let i = headerIndex + 1; i < lines.length; i++) {
    const cells = splitCsvLine(lines[i], delimiter);
    // Trailing summary lines ("Closing balance", totals) have too few columns.
    if (cells.length < 2) continue;
    totalDataRows++;

    const parsedDate = parseStatementDate(cells[dateIdx] ?? '');
    if (!parsedDate) { skipped++; continue; }

    let amount: number | null = null;
    let isDebit = true;
    let amountCertain = true;

    if (debitIdx !== -1 || creditIdx !== -1) {
      const debit = debitIdx !== -1 ? parseMoney(cells[debitIdx] ?? '') : null;
      const credit = creditIdx !== -1 ? parseMoney(cells[creditIdx] ?? '') : null;
      if (debit) { amount = debit.value; isDebit = true; }
      else if (credit) { amount = credit.value; isDebit = false; }
    }

    if (amount == null && amountIdx !== -1) {
      const single = parseMoney(cells[amountIdx] ?? '');
      if (single) {
        amount = single.value;
        // A single signed amount column: negative means money out.
        isDebit = single.negative;
        amountCertain = /-|\(|\bdr\b/i.test(cells[amountIdx] ?? '') || single.negative;
      }
    }

    if (amount == null) { skipped++; continue; }

    const rawDesc = (cells[descIdx] ?? '').trim();
    const description = cleanDescription(rawDesc);

    rows.push({
      id: `imp_${i}_${Math.random().toString(36).slice(2, 7)}`,
      date: parsedDate.iso,
      description: description || 'Statement entry',
      amount,
      isDebit,
      category: categoriseDescription(rawDesc),
      uncertain: !parsedDate.certain || !amountCertain,
    });
  }

  if (rows.length === 0) {
    return {
      ...empty,
      mapping,
      skipped,
      totalDataRows,
      error: 'No readable transactions were found in this file.',
    };
  }

  // Newest first, matching how transactions are listed everywhere else.
  rows.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  return { rows, mapping, skipped, totalDataRows };
}

/**
 * Minimal SHA-1. Present because the backend contract specifies
 * `sha1(date|merchant|paise)` for `dedupeKey` and React Native has no built-in
 * crypto digest. Used only as a content fingerprint, never for security.
 */
function sha1Hex(input: string): string {
  // UTF-8 encode.
  const bytes: number[] = [];
  for (let i = 0; i < input.length; i++) {
    let c = input.charCodeAt(i);
    if (c < 0x80) bytes.push(c);
    else if (c < 0x800) {
      bytes.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f));
    } else if (c < 0xd800 || c >= 0xe000) {
      bytes.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
    } else {
      // Surrogate pair.
      i++;
      c = 0x10000 + (((c & 0x3ff) << 10) | (input.charCodeAt(i) & 0x3ff));
      bytes.push(
        0xf0 | (c >> 18),
        0x80 | ((c >> 12) & 0x3f),
        0x80 | ((c >> 6) & 0x3f),
        0x80 | (c & 0x3f),
      );
    }
  }

  const bitLen = bytes.length * 8;
  bytes.push(0x80);
  while (bytes.length % 64 !== 56) bytes.push(0);
  // 64-bit big-endian length; the high word is always 0 for our input sizes.
  for (let i = 7; i >= 0; i--) {
    bytes.push(i < 4 ? (bitLen >>> (i * 8)) & 0xff : 0);
  }

  let h0 = 0x67452301, h1 = 0xefcdab89, h2 = 0x98badcfe, h3 = 0x10325476, h4 = 0xc3d2e1f0;
  const w = new Array<number>(80);

  for (let chunk = 0; chunk < bytes.length; chunk += 64) {
    for (let i = 0; i < 16; i++) {
      const o = chunk + i * 4;
      w[i] = ((bytes[o] << 24) | (bytes[o + 1] << 16) | (bytes[o + 2] << 8) | bytes[o + 3]) >>> 0;
    }
    for (let i = 16; i < 80; i++) {
      const n = w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16];
      w[i] = ((n << 1) | (n >>> 31)) >>> 0;
    }

    let a = h0, b = h1, c = h2, d = h3, e = h4;
    for (let i = 0; i < 80; i++) {
      let f: number, k: number;
      if (i < 20) { f = (b & c) | (~b & d); k = 0x5a827999; }
      else if (i < 40) { f = b ^ c ^ d; k = 0x6ed9eba1; }
      else if (i < 60) { f = (b & c) | (b & d) | (c & d); k = 0x8f1bbcdc; }
      else { f = b ^ c ^ d; k = 0xca62c1d6; }

      const temp = (((a << 5) | (a >>> 27)) + f + e + k + w[i]) >>> 0;
      e = d;
      d = c;
      c = ((b << 30) | (b >>> 2)) >>> 0;
      b = a;
      a = temp;
    }
    h0 = (h0 + a) >>> 0;
    h1 = (h1 + b) >>> 0;
    h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0;
  }

  return [h0, h1, h2, h3, h4].map((h) => h.toString(16).padStart(8, '0')).join('');
}

/**
 * Content-hash dedup key. Matches the backend contract:
 * `sha1(date_yyyy_mm_dd + "|" + normalized_merchant + "|" + amount_in_paise)`.
 *
 * Deliberately excludes category and member so re-categorising a row before
 * import does not make it look like a different transaction.
 *
 * The server treats this as an opaque string and upserts on
 * `(userId, dedupeKey)` — it never recomputes the hash — so what matters is that
 * the SAME statement line always produces the SAME key.
 */
export function buildDedupeKey(row: { date: string; description: string; amount: number }): string {
  const day = row.date.slice(0, 10);
  const merchant = row.description.toLowerCase().replace(/[^a-z0-9]/g, '');
  const paise = Math.round(row.amount * 100);
  return sha1Hex(`${day}|${merchant}|${paise}`);
}
