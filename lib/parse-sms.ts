/**
 * Parse Indian UPI / bank SMS into transaction-like objects.
 * Handles common formats: debited, credited, amount (Rs/INR), date, sender/merchant.
 */

import { shouldParseSender } from './sms-sender';

export interface ParsedSmsTransaction {
  merchant: string;
  amount: number;
  date: string;
  isDebit: boolean;
  description: string;
  upiId?: string;
  category?: string;
  /**
   * Stable id of the source SMS (Android inbox _id). Sent to the backend so it
   * can deduplicate on (userId, smsId) and safely ignore re-sent overlaps that
   * happen with incremental syncs. Undefined only if the device gave no _id.
   */
  smsId?: string;
}

// Amount patterns: Rs. 500 / Rs 500 / INR 500 / ₹500 / 500 debited
const AMOUNT_REGEX = /(?:Rs\.?|INR|₹)\s*([\d,]+(?:\.\d{2})?)|([\d,]+(?:\.\d{2})?)\s*(?:Rs\.?|INR|₹)/gi;

/**
 * Money-out wording. Deliberately broad: Indian banks phrase the same event a
 * dozen ways and every unmatched phrasing is a transaction the user never sees.
 *
 * `\bsent\b` (not `sent to`) is what makes HDFC's "Sent Rs.400.00 From A/C X To
 * RAGHAV" parse — the account comes between the verb and the payee, so the old
 * `sent to` never matched and the whole message was dropped.
 */
const DEBIT_KEYWORDS =
  /\bdebited\b|\bdebit\b|deducted|withdrawn|\bwithdrawal\b|\bspent\b|\bsent\b|\bpaid\b|paid to|\btransferred\b|\btrf\b|purchase|payment|remitted|auto-?pay|\bcharged\b|\bbilled\b|made a transaction|\bdr\b/i;

/**
 * Money-in wording. `credited` alone is NOT enough to call something a credit —
 * see `resolveDirection`: a debit SMS usually names the payee as "credited".
 */
const CREDIT_KEYWORDS =
  /\bcredited\b|\bcredit\b|\breceived\b|deposited|\brefund(?:ed)?\b|added to|reversed|\bcashback\b|\binterest\b|\bcr\b/i;

/**
 * Messages that mention money but move none. Checked before anything else,
 * because several of these contain a perfectly valid-looking amount and would
 * otherwise be stored as real spending (the JioMart promo below became a ₹500
 * expense in testing).
 */
const NON_TRANSACTION_PATTERNS: RegExp[] = [
  /\bOTP\b|one[- ]time[- ]password|\bverification code\b|do not share/i,
  /\bwill be debited\b|\bwill be credited\b|\bis due\b|\bdue on\b|\bdue date\b|\bpay now\b|\breminder\b/i,
  /\bcashback on\b|\boffer\b|\bdiscount\b|\bsave Rs\b|\bshop now\b|\bwin\b|\bcoupon\b|\bsale\b/i,
  /\bbalance is\b|\bavailable balance is\b|\bbal(?:ance)? enquiry\b|\bas on\b/i,
  /\bapplied\b|\bapproved\b|\bregistered successfully\b|\bwelcome to\b/i,
  /\brequest(?:ed)? (?:for|to)\b|\bhas requested\b|\bcollect request\b/i,
  /\bfailed\b|\bdeclined\b|\breversed due to\b|\bunsuccessful\b/i,
  /\bstatement\b|\be-statement\b|\bmin(?:imum)? (?:amt|amount) due\b/i,
];

/**
 * Decide debit vs credit when a message contains both words, which is the norm
 * rather than the exception: "A/c debited for Rs 640; ZOMATO credited" is one
 * payment, not two. The old `DEBIT && !CREDIT` test made both flags false and
 * silently dropped every such message — a large share of all UPI SMS.
 *
 * Rules, in order:
 *  1. An explicit card charge is always a debit.
 *  2. "debited ... and credited to X" — the credit describes the payee. Debit.
 *  3. Otherwise whichever keyword appears first wins; banks lead with the verb
 *     that describes what happened to *this* account.
 */
