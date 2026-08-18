import AsyncStorage from '@react-native-async-storage/async-storage';

import { apiRequest } from '@/lib/query-client';
import type { FamilyReminder } from '@/lib/family-reminders';

/**
 * Server-side family reminder projection.
 *
 * The backend implements the same projection this app computes locally in
 * `lib/family-reminders.ts` — same 8 kinds, same skip rules, same title format,
 * built to match field-for-field rather than reinvented. See
 * `backend-team/app docs/FAMILY_REMINDERS_BACKEND_SPEC.md` and the backend's
 * integration guide.
 *
 * The server is preferred when reachable because it is the only side that can
 * see records created on the user's *other* devices, and because its scheduler
 * is what sends push while the app is closed. The local projection stays as an
 * offline fallback.
 */

/**
 * Marks that the server has taken over scheduling.
 *
 * This is the double-fire guard. The backend scheduler is already live, so any
 * reminder the server knows about will be pushed by the server; if the client
 * also holds a local `expo-notifications` schedule for it, the user is notified
 * twice for one appointment. Once a successful server response is seen, local
 * scheduling is permanently off for this install.
 *
 * Deliberately sticky rather than recomputed per call: a user who goes offline
 * after the cutover must NOT have local scheduling silently switch back on,
 * because the server-side schedule for those same reminders still exists and
 * will still fire.
 */
const SERVER_SCHEDULING_KEY = '@lifewise_family_reminders_server_scheduling';

/**
 * Whether the backend actually SENDS PUSH for family reminders yet.
 *
 * This is deliberately separate from "does the endpoint return rows". As of
 * 2026-08-17 the backend returns real rows but its scheduler
 * (`startReminderScheduler`) still reads only the `bills` collection and emits
 * nothing for Family Hub reminders — their own status doc confirms §4 is
 * unstarted.
 *
 * Handing scheduling to a server that isn't scheduling means the local
 * notifications get cancelled and nothing replaces them: the user silently
 * stops getting family reminders altogether. That is worse than the local-only
 * fallback, which at least works on the device that created the record.
 *
 * **Flip this to `true` only when the backend confirms §4 of
 * `backend-team/FAMILY-REMINDERS-HOME-backend-requirements.md` is live** — i.e.
 * push actually fires for a row this endpoint returned. Verify on a device
 * before flipping; there is no way to detect it from the response shape.
 */
const SERVER_PUSH_CONFIRMED = false;

/** The local scheduling ledger, cleared once at cutover. */
const LOCAL_SCHEDULED_KEY = '@lifewise_family_reminder_scheduled';

/**
 * Notification ids for repeating routine/check-in triggers. Mirrors
 * `REPEATING_IDS_KEY` in `lib/family-reminders.ts`; duplicated as a constant
 * rather than imported so the network path keeps no runtime dependency on the
 * offline path (the same reason `SERVER_SCHEDULING_KEY` is duplicated there).
 */
const LOCAL_REPEATING_IDS_KEY = '@lifewise_family_reminder_repeating_ids';

export async function isServerSchedulingActive(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(SERVER_SCHEDULING_KEY)) === 'true';
  } catch {
    // Unknown state: assume the server is NOT active, so the user still gets
    // local reminders. A duplicate notification is a far smaller failure than
    // a medicine reminder that never arrives.
    return false;
  }
}

/**
 * Clears a cutover that should never have happened.
 *
 * Earlier builds latched `SERVER_SCHEDULING_KEY` on ANY successful response —
 * including the `[]` that a server with no family records returns. Installs that
 * hit that path have local scheduling switched off permanently, so family
 * reminders stop notifying entirely and nothing in the UI explains why.
 *
 * Safe to call when the server returned no reminders: if it has none, it has
 * nothing scheduled, so there is no double-fire to protect against. When the
 * backend starts returning real rows, `fetchFamilyReminders` re-latches the flag
 * on the very next fetch.
 */
export async function clearStaleServerScheduling(): Promise<void> {
  try {
    if ((await AsyncStorage.getItem(SERVER_SCHEDULING_KEY)) !== 'true') return;
    await AsyncStorage.multiSet([
      [SERVER_SCHEDULING_KEY, 'false'],
      // Drop the ledger too, so the local scheduler treats every reminder as
      // new and re-arms notifications the cutover had cancelled.
      [LOCAL_SCHEDULED_KEY, JSON.stringify({})],
      // The repeating ids were cancelled at cutover, so these are stale. Clear
      // them alongside, or the next sync would try to cancel ids the OS may
      // have reassigned.
      [LOCAL_REPEATING_IDS_KEY, JSON.stringify({})],
    ]);
  } catch {
    // Leaves the flag as-is; retried on the next fetch.
  }
}

/**
 * Records that the server is handling scheduling, and cancels the local
 * schedules that would otherwise double-fire.
 *
 * Idempotent — only does the cancellation work the first time.
 */
