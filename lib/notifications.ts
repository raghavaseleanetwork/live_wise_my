import * as Device from 'expo-device';
import Constants from "expo-constants";
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getApiUrl } from '@/lib/query-client';

function isExpoGo() {
  return Constants.appOwnership === "expo";
}

let handlerConfigured = false;
let channelConfigured = false;
let lastRegisteredToken: string | null = null;
/** The registration request currently in flight, if any. See its use below. */
let inFlightRegistration: Promise<string | undefined> | null = null;

export const ANDROID_CHANNEL_ID = "default";
/**
 * Android channel settings are immutable once created, so a preference change
 * has to create a *new* channel rather than edit the existing one. The id
 * encodes the settings it was built with.
 */
const SILENT_CHANNEL_ID = "reminders_silent";
const NO_VIBRATE_CHANNEL_ID = "reminders_novibrate";
const SILENT_NO_VIBRATE_CHANNEL_ID = "reminders_silent_novibrate";

/** Mirrors `STORAGE_KEYS.REMINDER_SETTINGS` in `lib/expense-context.tsx`. */
const REMINDER_SETTINGS_KEY = '@lifewise_reminder_settings';

/**
 * The user's saved sound/vibration preferences.
 *
 * Read from AsyncStorage rather than taken as an argument because notifications
 * are scheduled from several screens, and threading the setting through every
 * call site would mean each one could forget it. Defaults to on if unreadable —
 * a missed reminder is worse than an unwanted sound.
 */
async function getAlertPrefs(): Promise<{ sound: boolean; vibration: boolean }> {
  try {
    const raw = await AsyncStorage.getItem(REMINDER_SETTINGS_KEY);
    if (!raw) return { sound: true, vibration: true };
    const parsed = JSON.parse(raw);
    return {
      sound: parsed?.soundEnabled !== false,
      vibration: parsed?.vibrationEnabled !== false,
    };
  } catch {
    return { sound: true, vibration: true };
  }
}

/** Which Android channel matches the current preferences. */
function channelIdFor(prefs: { sound: boolean; vibration: boolean }): string {
  if (prefs.sound && prefs.vibration) return ANDROID_CHANNEL_ID;
  if (!prefs.sound && !prefs.vibration) return SILENT_NO_VIBRATE_CHANNEL_ID;
  return prefs.sound ? NO_VIBRATE_CHANNEL_ID : SILENT_CHANNEL_ID;
}

async function getNotificationsModule() {
  // Expo Go (especially Arndroid, SDK 53+) no longer supports expo-notifications
  // for remote push tokens and now throws a hard runtime error when the module
  // is imported. To keep the app running in Expo Go, never import the module
  // at all in that environment and simply no-op all notification features.
  if (isExpoGo()) {
    console.log("[Push] Notifications module disabled in Expo Go (using no-op implementation).");
    return null;
  }

  try {
    const mod = await import("expo-notifications");
    if (!handlerConfigured) {
      mod.setNotificationHandler({
        // Read per-notification so a change in Reminder Settings takes effect
        // immediately — the handler is installed once and would otherwise keep
        // whatever the preference was at app start.
        handleNotification: async () => {
          const prefs = await getAlertPrefs();
          return {
            shouldShowAlert: true,
            shouldPlaySound: prefs.sound,
            shouldSetBadge: false,
            shouldShowBanner: true,
            shouldShowList: true,
          };
        },
      });
      handlerConfigured = true;
    }

    // Android 8+ drops any notification that has no channel. Without this,
    // scheduled locals are silently discarded or arrive with no sound/banner.
    //
    // All four combinations are registered up front because a channel's sound
    // and vibration cannot be changed after creation — switching channel is the
    // only way to honour a preference change.
    if (Platform.OS === "android" && !channelConfigured) {
      const vibrationPattern = [0, 250, 250, 250];
      await Promise.all([
        mod.setNotificationChannelAsync(ANDROID_CHANNEL_ID, {
          name: "Reminders",
          importance: mod.AndroidImportance.HIGH,
          vibrationPattern,
          lightColor: "#4F46E5",
        }),
        mod.setNotificationChannelAsync(NO_VIBRATE_CHANNEL_ID, {
          name: "Reminders (no vibration)",
          importance: mod.AndroidImportance.HIGH,
          vibrationPattern: null,
          enableVibrate: false,
          lightColor: "#4F46E5",
        }),
        mod.setNotificationChannelAsync(SILENT_CHANNEL_ID, {
          name: "Reminders (silent)",
          importance: mod.AndroidImportance.HIGH,
          sound: null,
          vibrationPattern,
          lightColor: "#4F46E5",
        }),
        mod.setNotificationChannelAsync(SILENT_NO_VIBRATE_CHANNEL_ID, {
          name: "Reminders (silent, no vibration)",
          importance: mod.AndroidImportance.HIGH,
          sound: null,
          vibrationPattern: null,
          enableVibrate: false,
          lightColor: "#4F46E5",
        }),
      ]);
      channelConfigured = true;
    }

    return mod;
  } catch {
    return null;
  }
}

