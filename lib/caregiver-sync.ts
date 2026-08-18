/**
 * Tiny pub/sub for the caregiver "sync" push (see notifications.ts +
 * app/_layout.tsx). When any connected caregiver marks a medicine, the
 * backend pushes a silent { type: "sync", memberId, medId } notification to
 * every other caregiver. Any currently-focused screen for that member
 * subscribes here to refetch immediately instead of waiting for the next
 * useFocusEffect.
 */

type SyncListener = (memberId: string) => void;

const listeners = new Set<SyncListener>();

export function onCaregiverSync(listener: SyncListener): { remove: () => void } {
  listeners.add(listener);
  return { remove: () => listeners.delete(listener) };
}

export function emitCaregiverSync(memberId: string) {
  listeners.forEach((l) => l(memberId));
}

/**
 * Same idea, for the Done/Snooze notification action buttons.
 *
 * `handleNotificationAction` (lib/notification-actions.ts) runs with no
 * mounted screen, so it cannot call a context setter or navigate. It emits
 * here once its server call has actually completed, so a currently-open
 * Notifications screen can refetch immediately instead of showing the old
 * (undone) state until the next focus.
 */
type NotificationActionListener = () => void;

const notificationActionListeners = new Set<NotificationActionListener>();

export function onNotificationActionHandled(listener: NotificationActionListener): { remove: () => void } {
  notificationActionListeners.add(listener);
  return { remove: () => notificationActionListeners.delete(listener) };
}

export function emitNotificationActionHandled() {
  notificationActionListeners.forEach((l) => l());
}
