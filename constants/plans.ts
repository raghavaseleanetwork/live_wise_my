/**
 * LifeWise — Subscription Plans (single source of truth).
 *
 * Encodes every plan, price, limit, feature flag and paywall trigger exactly as
 * defined in `backend-team/app docs/LifeWise_Product_Logic_with_Timeline (1).docx`
 * (Section 4: Subscription Plans & Limits, Section 5: Paywall Logic & UX,
 * Section 6: Feature Availability Matrix).
 *
 * This file is PURE DATA — no UI, no side effects, no payment code. The client
 * subscription layer (`lib/entitlements.ts`, `lib/subscription-context.tsx`)
 * reads from here. When the payment gateway (IAP / RevenueCat) is added later,
 * only the purchase seam changes — these tables stay authoritative.
 *
 * `Infinity` represents "unlimited" (the doc's ∞). `0` on a numeric limit means
 * the feature is not available on that plan (the doc's ✗ / "Not available").
 */

export type PlanId = 'free' | 'starter' | 'family' | 'pro';

export type BillingInterval = 'month' | 'year';

/** Plans ordered from lowest to highest tier — used for upgrade comparisons. */
export const PLAN_ORDER: PlanId[] = ['free', 'starter', 'family', 'pro'];

export interface PlanMeta {
  id: PlanId;
  name: string;
  /** Short positioning line from the doc. */
  tagline: string;
  /** Price in INR. Region-fixed (store pricing), independent of in-app display currency. */
  priceMonthly: number;
  priceYearly: number;
  /** e.g. "33% off" — shown next to the yearly price. Empty for FREE. */
  yearlyDiscountLabel: string;
  /** FAMILY is the doc's "RECOMMENDED / Most Popular" plan. */
  recommended: boolean;
  /** Store product IDs (documented for the future IAP phase; unused now). */
  productIdMonthly: string | null;
  productIdYearly: string | null;
}

export const PLAN_META: Record<PlanId, PlanMeta> = {
  free: {
    id: 'free',
    name: 'Free',
    tagline: 'Get started — no credit card needed',
    priceMonthly: 0,
    priceYearly: 0,
    yearlyDiscountLabel: '',
    recommended: false,
    productIdMonthly: null,
    productIdYearly: null,
  },
  starter: {
    id: 'starter',
    name: 'Starter',
    tagline: 'Perfect for a small family or couple',
    priceMonthly: 99,
    priceYearly: 799,
    yearlyDiscountLabel: '33% off',
    recommended: false,
    productIdMonthly: 'lifewise_starter_monthly',
    productIdYearly: 'lifewise_starter_yearly',
  },
  family: {
    id: 'family',
    name: 'Family',
    tagline: 'The complete family operating system',
    priceMonthly: 199,
    priceYearly: 1499,
    yearlyDiscountLabel: '37% off',
    recommended: true,
    productIdMonthly: 'lifewise_family_monthly',
    productIdYearly: 'lifewise_family_yearly',
  },
  pro: {
    id: 'pro',
    name: 'Pro',
    tagline: 'Power users, large families, business use',
    priceMonthly: 499,
    priceYearly: 3999,
    yearlyDiscountLabel: '33% off',
    recommended: false,
    productIdMonthly: 'lifewise_pro_monthly',
    productIdYearly: 'lifewise_pro_yearly',
  },
};

/**
 * Numeric limits per plan. `Infinity` = unlimited. `0` = not available.
 *
 * NOTE ON MODULES: the doc lists 20 modules/member for FAMILY+. The app's real
 * module catalogue (`lib/family-features.ts`) currently defines 15. We keep the
 * doc's FREE=3 / STARTER=8 gates and treat FAMILY/PRO as "all modules"
 * (Infinity), so the ceiling always matches the real catalogue rather than an
 * invented count. See SUBSCRIPTION_INTEGRATION_PLAN.md §5.1.
 */
export interface PlanLimits {
  familyMembers: number;
  modulesPerMember: number;
  reminders: number;
  expenseHistoryDays: number;
  billsPerMember: number;
  documents: number;
  voiceReminderPerMonth: number;
  billScanPerMonth: number;
  wiseAiPerMonth: number;
  bankPdfImportPerMonth: number;
  caregiversPerMember: number;
  recurringTemplates: number;
  noticeboardPostsPerMonth: number;
  locationSharingMembers: number;
}

