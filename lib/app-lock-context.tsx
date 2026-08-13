/**
 * App Lock — biometric (fingerprint / face) gate in front of the whole app.
 *
 * DESIGN: the OS owns the entire credential flow. We call
 * `LocalAuthentication.authenticateAsync` with `disableDeviceFallback: false`,
 * which shows the platform sheet: fingerprint/face if enrolled, plus a
 * "Use PIN" button falling back to the phone's own lock PIN/pattern/password.
 *
 * That means this app stores NO PIN and implements NO keypad. Enrollment,
 * attempt throttling, lockout, and accessibility are all the OS's job. There is
 * nothing here for an attacker to read, and no "forgot my PIN" flow to own.
 *
 * NATIVE ONLY, AND LAZILY LOADED. `expo-local-authentication` has no meaningful
 * web implementation, and this app ships a web build — so `isSupported` is false
 * on web and the settings row hides itself rather than offering a dead toggle.
 * Same pattern as `lib/revenuecat.ts`.
 *
 * The SDK is `require`d on first use, NOT statically imported. A static import
 * evaluates at module load and throws "Cannot find native module
 * 'ExpoLocalAuthentication'" — crashing the whole app — in any JS bundle running
 * against a binary that predates the package (Expo Go, or a dev build compiled
 * before `expo install`). Loading it behind a try/catch turns that hard crash
 * into the feature simply reporting itself unsupported.
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { AppState, AppStateStatus, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
// Type-only: erased at compile time, so it cannot pull the native module in.
import type * as LocalAuthenticationTypes from 'expo-local-authentication';

const STORAGE_KEY = '@lifewise_app_lock';

/** Native-only: the web build must never try to load the native module. */
const IS_SUPPORTED_PLATFORM = Platform.OS === 'ios' || Platform.OS === 'android';

type LocalAuthModule = typeof LocalAuthenticationTypes;

/** Cached module handle; `null` once we know it is unavailable. */
let cachedModule: LocalAuthModule | null = null;
let hasAttemptedLoad = false;

/**
 * Load the native module, or return null if it isn't in this binary.
 *
 * Requiring inside a try/catch is the whole safety mechanism here — see the
 * module docblock. Do NOT convert this back to a static import.
 */
function loadAuthModule(): LocalAuthModule | null {
  if (!IS_SUPPORTED_PLATFORM) return null;
  if (hasAttemptedLoad) return cachedModule;
  hasAttemptedLoad = true;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    cachedModule = require('expo-local-authentication') as LocalAuthModule;
  } catch {
    // Native module missing (Expo Go, or a build predating the install).
    cachedModule = null;
  }
  return cachedModule;
}

/**
 * How long the app may sit in the background before returning requires a fresh
 * unlock. A grace period is NOT optional: the OS biometric sheet itself
 * backgrounds the app on some Android skins, so a zero-second policy can
 * re-trigger the prompt immediately after a successful unlock — an infinite
 * loop the user cannot escape. 30s also covers the common "switch to the SMS
 * app to copy an OTP" case without re-prompting.
 */
const BACKGROUND_GRACE_MS = 30_000;

/** What hardware this device actually has, so labels can say the true thing. */
export type BiometricKind = 'face' | 'fingerprint' | 'iris' | 'generic';

interface AppLockContextValue {
  /** Device can do this at all (native + hardware + something enrolled). */
  isSupported: boolean;
  /** User has turned the lock on. */
  isEnabled: boolean;
  /** Currently gated — `LockGate` shows the lock screen while true. */
  isLocked: boolean;
  /** Still reading the stored flag; the gate must wait rather than flash. */
  isLoading: boolean;
  /** Best label for the available hardware, e.g. 'face' → "Face Unlock". */
  biometricKind: BiometricKind;
  /**
   * Turn the lock on or off. Enabling REQUIRES a successful authentication
   * first — otherwise someone holding an already-unlocked phone could enable
   * the lock with credentials they don't have and lock the owner out of their
   * own records. Returns false if that check failed or was cancelled.
   */
  setEnabled: (next: boolean) => Promise<boolean>;
  /** Run the OS prompt. On success clears `isLocked`. */
  authenticate: () => Promise<boolean>;
}

const AppLockContext = createContext<AppLockContextValue>({
  isSupported: false,
  isEnabled: false,
  isLocked: false,
  isLoading: true,
  biometricKind: 'generic',
  setEnabled: async () => false,
  authenticate: async () => false,
});

/**
 * Map the OS's enrolled-hardware list onto a label we can show.
 *
 * The numeric values are compared directly rather than via the SDK's
 * `AuthenticationType` enum: reading the enum needs the module loaded, and this
 * has to stay callable when it isn't. These values are part of the module's
 * public API and are stable — 1 FINGERPRINT, 2 FACIAL_RECOGNITION, 3 IRIS.
 */
const AUTH_TYPE_FINGERPRINT = 1;
const AUTH_TYPE_FACIAL_RECOGNITION = 2;
const AUTH_TYPE_IRIS = 3;

function pickKind(types: number[]): BiometricKind {
  if (types.includes(AUTH_TYPE_FACIAL_RECOGNITION)) return 'face';
  if (types.includes(AUTH_TYPE_FINGERPRINT)) return 'fingerprint';
  if (types.includes(AUTH_TYPE_IRIS)) return 'iris';
  return 'generic';
}

