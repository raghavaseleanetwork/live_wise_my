import { createHash } from 'node:crypto';

// Minimal RFC4180-aware CSV parser: handles quoted fields, embedded commas,
// escaped quotes (""), and newlines inside quoted fields.
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;

  // Strip a leading UTF-8 BOM, which Excel/bank exports commonly include.
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\r') {
      // skip; \n (or \r\n) below terminates the row
    } else if (c === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += c;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((cell) => cell.trim() !== ''));
}

const DATE_HEADERS = ['date', 'txn date', 'transaction date', 'value date', 'posting date'];
const DESC_HEADERS = ['description', 'narration', 'particulars', 'details', 'remarks', 'transaction remarks'];
const DEBIT_HEADERS = ['debit', 'withdrawal', 'withdrawal amt', 'debit amount', 'withdrawal amount'];
const CREDIT_HEADERS = ['credit', 'deposit', 'deposit amt', 'credit amount', 'deposit amount'];
const AMOUNT_HEADERS = ['amount', 'transaction amount'];
const TYPE_HEADERS = ['type', 'transaction type', 'dr/cr'];

// Bank exports commonly append a trailing "." (e.g. "Withdrawal Amt.") or extra
// spaces to headers, so match on the header with trailing punctuation and
// repeated whitespace stripped rather than requiring an exact string match.
function normalizeHeader(h: string): string {
  return h.trim().toLowerCase().replace(/\.+$/, '').replace(/\s+/g, ' ').trim();
}

function findColumn(headers: string[], candidates: string[]): number {
  const normalized = headers.map(normalizeHeader);
  for (const candidate of candidates) {
    const idx = normalized.indexOf(candidate);
    if (idx !== -1) return idx;
  }
  return -1;
}

function parseAmount(raw: string): number | null {
  if (!raw) return null;
  const cleaned = raw.replace(/[₹,\s]/g, '');
  if (!cleaned) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? Math.abs(n) : null;
}

function parseDate(raw: string): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();

  // DD/MM/YYYY or DD-MM-YYYY (the common Indian bank statement format).
  // Emit UTC midnight: the client renders with timeZone 'UTC', so building a
  // local date here would shift 14 July into 13 July for any timezone east of
  // Greenwich (IST included).
  const dmy = trimmed.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
  if (dmy) {
    let [, d, m, y] = dmy;
    if (y.length === 2) y = `20${y}`;
    const date = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)));
    if (!Number.isNaN(date.getTime())) return date.toISOString();
  }

  // Date-only ISO (YYYY-MM-DD) already parses as UTC midnight. Anything with a
  // time component gets truncated to its UTC calendar day so the dedupeKey
  // stays stable across formats that do and don't carry a time.
  const parsed = new Date(trimmed);
  if (!Number.isNaN(parsed.getTime())) {
    return new Date(Date.UTC(parsed.getUTCFullYear(), parsed.getUTCMonth(), parsed.getUTCDate())).toISOString();
  }
  return null;
}

export interface ParsedCsvRow {
  date: string;
  description: string;
  amount: number;
  isDebit: boolean;
  dedupeKey: string;
}

export interface CsvParseResult {
  rows: ParsedCsvRow[];
  rowsSkipped: number;
}

// Excludes category/member from the key so re-categorising a row never creates
// a new transaction — matches the dedup contract in POST /api/transactions.
function computeDedupeKey(dateIso: string, description: string, amountRupees: number): string {
  const day = dateIso.slice(0, 10);
  const normalizedMerchant = description.trim().toLowerCase().replace(/\s+/g, ' ');
  const amountPaise = Math.round(amountRupees * 100);
  return createHash('sha1').update(`${day}|${normalizedMerchant}|${amountPaise}`).digest('hex');
}

export function parseBankCsv(text: string): CsvParseResult {
  const table = parseCsv(text);
  if (table.length < 2) return { rows: [], rowsSkipped: 0 };

  const headers = table[0];
  const dateCol = findColumn(headers, DATE_HEADERS);
  const descCol = findColumn(headers, DESC_HEADERS);
  const debitCol = findColumn(headers, DEBIT_HEADERS);
  const creditCol = findColumn(headers, CREDIT_HEADERS);
  const amountCol = findColumn(headers, AMOUNT_HEADERS);
  const typeCol = findColumn(headers, TYPE_HEADERS);

  if (dateCol === -1 || (debitCol === -1 && creditCol === -1 && amountCol === -1)) {
    return { rows: [], rowsSkipped: table.length - 1 };
  }

  const rows: ParsedCsvRow[] = [];
  let rowsSkipped = 0;

  for (let i = 1; i < table.length; i++) {
    const cells = table[i];
    const dateIso = parseDate(cells[dateCol] || '');
    const description = descCol !== -1 ? (cells[descCol] || '').trim() : '';

    let amount: number | null = null;
    let isDebit = true;

    if (debitCol !== -1 || creditCol !== -1) {
      const debitAmt = debitCol !== -1 ? parseAmount(cells[debitCol] || '') : null;
      const creditAmt = creditCol !== -1 ? parseAmount(cells[creditCol] || '') : null;
      if (debitAmt) {
        amount = debitAmt;
        isDebit = true;
      } else if (creditAmt) {
        amount = creditAmt;
        isDebit = false;
      }
    } else if (amountCol !== -1) {
      amount = parseAmount(cells[amountCol] || '');
      const typeVal = typeCol !== -1 ? (cells[typeCol] || '').trim().toLowerCase() : '';
      isDebit = !(typeVal.startsWith('cr') || typeVal === 'credit');
    }

    if (!dateIso || amount == null || amount <= 0) {
      rowsSkipped++;
      continue;
    }

    rows.push({
      date: dateIso,
      description,
      amount,
      isDebit,
      dedupeKey: computeDedupeKey(dateIso, description, amount),
    });
  }

  return { rows, rowsSkipped };
}