export const LIMITS: Record<PlanId, PlanLimits> = {
  free: {
    familyMembers: 2,
    modulesPerMember: 3,
    reminders: 10,
    expenseHistoryDays: 7,
    billsPerMember: 1,
    documents: 1,
    voiceReminderPerMonth: 5,
    billScanPerMonth: 3,
    wiseAiPerMonth: 5,
    bankPdfImportPerMonth: 0,
    caregiversPerMember: 0,
    recurringTemplates: 0,
    noticeboardPostsPerMonth: 0,
    locationSharingMembers: 0,
  },
  starter: {
    familyMembers: 4,
    modulesPerMember: 8,
    reminders: 50,
    expenseHistoryDays: 90,
    billsPerMember: 5,
    documents: 10,
    voiceReminderPerMonth: 30,
    billScanPerMonth: 20,
    wiseAiPerMonth: 30,
    bankPdfImportPerMonth: 1,
    caregiversPerMember: 1,
    recurringTemplates: 10,
    noticeboardPostsPerMonth: 20,
    locationSharingMembers: 0,
  },
  family: {
    familyMembers: Infinity,
    modulesPerMember: Infinity,
    reminders: Infinity,
    expenseHistoryDays: 365,
    billsPerMember: Infinity,
    documents: 50,
    voiceReminderPerMonth: Infinity,
    billScanPerMonth: Infinity,
    wiseAiPerMonth: 100,
    bankPdfImportPerMonth: Infinity,
    caregiversPerMember: Infinity,
    recurringTemplates: Infinity,
    noticeboardPostsPerMonth: Infinity,
    locationSharingMembers: 6,
  },
  pro: {
    familyMembers: Infinity,
    modulesPerMember: Infinity,
    reminders: Infinity,
    expenseHistoryDays: Infinity,
    billsPerMember: Infinity,
    documents: Infinity,
    voiceReminderPerMonth: Infinity,
    billScanPerMonth: Infinity,
    wiseAiPerMonth: 300,
    bankPdfImportPerMonth: Infinity,
    caregiversPerMember: Infinity,
    recurringTemplates: Infinity,
    noticeboardPostsPerMonth: Infinity,
    locationSharingMembers: Infinity,
  },
};

export type LimitKey = keyof PlanLimits;

/** The per-month usage counters (reset monthly). Subset of LimitKey. */
export const MONTHLY_LIMIT_KEYS: LimitKey[] = [
  'voiceReminderPerMonth',
  'billScanPerMonth',
  'wiseAiPerMonth',
  'bankPdfImportPerMonth',
  'noticeboardPostsPerMonth',
];

/**
 * Boolean feature flags per plan (the doc's ✓ / ✗ availability matrix,
 * Section 6). Anything not listed here is treated as always-on for all plans
 * (Manual Quick Add, current-month summary, 7-day history, basic charts,
 * Aadhaar/PAN scan, push notifications, Emergency SOS, dark mode,
 * shared shopping list, birthday reminders — free on every plan).
 */
export interface PlanFlags {
  pdfReports: boolean;
  annualReportPdf: boolean;
  csvImport: boolean;
  moneyLeakAlerts: boolean;
  budgetAlerts: boolean;
  smsAutoDetect: boolean;
  perMemberBreakdown: boolean;
  healthGraph12mo: boolean;
  medicineStockAlerts: boolean;
  documentExpiryAlerts: boolean;
  sharedCaregiverAlerts: boolean;
  medicineInteraction: boolean;
  pillIdentifier: boolean;
  doctorHealthPdf: boolean;
  whatsappReminders: boolean;
  dataExportJson: boolean;
}

