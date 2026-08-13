/**
 * Merchant -> expected category. Drives tmp/run-cat.ts.
 * Categories must be members of CategoryType in lib/data.ts.
 */
export const CAT_CASES: { merchant: string; expect: string; note?: string }[] = [
  // Food & dining
  { merchant: 'SWIGGY', expect: 'food' },
  { merchant: 'zomato', expect: 'food' },
  { merchant: 'Chai Point', expect: 'food' },
  { merchant: 'DOMINOS PIZZA', expect: 'food' },
  { merchant: 'HALDIRAM', expect: 'food' },

  // Groceries -> shopping (app has no separate grocery category)
  { merchant: 'DMART', expect: 'shopping', note: 'currently others' },
  { merchant: 'RELIANCE FRESH', expect: 'shopping', note: 'currently others' },
  { merchant: 'BIGBASKET', expect: 'shopping' },
  { merchant: 'BLINKIT', expect: 'shopping' },
  { merchant: 'MORE SUPERMARKET', expect: 'shopping', note: 'currently others' },

  // E-commerce
  { merchant: 'AMAZON', expect: 'shopping' },
  { merchant: 'MYNTRA', expect: 'shopping' },
  { merchant: 'CROMA', expect: 'shopping' },
  { merchant: 'BIGBAZAAR', expect: 'shopping', note: 'currently others' },

  // Transport & fuel
  { merchant: 'UBER INDIA', expect: 'transport' },
  { merchant: 'OLA CABS', expect: 'transport' },
  { merchant: 'RAPIDO', expect: 'transport' },
  { merchant: 'INDIAN OIL', expect: 'transport', note: 'fuel; currently others' },
  { merchant: 'HP PETROL PUMP', expect: 'transport', note: 'fuel; currently others' },
  { merchant: 'BHARAT PETROLEUM', expect: 'transport', note: 'fuel; currently others' },
  { merchant: 'PAYTM FASTAG', expect: 'transport', note: 'toll; currently others' },

  // Travel
  { merchant: 'IRCTC', expect: 'travel' },
  { merchant: 'MAKEMYTRIP', expect: 'travel' },
  { merchant: 'INDIGO', expect: 'travel' },

  // Subscriptions (NOT entertainment)
  { merchant: 'NETFLIX', expect: 'subscriptions', note: 'currently entertainment' },
  { merchant: 'SPOTIFY', expect: 'subscriptions', note: 'currently entertainment' },
  { merchant: 'HOTSTAR', expect: 'subscriptions', note: 'currently entertainment' },
  { merchant: 'GOOGLE ONE', expect: 'subscriptions', note: 'currently others' },

  // Entertainment (one-off outings, not recurring)
  { merchant: 'BOOKMYSHOW', expect: 'entertainment' },
  { merchant: 'PVR CINEMAS', expect: 'entertainment' },
  { merchant: 'INOX', expect: 'entertainment' },

  // Health
  { merchant: 'APOLLO PHARMACY', expect: 'health', note: 'currently others' },
  { merchant: 'MEDPLUS', expect: 'health', note: 'currently others' },
  { merchant: 'PHARMEASY', expect: 'health', note: 'currently others' },
  { merchant: 'FORTIS HOSPITAL', expect: 'health', note: 'currently others' },
  { merchant: 'DR LAL PATHLABS', expect: 'health', note: 'currently others' },

  // Bills & utilities
  { merchant: 'AIRTEL', expect: 'bills' },
  { merchant: 'JIO', expect: 'bills' },
  { merchant: 'TATA POWER', expect: 'bills', note: 'currently others' },
  { merchant: 'ADANI ELECTRICITY', expect: 'bills' },
  { merchant: 'MAHANAGAR GAS', expect: 'bills', note: 'currently others' },
  { merchant: 'ACT FIBERNET', expect: 'bills', note: 'currently others' },

  // Finance / insurance / investment
  { merchant: 'LIC INDIA', expect: 'finance', note: 'insurance; currently others' },
  { merchant: 'HDFC LIFE', expect: 'finance', note: 'currently others' },
  { merchant: 'ZERODHA', expect: 'investment', note: 'currently others' },
  { merchant: 'GROWW', expect: 'investment', note: 'currently others' },
  { merchant: 'ATM PNB MUMBAI', expect: 'finance', note: 'cash withdrawal; currently others' },
  { merchant: 'NEFT-SALARY', expect: 'finance', note: 'income; currently others' },

  // Education
  { merchant: 'BYJUS', expect: 'education', note: 'currently others' },
  { merchant: 'UNACADEMY', expect: 'education', note: 'currently others' },
  { merchant: 'UDEMY', expect: 'education', note: 'currently others' },

  // Substring-collision guards: these must NOT inherit a category.
  { merchant: 'colacompany', expect: 'others', note: 'must not match "ola"' },
  { merchant: 'sharolabs', expect: 'others', note: 'must not match "ola"' },
  { merchant: 'IDEAL TRADERS', expect: 'others', note: 'must not match "idea"' },
  { merchant: 'RAGHAV', expect: 'others', note: 'a person, not a merchant' },
  { merchant: 'RAMESH KUMAR', expect: 'others', note: 'a person' },
];
