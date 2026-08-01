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

/**
 * ⚠️ MASTER KILL SWITCH — all plan limits and paywalls are DISABLED.
 *
 * Set `true` for client demos: every limit reads as unlimited, every feature
 * flag reads as on, and no paywall can fire anywhere in the app. Set back to
 * `false` to restore normal plan enforcement — that single edit is the whole
 * revert, no other file changes.
 *
 * This is the only switch: every gate in the app routes through `getLimit`,
 * `isFlagEnabled`, `checkLimit` and `checkFlag` below, so nothing can slip past.
 *
 * ⚠️ MUST be `false` before any production release — with it on, every paid
 * feature is free for everyone.
 *
 * Set 2026-07-29 for client demos while the RevenueCat dashboard
 * misconfiguration and backend enforcement are still being sorted out.
 */
export const LIMITS_DISABLED = true;

/** Returns the numeric limit for a plan (`Infinity` = unlimited, `0` = unavailable). */
export function getLimit(plan: PlanId, key: LimitKey): number {
  if (LIMITS_DISABLED) return Infinity;
  return LIMITS[plan][key];
}

/** Whether a boolean feature flag is enabled on a plan. */
export function isFlagEnabled(plan: PlanId, key: FlagKey): boolean {
  if (LIMITS_DISABLED) return true;
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
  if (LIMITS_DISABLED) {
    // `triggerKey: null` matters as much as `allowed: true` — call sites gate on
    // `!allowed && triggerKey`, so a null trigger is a second guarantee that no
    // paywall can be presented.
    return {
      allowed: true,
      limit: Infinity,
      attempted: currentCount + 1,
      recommendedPlan: null,
      triggerKey: null,
    };
  }

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

/**
 * The paywall trigger for a limit, independent of any local count.
 *
 * `checkLimit` needs to know how many the user has already used; this does not.
 * It exists for the case where the SERVER has already decided the limit is
 * breached (a `403 {"error":"plan_limit","limitKey":...}` response) and the
 * client only needs to know which paywall to present. Going through
 * `checkLimit` there would re-derive the verdict from the local counter, which
 * is exactly the counter the server just overruled.
 */
export function triggerForLimit(key: LimitKey): PaywallTriggerKey | null {
  return LIMIT_TO_TRIGGER[key] ?? null;
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
  if (LIMITS_DISABLED) {
    return { allowed: true, recommendedPlan: null, triggerKey: null };
  }

  const allowed = FLAGS[plan][key];
  const triggerKey = FLAG_TO_TRIGGER[key] ?? null;
  const recommendedPlan = allowed
    ? null
    : triggerKey
      ? PAYWALL_TRIGGERS[triggerKey].recommendedPlan
      : lowestPlanForFlag(key);
  return { allowed, recommendedPlan, triggerKey };
}
