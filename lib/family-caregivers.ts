import { apiRequest } from '@/lib/query-client';

/**
 * Connected Caregiver system — lets a family member (e.g. "Papa") be shared
 * with other LifeWise accounts, so reminders/alerts reach everyone connected
 * and a "done" status updates for all of them.
 *
 * Backed by the `connected-caregivers` routes (see
 * backend-team/CAREGIVER-SYSTEM-backend-requirements.md and the backend's
 * frontend integration guide). Deliberately namespaced apart from any older
 * free-text "caregiver contact" feature, which is unrelated.
 */

import type { FamilyFeatureKey } from '@/lib/family-features';

export type CaregiverRole = 'owner' | 'caregiver';

/**
 * What a caregiver is allowed to DO with the modules they can see.
 *
 * Deliberately ordered least->most capable; `ACCESS_LEVEL_RANK` below relies
 * on that order so a check can ask "at least this level?" rather than
 * enumerating every case.
 *
 * - `view`      read only. Cannot tick anything off.
 * - `mark_done` read + complete/snooze a reminder. The PRD's default caregiver:
 *               "receive alerts, mark reminders done".
 * - `full`      read + complete + create/edit/delete records.
 */
export type CaregiverAccessLevel = 'view' | 'mark_done' | 'full';

export const ACCESS_LEVEL_RANK: Record<CaregiverAccessLevel, number> = {
  view: 0,
  mark_done: 1,
  full: 2,
};

/**
 * A caregiver's permissions for one member.
 *
 * Two independent dimensions, per the client's request:
 *  1. WHICH modules (`allowedModules`) — scope of data.
 *  2. WHAT they may do in them (`accessLevel`) — scope of action.
 *
 * `allowedModules: null` means "every module the member has enabled", which is
 * how every caregiver connected before this feature existed behaves. That is
 * deliberate: an absent field must not silently revoke access for people who
 * are already relying on it. Restriction is opt-in by the owner.
 */
export interface CaregiverPermissions {
  allowedModules: FamilyFeatureKey[] | null;
  accessLevel: CaregiverAccessLevel;
}

/** Applied when the server sends no permissions — full access, see above. */
export const DEFAULT_CAREGIVER_PERMISSIONS: CaregiverPermissions = {
  allowedModules: null,
  accessLevel: 'full',
};

/** Normalises whatever the server returned into a usable permissions object. */
export function normalizeCaregiverPermissions(input: unknown): CaregiverPermissions {
  if (!input || typeof input !== 'object') return { ...DEFAULT_CAREGIVER_PERMISSIONS };
  const raw = input as Partial<CaregiverPermissions>;
  const level = raw.accessLevel;
  return {
    allowedModules: Array.isArray(raw.allowedModules) ? (raw.allowedModules as FamilyFeatureKey[]) : null,
    accessLevel: level === 'view' || level === 'mark_done' || level === 'full' ? level : 'full',
  };
}

/**
 * Can this caregiver see `module` at all?
 *
 * The OWNER is never restricted — `permissions` is only ever consulted for a
 * connected caregiver, and callers pass `isOwner` so this stays a single
 * decision point rather than an `if (isOwner)` at every call site.
 */
export function canAccessModule(
  module: FamilyFeatureKey,
  permissions: CaregiverPermissions | null | undefined,
  isOwner: boolean,
): boolean {
  if (isOwner) return true;
  if (!permissions || permissions.allowedModules === null) return true;
  return permissions.allowedModules.includes(module);
}

/** Does this caregiver hold at least `required` on the modules they can see? */
export function hasAccessLevel(
  required: CaregiverAccessLevel,
  permissions: CaregiverPermissions | null | undefined,
  isOwner: boolean,
): boolean {
  if (isOwner) return true;
  const level = permissions?.accessLevel ?? 'full';
  return ACCESS_LEVEL_RANK[level] >= ACCESS_LEVEL_RANK[required];
}
export type CaregiverInviteStatus = 'pending' | 'accepted' | 'declined';

export interface Caregiver {
  id: string;
  userId: string;
  name: string;
  email: string;
  avatarUrl?: string | null;
  role: CaregiverRole;
  connectedAt: string;
  /**
   * Absent on the owner, and on caregivers connected before scoped access
   * existed. `normalizeCaregiverPermissions` turns either into full access.
   */
  permissions?: CaregiverPermissions | null;
}

export interface CaregiverInvite {
  id: string;
  memberId: string;
  memberName: string;
  memberAvatarUrl?: string | null;
  invitedByName: string;
  invitedByEmail: string;
  inviteeEmail: string;
  status: CaregiverInviteStatus;
  createdAt: string;
}

