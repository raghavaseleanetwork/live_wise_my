/**
 * Decide whether an SMS sender is plausibly a bank/payment provider.
 *
 * Why sender-based filtering at all: the body-keyword blacklist in parse-sms.ts
 * is a losing race — every new promo wording is a new false transaction. Sender
 * IDs are registered with the telecom operator under TRAI's DLT rules and
 * cannot be chosen freely, so they are a far more stable signal.
 *
 * Indian commercial SMS headers look like `AD-HDFCBK-S`:
 *   AD      operator/telemarketer prefix (2 chars, varies by circle — NOT stable)
 *   HDFCBK  the registered entity code  ← the part worth matching
 *   -S/-P/-T  optional category suffix (S=service, P=promotional, T=transactional)
 *
 * The prefix is deliberately ignored: the user's own inbox shows the same SBI
 * UPI traffic arriving as both `AX-SBIINB` and `JK-SBIUPI`, and Bank of Baroda
 * as both `JD-BOBSMS` and `JX-BOBSMS`. Matching on the prefix would drop real
 * transactions depending on which route the operator happened to use.
 *
 * The design is deliberately permissive. A missed bank SMS is a transaction the
 * user never sees (the bug we just fixed); a stray promo that slips through is
 * caught downstream by NON_TRANSACTION_PATTERNS. When in doubt, let it through.
 */

/**
 * Registered entity codes for Indian banks, wallets and payment providers.
 * Matched as a substring of the sender's entity segment, so `SBIINB`, `SBIUPI`
 * and `SBICRD` all match `SBI`.
 */
const BANK_ENTITY_CODES: string[] = [
  // Public sector
  'SBI', 'PNB', 'BOB', 'BOI', 'CANBNK', 'CANARA', 'UNIONB', 'UBIN', 'IOB',
  'CBIN', 'CENTBK', 'INDBNK', 'UCOBNK', 'PSBSMS', 'BOMSMS', 'MAHABK',
  // Private sector
  'HDFC', 'ICICI', 'AXIS', 'KOTAK', 'YESBNK', 'INDUS', 'IDFC', 'IDBI',
  'FEDBNK', 'FEDERAL', 'RBLBNK', 'BANDHN', 'DCBBNK', 'CSBBNK', 'KVBANK',
  'TMBANK', 'SIBSMS', 'JKBANK', 'KARBNK', 'DHANBK', 'NAINIT', 'SVCBNK',
  // Small finance / payments banks
  'AUBANK', 'EQUITAS', 'UJJIVN', 'JANABK', 'ESAFBK', 'SURYOD', 'UTKARSH',
  'FINCAR', 'NEBANK', 'AIRBNK', 'PYTMBK', 'FINOBK', 'JIOPAY',
  // Foreign
  'CITIBK', 'HSBC', 'SCBANK', 'STANC', 'DBSBNK', 'DEUTSC', 'BARCLY', 'AMEX',
  // Wallets / UPI / cards
  'PAYTM', 'PHONPE', 'PHONEPE', 'GPAY', 'GOOGLE', 'BHIMUP', 'MOBIKW',
  'FREECH', 'AMZNPY', 'AMAZONPAY', 'CRED', 'SLICE', 'JUPITR', 'FISDOM',
  'RAZORP', 'BILLDK', 'PINELB',
  // Card issuers / NBFC lenders that send genuine txn alerts
  'SBICRD', 'ONECRD', 'BAJAJF', 'BAJFIN', 'HDFCCC', 'INDITR',
  // Co-operative / regional
  'SARSWT', 'COSMOS', 'ABHYUD', 'TJSBNK', 'NKGSBK',
];

/**
 * Entity codes that look bank-adjacent but never carry account transactions.
 * Listed explicitly because they would otherwise pass the generic
 * bank-shaped-header check in `looksLikeTransactionalSender`.
 *
 * SBLIFE is the clearest example from the user's inbox: an insurance arm whose
 * sender contains "SB", sending birthday wishes.
 */
const NON_BANK_ENTITY_CODES: string[] = [
  'SBLIFE', 'HDFCLI', 'ICILIF', 'LICIND', 'MAXLIF', 'TATAIA', 'BAJLIF',
  'STARHL', 'CARINS', 'POLICY', 'INSURE',
  'JIOFBR', 'JIOPC', 'JIONET', 'AIRTEL', 'VODAFO', 'IDEACL', 'BSNLIN',
  'SWISHN', 'INOXMV', 'PVRVIP', 'BOOKMY',
  'ANGELB', 'ANGLON', 'ZERODH', 'UPSTOX', 'GROWWA', 'NSEIND', 'BSEIND',
  'DHANHQ', 'RAPIDM', 'PAISA2',
];