export const FLAGS: Record<PlanId, PlanFlags> = {
  free: {
    pdfReports: false,
    annualReportPdf: false,
    csvImport: false,
    moneyLeakAlerts: false,
    budgetAlerts: false,
    smsAutoDetect: false,
    perMemberBreakdown: false,
    healthGraph12mo: false,
    medicineStockAlerts: false,
    documentExpiryAlerts: false,
    sharedCaregiverAlerts: false,
    medicineInteraction: false,
    pillIdentifier: false,
    doctorHealthPdf: false,
    whatsappReminders: false,
    dataExportJson: false,
  },
  starter: {
    pdfReports: false,
    annualReportPdf: false,
    csvImport: true,
    moneyLeakAlerts: false,
    budgetAlerts: false,
    smsAutoDetect: true,
    perMemberBreakdown: true,
    healthGraph12mo: false,
    medicineStockAlerts: true,
    documentExpiryAlerts: true,
    sharedCaregiverAlerts: true,
    medicineInteraction: false,
    pillIdentifier: false,
    doctorHealthPdf: false,
    whatsappReminders: false,
    dataExportJson: false,
  },
  family: {
    pdfReports: true,
    annualReportPdf: false,
    csvImport: true,
    moneyLeakAlerts: true,
    budgetAlerts: true,
    smsAutoDetect: true,
    perMemberBreakdown: true,
    healthGraph12mo: true,
    medicineStockAlerts: true,
    documentExpiryAlerts: true,
    sharedCaregiverAlerts: true,
    medicineInteraction: false,
    pillIdentifier: false,
    doctorHealthPdf: false,
    whatsappReminders: false,
    dataExportJson: false,
  },
  pro: {
    pdfReports: true,
    annualReportPdf: true,
    csvImport: true,
    moneyLeakAlerts: true,
    budgetAlerts: true,
    smsAutoDetect: true,
    perMemberBreakdown: true,
    healthGraph12mo: true,
    medicineStockAlerts: true,
    documentExpiryAlerts: true,
    sharedCaregiverAlerts: true,
    medicineInteraction: true,
    pillIdentifier: true,
    doctorHealthPdf: true,
    whatsappReminders: true,
    dataExportJson: true,
  },
};

export type FlagKey = keyof PlanFlags;

/**
 * Per-member module catalogue for the plan comparison / limit — the "modules
 * per member" concept. Kept in sync with `lib/family-features.ts` (the real
 * catalogue) at runtime; the number here (`TOTAL_MODULES_LABEL`) is only for
 * display copy like "3 of 20". We show the doc's marketing number (20) in copy
 * while gating against the real catalogue count.
 */
export const TOTAL_MODULES_LABEL = 20;

/**
 * Free-trial rules (doc Section 5.3). 7-day FAMILY trial, once per account,
 * auto-activated on first run. No card required.
 */
export const TRIAL = {
  planId: 'family' as PlanId,
  durationDays: 7,
  reminderDayBeforeExpiry: 2, // Day-5 reminder for a 7-day trial
} as const;

/**
 * Paywall trigger catalogue (doc Section 5.1). Each entry is fired at the exact
 * moment a user tries to cross a limit. Copy is verbatim/benefit-focused per the
 * doc — never "you hit the limit". `critical` triggers escalate to the hard
 * full-screen paywall after repeated soft dismissals (member / reminder limits).
 */
export type PaywallTriggerKey =
  | 'thirdMember'
  | 'fourthModule'
  | 'eleventhReminder'
  | 'expenseHistory'
  | 'pdfExport'
  | 'bankImport'
  | 'budgetAlerts'
  | 'fourthBillScan'
  | 'sixthWiseAi'
  | 'secondDocument'
  | 'locationSharing'
  | 'medicineInteraction';

export interface PaywallTrigger {
  key: PaywallTriggerKey;
  /** Benefit-focused headline for the paywall sheet. */
  title: string;
  /** The empathetic message copy (verbatim from the doc's trigger table). */
  message: string;
  /** Plan the doc recommends for this trigger. */
  recommendedPlan: PlanId;
  /** Ionicons name for the feature illustration in the sheet. */
  icon: string;
  /** 3–4 short upgrade benefits specific to the blocked feature. */
  benefits: string[];
  /** CRITICAL limits use the hard paywall after 3 soft dismissals. */
  critical: boolean;
}