function resolveDirection(body: string): 'debit' | 'credit' | null {
  const hasDebit = DEBIT_KEYWORDS.test(body);
  const hasCredit = CREDIT_KEYWORDS.test(body);

  if (/\b(?:charged|billed|spent)\b/i.test(body)) return 'debit';
  if (!hasDebit && !hasCredit) return null;
  if (hasDebit && !hasCredit) return 'debit';
  if (hasCredit && !hasDebit) return 'credit';

  if (/debited[^.]*?\bcredited to\b/i.test(body)) return 'debit';
  if (/credited[^.]*?\bdebited from\b/i.test(body)) return 'credit';

  const dIdx = body.search(DEBIT_KEYWORDS);
  const cIdx = body.search(CREDIT_KEYWORDS);
  if (dIdx < 0) return 'credit';
  if (cIdx < 0) return 'debit';
  return dIdx <= cIdx ? 'debit' : 'credit';
}

/**
 * Reject candidates that are an account/card reference, a bare amount, or a
 * bank's own name rather than a counterparty. Anything rejected here falls
 * through to the next pattern, so a bad match costs nothing.
 */
function looksLikeAccountRef(s: string): boolean {
  const t = s.trim();
  if (!t || t.length < 2) return true;
  // "A/c XX1234", "Acct", "Card ending 1234", "your account XX1234"
  if (/^(?:your\s+)?(?:a\/?c|acct|account|card|no\.?)\b/i.test(t)) return true;
  // Masked/plain digit runs: "XX1234", "*1592", "1234"
  if (/^[x*\d\s.-]+$/i.test(t)) return true;
  // A currency amount that leaked through, e.g. "Rs 850"
  if (/^(?:INR|Rs\.?|₹)\s*[\d,.]+$/i.test(t)) return true;
  // The bank itself is not the merchant.
  if (/^(?:hdfc|sbi|icici|axis|kotak|yes|pnb|bob|canara|idfc|amex|american express)\b/i.test(t)) {
    return true;
  }
  if (/\bbank\b/i.test(t) && t.split(/\s+/).length <= 4) return true;
  return false;
}

/**
 * Pull the counterparty out of the message.
 *
 * Ordering matters more than the individual patterns: the payee ("To RAGHAV",
 * "trf to SWIGGY", "at CROMA") must be tried *before* generic `from ...`, or a
 * debit SMS yields the user's own account number as the merchant — which is why
 * the app displayed "a/c *1592" instead of the payee.
 */
