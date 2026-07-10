import React, { createContext, useContext, useState, useEffect, useCallback, useMemo, ReactNode } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getApiUrl } from '@/lib/query-client';
import * as WebBrowser from 'expo-web-browser';
import * as Google from 'expo-auth-session/providers/google';
import * as AuthSession from 'expo-auth-session';
import Constants from 'expo-constants';

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
  login: (email: string, password: string) => Promise<{ success: boolean; error?: string }>;
  register: (name: string, email: string, password: string) => Promise<{ success: boolean; error?: string }>;
  logout: () => Promise<void>;
  hasOnboarded: boolean;
  completeOnboarding: () => void;
  loginWithGoogle: () => Promise<{ success: boolean; error?: string }>;
  updateProfile: (fields: { name?: string; phone?: string | null; avatarUrl?: string | null; email?: string; dateOfBirth?: string | null }) => Promise<{ success: boolean; error?: string }>;
  verifyOtp: (phone: string, code: string) => Promise<{ success: boolean; error?: string }>;
  resendOtp: (phone: string) => Promise<{ success: boolean; error?: string }>;
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

  WebBrowser.maybeCompleteAuthSession();

  const [googleRequest, googleResponse, googlePromptAsync] = Google.useAuthRequest({
    androidClientId: process.env.EXPO_PUBLIC_ANDROID_GOOGLE_CLIENT_ID,
    iosClientId: process.env.EXPO_PUBLIC_IOS_GOOGLE_CLIENT_ID,
    clientId: process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID,
    scopes: ['openid', 'profile', 'email'],
    responseType: AuthSession.ResponseType.IdToken,
  });

  useEffect(() => {
    if (googleResponse?.type === 'error') {
      console.error('Google Auth Error Details:', googleResponse.error);
    }
  }, [googleResponse]);

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
    ]);
  }, []);

  const loginWithGoogle = useCallback(async () => {
    try {
      if (!googleRequest) {
        console.error('Google config missing or still initializing');
        return { success: false, error: 'Google config missing' };
      }

      console.log('Starting Google Login prompt...');
      const result = await googlePromptAsync();
      console.log('Google Auth Result Type:', result.type);

      if (result.type !== 'success') {
        const err = result.type === 'error' ? (result as any).error?.message : 'Login cancelled';
        return { success: false, error: err };
      }

      // Extract token with more robust fallback
      const idToken = result.params?.id_token || result.authentication?.idToken;

      if (!idToken) {
        console.error('No id_token found in result:', JSON.stringify(result));
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
  }, [googleRequest, googlePromptAsync]);

  const updateProfile = useCallback(
    async (fields: { name?: string; phone?: string | null; avatarUrl?: string | null; email?: string; dateOfBirth?: string | null }) => {
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

  const verifyOtp = useCallback(async (phone: string, code: string) => {
    try {
      const baseUrl = getApiUrl();
      const url = new URL('/api/auth/verify-otp', baseUrl).toString();
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone, code }),
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

  const resendOtp = useCallback(async (phone: string) => {
    try {
      const baseUrl = getApiUrl();
      const url = new URL('/api/auth/resend-otp', baseUrl).toString();
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone }),
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