export const PAYWALL_TRIGGERS: Record<PaywallTriggerKey, PaywallTrigger> = {
  thirdMember: {
    key: 'thirdMember',
    title: "You're building a bigger family hub!",
    message: "You're building a bigger family hub! Add unlimited members with LifeWise Family.",
    recommendedPlan: 'family',
    icon: 'people',
    benefits: ['Unlimited family members', 'All 20 modules per member', 'Full family dashboard'],
    critical: true,
  },
  fourthModule: {
    key: 'fourthModule',
    title: 'Manage more of what matters',
    message:
      "This is a premium feature. Upgrade to manage more aspects of your family member's life.",
    recommendedPlan: 'starter',
    icon: 'grid',
    benefits: ['8 modules per member', 'More tracking per person', 'Grows with your family'],
    critical: false,
  },
  eleventhReminder: {
    key: 'eleventhReminder',
    title: "You're staying on top of things!",
    message: "You're staying on top of things! Unlimited reminders available in Starter and above.",
    recommendedPlan: 'starter',
    icon: 'notifications',
    benefits: ['50 reminders on Starter', 'Unlimited on Family', 'Never miss a bill or dose'],
    critical: true,
  },
  expenseHistory: {
    key: 'expenseHistory',
    title: 'See the full picture',
    message: 'Older expenses are stored safely. Unlock 12-month history to see the full picture.',
    recommendedPlan: 'starter',
    icon: 'time',
    benefits: ['3 months on Starter', '12 months on Family', 'Spot long-term trends'],
    critical: false,
  },
  pdfExport: {
    key: 'pdfExport',
    title: "Download your family's report",
    message:
      "Download your family's health and finance report. Available in Family plan and above.",
    recommendedPlan: 'family',
    icon: 'document-text',
    benefits: ['Monthly PDF reports', 'Annual overview', 'Share with anyone'],
    critical: false,
  },
  bankImport: {
    key: 'bankImport',
    title: 'One tap, whole month done',
    message:
      'Auto-fill all your expenses from your bank statement. One tap, whole month done.',
    recommendedPlan: 'starter',
    icon: 'cloud-upload',
    benefits: ['Import bank PDF statements', 'Auto-categorised expenses', 'Save hours of typing'],
    critical: false,
  },
  budgetAlerts: {
    key: 'budgetAlerts',
    title: "Keep your family's finances on track",
    message:
      "Set spending limits for each family member. Keep your family's finances on track.",
    recommendedPlan: 'family',
    icon: 'trending-up',
    benefits: ['Per-category budgets', 'Per-member limits', 'Overspend alerts'],
    critical: false,
  },
  fourthBillScan: {
    key: 'fourthBillScan',
    title: 'Scan unlimited bills',
    message: 'Scan unlimited bills and receipts with Family plan.',
    recommendedPlan: 'family',
    icon: 'scan',
    benefits: ['Unlimited receipt scans', 'On-device OCR', 'Attach receipt photos'],
    critical: false,
  },
  sixthWiseAi: {
    key: 'sixthWiseAi',
    title: "You're chatting with WiseAI!",
    message: "You're chatting with WiseAI! Get 100 messages/month with LifeWise Family.",
    recommendedPlan: 'family',
    icon: 'sparkles',
    benefits: ['100 messages/month on Family', '300 on Pro', 'Smart family insights'],
    critical: false,
  },
  secondDocument: {
    key: 'secondDocument',
    title: "Store all your family's documents",
    message:
      "Store all your family's Aadhaar, PAN, Passport safely. Family plan = 50 documents.",
    recommendedPlan: 'family',
    icon: 'folder',
    benefits: ['50 documents on Family', 'All document types', 'Expiry reminders'],
    critical: false,
  },
  locationSharing: {
    key: 'locationSharing',
    title: 'Stay connected safely',
    message: 'See where your family members are in real-time. Stay connected safely.',
    recommendedPlan: 'family',
    icon: 'location',
    benefits: ['Live location for up to 6', 'Emergency SOS', 'Peace of mind'],
    critical: false,
  },
  medicineInteraction: {
    key: 'medicineInteraction',
    title: 'Keep your family safe',
    message: 'Check if medicines are safe together. Pro plan keeps your family safe.',
    recommendedPlan: 'pro',
    icon: 'medkit',
    benefits: ['Medicine interaction checker', 'Pill photo identifier', 'Doctor-ready reports'],
    critical: false,
  },
};

/** Human-readable label for a numeric limit value ("∞" for unlimited). */
export function formatLimit(value: number): string {
  return value === Infinity ? '∞' : String(value);
}

/** Formats an INR plan price ("Free" for 0). */
export function formatPlanPrice(amount: number): string {
  return amount === 0 ? 'Free' : `₹${amount.toLocaleString('en-IN')}`;
}

/**
 * Display price for a plan, preferring the store's localised string.
 *
 * Apple and Google own displayed pricing — the hardcoded INR values above are a
 * fallback for the web build and for before offerings load. Showing a price that
 * differs from what the store charges is a review rejection, so always route
 * plan pricing through here rather than reading `priceMonthly` directly.
 *
 * `storePrices` comes from `useSubscription().storePrices`.
 */
export function resolvePlanPrice(
  planId: PlanId,
  interval: BillingInterval,
  storePrices?: Record<string, string>,
): string {
  const meta = PLAN_META[planId];
  const fallback = interval === 'year' ? meta.priceYearly : meta.priceMonthly;
  if (fallback === 0) return 'Free';
  return storePrices?.[`${planId}_${interval}`] ?? formatPlanPrice(fallback);
}
