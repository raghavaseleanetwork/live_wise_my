import React, { createContext, useContext, useState, useEffect, useCallback, useMemo, ReactNode } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getApiUrl } from '@/lib/query-client';
import { Platform } from 'react-native';
import Constants from 'expo-constants';

/**
 * Native Google Sign-In, loaded lazily.
 *
 * Replaces `expo-auth-session/providers/google`, which drove an *embedded
 * browser* implicit flow (`responseType: IdToken`). Google now blocks that:
 * the consent screen never rendered and returned
 * `Error 400: invalid_request — doesn't comply with Google's OAuth 2.0 policy`.
 * The native picker is the supported path and is not subject to that rule.
 *
 * Required lazily, never statically, for two reasons:
 *  1. It is a NATIVE module — a static import pulls it into the web bundle and
 *     breaks the web build, which this app ships.
 *  2. It does not exist in Expo Go, so importing it there is a hard crash.
 * Both are the same failure mode `lib/revenuecat.ts` guards against.
 */
type GoogleSigninModule = typeof import('@react-native-google-signin/google-signin');

let googleSigninModule: GoogleSigninModule | null = null;
let googleSigninConfigured = false;

function isExpoGo() {
  return Constants.appOwnership === 'expo';
}

function getGoogleSignin(): GoogleSigninModule | null {
  if (Platform.OS === 'web' || isExpoGo()) return null;
  if (googleSigninModule) return googleSigninModule;

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('@react-native-google-signin/google-signin') as GoogleSigninModule;

    if (!googleSigninConfigured) {
      // `webClientId` is the WEB client, even on Android — it is what Google
      // uses as the audience of the returned id_token, and the server verifies
      // that token. Passing the Android client id here yields a token the
      // backend rejects.
      mod.GoogleSignin.configure({
        webClientId: process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID,
        iosClientId: process.env.EXPO_PUBLIC_IOS_GOOGLE_CLIENT_ID,
        scopes: ['openid', 'profile', 'email'],
      });
      googleSigninConfigured = true;
    }

    googleSigninModule = mod;
    return mod;
  } catch (e) {
    console.error('[Google] Native sign-in module unavailable:', e);
    return null;
  }
}

interface User {
  id: string;
  email: string;
  name: string;
  phone?: string | null;
  phoneVerified?: boolean;
  avatarUrl?: string | null;
  dateOfBirth?: string | null;
}

interface AuthContextValue {
  user: User | null;
  token: string | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  login: (
    email: string,
    password: string,
  ) => Promise<{ success: boolean; error?: string; otpRequired?: boolean; email?: string }>;
  /**
   * Creates the account and triggers an email OTP. Resolves with
   * `otpRequired: true` and the email to verify — it deliberately does NOT sign
   * the user in, so the caller must route to the OTP screen.
   */
  register: (
    name: string,
    email: string,
    password: string,
  ) => Promise<{ success: boolean; error?: string; otpRequired?: boolean; email?: string }>;
  logout: () => Promise<void>;
  hasOnboarded: boolean;
  completeOnboarding: () => void;
  /**
   * Google sign-in. May also require OTP — a first-time Google user is a new
   * account, and the product rule is that no account is usable before its email
   * is verified, regardless of how it was created.
   */
  loginWithGoogle: () => Promise<{ success: boolean; error?: string; otpRequired?: boolean; email?: string }>;
  updateProfile: (fields: { name?: string; phone?: string | null; avatarUrl?: string | null; email?: string; dateOfBirth?: string | null; preferredCurrency?: string }) => Promise<{ success: boolean; error?: string }>;
  /** Verifies the emailed code and, on success, signs the user in. */
  verifyOtp: (email: string, code: string) => Promise<{ success: boolean; error?: string }>;
  resendOtp: (email: string) => Promise<{ success: boolean; error?: string }>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const STORAGE_KEYS = {
  USER: '@lifewise_user',
  TOKEN: '@lifewise_token',
  ONBOARDED: '@lifewise_onboarded',
};

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [hasOnboarded, setHasOnboarded] = useState(false);

  useEffect(() => {
    loadState();
  }, []);

  const loadState = async () => {
    try {
      const [storedUser, storedToken, storedOnboarded] = await Promise.all([
        AsyncStorage.getItem(STORAGE_KEYS.USER),
        AsyncStorage.getItem(STORAGE_KEYS.TOKEN),
        AsyncStorage.getItem(STORAGE_KEYS.ONBOARDED),
      ]);
      if (storedUser) setUser(JSON.parse(storedUser));
      if (storedToken) setToken(storedToken);
      if (storedOnboarded === 'true') setHasOnboarded(true);
    } catch {
    } finally {
      setIsLoading(false);
    }
  };