/** Sender header stripped to its entity segment, uppercased. */
function entitySegment(address: string): string {
  const raw = (address || '').trim().toUpperCase();
  if (!raw) return '';
  // `AD-HDFCBK-S` -> `HDFCBK`; `AD-HDFCBK` -> `HDFCBK`; `HDFCBK` -> `HDFCBK`
  const parts = raw.split('-').filter(Boolean);
  if (parts.length >= 2) return parts[1];
  return parts[0] ?? '';
}

/** True when the address is a phone number rather than a registered header. */
function isPhoneNumber(address: string): boolean {
  const t = (address || '').replace(/[\s+()-]/g, '');
  return /^\d{6,15}$/.test(t);
}

/**
 * Whether the header has the shape of a registered commercial sender —
 * `XX-YYYYYY` with a non-numeric entity segment. Numeric entity segments
 * (`JX-620014-P`) are telecom/marketing short codes, never banks.
 */
function isBankShapedHeader(address: string): boolean {
  const raw = (address || '').trim().toUpperCase();
  if (!/^[A-Z]{2}-[A-Z0-9]{2,10}(?:-[A-Z])?$/.test(raw)) return false;
  const entity = entitySegment(raw);
  if (!entity || /^\d+$/.test(entity)) return false;
  return true;
}

export type SenderVerdict = 'bank' | 'unknown' | 'blocked';

/**
 * Classify a sender:
 *  - `bank`    — a known bank/payment entity code. Always parsed.
 *  - `blocked` — a known non-bank commercial sender, or a numeric short code.
 *                Never parsed.
 *  - `unknown` — anything else. Parsed ONLY if the body reads like a real
 *                transaction (see `looksLikeTransactionalSender`), so small or
 *                regional banks we have not listed still work.
 */
export function classifySender(address?: string): SenderVerdict {
  const entity = entitySegment(address || '');
  if (!entity) return 'unknown';

  if (NON_BANK_ENTITY_CODES.some((code) => entity.includes(code))) return 'blocked';
  if (BANK_ENTITY_CODES.some((code) => entity.includes(code))) return 'bank';

  // `JX-620014-P`, `AR-650025-P` — a numeric entity inside a registered header
  // is a marketing short code, never a bank. A bare 10-digit phone number is
  // different: some small banks and payment services still send from one, so it
  // stays `unknown` and is judged on its body instead.
  if (/^\d+$/.test(entity) && !isPhoneNumber(address || '')) return 'blocked';

  return 'unknown';
}

/**
 * The transaction-shaped-body test applied to unknown senders.
 *
 * Requires BOTH an account/card reference AND a money-movement verb. A promo
 * can quote an amount ("Rs.5,000 off at 70+ brands") but essentially never
 * quotes a masked account number alongside a debit verb.
 */
export function looksLikeTransactionalBody(body: string): boolean {
  const hasAccountRef =
    /\b(?:a\/?c|acct|account|card)\b[^.]{0,20}?(?:x{2,}|\*{2,}|\d{3,})/i.test(body) ||
    /\b(?:x{4,}|\*{4,})\d{2,}\b/i.test(body) ||
    /\bUPI\s*(?:Ref|ID)\b/i.test(body) ||
    /\bVPA\b/i.test(body) ||
    /@(?:ok\w+|ybl|pty|upi|paytm|axl|ibl)\b/i.test(body);

  const hasMovementVerb =
    /\b(?:debited|credited|withdrawn|deducted|transferred|trf)\b/i.test(body) ||
    /\b(?:Dr|Cr)\.?\s*(?:from|to)\b/i.test(body) ||
    /\bspent\b.{0,30}\bcard\b/i.test(body);

  return hasAccountRef && hasMovementVerb;
}

/**
 * Final gate used by the parser.
 *
 * Note a deliberate asymmetry: known banks are NOT required to have a
 * transaction-shaped body here. Their promos are filtered downstream by
 * NON_TRANSACTION_PATTERNS, which keeps this module about identity only and
 * avoids two places both deciding "is this a transaction?".
 */
export function shouldParseSender(address: string | undefined, body: string): boolean {
  const verdict = classifySender(address);
  if (verdict === 'blocked') return false;
  if (verdict === 'bank') return true;

  // Unknown sender: allow only a clearly transactional body, and only from
  // something shaped like a registered header or a plain phone number (some
  // small banks and test/dev senders use those).
  if (!isBankShapedHeader(address || '') && !isPhoneNumber(address || '')) return false;
  return looksLikeTransactionalBody(body);
}
