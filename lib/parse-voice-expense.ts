/**
 * Parse a spoken phrase into an expense — Method 3 in the product doc.
 *
 * Runs entirely on-device against the transcript that
 * `POST /api/reminders/voice/parse` already returns, so it adds no API cost and
 * no extra round trip. Handles the Hinglish patterns the doc gives as examples:
 *
 *   "Papa ke liye medicine kharidi, 350 rupaye"  -> 350, health, member "Papa"
 *   "Sabzi mandi mein 180 spend kiya"            -> 180, food
 *   "Electricity bill bhara 2400"                -> 2400, bills
 *   "Petrol 1500 dala aaj"                       -> 1500, transport
 *
 * Deliberately conservative: when the amount is missing or ambiguous the caller
 * is told so rather than being handed a guess, because a wrong amount silently
 * saved is worse than asking the user to type it (doc: "If parsing confidence is
 * low, all fields shown empty for manual fill").
 */
import { CategoryType } from './data';

export interface ParsedVoiceExpense {
  amount: number | null;
  category: CategoryType;
  /** Name spoken for a family member ("Papa", "Mummy"), if any. Matched to a real member by the caller. */
  memberName: string | null;
  /** Cleaned-up label for the transaction row. */
  merchant: string;
  /** How much of the phrase we actually recognised. Drives whether the UI pre-fills or asks. */
  confidence: 'high' | 'medium' | 'low';
  /** True when the phrase looks like money received rather than spent. */
  isCredit: boolean;
}

/**
 * Hindi/Hinglish number words, for phrases where the amount is spoken rather
 * than dictated as digits. Only the round numbers people actually say for money.
 */
const NUMBER_WORDS: Record<string, number> = {
  ek: 1, do: 2, teen: 3, char: 4, chaar: 4, paanch: 5, panch: 5,
  chah: 6, chhah: 6, saat: 7, aath: 8, nau: 9, das: 10,
  bees: 20, tees: 30, chalis: 40, pachas: 50, pachaas: 50,
  saath: 60, sattar: 70, assi: 80, nabbe: 90,
  sau: 100, hazaar: 1000, hajaar: 1000, hazar: 1000,
};

/** Multipliers that follow a number: "2 hazaar" -> 2000, "1.5 lakh" -> 150000. */
const MULTIPLIERS: { re: RegExp; factor: number }[] = [
  { re: /\b(?:hazaar|hajaar|hazar|thousand|k)\b/i, factor: 1000 },
  { re: /\b(?:lakh|lac|lakhs)\b/i, factor: 100000 },
  { re: /\b(?:crore|cr)\b/i, factor: 10000000 },
];

/**
 * Category keywords, ordered most-specific first. The first hit wins, so
 * "medicine" must be tested before a generic "shop".
 */
const CATEGORY_KEYWORDS: { category: CategoryType; words: RegExp }[] = [
  {
    category: 'health',
    words: /\b(medicine|medicines|dawa|dawai|davai|doctor|hospital|clinic|medical|pharmacy|chemist|tablet|injection|checkup|test|lab)\b/i,
  },
  {
    category: 'bills',
    words: /\b(bill|bijli|electricity|current|water|paani|gas|cylinder|recharge|broadband|internet|wifi|dth|mobile bill|phone bill|rent|kiraya|maintenance)\b/i,
  },
  {
    category: 'transport',
    words: /\b(petrol|diesel|fuel|gaadi|auto|rickshaw|taxi|cab|uber|ola|bus|train|ticket|metro|parking|toll|scooter|bike)\b/i,
  },
  {
    category: 'food',
    words: /\b(sabzi|sabji|vegetable|veggies|grocery|groceries|kirana|ration|doodh|milk|bread|khana|food|lunch|dinner|breakfast|nashta|chai|tea|coffee|restaurant|hotel|zomato|swiggy|snacks|fruits|phal|atta|rice|chawal|dal)\b/i,
  },
  {
    category: 'education',
    words: /\b(school|college|tuition|fees|fee|books|kitab|stationery|copy|uniform|coaching|exam)\b/i,
  },
  {
    category: 'entertainment',
    words: /\b(movie|cinema|film|netflix|hotstar|prime|spotify|game|gaming|outing|picnic|party)\b/i,
  },
  {
    category: 'shopping',
    words: /\b(kapde|clothes|shirt|shoes|jutte|amazon|flipkart|myntra|shopping|kharida|kharidi|bought|mall|electronics|mobile|phone)\b/i,
  },
  {
    category: 'travel',
    words: /\b(travel|trip|flight|hotel booking|holiday|vacation|tour)\b/i,
  },
  {
    category: 'subscriptions',
    words: /\b(subscription|membership|gym|plan renew|renewal)\b/i,
  },
  {
    category: 'family',
    words: /\b(gift|shaadi|wedding|birthday|festival|puja|donation|chanda)\b/i,
  },
];

