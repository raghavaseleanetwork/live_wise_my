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

export type CaregiverRole = 'owner' | 'caregiver';
export type CaregiverInviteStatus = 'pending' | 'accepted' | 'declined';

export interface Caregiver {
  id: string;
  userId: string;
  name: string;
  email: string;
  avatarUrl?: string | null;
  role: CaregiverRole;
  connectedAt: string;
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
export async function inviteCaregiver(memberId: string, email: string, token: string | null): Promise<CaregiverInvite> {
  const res = await apiRequest('POST', `/api/family/${memberId}/connected-caregivers/invite`, { email: email.trim().toLowerCase() }, token);
  return (await res.json()) as CaregiverInvite;
}

/** Owner removes any caregiver; a caregiver may only remove themself. */
export async function removeCaregiver(memberId: string, caregiverUserId: string, token: string | null): Promise<void> {
  await apiRequest('DELETE', `/api/family/${memberId}/connected-caregivers/${caregiverUserId}`, undefined, token);
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