/** Everyone connected to a family member (owner + accepted caregivers). */
export async function loadCaregivers(memberId: string, token: string | null): Promise<Caregiver[]> {
  const res = await apiRequest('GET', `/api/family/${memberId}/connected-caregivers`, undefined, token);
  return (await res.json()) as Caregiver[];
}

/** Sends an invite to another LifeWise account by email. Owner-only. */
export async function inviteCaregiver(
  memberId: string,
  email: string,
  token: string | null,
  permissions?: CaregiverPermissions,
): Promise<CaregiverInvite> {
  const res = await apiRequest(
    'POST',
    `/api/family/${memberId}/connected-caregivers/invite`,
    { email: email.trim().toLowerCase(), ...(permissions ? { permissions } : {}) },
    token,
  );
  return (await res.json()) as CaregiverInvite;
}

/**
 * Owner-only: change what an already-connected caregiver may see and do.
 *
 * Separate from the invite call because permissions are far more likely to be
 * edited later than set correctly up front — the owner usually only discovers
 * they over-shared once the caregiver is already in.
 */
export async function updateCaregiverPermissions(
  memberId: string,
  caregiverUserId: string,
  permissions: CaregiverPermissions,
  token: string | null,
): Promise<void> {
  await apiRequest(
    'PATCH',
    `/api/family/${memberId}/connected-caregivers/${caregiverUserId}/permissions`,
    permissions,
    token,
  );
}

/** Owner removes any caregiver; a caregiver may only remove themself. */
export async function removeCaregiver(memberId: string, caregiverUserId: string, token: string | null): Promise<void> {
  await apiRequest('DELETE', `/api/family/${memberId}/connected-caregivers/${caregiverUserId}`, undefined, token);
}

/**
 * OUTGOING invites for one member — people the owner has invited who have not
 * accepted yet. This is what backs the "Pending" rows in the caregiver list.
 *
 * Distinct from `loadMyInvites`, which is the INCOMING direction (invites
 * addressed to me). The two are easy to confuse and answer opposite questions:
 * this one is "who have I invited?", that one is "who has invited me?".
 *
 * FAILS SOFT ON 404 BY DESIGN. As of 2026-08-19 this endpoint is not
 * implemented — probed against the deployed API, it returns 404 while
 * `connected-caregivers` returns 401 (i.e. exists but needs auth). Until the
 * backend ships it, this resolves to `[]` and the screen renders exactly as it
 * does today rather than showing an error for a feature that is merely absent.
 * The moment the route goes live, pending rows appear with no client change.
 *
 * Only a 404 is swallowed. Real failures (500, network) still throw, so a
 * broken endpoint is not silently indistinguishable from an empty list.
 */
export async function loadPendingCaregiverInvites(
  memberId: string,
  token: string | null,
): Promise<CaregiverInvite[]> {
  try {
    const res = await apiRequest(
      'GET',
      `/api/family/${memberId}/connected-caregivers/invites`,
      undefined,
      token,
    );
    const rows = (await res.json()) as CaregiverInvite[];
    // Defensive: the list must only ever contain pending rows. If the server
    // ever widens this to all statuses, accepted caregivers would otherwise
    // appear twice — once here and once from `loadCaregivers`.
    return Array.isArray(rows) ? rows.filter((r) => r.status === 'pending') : [];
  } catch (e) {
    if (String((e as Error)?.message ?? '').startsWith('404')) return [];
    throw e;
  }
}

/** Pending invites addressed to the current logged-in user, across all family members. */
export async function loadMyInvites(token: string | null): Promise<CaregiverInvite[]> {
  const res = await apiRequest('GET', '/api/caregiver-invites', undefined, token);
  return (await res.json()) as CaregiverInvite[];
}

export async function acceptInvite(inviteId: string, token: string | null): Promise<void> {
  await apiRequest('POST', `/api/caregiver-invites/${inviteId}/accept`, undefined, token);
}

export async function declineInvite(inviteId: string, token: string | null): Promise<void> {
  await apiRequest('POST', `/api/caregiver-invites/${inviteId}/decline`, undefined, token);
}

/**
 * Family members shared with the current user by someone else (i.e. members
 * where the current user is a caregiver, not the owner). Merged into the
 * Family Hub list alongside the user's own `GET /api/family` members.
 */
export async function loadSharedMembers(token: string | null): Promise<any[]> {
  const res = await apiRequest('GET', '/api/family/shared-with-me', undefined, token);
  return (await res.json()) as any[];
}
