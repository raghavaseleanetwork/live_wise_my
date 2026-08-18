import { useCallback, useEffect, useState } from 'react';
import { useFocusEffect } from 'expo-router';

import { useAuth } from '@/lib/auth-context';
import {
  CaregiverPermissions,
  DEFAULT_CAREGIVER_PERMISSIONS,
  canAccessModule,
  hasAccessLevel,
  loadCaregivers,
  normalizeCaregiverPermissions,
  type CaregiverAccessLevel,
} from '@/lib/family-caregivers';
import type { FamilyFeatureKey } from '@/lib/family-features';

/**
 * The current user's permissions on one family member.
 *
 * Answers the two questions every Family Hub screen needs before rendering:
 * "can I see this module?" and "am I allowed to do this?".
 *
 * ## Fail-open, deliberately
 *
 * If the caregiver list cannot be fetched, this returns OWNER-equivalent
 * access rather than locking the screen. Two reasons:
 *
 *  1. The owner is by far the common case, and a network blip must not make
 *     someone unable to use their own data.
 *  2. This is a UX affordance, not a security boundary. **The server is what
 *     actually enforces these rules** — see
 *     `backend-team/CAREGIVER-PERMISSIONS-backend-requirements.md`. Hiding a
 *     button the API would reject anyway is a courtesy; hiding data from its
 *     owner because a request timed out is a bug.
 */
export function useCaregiverPermissions(memberId: string | undefined | null): {
  isOwner: boolean;
  permissions: CaregiverPermissions;
  loading: boolean;
  /** Can the current user see this module at all? */
  canAccess: (module: FamilyFeatureKey) => boolean;
  /** Does the current user hold at least this access level? */
  can: (level: CaregiverAccessLevel) => boolean;
  /** Convenience: may they tick reminders off? The PRD's default caregiver right. */
  canMarkDone: boolean;
  /** Convenience: may they create/edit/delete records? */
  canEdit: boolean;
} {
  const { token, user } = useAuth();
  const [isOwner, setIsOwner] = useState(true);
  const [permissions, setPermissions] = useState<CaregiverPermissions>({
    ...DEFAULT_CAREGIVER_PERMISSIONS,
  });
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!memberId || !token) {
      setLoading(false);
      return;
    }
    try {
      const list = await loadCaregivers(String(memberId), token);
      const me = list.find((c) => String(c.userId) === String(user?.id));

      // No entry for this user, or an empty list, means they are not a
      // connected caregiver — i.e. they own the member. Fail open.
      if (!me) {
        setIsOwner(true);
        setPermissions({ ...DEFAULT_CAREGIVER_PERMISSIONS });
        return;
      }

      setIsOwner(me.role === 'owner');
      setPermissions(normalizeCaregiverPermissions(me.permissions));
    } catch {
      setIsOwner(true);
      setPermissions({ ...DEFAULT_CAREGIVER_PERMISSIONS });
    } finally {
      setLoading(false);
    }
  }, [memberId, token, user?.id]);

  useEffect(() => {
    void load();
  }, [load]);

  // Permissions can be changed by the owner while a caregiver has the screen
  // open, so re-check on focus rather than only on mount.
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const canAccess = useCallback(
    (module: FamilyFeatureKey) => canAccessModule(module, permissions, isOwner),
    [permissions, isOwner],
  );

  const can = useCallback(
    (level: CaregiverAccessLevel) => hasAccessLevel(level, permissions, isOwner),
    [permissions, isOwner],
  );

  return {
    isOwner,
    permissions,
    loading,
    canAccess,
    can,
    canMarkDone: hasAccessLevel('mark_done', permissions, isOwner),
    canEdit: hasAccessLevel('full', permissions, isOwner),
  };
}
