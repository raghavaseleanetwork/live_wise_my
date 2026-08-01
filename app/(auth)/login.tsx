import React, { useState } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TextInput,
  Pressable,
  Platform,
  ScrollView,
  Image,
} from 'react-native';
import PremiumLoader from '@/components/PremiumLoader';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Link, router } from 'expo-router';
import { useAuth } from '@/lib/auth-context';
import { useTheme } from '@/lib/theme-context';
import Animated, { FadeInDown, FadeInUp, ZoomIn } from 'react-native-reanimated';

export default function LoginScreen() {
  const insets = useSafeAreaInsets();
  const { login, loginWithGoogle } = useAuth();
  const { colors } = useTheme();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  // Tracked separately from `isSubmitting` so the spinner appears on the button
  // the user actually pressed. The backend token verification takes a visible
  // moment, during which the Google sheet has already closed — without this the
  // screen looks frozen and invites a second tap.
  const [isGoogleSubmitting, setIsGoogleSubmitting] = useState(false);
  const [error, setError] = useState('');

  const topInset = Platform.OS === 'web' ? 67 : insets.top;
  const bottomInset = Platform.OS === 'web' ? 34 : Math.max(insets.bottom, 20);

  const handleLogin = async () => {
    const trimmedEmail = email.trim();
    if (!trimmedEmail || !password.trim()) {
      setError('Please fill in all fields');
      return;
    }
    
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(trimmedEmail)) {
      setError('Please enter a valid email address');
      return;
    }

    setError('');
    setIsSubmitting(true);
    const result = await login(trimmedEmail, password);
    setIsSubmitting(false);
    if (!result.success) {
      setError(result.error || 'Login failed');
      return;
    }
    // An account created before verification completed still needs its code.
    // Without this the user is stuck: correct password, but no session.
    if (result.otpRequired) {
      router.push({
        pathname: '/(auth)/verify-otp',
        params: { email: result.email ?? trimmedEmail },
      });
    }
  };

  const handleGoogleLogin = async () => {
    if (isGoogleSubmitting) return;
    setError('');
    setIsGoogleSubmitting(true);
    let res;
    try {
      res = await loginWithGoogle();
    } finally {
      // Cleared in `finally` so a thrown error cannot strand the button in a
      // permanently disabled spinner state.
      setIsGoogleSubmitting(false);
    }
    if (!res.success) {
      setError(res.error || 'Google sign-in failed');
      return;
    }
    // Must be checked BEFORE navigating into the app: on an OTP-required
    // response no token was stored, so replacing to /(tabs) would land on an
    // unauthenticated shell.
    if (res.otpRequired && res.email) {
      router.push({
        pathname: '/(auth)/verify-otp',
        params: { email: res.email },
      });
      return;
    }
    router.replace('/(tabs)');
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.bg }]}>
      <ScrollView
        contentContainerStyle={[styles.scrollContent, { paddingTop: topInset + 40, paddingBottom: bottomInset + 20 }]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <Animated.View entering={Platform.OS !== 'web' ? FadeInDown.duration(800).springify() : undefined} style={styles.headerSection}>
          <Animated.View entering={Platform.OS !== 'web' ? ZoomIn.delay(300).duration(600) : undefined} style={styles.logoCircle}>
            <Image source={require('../../logo.png')} style={styles.logoImage} resizeMode="contain" />
          </Animated.View>
          <Text style={[styles.title, { color: colors.text }]}>Welcome Back</Text>
          <Text style={[styles.subtitle, { color: colors.textSecondary }]}>Sign in to access your spending insights</Text>
        </Animated.View>

        {!!error && (
          <View style={[styles.errorBox, { backgroundColor: colors.dangerDim }]}>
            <Ionicons name="alert-circle" size={16} color={colors.danger} />
            <Text style={[styles.errorText, { color: colors.danger }]}>{error}</Text>
          </View>
        )}

        <Animated.View entering={Platform.OS !== 'web' ? FadeInDown.delay(150).duration(600) : undefined} style={styles.formSection}>
          <Animated.View entering={Platform.OS !== 'web' ? FadeInDown.delay(200).duration(600) : undefined}>
            <Text style={[styles.label, { color: colors.textSecondary }]}>Email</Text>
            <View style={[styles.inputWrap, { backgroundColor: colors.inputBg, borderColor: colors.inputBorder }]}>
              <Ionicons name="mail-outline" size={20} color={colors.textTertiary} />
              <TextInput
                style={[styles.input, { color: colors.text }]}
                value={email}
                onChangeText={setEmail}
                placeholder="your@email.com"
                placeholderTextColor={colors.textTertiary}
                keyboardType="email-address"
                autoCapitalize="none"
                autoComplete="email"
                testID="login-email"
              />
            </View>
          </Animated.View>

          <Animated.View entering={Platform.OS !== 'web' ? FadeInDown.delay(250).duration(600) : undefined}>
            <Text style={[styles.label, { color: colors.textSecondary, marginTop: 16 }]}>Password</Text>
            <View style={[styles.inputWrap, { backgroundColor: colors.inputBg, borderColor: colors.inputBorder }]}>
              <Ionicons name="lock-closed-outline" size={20} color={colors.textTertiary} />
              <TextInput
                style={[styles.input, { color: colors.text }]}
                value={password}
                onChangeText={setPassword}
                placeholder="Enter password"
                placeholderTextColor={colors.textTertiary}
                secureTextEntry={!showPassword}
                testID="login-password"
              />
              <Pressable onPress={() => setShowPassword(!showPassword)} hitSlop={8}>
                <Ionicons name={showPassword ? 'eye-off-outline' : 'eye-outline'} size={20} color={colors.textTertiary} />
              </Pressable>
            </View>
          </Animated.View>

          <Animated.View entering={Platform.OS !== 'web' ? FadeInDown.delay(300).duration(600) : undefined}>
            <Pressable
              onPress={handleLogin}
              disabled={isSubmitting || isGoogleSubmitting}
              style={styles.loginBtnWrap}
              testID="login-submit"
            >
              <LinearGradient
                colors={[...colors.buttonGradient] as [string, string]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={styles.loginBtn}
              >
                {isSubmitting ? (
                  <PremiumLoader size={28} compact />
                ) : (
                  <Text style={styles.loginBtnText}>Sign In</Text>
                )}
              </LinearGradient>
            </Pressable>
          </Animated.View>
        </Animated.View>

        <Animated.View entering={Platform.OS !== 'web' ? FadeInDown.delay(200).duration(600) : undefined}>
          <View style={styles.dividerRow}>
            <View style={[styles.dividerLine, { backgroundColor: colors.border }]} />
            <Text style={[styles.dividerText, { color: colors.textTertiary }]}>OR</Text>
            <View style={[styles.dividerLine, { backgroundColor: colors.border }]} />
          </View>

          <View style={styles.socialRow}>
            <Pressable
              onPress={handleGoogleLogin}
              disabled={isGoogleSubmitting || isSubmitting}
              style={[
                styles.googleBtn,
                {
                  backgroundColor: '#FFFFFF',
                  borderColor: colors.border,
                  opacity: isGoogleSubmitting || isSubmitting ? 0.7 : 1,
                },
              ]}
              testID="login-google"
            >
              {isGoogleSubmitting ? (
                <>
                  <PremiumLoader size={24} compact />
                  {/* Named step rather than a bare spinner: the account sheet has
                      already closed by this point, so saying what is happening
                      is what makes the wait legible. */}
                  <Text style={[styles.googleBtnText, { color: colors.textSecondary }]}>
                    Verifying…
                  </Text>
                </>
              ) : (
                <>
                  <Ionicons name="logo-google" size={24} color="#4285F4" />
                  <Text style={[styles.googleBtnText, { color: colors.text }]}>Continue with Google</Text>
                </>
              )}
            </Pressable>
          </View>
        </Animated.View>

        <View style={styles.footerRow}>
          <Text style={[styles.footerText, { color: colors.textSecondary }]}>{`Don\u2019t have an account?`}</Text>
          <Link href="/(auth)/register" asChild>
            <Pressable>
              <Text style={[styles.footerLink, { color: colors.accent }]}>Sign Up</Text>
            </Pressable>
          </Link>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scrollContent: { paddingHorizontal: 24 },
  headerSection: { alignItems: 'center', marginBottom: 32 },
  logoCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
    marginBottom: 20,
  },
  logoImage: {
    width: 60,
    height: 60,
    borderRadius: 30,
  },
  title: {
    fontFamily: 'Inter_700Bold',
    fontSize: 28,
    marginBottom: 8,
  },
  subtitle: {
    fontFamily: 'Inter_400Regular',
    fontSize: 15,
    textAlign: 'center',
  },
  errorBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 14,
    borderRadius: 12,
    marginBottom: 20,
  },
  errorText: {
    fontFamily: 'Inter_500Medium',
    fontSize: 13,
    flex: 1,
  },
  formSection: { marginBottom: 28 },
  label: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 12,
    letterSpacing: 0.5,
    marginBottom: 8,
  },
  inputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: 16,
    gap: 12,
  },
  input: {
    flex: 1,
    fontFamily: 'Inter_400Regular',
    fontSize: 15,
    paddingVertical: 16,
  },
  loginBtnWrap: {
    borderRadius: 14,
    overflow: 'hidden',
    marginTop: 24,
  },
  loginBtn: {
    // Fixed, not padding-derived: the button swaps its label for a spinner
    // while submitting, and any content-driven height makes it jump between the
    // two states. 56 is what `paddingVertical: 18` around the 16px bold label
    // resolved to, so the resting appearance is unchanged.
    height: 56,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 14,
  },
  loginBtnText: {
    fontFamily: 'Inter_700Bold',
    fontSize: 16,
    color: '#FFFFFF',
  },
  dividerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    marginTop: 12,
    marginBottom: 24,
  },
  dividerLine: { flex: 1, height: 1 },
  dividerText: {
    fontFamily: 'Inter_400Regular',
    fontSize: 13,
  },
  socialRow: {
    marginTop: 4,
    marginBottom: 32,
  },
  googleBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    paddingVertical: 16,
    paddingHorizontal: 16,
    borderRadius: 14,
    borderWidth: 1,
  },
  googleBtnText: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 16,
  },
  footerRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 6,
  },
  footerText: {
    fontFamily: 'Inter_400Regular',
    fontSize: 14,
  },
  footerLink: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 14,
  },
});
