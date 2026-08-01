/**
 * Read SMS from device (Android). Uses native module when available.
 * On web/iOS or when permission denied, returns [] so sync flow still runs.
 * For Android inbox: add react-native-get-sms-android and use dev build.
 */

import { Platform, PermissionsAndroid } from 'react-native';

export interface RawSms {
  body: string;
  date?: number | string;
  address?: string;
  _id?: string;
}

export interface SmsReadResult {
  messages: RawSms[];
  error: string | null;
  moduleAvailable: boolean;
}

export type SmsPermissionStatus =
  | 'granted'
  | 'denied'
  | 'never_ask_again'
  | 'unavailable'
  | 'error';

export interface SmsPermissionResult {
  status: SmsPermissionStatus;
  message: string;
}

/** Request SMS permission (Android). Returns true if granted. */
export async function requestSmsPermission(): Promise<boolean> {
  const result = await requestSmsPermissionDetails();
  return result.status === 'granted';
}

/**
 * Whether SMS permission is already granted, without ever prompting.
 *
 * This is what makes an automatic sync on app open acceptable: the background
 * sync runs only for users who have already said yes, so opening the app never
 * triggers a permission dialog or an "iOS can't do this" alert on its own.
 * Asking is still done explicitly, from the Auto Track entry point.
 */
export async function hasSmsPermission(): Promise<boolean> {
  if (Platform.OS !== 'android') return false;
  try {
    return await PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.READ_SMS);
  } catch {
    return false;
  }
}

/** Request SMS permission (Android) with detailed status for UX handling. */
export async function requestSmsPermissionDetails(): Promise<SmsPermissionResult> {
  if (Platform.OS !== 'android') {
    return { status: 'unavailable', message: 'SMS sync only works on Android devices.' };
  }
  try {
    const alreadyGranted = await PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.READ_SMS);
    if (alreadyGranted) {
      return { status: 'granted', message: 'SMS permission already granted.' };
    }

    const granted = await PermissionsAndroid.request(
      PermissionsAndroid.PERMISSIONS.READ_SMS,
      {
        title: 'Allow LifeWise to read SMS for auto tracking',
        message: 'We use SMS messages from your bank to auto-detect transactions. No messages are stored on our servers beyond transaction info.',
        buttonPositive: 'Allow',
        buttonNegative: 'Deny',
      },
    );
    if (granted === PermissionsAndroid.RESULTS.GRANTED) {
      return { status: 'granted', message: 'SMS permission granted.' };
    }
    if (granted === PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN) {
      return {
        status: 'never_ask_again',
        message: 'SMS permission is permanently denied. Please enable it from app settings.',
      };
    }
    return { status: 'denied', message: 'SMS permission denied.' };
  } catch {
    return { status: 'error', message: 'SMS permission request failed.' };
  }
}


export interface SmsReadOptions {
  /**
   * Upper bound on messages returned. Acts as a safety cap so a huge inbox
   * cannot blow up memory. With `minDate` set this should be generous, since
   * the date window — not the count — is what bounds a normal sync.
   */
  maxCount?: number;
  /**
   * Only return messages with `date >= minDate` (epoch ms). This is the key to
   * incremental syncing: pass the last-sync watermark and the native layer
   * returns everything since then, instead of a fixed slice of the newest N.
   */
  minDate?: number;
}

// A generous default: without a minDate we still cap, but high enough that a
// bank SMS is very unlikely to be pushed out of range by unrelated inbox noise.
const DEFAULT_MAX_COUNT = 2000;

/** Read recent SMS from inbox. Returns [] on web, iOS, or when module/permission unavailable. */
export async function readSmsFromDevice(
  options: SmsReadOptions | number = {},
): Promise<RawSms[]> {
  const result = await readSmsFromDeviceWithMeta(options);
  return result.messages;
}

/** Read recent SMS from inbox with diagnostics for UI feedback/debugging. */
export async function readSmsFromDeviceWithMeta(
  options: SmsReadOptions | number = {},
): Promise<SmsReadResult> {
  // Back-compat: a bare number is treated as maxCount (old call signature).
  const opts: SmsReadOptions = typeof options === 'number' ? { maxCount: options } : options;
  const maxCount = opts.maxCount ?? DEFAULT_MAX_COUNT;
  const minDate = opts.minDate;

  if (Platform.OS !== 'android') {
    return {
      messages: [],
      error: 'SMS sync only works on Android devices.',
      moduleAvailable: false,
    };
  }

  let SmsAndroid: any;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- optional native module
    SmsAndroid = require('react-native-get-sms-android');
  } catch {
    return {
      messages: [],
      error: 'SMS reader native module not loaded. Install Android dev build/APK (Expo Go cannot read SMS).',
      moduleAvailable: false,
    };
  }

  try {
    // `minDate` (epoch ms) restricts the native query to messages since the last
    // sync watermark, so incremental syncs read the full window rather than a
    // fixed newest-N slice that could bury older bank SMS behind inbox noise.
    const filter: Record<string, unknown> = { box: 'inbox', maxCount };
    if (minDate != null && minDate > 0) filter.minDate = minDate;
    const list = await new Promise<RawSms[]>((resolve, reject) => {
      SmsAndroid.list(
        JSON.stringify(filter),
        (fail: string) => reject(new Error(fail)),
        (_count: number, smsList: string) => {
          try {
            const arr = JSON.parse(smsList || '[]');
            resolve(
              Array.isArray(arr)
                ? arr.map((s: { _id?: string | number; body?: string; date?: number; address?: string }) => ({
                    _id: s._id != null ? String(s._id) : undefined,
                    body: String(s.body ?? ''),
                    date: s.date,
                    address: s.address,
                  }))
                : []
            );
          } catch {
            resolve([]);
          }
        }
      );
    });
    return {
      messages: list.filter((s) => (s.body || '').trim().length > 0),
      error: null,
      moduleAvailable: true,
    };
  } catch (e: any) {
    return {
      messages: [],
      error: e?.message ? String(e.message) : 'Failed to read SMS inbox.',
      moduleAvailable: true,
    };
  }
}