  const login = useCallback(async (email: string, password: string) => {
    try {
      const baseUrl = getApiUrl();
      const url = new URL('/api/auth/login', baseUrl).toString();
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        return { success: false, error: data.message || 'Login failed' };
      }

      // Correct credentials but an unverified email: the server re-sends the
      // code and withholds the token. Treated as success-with-a-next-step, not
      // an error — the password was right, and an error message would tell the
      // user something untrue.
      if (data.otpRequired || !data.token) {
        return { success: true, otpRequired: true, email: data.email ?? email.trim().toLowerCase() };
      }

      setUser(data.user);
      setToken(data.token);
      await AsyncStorage.setItem(STORAGE_KEYS.USER, JSON.stringify(data.user));
      await AsyncStorage.setItem(STORAGE_KEYS.TOKEN, data.token);
      return { success: true };
    } catch {
      return { success: false, error: 'Network error. Check backend is running and EXPO_PUBLIC_DOMAIN (e.g. 127.0.0.1:5000 or your PC IP).' };
    }
  }, []);

  const register = useCallback(async (name: string, email: string, password: string) => {
    try {
      const baseUrl = getApiUrl();
      const url = new URL('/api/auth/register', baseUrl).toString();
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        return { success: false, error: data.message || 'Registration failed' };
      }

      // Deliberately NOT signed in here. Registration creates the account and
      // sends an email OTP; the session is only established by `verifyOtp`.
      // Storing a token at this point would leave an unverified user fully
      // logged in and able to dismiss the OTP screen — which is the bug this
      // whole flow exists to close.
      if (data.otpRequired || !data.token) {
        return { success: true, otpRequired: true, email: data.email ?? email.trim().toLowerCase() };
      }

      // Server did not require OTP (verification disabled server-side). Honour
      // that rather than stranding the user on a screen with no code coming.
      setUser(data.user);
      setToken(data.token);
      await AsyncStorage.setItem(STORAGE_KEYS.USER, JSON.stringify(data.user));
      await AsyncStorage.setItem(STORAGE_KEYS.TOKEN, data.token);
      return { success: true };
    } catch (e) {
      return { success: false, error: 'Network error. Check backend is running and EXPO_PUBLIC_DOMAIN (e.g. 127.0.0.1:5000 or your PC IP).' };
    }
  }, []);

  const logout = useCallback(async () => {
    setUser(null);
    setToken(null);
    await Promise.all([
      AsyncStorage.removeItem(STORAGE_KEYS.USER),
      AsyncStorage.removeItem(STORAGE_KEYS.TOKEN),
      AsyncStorage.removeItem('last_sms_sync_timestamp'),
      // Legacy: the expense-overlay cache is gone (the server now persists
      // memberId/paymentMode/etc.), but old installs may still hold the key.
      AsyncStorage.removeItem('@lifewise_expense_overlay'),
      // Legacy: recurring templates now sync via /api/recurring. Clearing the
      // old local store stops a stale copy shadowing the server's list.
      AsyncStorage.removeItem('@lifewise_recurring_expenses'),
    ]);

    // Clear the native Google session too. Without this the account stays
    // signed in at the OS level, so "log out then log in as someone else"
    // silently re-uses the previous account without ever showing the picker.
    try {
      await getGoogleSignin()?.GoogleSignin.signOut();
    } catch {
      // Never block logout on this — local state is already cleared.
    }
  }, []);

  const loginWithGoogle = useCallback(async () => {
    try {
      const google = getGoogleSignin();
      if (!google) {
        return {
          success: false,
          error: isExpoGo()
            ? 'Google sign-in needs a development build — it does not work in Expo Go.'
            : 'Google sign-in is not available on this platform.',
        };
      }

      const { GoogleSignin, statusCodes } = google;

      // Surfaces a clear, fixable message instead of a generic failure when
      // Play Services are missing or outdated.
      await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });

      // Without this, signing in a second time can silently reuse the first
      // account instead of showing the picker.
      await GoogleSignin.signOut().catch(() => {});

      let idToken: string | null = null;
      try {
        const result: any = await GoogleSignin.signIn();
        // v13+ returns `{ type, data }`; older versions return the user object
        // directly. Accept both so a library bump does not silently break login.
        idToken = result?.data?.idToken ?? result?.idToken ?? null;

        if (result?.type === 'cancelled') {
          return { success: false, error: 'Login cancelled' };
        }
      } catch (e: any) {
        // Dismissing the account picker is a normal user action, not an error.
        if (e?.code === statusCodes.SIGN_IN_CANCELLED) {
          return { success: false, error: 'Login cancelled' };
        }
        if (e?.code === statusCodes.PLAY_SERVICES_NOT_AVAILABLE) {
          return { success: false, error: 'Google Play Services is unavailable on this device.' };
        }
        // DEVELOPER_ERROR almost always means the signing certificate's SHA-1
        // is not registered against the Android OAuth client in Google Cloud
        // Console. Say so explicitly — the raw error names nothing actionable.
        // Not in `statusCodes` — the native layer raises it as a bare string.
        if (e?.code === 'DEVELOPER_ERROR' || e?.code === 10) {
          console.error('[Google] DEVELOPER_ERROR — register this build\'s SHA-1 in Google Cloud Console.', e);
          return {
            success: false,
            error: 'This build is not registered with Google. Add its SHA-1 fingerprint to the Android OAuth client.',
          };
        }
        console.error('[Google] Native sign-in failed:', e);
        return { success: false, error: e?.message || 'Google sign-in failed' };
      }

      if (!idToken) {
        console.error('[Google] Sign-in succeeded but returned no idToken.');
        return { success: false, error: 'No id_token from Google' };
      }

      console.log('Sending ID Token to backend for verification...');
      const baseUrl = getApiUrl();
      const url = new URL('/api/auth/oauth/google', baseUrl).toString();
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken }),
      });

      const data = await res.json();
      if (!res.ok) {
        console.error('Backend OAuth Error:', data.message);
        return { success: false, error: data.message || 'Google login failed' };
      }

      // Google sign-in is subject to the same rule as email/password: an
      // account that has not verified its email is not usable. The server
      // signals this with `otpRequired`, typically for a first-time Google user
      // (a returning, already-verified one signs straight in).
      if (data.otpRequired || !data.token) {
        return {
          success: true,
          otpRequired: true,
          email: data.email ?? data.user?.email,
        };
      }

      console.log('Google login successful! User:', data.user?.email);
      setUser(data.user);
      setToken(data.token);
      await AsyncStorage.setItem(STORAGE_KEYS.USER, JSON.stringify(data.user));
      await AsyncStorage.setItem(STORAGE_KEYS.TOKEN, data.token);
      return { success: true };
    } catch (err) {
      console.error('Google login catch error:', err);
      return { success: false, error: 'Google login error' };
    }
  }, []);

  const updateProfile = useCallback(
    async (fields: {
      name?: string;
      phone?: string | null;
      avatarUrl?: string | null;
      email?: string;
      dateOfBirth?: string | null;
      /**
       * ISO 4217 code. Mirrors the local `@lifewise_currency` preference so the
       * server can render reminder emails in the user's currency — it has no
       * other way to know what they picked.
       */
      preferredCurrency?: string;
    }) => {
      try {
        if (!token) {
          return { success: false, error: 'Not authenticated' };
        }
        const baseUrl = getApiUrl();
        const url = new URL('/api/auth/me', baseUrl).toString();
        const res = await fetch(url, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(fields),
        });
        const data = await res.json();
        if (!res.ok) {
          return { success: false, error: data.message || 'Update failed' };
        }
        if (data.user) {
          setUser(data.user);
          await AsyncStorage.setItem(STORAGE_KEYS.USER, JSON.stringify(data.user));
        }
        return { success: true };
      } catch {
        return { success: false, error: 'Profile update error' };
      }
    },
    [token],
  );

  const verifyOtp = useCallback(async (email: string, code: string) => {
    try {
      const baseUrl = getApiUrl();
      const url = new URL('/api/auth/verify-otp', baseUrl).toString();
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // Field is `otp`, not `code`: the server reads `req.body.otp`. The old
        // client sent `code`, so the value arrived undefined and every
        // verification failed with "Phone and OTP are required".
        body: JSON.stringify({ email: email.trim().toLowerCase(), otp: code }),
      });
      const data = await res.json();
      if (!res.ok) return { success: false, error: data.message || 'Verification failed' };

      setUser(data.user);
      setToken(data.token);
      await AsyncStorage.setItem(STORAGE_KEYS.USER, JSON.stringify(data.user));
      await AsyncStorage.setItem(STORAGE_KEYS.TOKEN, data.token);
      return { success: true };
    } catch {
      return { success: false, error: 'OTP verification error' };
    }
  }, []);

  const resendOtp = useCallback(async (email: string) => {
    try {
      const baseUrl = getApiUrl();
      const url = new URL('/api/auth/resend-otp', baseUrl).toString();
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim().toLowerCase() }),
      });
      const data = await res.json();
      if (!res.ok) return { success: false, error: data.message || 'Failed to resend' };
      return { success: true };
    } catch {
      return { success: false, error: 'OTP resend error' };
    }
  }, []);

  const completeOnboarding = useCallback(() => {
    setHasOnboarded(true);
    AsyncStorage.setItem(STORAGE_KEYS.ONBOARDED, 'true');
  }, []);

  const value = useMemo(() => ({
    user,
    token,
    isLoading,
    isAuthenticated: !!user && !!token,
    login,
    register,
    logout,
    hasOnboarded,
    completeOnboarding,
    loginWithGoogle,
    updateProfile,
    verifyOtp,
    resendOtp,
  }), [user, token, isLoading, hasOnboarded, login, register, logout, completeOnboarding, loginWithGoogle, updateProfile, verifyOtp, resendOtp]);

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
