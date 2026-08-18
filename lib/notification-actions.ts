import AsyncStorage from '@react-native-async-storage/async-storage';

import { getApiUrl } from '@/lib/query-client';
import {
  SNOOZE_ACTION_ID,
  DONE_ACTION_ID,
  SNOOZE_MINUTES,
  scheduleLocalNotification,
} from '@/lib/notifications';
import {
  markCheckinDone,
  markRoutineDoneToday,
  markFitnessDone,
  toggleAppointmentDone,
  toggleFamilyBillPaid,
  toggleFamilyTask,
  toggleTravelItem,
} from '@/lib/family-records';
import { emitNotificationActionHandled } from '@/lib/caregiver-sync';

/**
 * Handles the Snooze / Done buttons on a notification.
 *
 * ## Why this is a standalone module, not part of a React component
 *
 * These actions fire with `opensAppToForeground: false`, so the handler runs
 * with **no mounted React tree**: no `useAuth()`, no `useExpenses()`, no
 * context of any kind. Everything it needs — the auth token, the API base URL —
 * is read directly from storage.
 *
 * That is also why it writes through the same underlying endpoints/record
 * functions the UI uses rather than calling context setters: the next time a
 * screen mounts or refocuses it re-reads from those sources and picks the
 * change up for free.
 *
 * ## Failure policy
 *
 * Every path is best-effort and silent. There is no UI to show an error in —
 * the app may not even be running. A failed Done leaves the reminder active,
 * which is the safe direction: the user sees it again rather than believing
 * something was recorded that wasn't.
 */

/** Mirrors `STORAGE_KEYS.TOKEN` in `lib/auth-context.tsx`. */
const TOKEN_KEY = '@lifewise_token';

async function getToken(): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

/** Fires a `/api/bills/:id/actions` call without needing the expense context. */
async function postBillAction(
  billId: string,
  body: Record<string, unknown>,
): Promise<boolean> {
  const token = await getToken();
  if (!token) return false;
  try {
    const res = await fetch(`${getApiUrl()}/api/bills/${billId}/actions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Marks a Family Hub record done, dispatching on the `sourceKind` the push
 * carries.
 *
 * Recurring kinds (routine, check-in, fitness) record a completion for *today*
 * rather than flipping a permanent done flag — "completed" is not a state they
 * have, and marking one permanently done would stop it recurring.
 */
async function markFamilyRecordDone(
  memberId: string,
  sourceKind: string,
  sourceId: string,
): Promise<boolean> {
  try {
    switch (sourceKind) {
      case 'checkin':
        await markCheckinDone(memberId, sourceId);
        return true;
      case 'routine':
        await markRoutineDoneToday(memberId, sourceId);
        return true;
      case 'fitness':
        await markFitnessDone(memberId, sourceId);
        return true;
      case 'appointment':
        await toggleAppointmentDone(memberId, sourceId);
        return true;
      case 'family-bill':
        await toggleFamilyBillPaid(memberId, sourceId);
        return true;
      case 'task':
        await toggleFamilyTask(memberId, sourceId);
        return true;
      case 'travel':
        await toggleTravelItem(memberId, sourceId);
        return true;
      default:
        // medicine-stock and subscription have no "done" concept — a stock
        // level isn't completed, and a subscription renews whether or not the
        // user acknowledges it. Snooze still works on both.
        return false;
    }
  } catch {
    return false;
  }
}

/**
 * Re-arms a notification `SNOOZE_MINUTES` from now.
 *
 * The re-armed copy carries the original payload, so its own buttons work and
 * tapping it still routes to the right screen. `withActions` is left on.
 */
async function rescheduleSnoozed(
  title: string,
  body: string,
  data: Record<string, any>,
): Promise<void> {
  await scheduleLocalNotification({
    title,
    body,
    data: { ...data, snoozed: true },
    triggerAt: new Date(Date.now() + SNOOZE_MINUTES * 60 * 1000),
  });
}

/**
 * Entry point, wired to `addNotificationResponseReceivedListener` in
 * `app/_layout.tsx`.
 *
 * Returns true when it consumed the response, so the caller knows to skip its
 * normal tap-to-navigate routing — a button press must never also open a screen.
 */
export async function handleNotificationAction(response: {
  actionIdentifier: string;
  notification: {
    request: {
      content: {
        title?: string | null;
        body?: string | null;
        data?: any;
      };
    };
  };
}): Promise<boolean> {
  const action = response.actionIdentifier;
  if (action !== SNOOZE_ACTION_ID && action !== DONE_ACTION_ID) return false;

  const content = response.notification.request.content;
  const data = (content.data ?? {}) as Record<string, any>;

  if (action === SNOOZE_ACTION_ID) {
    // Persist the snooze server-side for the user's own bills so it survives a
    // reinstall and holds across devices. Family Hub reminders are projected
    // from records, not stored as bills, so for those the local re-arm below
    // IS the snooze.
    if (data.type === 'reminder' && data.billId) {
      await postBillAction(String(data.billId), {
        action: 'snooze',
        days: 0,
        minutes: SNOOZE_MINUTES,
      });
    }

    await rescheduleSnoozed(
      content.title || 'Reminder',
      content.body || '',
      data,
    );
    emitNotificationActionHandled();
    return true;
  }

  // DONE
  if (data.type === 'reminder' && data.billId) {
    await postBillAction(String(data.billId), { action: 'paid' });
    emitNotificationActionHandled();
    return true;
  }

  if (data.memberId && data.sourceKind && data.sourceId) {
    await markFamilyRecordDone(
      String(data.memberId),
      String(data.sourceKind),
      String(data.sourceId),
    );
    emitNotificationActionHandled();
    return true;
  }

  // Nothing actionable in the payload — still consumed, so a stray Done press
  // doesn't fall through and navigate somewhere unexpected.
  return true;
}
