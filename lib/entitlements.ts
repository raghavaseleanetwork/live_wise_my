/**
 * Entitlement engine — pure, React-free logic that answers "can this user do X?"
 * given their current plan and current usage.
 *
 * Reads exclusively from `constants/plans.ts`. No storage, no side effects, no
 * UI — this is the layer that both the subscription context and any screen can
 * call to decide whether to allow an action or present a paywall.
 */

import {
  PlanId,
  PLAN_ORDER,
  LIMITS,
  FLAGS,
  LimitKey,
  FlagKey,
  PaywallTriggerKey,
  PAYWALL_TRIGGERS,
} from '@/constants/plans';

/** Returns the numeric limit for a plan (`Infinity` = unlimited, `0` = unavailable). */
export function getLimit(plan: PlanId, key: LimitKey): number {
  return LIMITS[plan][key];
}

/** Whether a boolean feature flag is enabled on a plan. */
export function isFlagEnabled(plan: PlanId, key: FlagKey): boolean {
  return FLAGS[plan][key];
}

/** True if `plan` is the same or a higher tier than `min`. */
export function planAtLeast(plan: PlanId, min: PlanId): boolean {
  return PLAN_ORDER.indexOf(plan) >= PLAN_ORDER.indexOf(min);
}

/** The lowest-tier plan whose limit for `key` covers `needed` (or null if none does). */
export function lowestPlanFor(key: LimitKey, needed: number): PlanId | null {
  for (const plan of PLAN_ORDER) {
    if (LIMITS[plan][key] >= needed) return plan;
  }
  return null;
}

/** The lowest-tier plan that enables a boolean flag (or null if only never). */
export function lowestPlanForFlag(key: FlagKey): PlanId | null {
  for (const plan of PLAN_ORDER) {
    if (FLAGS[plan][key]) return plan;
  }
  return null;
}

export interface LimitCheck {
  /** Whether the action is permitted under the current plan. */
  allowed: boolean;
  /** The plan's limit for this key. */
  limit: number;
  /** The count that would result after the action (currentCount + 1). */
  attempted: number;
  /** The plan to recommend if blocked (from the trigger, or the next tier up). */
  recommendedPlan: PlanId | null;
  /** The paywall trigger to present if blocked, when one maps to this limit. */
  triggerKey: PaywallTriggerKey | null;
}

/**
 * Maps a numeric limit to the paywall trigger the doc fires when it's crossed.
 * Only limits with an explicit trigger in Section 5.1 are listed.
 */
const LIMIT_TO_TRIGGER: Partial<Record<LimitKey, PaywallTriggerKey>> = {
  familyMembers: 'thirdMember',
  modulesPerMember: 'fourthModule',
  reminders: 'eleventhReminder',
  bankPdfImportPerMonth: 'bankImport',
  billScanPerMonth: 'fourthBillScan',
  wiseAiPerMonth: 'sixthWiseAi',
  documents: 'secondDocument',
};

/**
 * Checks whether adding one more of `key` is allowed for a plan.
 *
 * @param currentCount how many the user already has/used this period.
 * @returns a full decision including which paywall to show if blocked.
 */
export function checkLimit(plan: PlanId, key: LimitKey, currentCount: number): LimitCheck {
  const limit = LIMITS[plan][key];
  const attempted = currentCount + 1;
  const allowed = attempted <= limit;
  const triggerKey = LIMIT_TO_TRIGGER[key] ?? null;
  const recommendedPlan = allowed
    ? null
    : triggerKey
      ? PAYWALL_TRIGGERS[triggerKey].recommendedPlan
      : lowestPlanFor(key, attempted);
  return { allowed, limit, attempted, recommendedPlan, triggerKey };
}

export interface FlagCheck {
  allowed: boolean;
  recommendedPlan: PlanId | null;
  triggerKey: PaywallTriggerKey | null;
}

/** Maps a boolean flag to its paywall trigger where the doc defines one. */
const FLAG_TO_TRIGGER: Partial<Record<FlagKey, PaywallTriggerKey>> = {
  pdfReports: 'pdfExport',
  budgetAlerts: 'budgetAlerts',
  medicineInteraction: 'medicineInteraction',
};

/** Checks whether a boolean feature is available, with the paywall to show if not. */
export function checkFlag(plan: PlanId, key: FlagKey): FlagCheck {
  const allowed = FLAGS[plan][key];
  const triggerKey = FLAG_TO_TRIGGER[key] ?? null;
  const recommendedPlan = allowed
    ? null
    : triggerKey
      ? PAYWALL_TRIGGERS[triggerKey].recommendedPlan
      : lowestPlanForFlag(key);
  return { allowed, recommendedPlan, triggerKey };
}