async function markServerSchedulingActive(): Promise<void> {
  try {
    if ((await AsyncStorage.getItem(SERVER_SCHEDULING_KEY)) === 'true') return;

    await cancelLocalFamilyNotifications();
    await AsyncStorage.multiSet([
      [SERVER_SCHEDULING_KEY, 'true'],
      // Per the backend guide's §4 step 3: clear the ledger at cutover, so a
      // later rollback re-schedules from a clean slate rather than believing
      // stale entries are still live.
      [LOCAL_SCHEDULED_KEY, JSON.stringify({})],
      // Repeating routine/check-in triggers are cancelled by the call above;
      // drop their id ledger too so it cannot later cancel ids the OS has
      // since reissued to unrelated notifications.
      [LOCAL_REPEATING_IDS_KEY, JSON.stringify({})],
    ]);
  } catch {
    // Falls through to the local path, which is safe: worst case the cutover
    // is retried on the next fetch.
  }
}

/**
 * Cancels every already-scheduled local family notification.
 *
 * Clearing the ledger alone is not enough — the OS holds the schedules, not
 * AsyncStorage. Without this, notifications queued before the cutover keep
 * firing alongside the server's for as long as their trigger dates last.
 *
 * Only family reminders are cancelled; the app's other local notifications are
 * identified by the absence of `data.type === 'family-reminder'` and left
 * alone.
 */
export async function cancelLocalFamilyNotifications(): Promise<void> {
  try {
    const Notifications = await import('expo-notifications');
    const scheduled = await Notifications.getAllScheduledNotificationsAsync();
    await Promise.all(
      scheduled
        .filter((n) => (n.content?.data as any)?.type === 'family-reminder')
        .map((n) => Notifications.cancelScheduledNotificationAsync(n.identifier)),
    );
  } catch {
    // expo-notifications is unavailable in Expo Go / on web. Nothing was
    // scheduled there either, so there is nothing to cancel.
  }
}

/**
 * Fetches the server projection.
 *
 * Returns null — not an empty array — whenever the server has nothing usable to
 * say, so the caller falls back to the local projection instead of rendering an
 * empty list.
 *
 * **An empty array counts as "nothing usable".** Family records currently live
 * only in on-device AsyncStorage (see `lib/family-records.ts`) — the server has
 * no way to know about an appointment added on this phone, so it answers `[]`.
 * Trusting that response blanked the Reminders list and, worse, latched the
 * permanent `markServerSchedulingActive()` flag below, which silently disables
 * local notification scheduling for the rest of the install. Both together are
 * the "I added an appointment and it never showed up" bug.
 *
 * Once the backend actually persists family records and returns real rows, this
 * function starts preferring the server with no further change — an empty list
 * from a server that genuinely owns the data is indistinguishable from one that
 * does not, and falling back costs only a redundant local rebuild.
 */
export async function fetchFamilyReminders(
  token: string | null,
): Promise<FamilyReminder[] | null> {
  if (!token) return null;
  try {
    const res = await apiRequest('GET', '/api/reminders/family', undefined, token);
    // A 404 means the endpoint does not exist on this backend at all, so the
    // server cannot be scheduling anything — undo any cutover a previous build
    // latched, or local notifications stay dead for the life of the install.
    if (!res.ok) {
      if (res.status === 404) await clearStaleServerScheduling();
      return null;
    }
    const data = await res.json();
    if (!Array.isArray(data)) return null;

    // Fall through to the local projection rather than showing an empty list.
    // Crucially this also skips the cutover below: scheduling must NOT be
    // handed to a server that is not returning any reminders to schedule, and
    // any cutover a previous build latched here is undone.
    if (data.length === 0) {
      await clearStaleServerScheduling();
      return null;
    }

    // A server returning real rows owns their scheduling too — but ONLY once
    // the server actually sends push for them.
    //
    // 2026-08-17: the backend confirmed `GET /api/reminders/family` now returns
    // real rows (with `memberAvatarUrl` and `recurrence`), but that
    // `startReminderScheduler` still reads only the `bills` collection and
    // sends NO push for Family Hub reminders. Cutting over on the row response
    // alone would cancel local notifications and leave those users with zero
    // family reminders — strictly worse than the local-only fallback.
    //
    // So the cutover is gated behind SERVER_PUSH_CONFIRMED until the backend
    // ships §4 of FAMILY-REMINDERS-HOME-backend-requirements.md. Rows are still
    // used for display (they include other devices' records, which local
    // projection cannot see); only the scheduling handover waits.
    if (SERVER_PUSH_CONFIRMED) {
      await markServerSchedulingActive();
    } else {
      // Undo a cutover an earlier build may already have latched, so anyone
      // affected gets local notifications back on the next fetch.
      await clearStaleServerScheduling();
    }

    return data as FamilyReminder[];
  } catch {
    return null;
  }
}