export async function registerForPushNotifications(token: string | null) {
  const Notifications = await getNotificationsModule();
  if (!Notifications) {
    console.log("[Push] Notifications not available in this client (Expo Go or unsupported runtime).");
    return;
  }

  if (!Device.isDevice) {
    console.log('[Push] Not running on a physical device, skipping push registration.');
    return;
  }

  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  let finalStatus = existingStatus;

  if (existingStatus !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }

  if (finalStatus !== 'granted') {
    console.log('[Push] Notification permissions not granted');
    return;
  }

  // In Expo Go, remote push token fetching is not supported on Android (SDK 53+).
  if (isExpoGo()) {
    console.log("[Push] Skipping remote push token registration in Expo Go.");
    return;
  }

  // NATIVE FCM TOKEN, NOT AN EXPO ONE. This must stay `getDevicePushTokenAsync`.
  //
  // `getExpoPushTokenAsync()` returns `ExponentPushToken[...]`, which is a
  // handle for *Expo's* push service. Our server sends through raw
  // firebase-admin (`messaging.sendEachForMulticast`), and FCM rejects an Expo
  // token as `messaging/invalid-registration-token` — so every push silently
  // failed. Nothing surfaced it because `sendEachForMulticast` resolves even
  // when all sends fail; the failures live in `response.responses[]`.
  //
  // Switching to Expo's push API server-side would work equally well, but only
  // one of the two can be true at a time. The server already speaks FCM, so the
  // client is what changes. If the backend ever moves to expo-server-sdk, this
  // line has to move back in the same commit.
  let devicePushToken: unknown;
  try {
    devicePushToken = (await Notifications.getDevicePushTokenAsync()).data;
  } catch (e) {
    // Throws when the app has no usable FCM setup (missing/incorrect
    // google-services.json, or Play Services unavailable). Previously this
    // rejected the whole function silently via the caller's `.catch`, so a
    // broken FCM config was indistinguishable from push simply not running.
    console.log('[Push] Could not obtain a device push token from FCM:', e);
    return;
  }

  // `.data` is a string on Android/iOS but typed as a union (web push returns
  // an object), so guard rather than send `[object Object]` to the server.
  if (typeof devicePushToken !== 'string' || !devicePushToken) {
    console.log('[Push] No usable device push token on this platform.');
    return;
  }
  // Narrowed above; bound to a `const` so it stays a string inside the async
  // closure below, where TypeScript would otherwise widen `let` back to unknown.
  const pushToken: string = devicePushToken;

  if (!token) {
    return pushToken;
  }

  // If we've already registered this exact token in this session, skip the network request
  if (lastRegisteredToken === pushToken) {
    return pushToken;
  }

  // Collapse concurrent callers onto one request.
  //
  // `lastRegisteredToken` is only assigned AFTER the await below resolves, so
  // it cannot stop calls that start while the first is still in flight — every
  // one of them reads the old value and proceeds. In practice the effect in
  // `_layout.tsx` re-runs on each auth/render change and fired 34 POSTs in
  // ~3 seconds. Tracking the in-flight promise makes the guard hold from the
  // moment the first request starts rather than when it finishes.
  if (inFlightRegistration) {
    return inFlightRegistration;
  }

  inFlightRegistration = (async () => {
  try {
    const baseUrl = getApiUrl();
    const url = new URL('/api/push-token', baseUrl).toString();

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        token: pushToken,
        platform: Platform.OS === 'android' ? 'android' : Platform.OS === 'ios' ? 'ios' : 'web',
        // Lets the backend purge the Expo-format tokens written by earlier
        // builds. Without a discriminator the server cannot tell a stale
        // `ExponentPushToken[...]` row from a live FCM one.
        tokenType: 'fcm',
      }),
    });

    if (response.ok) {
      lastRegisteredToken = pushToken;
      // Logged because the success path was previously silent: a working
      // registration and a registration that never ran looked identical in the
      // console, which is exactly the ambiguity that hid the Expo-token bug.
      // The prefix is enough to confirm the token TYPE without printing a
      // credential in full.
      console.log(
        `[Push] Registered ${Platform.OS} token with server (${pushToken.slice(0, 12)}…, ${pushToken.length} chars).`,
      );
    } else {
      console.log(`[Push] Server rejected token registration: ${response.status}`);
    }
  } catch (e) {
    console.log('[Push] Failed to register push token', e);
  } finally {
    // Released regardless of outcome so a failed attempt does not block every
    // later one for the lifetime of the process.
    inFlightRegistration = null;
  }

    return pushToken;
  })();

  return inFlightRegistration;
}

export async function addNotificationResponseReceivedListener(
  listener: Parameters<(typeof import("expo-notifications"))["addNotificationResponseReceivedListener"]>[0],
) {
  const Notifications = await getNotificationsModule();
  if (!Notifications) {
    return { remove: () => {} };
  }
  return Notifications.addNotificationResponseReceivedListener(listener);
}

