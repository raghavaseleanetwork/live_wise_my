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
