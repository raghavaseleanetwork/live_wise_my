import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Family Hub — feature catalog (single source of truth).
 *
 * Phase 1 (frontend-only): the list of every manageable feature a family
 * member can have, plus a local-storage layer so a member's selected features
 * persist on-device even though the server's GET /api/family does not yet
 * return the `features` field. See backend-team docs (Phase 5) for the server
 * work needed to make this fully server-backed.
 */


export type FamilyFeatureKey =
  | 'medicines'
  | 'appointments'
  | 'bills'
  | 'health'
  | 'emergency'
  | 'routine'
  | 'subscriptions'
  | 'expenses'
  | 'tasks'
  | 'checkin'
  | 'travel'
  | 'stock'
  | 'diet'
  | 'insurance'
  | 'custom'
  | 'fitness'
  | 'study'
  | 'wellness'
  | 'vehicles'
  | 'homeMaintenance';

export interface FamilyFeatureDef {
  key: FamilyFeatureKey;
  label: string;
  emoji: string;
  /** Ionicons name used for the dashboard card + selector row. */
  icon: string;
  /** Short one-line description shown under the label in the selector. */
  description: string;
  /**
   * Whether a working screen exists for this feature yet.
   * Phase 1 only wires up 'medicines' (already built). The rest render a
   * "Coming soon" placeholder card until their phase lands.
   */
  built: boolean;
}

export const FAMILY_FEATURES: FamilyFeatureDef[] = [
  { key: 'medicines', label: 'Medicine Tracking', emoji: '💊', icon: 'medkit', description: 'Daily reminders & adherence tracking', built: true },
  { key: 'appointments', label: 'Doctor Appointments', emoji: '🏥', icon: 'calendar', description: 'Appointment reminders & follow-ups', built: true },
  { key: 'bills', label: 'Bill Management', emoji: '💡', icon: 'receipt', description: 'Electricity, medical & insurance bills', built: true },
  { key: 'health', label: 'Health Monitoring', emoji: '❤️', icon: 'heart', description: 'Blood pressure, sugar & weight tracking', built: true },
  { key: 'emergency', label: 'Emergency Alerts', emoji: '🚨', icon: 'warning', description: 'Missed-medicine & SOS alerts', built: true },
  { key: 'routine', label: 'Daily Routine', emoji: '🕒', icon: 'time', description: 'Wake-up, sleep & walking schedule', built: true },
  { key: 'subscriptions', label: 'Subscription Tracking', emoji: '📺', icon: 'tv', description: 'OTT subscriptions & renewals', built: true },
  { key: 'expenses', label: 'Expense Tracking', emoji: '💰', icon: 'wallet', description: 'Personal spending & alerts', built: true },
  // `list` is three hairline rules — at 18px in the accent tint it reads as an
  // empty tile. `list-circle` carries enough mass to match the other icons.
  { key: 'tasks', label: 'Reminder Tasks', emoji: '📋', icon: 'list-circle', description: 'Daily tasks & custom reminders', built: true },
  { key: 'checkin', label: 'Call & Check-in', emoji: '📞', icon: 'call', description: 'Call reminders & daily check-ins', built: true },
  { key: 'travel', label: 'Travel & Visits', emoji: '✈️', icon: 'airplane', description: 'Doctor visits & family visit reminders', built: true },
  { key: 'stock', label: 'Medication Stock', emoji: '📦', icon: 'cube', description: 'Refill reminders & low-stock alerts', built: true },
  { key: 'diet', label: 'Diet & Food', emoji: '🍽️', icon: 'restaurant', description: 'Meal reminders & diet schedules', built: true },
  { key: 'insurance', label: 'Insurance & Documents', emoji: '📄', icon: 'document-text', description: 'Policy reminders & document tracking', built: true },
  { key: 'custom', label: 'Custom Feature', emoji: '⚙️', icon: 'construct', description: 'Your own tracking option', built: true },
  { key: 'fitness', label: 'Fitness Tracking', emoji: '🏋️', icon: 'barbell', description: 'Workout schedule & streak tracking', built: true },
  { key: 'study', label: 'Study & Education', emoji: '📚', icon: 'school', description: 'Homework, exams & study schedule', built: true },
  { key: 'wellness', label: 'Mental Health & Wellness', emoji: '🧘', icon: 'leaf', description: 'Mood tracking & self-care reminders', built: true },
  { key: 'vehicles', label: 'Vehicle Management', emoji: '🚗', icon: 'car', description: 'Service, insurance & PUC reminders', built: true },
  { key: 'homeMaintenance', label: 'Home Maintenance', emoji: '🏠', icon: 'construct-outline', description: 'AMC, appliance & service reminders', built: true },
];