export const AppLockProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [isSupported, setIsSupported] = useState(false);
  const [isEnabled, setIsEnabled] = useState(false);
  const [isLocked, setIsLocked] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [biometricKind, setBiometricKind] = useState<BiometricKind>('generic');

  /**
   * Guards the AppState listener against the OS prompt's own backgrounding.
   * While a prompt is on screen the app may report `background`; without this
   * flag returning to `active` would schedule another lock behind the sheet.
   */
  const isPromptOpen = useRef(false);
  /** When the app last went to background/inactive, for the grace period. */
  const backgroundedAt = useRef<number | null>(null);
  /** Read inside the AppState listener, which must not re-subscribe on change. */
  const isEnabledRef = useRef(false);

  useEffect(() => {
    isEnabledRef.current = isEnabled;
  }, [isEnabled]);

  // Probe hardware + read the stored preference once on mount. Locking starts
  // ON when enabled, so a cold start is always gated — never a frame of real
  // content before the prompt.
  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const auth = loadAuthModule();
        // Web, or a binary without the native module: the feature is simply
        // absent. No crash, no toggle in settings, nothing locked.
        if (!auth) return;

        const [hasHardware, isEnrolled, types] = await Promise.all([
          auth.hasHardwareAsync(),
          auth.isEnrolledAsync(),
          auth.supportedAuthenticationTypesAsync(),
        ]);
        if (cancelled) return;

        // `isEnrolled` covers device PIN/pattern too, not just biometrics —
        // which is exactly the fallback we rely on, so it belongs in the gate.
        const supported = hasHardware && isEnrolled;
        setIsSupported(supported);
        setBiometricKind(pickKind(types));

        const stored = await AsyncStorage.getItem(STORAGE_KEY);
        if (cancelled) return;

        // A stored `true` on a device that has since had its biometrics and
        // device lock removed must not lock the user out of their own data with
        // no way to authenticate. Treat unsupported as off.
        const enabled = supported && stored === 'true';
        setIsEnabled(enabled);
        setIsLocked(enabled);
      } catch {
        // Probing failed — fail OPEN. A lock we cannot satisfy is a lockout.
        if (!cancelled) {
          setIsSupported(false);
          setIsEnabled(false);
          setIsLocked(false);
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const authenticate = useCallback(async (): Promise<boolean> => {
    const auth = loadAuthModule();
    // Nothing to authenticate against. Returning true keeps a locked state from
    // becoming unescapable — though with no module we never lock in the first
    // place, since `isSupported` stays false.
    if (!auth) return true;

    isPromptOpen.current = true;
    try {
      const result = await auth.authenticateAsync({
        promptMessage: 'Unlock LifeWise',
        // The whole point of Option A: the OS sheet offers the device PIN as a
        // fallback, so we never build or store a PIN of our own.
        disableDeviceFallback: false,
        cancelLabel: 'Cancel',
      });

      if (result.success) {
        setIsLocked(false);
        backgroundedAt.current = null;
        return true;
      }
      return false;
    } catch {
      return false;
    } finally {
      // Cleared on the next tick: Android reports `active` again slightly after
      // the sheet dismisses, and clearing synchronously would let that
      // transition be read as a real foreground return and re-lock.
      setTimeout(() => {
        isPromptOpen.current = false;
      }, 500);
    }
  }, []);

  const setEnabled = useCallback(
    async (next: boolean): Promise<boolean> => {
      if (next && !isSupported) return false;

      // Confirm the person toggling can actually pass the check — in BOTH
      // directions. Enabling without proof can lock out the real owner;
      // disabling without proof lets anyone holding an unlocked phone remove
      // the protection, which would make the lock decorative.
      const ok = await authenticate();
      if (!ok) return false;

      try {
        await AsyncStorage.setItem(STORAGE_KEY, next ? 'true' : 'false');
        setIsEnabled(next);
        setIsLocked(false);
        return true;
      } catch {
        return false;
      }
    },
    [authenticate, isSupported],
  );

  // Re-lock when the app comes back from the background after the grace
  // period. Cold start is handled by the mount effect above.
  useEffect(() => {
    if (!IS_SUPPORTED_PLATFORM) return;

    const onChange = (state: AppStateStatus) => {
      if (isPromptOpen.current) return;

      if (state === 'background' || state === 'inactive') {
        if (backgroundedAt.current === null) {
          backgroundedAt.current = Date.now();
        }
        return;
      }

      if (state === 'active') {
        const since = backgroundedAt.current;
        backgroundedAt.current = null;
        if (!isEnabledRef.current || since === null) return;
        if (Date.now() - since >= BACKGROUND_GRACE_MS) {
          setIsLocked(true);
        }
      }
    };

    const sub = AppState.addEventListener('change', onChange);
    return () => sub.remove();
  }, []);

  const value = useMemo(
    () => ({
      isSupported,
      isEnabled,
      isLocked,
      isLoading,
      biometricKind,
      setEnabled,
      authenticate,
    }),
    [
      isSupported,
      isEnabled,
      isLocked,
      isLoading,
      biometricKind,
      setEnabled,
      authenticate,
    ],
  );

  return (
    <AppLockContext.Provider value={value}>{children}</AppLockContext.Provider>
  );
};

export const useAppLock = () => useContext(AppLockContext);

/** Human label for the device's hardware, for settings rows and prompts. */
export function biometricLabel(kind: BiometricKind): string {
  switch (kind) {
    case 'face':
      return 'Face Unlock';
    case 'fingerprint':
      return 'Fingerprint Unlock';
    case 'iris':
      return 'Iris Unlock';
    default:
      return 'Biometric Lock';
  }
}

/** Ionicons glyph matching the hardware. */
export function biometricIcon(kind: BiometricKind): string {
  switch (kind) {
    case 'face':
      return 'scan-outline';
    case 'fingerprint':
      return 'finger-print-outline';
    case 'iris':
      return 'eye-outline';
    default:
      return 'lock-closed-outline';
  }
}
