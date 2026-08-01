import { useCallback, useEffect, useState } from 'react';
import { useFocusEffect } from 'expo-router';

import { useAuth } from '@/lib/auth-context';
import { apiRequest } from '@/lib/query-client';
import { loadSharedMembers } from '@/lib/family-caregivers';
import { syncFamilyReminders, type FamilyReminder } from '@/lib/family-reminders';
import { fetchFamilyReminders } from '@/lib/family-reminders-api';

/**
 * Family Hub reminders, ready to merge into the user's own reminder list.
 *
 * Two sources, in priority order:
 *
 * 1. **`GET /api/reminders/family`** — the server's projection. Preferred
 *    because it includes records created on the user's other devices, and
 *    because the backend scheduler delivers these as push while the app is
 *    closed (which local notifications cannot do reliably).
 * 2. **Local projection** — rebuilt from on-device records when the server is
 *    unreachable, so the list still renders offline.
 *
 * Both produce the same `FamilyReminder` shape; the server implementation was
 * built to match the local one field-for-field.
 *
 * Refreshes on focus. Family records are written by the family add screens
 * straight to AsyncStorage with no shared store to subscribe to, so returning
 * to a screen is the moment new records can appear.
 */
export function useFamilyReminders(): {
  familyReminders: FamilyReminder[];
  refreshFamilyReminders: () => Promise<void>;
} {
  const { token } = useAuth();
  const [familyReminders, setFamilyReminders] = useState<FamilyReminder[]>([]);

  const refreshFamilyReminders = useCallback(async () => {
    if (!token) {
      setFamilyReminders([]);
      return;
    }

    // Server first: it is the only side that sees records created on the
    // user's other devices, and its scheduler is what delivers push while the
    // app is closed. Reaching it also switches local scheduling off — see
    // `fetchFamilyReminders`.
    const serverReminders = await fetchFamilyReminders(token);
    if (serverReminders) {
      setFamilyReminders(serverReminders);
      return;
    }

    // Offline fallback: rebuild from on-device records. Note this still
    // schedules locally ONLY if the server has never been reached on this
    // install; after cutover `syncFamilyReminders` no-ops its scheduling half.
    try {
      const [res, shared] = await Promise.all([
        apiRequest('GET', '/api/family', undefined, token),
        loadSharedMembers(token).catch(() => []),
      ]);
      const owned = (await res.json()) as { id: string | number; name: string }[];
      // Members shared by another caregiver count too — a connected caregiver
      // sees the same family records and should get the same reminders.
      const members = [
        ...owned,
        ...shared.filter((s) => !owned.some((o) => String(o.id) === String(s.id))),
      ].map((m) => ({ id: String(m.id), name: m.name }));

      setFamilyReminders(await syncFamilyReminders(members));
    } catch {
      // Family reminders are additive to the user's own list. If the member
      // fetch fails the Bills tab must still render the server bills, so this
      // degrades to "no family rows" rather than surfacing an error.
      setFamilyReminders([]);
    }
  }, [token]);

  useEffect(() => {
    void refreshFamilyReminders();
  }, [refreshFamilyReminders]);

  useFocusEffect(
    useCallback(() => {
      void refreshFamilyReminders();
    }, [refreshFamilyReminders]),
  );

  return { familyReminders, refreshFamilyReminders };
}
