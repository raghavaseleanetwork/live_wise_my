import * as Device from 'expo-device';
import Constants from "expo-constants";
import { Platform } from 'react-native';
import { getApiUrl } from '@/lib/query-client';

function isExpoGo() {
  return Constants.appOwnership === "expo";
}

let handlerConfigured = false;
let lastRegisteredToken: string | null = null;

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
        handleNotification: async () => ({
          shouldShowAlert: true,
          shouldPlaySound: true,
          shouldSetBadge: false,
          shouldShowBanner: true,
          shouldShowList: true,
        }),
      });
      handlerConfigured = true;
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

  const expoToken = (await Notifications.getExpoPushTokenAsync()).data;
  // console.log("FCM Token:", expoToken);

  if (!token) {
    return expoToken;
  }

  // If we've already registered this exact token in this session, skip the network request
  if (lastRegisteredToken === expoToken) {
    return expoToken;
  }

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
        token: expoToken,
        platform: Platform.OS === 'android' ? 'android' : Platform.OS === 'ios' ? 'ios' : 'web',
      }),
    });

    if (response.ok) {
      lastRegisteredToken = expoToken;
    }
  } catch (e) {
    console.log('[Push] Failed to register push token', e);
  }

  return expoToken;
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
  return Notifications.addPushTokenListener((token) => listener(token.data));
}

export async function scheduleLocalNotification(opts: {
  title: string;
  body: string;
  data?: Record<string, any>;
  triggerAt: Date;
}) {
  const Notifications = await getNotificationsModule();
  if (!Notifications) return;

  await Notifications.scheduleNotificationAsync({
    content: {
      title: opts.title,
      body: opts.body,
      data: opts.data || {},
    },
    trigger: opts.triggerAt,
  } as any);
}