export const FAMILY_FEATURE_MAP: Record<FamilyFeatureKey, FamilyFeatureDef> = FAMILY_FEATURES.reduce(
  (acc, f) => {
    acc[f.key] = f;
    return acc;
  },
  {} as Record<FamilyFeatureKey, FamilyFeatureDef>,
);

/** Features enabled by default when adding a brand-new member. */
export const DEFAULT_FEATURES: FamilyFeatureKey[] = ['medicines'];

const STORAGE_PREFIX = '@lifewise_family_features_';

/**
 * Migrates the legacy `{ medicines, reminders, reports }` boolean object into
 * the new `FamilyFeatureKey[]` list, so members created before Phase 1 keep
 * working. Accepts either shape and always returns a clean key list.
 */
/**
 * Turns whatever a member record carries into a clean feature-key list.
 *
 * ## Returns `null` when there is NO DATA, not a default
 *
 * This used to fall back to `DEFAULT_FEATURES` (`['medicines']`) whenever the
 * input was absent or unrecognised. That silently invented a module the member
 * did not have, which produced two user-visible bugs:
 *
 *  1. Every member card showed one more feature than it had ("0 features" read
 *     as 1, "4 features" as 5), because `GET /api/family` does not return a
 *     `features` field at all — so the fallback fired for every member.
 *  2. A caregiver restricted to specific modules saw an EMPTY dashboard: the
 *     list being filtered was the fabricated `['medicines']`, which the
 *     caregiver had not been granted, so the intersection was empty.
 *
 * "I could not read this" and "this member genuinely has no modules" are
 * different answers and must not collapse into the same value. Callers that
 * want a default now have to ask for one explicitly.
 */
export function normalizeFeatures(input: unknown): FamilyFeatureKey[] | null {
  if (Array.isArray(input)) {
    // A real array — even an empty one — is an answer. Honour it.
    return input.filter((k): k is FamilyFeatureKey => k in FAMILY_FEATURE_MAP);
  }
  if (input && typeof input === 'object') {
    const legacy = input as Record<string, boolean>;
    const out: FamilyFeatureKey[] = [];
    if (legacy.medicines) out.push('medicines');
    // Legacy "reminders" maps to Bill Management; "reports" has no 1:1 modern
    // equivalent (it was a link-out), so we drop it rather than guess.
    if (legacy.reminders) out.push('bills');
    return out;
  }
  // undefined / null / a string / a number: nothing usable was supplied.
  return null;
}

/**
 * `normalizeFeatures` with an explicit fallback, for the one place that truly
 * wants one: seeding a brand-new member's selection.
 */
export function normalizeFeaturesOrDefault(input: unknown): FamilyFeatureKey[] {
  return normalizeFeatures(input) ?? [...DEFAULT_FEATURES];
}

/** Reads a member's enabled features from local storage. */
export async function loadMemberFeatures(memberId: string): Promise<FamilyFeatureKey[] | null> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_PREFIX + memberId);
    if (!raw) return null;
    return normalizeFeatures(JSON.parse(raw));
  } catch {
    return null;
  }
}

/** Persists a member's enabled features to local storage. */
export async function saveMemberFeatures(memberId: string, features: FamilyFeatureKey[]): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_PREFIX + memberId, JSON.stringify(features));
  } catch {
    // Non-fatal — the same list is also sent to the server on save.
  }
}