/**
 * Fires for a push received while the app is foregrounded/backgrounded, even
 * for silent data-only pushes (e.g. the caregiver `sync` event) that the user
 * never taps — unlike addNotificationResponseReceivedListener, which only
 * fires on tap.
 */
export async function addNotificationReceivedListener(
  listener: Parameters<(typeof import("expo-notifications"))["addNotificationReceivedListener"]>[0],
) {
  const Notifications = await getNotificationsModule();
  if (!Notifications) {
    return { remove: () => {} };
  }
  return Notifications.addNotificationReceivedListener(listener);
}

export async function addPushTokenListener(
  listener: (token: string) => void,
) {
  const Notifications = await getNotificationsModule();
  if (!Notifications) {
    return { remove: () => {} };
  }
  // Fires when FCM rotates the device token. The emitted value is only a
  // signal — callers re-run `registerForPushNotifications`, which re-reads the
  // token through the same `getDevicePushTokenAsync` path rather than trusting
  // whatever shape this event carries.
  return Notifications.addPushTokenListener((token) => {
    if (typeof token.data === 'string') listener(token.data);
  });
}

export async function scheduleLocalNotification(opts: {
  title: string;
  body: string;
  data?: Record<string, any>;
  triggerAt: Date;
}) {
  const Notifications = await getNotificationsModule();
  if (!Notifications) return;

  // A trigger in the past never fires. Deliver immediately instead of
  // scheduling a notification that would be silently dropped.
  const msUntil = opts.triggerAt.getTime() - Date.now();

  // Honours the Reminder Settings toggles. On Android sound and vibration are
  // properties of the channel; on iOS `sound` on the content is what matters.
  const prefs = await getAlertPrefs();

  await Notifications.scheduleNotificationAsync({
    content: {
      title: opts.title,
      body: opts.body,
      data: opts.data || {},
      sound: prefs.sound ? 'default' : false,
    },
    // Must be a trigger object, not a bare Date — a raw Date is not a valid
    // trigger in expo-notifications v0.32 and the notification never fires.
    trigger:
      msUntil <= 0
        ? null
        : {
            type: Notifications.SchedulableTriggerInputTypes.DATE,
            date: opts.triggerAt,
            channelId: channelIdFor(prefs),
          },
  });
}

/**
 * Schedules a notification that repeats at a wall-clock time, forever.
 *
 * `scheduleLocalNotification` schedules a one-shot DATE trigger, which is wrong
 * for anything recurring: a "daily" 12:30 routine armed with a DATE trigger
 * fires once, at the next 12:30, and is then gone. Nothing re-arms it, so the
 * user gets exactly one notification for a reminder they asked to repeat every
 * day. That was the reported "my wake-up reminder doesn't notify me" bug.
 *
 * `weekdays` is 0=Sun..6=Sat, matching `CheckinItem.days` / `RoutineItem.days`.
 * Empty or omitted means every day, which is the meaning those fields already
 * carry in storage.
 *
 * Returns the OS identifiers created. A weekly repeat cannot express "these N
 * days" in one trigger, so one WEEKLY trigger is registered per selected day —
 * hence an array rather than a single id.
 *
 * expo-notifications takes weekday as 1=Sun..7=Sat, one off from our storage
 * convention; the `+ 1` below is that conversion and not an off-by-one.
 */
export async function scheduleRepeatingLocalNotification(opts: {
  title: string;
  body: string;
  data?: Record<string, any>;
  hour: number;
  minute: number;
  weekdays?: number[];
}): Promise<string[]> {
  const Notifications = await getNotificationsModule();
  if (!Notifications) return [];

  const prefs = await getAlertPrefs();
  const content = {
    title: opts.title,
    body: opts.body,
    data: opts.data || {},
    sound: prefs.sound ? 'default' : false,
  } as const;
  const channelId = channelIdFor(prefs);

  const days = (opts.weekdays ?? []).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6);

  // No specific days selected → a single DAILY trigger. Using seven WEEKLY
  // triggers here would work but burns seven of the OS's limited scheduled-
  // notification slots per reminder for no benefit.
  if (days.length === 0) {
    const id = await Notifications.scheduleNotificationAsync({
      content,
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DAILY,
        hour: opts.hour,
        minute: opts.minute,
        channelId,
      },
    });
    return [id];
  }

  const ids: string[] = [];
  for (const day of days) {
    const id = await Notifications.scheduleNotificationAsync({
      content,
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.WEEKLY,
        weekday: day + 1,
        hour: opts.hour,
        minute: opts.minute,
        channelId,
      },
    });
    ids.push(id);
  }
  return ids;
}

/** Cancels scheduled notifications by id, ignoring ones already gone. */
export async function cancelScheduledNotifications(ids: string[]): Promise<void> {
  if (!ids.length) return;
  const Notifications = await getNotificationsModule();
  if (!Notifications) return;
  await Promise.all(
    ids.map((id) =>
      Notifications.cancelScheduledNotificationAsync(id).catch(() => {
        // Already fired, already cancelled, or unknown to the OS. Cancelling is
        // best-effort cleanup; a failure here must not break rescheduling.
      }),
    ),
  );
}