/** Kinship terms the doc uses; matched case-insensitively against real member names. */
const MEMBER_WORDS = /\b(papa|pappa|pitaji|dad|daddy|father|mummy|mumma|maa|mom|mother|bhai|brother|behen|bahen|sister|beta|beti|son|daughter|wife|biwi|patni|husband|pati|dada|dadi|nana|nani|grandpa|grandma|uncle|aunty)\b/i;

const CREDIT_WORDS = /\b(mila|mile|received|aaya|aaye|credit|credited|refund|wapas|salary|income)\b/i;

/** Words that mean "spent" — their presence raises confidence that this is an expense. */
const SPEND_WORDS = /\b(kharch|kharcha|spend|spent|kiya|kiye|diya|diye|bhara|bhare|paid|pay|kharida|kharidi|liya|liye|dala|daala|gaya|lag[ae])\b/i;

/**
 * Strip filler so the leftover text makes a usable transaction title.
 *
 * Covers the English scaffolding of a spoken sentence as well as the Hinglish
 * particles — "I paid 100 on food" must reduce to "Food", not "I on Food".
 * Pronouns, articles, and the prepositions that attach a spend to its subject
 * all have to go, since `SPEND_WORDS` only removes the verb itself.
 */
const FILLER = /\b(ke liye|k liye|kelie|mein|me|main|par|pe|ko|ka|ki|se|aaj|kal|today|yesterday|rupaye|rupees|rupee|rs|inr|ka hisab|about|around|approx|i|we|my|our|myself|on|for|of|at|to|in|from|the|a|an|and|some|this|that|it|was|were|have|has|had|did|do|just|now|please|add|expense|transaction|entry|record|note|log)\b/gi;

function wordsToNumber(text: string): number | null {
  const tokens = text.toLowerCase().split(/\s+/);
  let total = 0;
  let current = 0;
  let matched = false;

  for (const raw of tokens) {
    const token = raw.replace(/[^a-z]/g, '');
    const value = NUMBER_WORDS[token];
    if (value == null) continue;
    matched = true;
    if (value === 100 || value === 1000) {
      current = (current || 1) * value;
      total += current;
      current = 0;
    } else {
      current += value;
    }
  }
  const result = total + current;
  return matched && result > 0 ? result : null;
}

/**
 * Pull the amount out of the phrase. Digits win over spoken words; a trailing
 * multiplier ("2 hazaar") is applied when present.
 */