function extractMerchant(body: string, isDebit: boolean): string {
  const patterns: RegExp[] = [
    /\btrf\s+to\s+([^.,;]+?)(?:\s+Refno|\s+Ref\b|[.,;]|$)/i,
    /\bcredited\s+to\s+([^.,;(]+?)(?:\s*\(|\s+on\b|[.,;]|$)/i,
    // "...; UBER INDIA credited" — payee named just before the verb.
    /[;,]\s*([A-Za-z][A-Za-z0-9&'. -]{2,40}?)\s+credited\b/,
    // "transferred from A/c XX to RAMESH on ..." — skip the account, take payee.
    /\btransferred\s+from\s+[^\s]+\s+[^\s]+\s+to\s+([^.,;]+?)(?:\s+on\b|[.,;]|$)/i,
    // "Paid Rs.250 to Chai Point via Paytm" / "Rs.1500 paid to BigBasket"
    /\b(?:paid|sent)\s+(?:INR|Rs\.?|₹)?\s*[\d,.]*\s*to\s+([^.,;]+?)(?:\s+via\b|\s+from\b|\s+on\b|[.,;]|$)/i,
    // "credited by ... from RAHUL K" / "by a/c linked to mobile"
    /\bcredited\s+(?:by|with)\s+(?:INR|Rs\.?|₹)?\s*[\d,.]*\s+(?:on\s+[\d\-A-Za-z]+\s+)?from\s+([^.,;]+?)(?:\s+on\b|[.,;]|$)/i,
    /\b(?:to|towards)\s+VPA\s+([^\s.,;]+)/i,
    /\b(?:to|towards)\s+UPI[- ]([^.,;]+?)(?:[.,;]|\s+on\b|$)/i,
    /\b(?:paid|sent|transferred)\s+to\s+([^.,;]+?)(?:\s+on\b|\s+via\b|\s+from\b|[.,;]|$)/i,
    /\bTo\s+([A-Z][A-Za-z0-9&'. -]{1,40}?)(?:\s+On\b|\s+Ref\b|[.,;]|$)/,
    /\bto\s+([^\s.,;]+@[^\s.,;]+)/i,
    /\bat\s+([^.,;]+?)(?:\s+on\b|[.,;]|$)/i,
    /\b(?:on|towards|for)\s+([A-Z][A-Za-z0-9&'. -]{2,40}?)(?:\s+on\b|[.,;]|$)/,
    /\breceived\s+Rs\.?\s*[\d,.]+\s+from\s+([^.,;]+?)(?:\s+in\b|\s+on\b|[.,;]|$)/i,
    /\bfrom\s+([^\s.,;]+@[^\s.,;]+)/i,
    /\bfrom\s+([A-Z][A-Za-z0-9&'. -]{2,40}?)(?:\s+on\b|\s+UPI\b|[.,;]|$)/,
    /NEFT\s+(?:Dr|Cr)-[^-]+-([^-]+)-/i,
    /\btowards\s+([^.,;]+?)(?:\s+UPI|\s+UMN|[.,;]|$)/i,
  ];

  for (const re of patterns) {
    const m = body.match(re);
    if (m && m[1]) {
      const candidate = m[1].trim().replace(/\s+/g, ' ');
      if (!looksLikeAccountRef(candidate)) return candidate.slice(0, 80);
    }
  }
  return isDebit ? 'UPI Payment' : 'Received';
}

/** `1,234.50` -> 1234.5, rejecting malformed runs like `1.2.3`. */
function toNumber(raw: string): number | null {
  const n = parseFloat(raw.replace(/,/g, ''));
  if (isNaN(n) || n <= 0 || n >= 1e8) return null;
  if ((raw.match(/\./g) || []).length > 1) return null;
  return Math.round(n * 100) / 100;
}

/**
 * Strip clauses that state a *balance* rather than the transacted amount.
 * Without this, "Rs.500 debited... Avl Bal Rs.12345" can yield 12345 depending
 * on which pattern matches first.
 */
function stripBalanceClauses(body: string): string {
  return body
    .replace(/\b(?:avl|available|avbl|total|closing|a\/c)?\s*(?:bal|balance|limit|lmt)\b[^.;]*/gi, ' ')
    .replace(/\bavl\s+lmt\b[^.;]*/gi, ' ');
}

function extractAmount(body: string): number | null {
  const cleaned = stripBalanceClauses(body);

  // Ordered most-specific first: a pattern anchored to a transaction verb is
  // far more trustworthy than a bare "Rs <n>", which can also match a reference
  // number, a card limit, or an OTP amount.
  const patterns = [
    /(?:debited|credited)\s+(?:by|for|with)\s*(?:INR|Rs\.?|₹)?\s*([\d,]+(?:\.\d{1,2})?)/i,
    /(?:INR|Rs\.?|₹)\s*([\d,]+(?:\.\d{1,2})?)\s*(?:has been\s+)?(?:is\s+)?(?:debited|credited|spent|paid|charged|billed|withdrawn|transferred)/i,
    /(?:sent|paid|spent|charged|billed|transferred|withdrawn|received)\s+(?:INR|Rs\.?|₹)\s*([\d,]+(?:\.\d{1,2})?)/i,
    /(?:transaction|txn|amount|amt)\s+of\s+(?:INR|Rs\.?|₹)\s*([\d,]+(?:\.\d{1,2})?)/i,
    /(?:amount|amt)\s*(?:of)?\s*(?:INR|Rs\.?|₹)\s*([\d,]+(?:\.\d{1,2})?)/i,
    /(?:INR|Rs\.?|₹)\s*([\d,]+(?:\.\d{1,2})?)/i,
    /([\d,]+(?:\.\d{1,2})?)\s*(?:INR|Rs\.?|₹)/i,
    // Bare number next to a verb, e.g. SBI's "debited by 2500.0 on date ...".
    /(?:debited|credited|deducted)\s+by\s+([\d,]+(?:\.\d{1,2})?)/i,
    /([\d,]+(?:\.\d{1,2})?)\s*(?:debited|credited|deducted)/i,
  ];

  for (const re of patterns) {
    const m = cleaned.match(re);
    if (m) {
      const n = toNumber(m[1]);
      if (n != null) return n;
    }
  }
  return null;
}

const MONTH_ABBR: Record<string, number> = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };

function extractDate(body: string, smsDate?: number | string): Date {
  const now = new Date();
  if (smsDate != null) {
    const d = new Date(typeof smsDate === 'number' ? smsDate : smsDate);
    if (!isNaN(d.getTime())) return d;
  }
  // "09-MAR-26" / "on 14-Mar-25" / "14/03/2025"
  const ddmmyy = body.match(/(\d{1,2})[-/]([A-Za-z]{3})[-/](\d{2,4})/);
  if (ddmmyy) {
    const day = parseInt(ddmmyy[1], 10);
    const monthStr = ddmmyy[2].toLowerCase().slice(0, 3);
    const month = MONTH_ABBR[monthStr] ?? parseInt(ddmmyy[2], 10) - 1;
    const y = parseInt(ddmmyy[3], 10);
    const year = y < 100 ? 2000 + y : y;
    const date = new Date(year, month, day);
    if (!isNaN(date.getTime())) return date;
  }
  const d = body.match(/(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})/);
  if (d) {
    const day = parseInt(d[1], 10);
    const month = parseInt(d[2], 10) - 1;
    const year = parseInt(d[3], 10) < 100 ? 2000 + parseInt(d[3], 10) : parseInt(d[3], 10);
    const date = new Date(year, month, day);
    if (!isNaN(date.getTime())) return date;
  }
  const dm = body.match(/(\d{1,2})[-/](\d{1,2})/);
  if (dm) {
    const date = new Date(now.getFullYear(), parseInt(dm[2], 10) - 1, parseInt(dm[1], 10));
    if (!isNaN(date.getTime())) return date;
  }
  return now;
}

/**
 * Merchant keyword -> category. Values must be members of `CategoryType`
 * (lib/data.ts): health, bills, family, work, tasks, subscriptions, finance,
 * habits, travel, events, food, shopping, transport, entertainment, education,
 * investment, others.
 *
 * The previous map could only ever produce 6 of those 17, so health,
 * subscriptions, finance, education and investment were unreachable from SMS
 * scanning even though the app has screens for them.
 *
 * Keys are matched on WORD BOUNDARIES, not substrings — see `categorizeMerchant`.
 */
const MERCHANT_CATEGORIES: Record<string, string> = {
  // ---------- Food & dining ----------
  swiggy: 'food', zomato: 'food', eatfit: 'food', faasos: 'food', behrouz: 'food',
  starbucks: 'food', mcdonalds: 'food', 'burger king': 'food', kfc: 'food',
  dominos: 'food', "domino's": 'food', 'pizza hut': 'food', subway: 'food',
  'chai point': 'food', chaayos: 'food', barista: 'food', ccd: 'food',
  haldiram: 'food', bikanervala: 'food', 'sweetish house': 'food',
  dunkin: 'food', wendys: 'food', 'taco bell': 'food', theobroma: 'food',
  restaurant: 'food', cafe: 'food', bakery: 'food', dhaba: 'food',
  eatclub: 'food', box8: 'food', freshmenu: 'food',

  // ---------- Groceries (app has no grocery category -> shopping) ----------
  bigbasket: 'shopping', blinkit: 'shopping', zepto: 'shopping', dunzo: 'shopping',
  instamart: 'shopping', jiomart: 'shopping', dmart: 'shopping',
  'd mart': 'shopping', 'reliance fresh': 'shopping', 'reliance smart': 'shopping',
  'more supermarket': 'shopping', spencers: 'shopping', 'nature basket': 'shopping',
  grofers: 'shopping', supermarket: 'shopping', kirana: 'shopping',
  provision: 'shopping', grocery: 'shopping',

  // ---------- Shopping & e-commerce ----------
  amazon: 'shopping', flipkart: 'shopping', myntra: 'shopping', ajio: 'shopping',
  nykaa: 'shopping', meesho: 'shopping', snapdeal: 'shopping', tatacliq: 'shopping',
  croma: 'shopping', 'reliance digital': 'shopping', vijay_sales: 'shopping',
  'vijay sales': 'shopping', decathlon: 'shopping', ikea: 'shopping',
  lifestyle: 'shopping', pantaloons: 'shopping', westside: 'shopping',
  shoppers_stop: 'shopping', 'shoppers stop': 'shopping', bigbazaar: 'shopping',
  'big bazaar': 'shopping', zudio: 'shopping', 'h&m': 'shopping', zara: 'shopping',
  firstcry: 'shopping', lenskart: 'shopping', boat: 'shopping',

  // ---------- Transport, fuel & tolls ----------
  uber: 'transport', ola: 'transport', rapido: 'transport', blusmart: 'transport',
  meru: 'transport', namma_yatri: 'transport',
  'indian oil': 'transport', indianoil: 'transport', iocl: 'transport',
  'bharat petroleum': 'transport', bpcl: 'transport', hpcl: 'transport',
  'hp petrol': 'transport', 'hindustan petroleum': 'transport',
  'shell petrol': 'transport', nayara: 'transport', petrol: 'transport',
  'fuel station': 'transport', 'petrol pump': 'transport',
  fastag: 'transport', toll: 'transport', parking: 'transport',
  metro: 'transport', dmrc: 'transport', bmtc: 'transport', ksrtc: 'transport',
  msrtc: 'transport', redbus: 'transport',

  // ---------- Travel ----------
  irctc: 'travel', makemytrip: 'travel', goibibo: 'travel', yatra: 'travel',
  cleartrip: 'travel', ixigo: 'travel', easemytrip: 'travel',
  indigo: 'travel', 'air india': 'travel', spicejet: 'travel', vistara: 'travel',
  akasa: 'travel', airasia: 'travel', emirates: 'travel',
  oyo: 'travel', airbnb: 'travel', booking_com: 'travel', trivago: 'travel',
  'taj hotel': 'travel', marriott: 'travel', hotel: 'travel', resort: 'travel',

  // ---------- Subscriptions (recurring digital services) ----------
  netflix: 'subscriptions', spotify: 'subscriptions', hotstar: 'subscriptions',
  'disney+': 'subscriptions', disneyplus: 'subscriptions', prime_video: 'subscriptions',
  'prime video': 'subscriptions', sonyliv: 'subscriptions', zee5: 'subscriptions',
  jiocinema: 'subscriptions', jiosaavn: 'subscriptions', gaana: 'subscriptions',
  wynk: 'subscriptions', audible: 'subscriptions', kindle: 'subscriptions',
  'youtube premium': 'subscriptions', 'google one': 'subscriptions',
  'apple music': 'subscriptions', icloud: 'subscriptions', 'apple tv': 'subscriptions',
  dropbox: 'subscriptions', canva: 'subscriptions', adobe: 'subscriptions',
  microsoft_365: 'subscriptions', 'office 365': 'subscriptions',
  openai: 'subscriptions', chatgpt: 'subscriptions', notion: 'subscriptions',
  linkedin_premium: 'subscriptions', cult_fit: 'subscriptions', cultfit: 'subscriptions',

  // ---------- Entertainment (one-off outings) ----------
  bookmyshow: 'entertainment', pvr: 'entertainment', inox: 'entertainment',
  cinepolis: 'entertainment', carnival_cinemas: 'entertainment',
  cinema: 'entertainment', multiplex: 'entertainment',
  dream11: 'entertainment', mpl: 'entertainment', 'gaming': 'entertainment',
  wonderla: 'entertainment', 'amusement park': 'entertainment',

  // ---------- Health & medical ----------
  apollo: 'health', medplus: 'health', pharmeasy: 'health', netmeds: 'health',
  '1mg': 'health', tata_1mg: 'health', wellness_forever: 'health',
  pharmacy: 'health', chemist: 'health', medical_store: 'health', medicos: 'health',
  hospital: 'health', clinic: 'health', diagnostic: 'health', pathlab: 'health',
  pathlabs: 'health', 'dr lal': 'health', thyrocare: 'health', metropolis: 'health',
  fortis: 'health', manipal: 'health', max_healthcare: 'health', aiims: 'health',
  practo: 'health', dental: 'health', optical: 'health',

  // ---------- Bills & utilities ----------
  airtel: 'bills', jio: 'bills', vodafone: 'bills', 'vi ': 'bills', bsnl: 'bills',
  'tata play': 'bills', tataplay: 'bills', dishtv: 'bills', 'd2h': 'bills',
  'act fibernet': 'bills', actcorp: 'bills', hathway: 'bills', excitel: 'bills',
  broadband: 'bills', 'tata power': 'bills', 'adani electricity': 'bills',
  torrent_power: 'bills', 'torrent power': 'bills', bescom: 'bills', mseb: 'bills',
  bses: 'bills', tneb: 'bills', electricity: 'bills',
  'mahanagar gas': 'bills', 'indraprastha gas': 'bills', 'gas limited': 'bills',
  gujarat_gas: 'bills', water_board: 'bills', municipal: 'bills',
  recharge: 'bills', postpaid: 'bills', prepaid: 'bills', utility: 'bills',

  // ---------- Finance, insurance & banking ----------
  lic: 'finance', 'hdfc life': 'finance', 'sbi life': 'finance',
  'icici prudential': 'finance', 'max life': 'finance', 'bajaj allianz': 'finance',
  'tata aia': 'finance', insurance: 'finance', policybazaar: 'finance',
  'star health': 'finance', 'care health': 'finance', premium_payment: 'finance',
  atm: 'finance', 'cash withdrawal': 'finance', salary: 'finance',
  emi: 'finance', 'loan repayment': 'finance', 'credit card payment': 'finance',
  'bajaj finserv': 'finance', 'bajaj finance': 'finance',

  // ---------- Investment ----------
  zerodha: 'investment', groww: 'investment', upstox: 'investment',
  angel_one: 'investment', 'angel one': 'investment', angelbroking: 'investment',
  smallcase: 'investment', kuvera: 'investment', 'coin by zerodha': 'investment',
  'mutual fund': 'investment', 'sip ': 'investment', nps: 'investment',
  ppf: 'investment', 'fixed deposit': 'investment', 'recurring deposit': 'investment',
  cams: 'investment', kfintech: 'investment', 'nse ': 'investment', 'bse ': 'investment',
  coindcx: 'investment', wazirx: 'investment',

  // ---------- Education ----------
  byjus: 'education', "byju's": 'education', unacademy: 'education',
  vedantu: 'education', toppr: 'education', whitehat: 'education',
  udemy: 'education', coursera: 'education', upgrad: 'education',
  simplilearn: 'education', 'great learning': 'education', physicswallah: 'education',
  school: 'education', college: 'education', university: 'education',
  tuition: 'education', coaching: 'education', 'exam fee': 'education',
  'admission fee': 'education',
};

/**
 * Keywords too short or too common to match safely as a bare word.
 * `ola` inside "colacompany", `idea` inside "IDEAL TRADERS" and `jio` inside
 * "JIOMART-like" strings all produced wrong categories under the old
 * `includes()` matcher.
 */
const STRICT_WORD_KEYWORDS = new Set([
  'ola', 'jio', 'vi ', 'atm', 'emi', 'nps', 'ppf', 'kfc', 'ccd', 'd2h',
  'sip ', 'nse ', 'bse ', '1mg', 'boat', 'zara', 'metro', 'salary', 'toll',
  'hotel', 'cinema', 'school', 'college', 'dental', 'cafe', 'petrol',
]);

/** Escape a keyword for safe use inside a RegExp. */
function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Map a merchant name to a category.
 *
 * Matching is word-boundary based rather than substring based. The old version
 * used `merchant.includes(keyword)`, which categorised "colacompany" and
 * "sharolabs" as transport because both contain "ola".
 *
 * Longer keywords are tried first so a specific match ("prime video") wins over
 * a generic one ("video") regardless of object key order.
 */
function categorizeMerchant(merchant: string): string {
  if (!merchant) return 'others';
  const m = ' ' + merchant.toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim() + ' ';

  const entries = Object.entries(MERCHANT_CATEGORIES).sort((a, b) => b[0].length - a[0].length);

  for (const [kwRaw, cat] of entries) {
    const kw = kwRaw.toLowerCase().replace(/[_-]+/g, ' ').trim();
    if (!kw) continue;

    if (STRICT_WORD_KEYWORDS.has(kwRaw)) {
      // Must appear as a standalone word.
      if (new RegExp('\\b' + escapeRe(kw) + '\\b').test(m)) return cat;
      continue;
    }

    // Multi-word keys match as a phrase; single words must start at a boundary
    // so "ideal" cannot match "idea" but "swiggyit" still matches "swiggy".
    if (kw.includes(' ')) {
      if (m.includes(' ' + kw)) return cat;
    } else if (new RegExp('\\b' + escapeRe(kw)).test(m)) {
      return cat;
    }
  }
  return 'others';
}

/** Exposed for the category test suite (tmp/run-cat.ts). */
export function categorizeMerchantPublic(merchant: string): string {
  return categorizeMerchant(merchant);
}

/**
 * Category for a whole transaction, not just its merchant name.
 *
 * Two things the merchant map alone cannot decide:
 *
 * 1. **Money in.** A credit's counterparty is usually a person or an employer,
 *    so the map returns 'others' and all income ended up uncategorised. Any
 *    unmatched credit is 'finance' — it is money movement, not a purchase.
 * 2. **Transaction-type words in the SMS body** (ATM withdrawal, EMI, IMPS)
 *    that never appear in the extracted merchant.
 */
function resolveCategory(merchant: string, body: string, isDebit: boolean): string {
  const byMerchant = categorizeMerchant(merchant);
  if (byMerchant !== 'others') return byMerchant;

  // Fall back to the full SMS text — the merchant may be a bare name while the
  // body still says "ATM", "EMI" or "salary".
  const byBody = categorizeMerchant(body);
  if (byBody !== 'others') return byBody;

  if (/\b(?:atm|cash\s*w(?:it)?hdrawal|cardless\s*cash)\b/i.test(body)) return 'finance';
  if (/\b(?:emi|loan|repayment|credit\s*card\s*(?:bill|payment))\b/i.test(body)) return 'finance';

  // Unmatched credits are income/transfers rather than spending.
  if (!isDebit) return 'finance';

  return 'others';
}

function cleanMerchantName(name: string): string {
  if (!name) return '';
  return name
    .replace(/(?:UPI-|VPA\s+|to\s+|towards\s+|sent\s+to\s+)/i, '')
    .split('@')[0] // remove upi handle
    .replace(/\s+/g, ' ')
    .trim();
}

export function parseSmsToTransactions(
  smsList: { body: string; date?: string | number; address?: string; _id?: string }[]
): ParsedSmsTransaction[] {
  const out: ParsedSmsTransaction[] = [];
  const seen = new Set<string>();

  for (const sms of smsList) {
    const body = (sms.body || '').trim();
    if (body.length < 10) continue;

    // Identity check first: a registered bank header is a far more reliable
    // signal than anything in the body. Unknown senders are not rejected
    // outright — they pass if the body is clearly transactional, so a small or
    // regional bank we have not listed still works.
    if (!shouldParseSender(sms.address, body)) continue;

    // Promos, OTPs, bill reminders and balance alerts all carry an amount and
    // would otherwise be stored as real transactions.
    if (NON_TRANSACTION_PATTERNS.some((re) => re.test(body))) continue;

    // Handles the both-keywords case instead of discarding it. The previous
    // `DEBIT && !CREDIT` test dropped every "debited ... credited to <payee>"
    // message, which is how most banks word an ordinary UPI payment.
    const direction = resolveDirection(body);
    if (!direction) continue;
    const isDebit = direction === 'debit';

    const amount = extractAmount(body);
    if (amount == null || amount <= 0) continue;

    const date = extractDate(body, sms.date);
    const rawMerchant = extractMerchant(body, isDebit);
    const merchant = cleanMerchantName(rawMerchant);
    
    // Deduplicate on content, always including the id rather than trusting it
    // alone. The Android inbox `_id` is reused after the user deletes messages,
    // so keying on `id-<_id>` by itself made two genuinely different
    // transactions collide — the second was dropped here and never uploaded.
    const key = `${sms._id ?? 'noid'}-${date.getTime()}-${merchant}-${amount}-${isDebit}`;
    if (seen.has(key)) continue;
    seen.add(key);

    out.push({
      merchant,
      amount,
      date: date.toISOString(),
      isDebit,
      description: body.slice(0, 200),
      upiId: sms.address || undefined,
      category: resolveCategory(merchant, body, isDebit),
      smsId: sms._id != null ? String(sms._id) : undefined,
    });
  }

  out.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  return out;
}
