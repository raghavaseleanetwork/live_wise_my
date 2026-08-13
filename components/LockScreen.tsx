/**
 * The gate shown while the app is locked.
 *
 * Rendered by `LockGate` INSTEAD OF the navigation stack, not on top of it — so
 * while this is on screen no real screen is mounted, nothing sensitive is behind
 * it to capture, and a deep link has no route to land on.
 *
 * The OS sheet is fired automatically on mount so the usual path is: open app →
 * touch sensor → in. The button below is the retry path for a cancelled or
 * failed attempt.
 */

import React, { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useTheme } from '@/lib/theme-context';
import {
  useAppLock,
  biometricIcon,
  biometricLabel,
} from '@/lib/app-lock-context';
import { BRAND_LOGO } from '@/components/PremiumLoader';

export default function LockScreen() {
  const { colors } = useTheme();
  const { authenticate, biometricKind } = useAppLock();
  const [isAuthenticating, setIsAuthenticating] = useState(true);
  const [failed, setFailed] = useState(false);

  /**
   * StrictMode / fast-refresh can mount this twice; a second prompt while the
   * first is open throws on Android. One auto-attempt per mount only.
   */
  const hasAutoPrompted = useRef(false);

  const run = async () => {
    setIsAuthenticating(true);
    setFailed(false);
    const ok = await authenticate();
    // On success the provider clears `isLocked` and this unmounts, so only the
    // failure path needs to settle state.
    if (!ok) {
      setFailed(true);
      setIsAuthenticating(false);
    }
  };

  useEffect(() => {
    if (hasAutoPrompted.current) return;
    hasAutoPrompted.current = true;
    void run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const label = biometricLabel(biometricKind);

  return (
    <View style={[styles.container, { backgroundColor: colors.bg }]}>
      <View style={styles.content}>
        <View style={[styles.logoWrap, { backgroundColor: colors.card }]}>
          <Image
            source={BRAND_LOGO}
            style={styles.logo}
            contentFit="contain"
            cachePolicy="memory-disk"
            transition={0}
          />
        </View>

        <Text style={[styles.title, { color: colors.text }]}>LifeWise</Text>
        <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
          {isAuthenticating
            ? 'Waiting for authentication…'
            : failed
              ? 'Unlock to continue'
              : `Use ${label.toLowerCase()} to continue`}
        </Text>

        <View
          style={[styles.iconRing, { borderColor: colors.border, backgroundColor: colors.accentDim }]}
        >
          <Ionicons
            name={biometricIcon(biometricKind) as any}
            size={48}
            color={colors.accent}
          />
        </View>

        <Pressable
          onPress={run}
          disabled={isAuthenticating}
          style={[
            styles.unlockBtn,
            { backgroundColor: colors.accent },
            isAuthenticating && styles.unlockBtnDisabled,
          ]}
          testID="lock-screen-unlock"
        >
          <Ionicons name="lock-open-outline" size={18} color="#FFFFFF" />
          <Text style={styles.unlockBtnText}>
            {isAuthenticating ? 'Authenticating…' : 'Unlock'}
          </Text>
        </Pressable>

        {failed && (
          <Text style={[styles.hint, { color: colors.textTertiary }]}>
            You can also use your device PIN or password.
          </Text>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  content: { alignItems: 'center', width: '100%' },
  logoWrap: {
    width: 88,
    height: 88,
    borderRadius: 26,
    padding: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logo: { width: '100%', height: '100%', borderRadius: 20 },
  title: {
    fontFamily: 'Inter_700Bold',
    fontSize: 26,
    marginTop: 18,
    letterSpacing: 0.4,
  },
  subtitle: {
    fontFamily: 'Inter_400Regular',
    fontSize: 14,
    marginTop: 8,
    textAlign: 'center',
  },
  iconRing: {
    width: 108,
    height: 108,
    borderRadius: 54,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 36,
    marginBottom: 36,
  },
  unlockBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderRadius: 14,
    paddingVertical: 16,
    paddingHorizontal: 32,
    alignSelf: 'stretch',
  },
  unlockBtnDisabled: { opacity: 0.6 },
  unlockBtnText: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 15,
    color: '#FFFFFF',
  },
  hint: {
    fontFamily: 'Inter_400Regular',
    fontSize: 12,
    marginTop: 16,
    textAlign: 'center',
  },
});