function extractAmount(text: string): { amount: number | null; certain: boolean } {
  const normalized = text.replace(/,/g, '');

  // Currency-anchored is the most reliable: "350 rupaye", "Rs 500", "₹1200".
  const anchored =
    normalized.match(/(?:rs\.?|inr|₹)\s*(\d+(?:\.\d{1,2})?)/i) ||
    normalized.match(/(\d+(?:\.\d{1,2})?)\s*(?:rupaye|rupees|rupee|rs\b|inr|₹)/i);
  if (anchored) {
    let value = Number(anchored[1]);
    const tail = normalized.slice(normalized.indexOf(anchored[0]) + anchored[0].length, normalized.indexOf(anchored[0]) + anchored[0].length + 12);
    for (const { re, factor } of MULTIPLIERS) {
      if (re.test(tail)) { value *= factor; break; }
    }
    return { amount: value, certain: true };
  }

  // Digits followed by a multiplier word: "2 hazaar", "1.5 lakh".
  const withMultiplier = normalized.match(
    /(\d+(?:\.\d{1,2})?)\s*(hazaar|hajaar|hazar|thousand|k|lakh|lac|lakhs|crore|cr)\b/i,
  );
  if (withMultiplier) {
    const factor =
      MULTIPLIERS.find(({ re }) => re.test(withMultiplier[2]))?.factor ?? 1;
    return { amount: Number(withMultiplier[1]) * factor, certain: true };
  }

  // Bare digits anywhere in the phrase. `\b` is not usable on the left here:
  // in "mein 180" the space already ends the previous word, and a leading \b
  // after a non-word char fails to match. Anchor on a non-digit lookbehind
  // instead so "180", "mein 180" and "bill2400" all resolve.
  const bare = normalized.match(/(?:^|[^\d.])(\d{1,7}(?:\.\d{1,2})?)(?![\d.])/);
  if (bare) return { amount: Number(bare[1]), certain: false };

  // Spoken words last, and only when no digits were found at all — otherwise
  // stray tokens ("do", "das") hijack a phrase that already stated its amount.
  const spokenWithMultiplier = normalized.match(
    /\b(ek|do|teen|char|chaar|paanch|panch|saat|aath|nau|das)\s+(hazaar|hajaar|hazar|lakh|sau)\b/i,
  );
  if (spokenWithMultiplier) {
    const base = NUMBER_WORDS[spokenWithMultiplier[1].toLowerCase()] ?? 1;
    const mult = NUMBER_WORDS[spokenWithMultiplier[2].toLowerCase()] ?? 1;
    return { amount: base * mult, certain: true };
  }

  const spoken = wordsToNumber(normalized);
  if (spoken != null) return { amount: spoken, certain: false };

  return { amount: null, certain: false };
}

function extractCategory(text: string): { category: CategoryType; matched: boolean } {
  for (const { category, words } of CATEGORY_KEYWORDS) {
    if (words.test(text)) return { category, matched: true };
  }
  return { category: 'others', matched: false };
}

/** Build a short human title from whatever is left after removing amount and filler. */
function buildMerchant(text: string, category: CategoryType, fallbackLabel: string): string {
  const cleaned = text
    .replace(/(?:rs\.?|inr|₹)\s*\d+(?:\.\d{1,2})?/gi, ' ')
    .replace(/\d+(?:\.\d{1,2})?\s*(?:rupaye|rupees|rupee|rs\b|inr|hazaar|hajaar|lakh|k)\b/gi, ' ')
    .replace(/\b\d+(?:\.\d{1,2})?\b/g, ' ')
    // FILLER before SPEND_WORDS: multi-word particles like "ke liye" share a
    // token with the spend verbs ("liye"), so stripping verbs first would break
    // the phrase apart and strand a bare "ke" in the title.
    .replace(FILLER, ' ')
    .replace(SPEND_WORDS, ' ')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!cleaned) return fallbackLabel;
  // Title-case the first few words; long transcripts make unreadable row titles.
  const words = cleaned.split(' ').slice(0, 5);
  return words
    .map((w) => (w.length > 2 ? w[0].toUpperCase() + w.slice(1).toLowerCase() : w))
    .join(' ')
    .slice(0, 60);
}

export function parseVoiceExpense(
  transcript: string,
  categoryLabel: (c: CategoryType) => string,
): ParsedVoiceExpense {
  const text = (transcript || '').trim();
  if (!text) {
    return {
      amount: null,
      category: 'others',
      memberName: null,
      merchant: '',
      confidence: 'low',
      isCredit: false,
    };
  }

  const { amount, certain } = extractAmount(text);
  const { category, matched: categoryMatched } = extractCategory(text);
  const memberMatch = text.match(MEMBER_WORDS);
  const memberName = memberMatch ? memberMatch[1] : null;
  const isCredit = CREDIT_WORDS.test(text) && !SPEND_WORDS.test(text);
  const merchant = buildMerchant(text, category, categoryLabel(category));

  // Confidence drives whether the review screen pre-fills or asks. An amount is
  // mandatory — without one there is nothing to save, so that is always 'low',
  // regardless of how many other signals matched.
  let confidence: ParsedVoiceExpense['confidence'] = 'low';
  if (amount != null && amount > 0) {
    const signals = [certain, categoryMatched, SPEND_WORDS.test(text)].filter(Boolean).length;
    // A phrase that looks like money received is never a high-confidence expense.
    confidence = signals >= 2 && !isCredit ? 'high' : 'medium';
  }

  return { amount, category, memberName, merchant, confidence, isCredit };
}
