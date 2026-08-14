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
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Link, router } from 'expo-router';
import { useAuth } from '@/lib/auth-context';
import { useTheme } from '@/lib/theme-context';
import Animated, { FadeInDown, ZoomIn, FadeInLeft } from 'react-native-reanimated';
import PremiumLoader from '@/components/PremiumLoader';
import { useTranslation } from 'react-i18next';

export default function RegisterScreen() {
  const insets = useSafeAreaInsets();
  const { register, loginWithGoogle } = useAuth();
  const { colors } = useTheme();
  const { t } = useTranslation();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  // Separate from `isSubmitting` so the spinner shows on the pressed button.
  // Backend token verification runs after the Google sheet closes, so without
  // this the screen looks frozen. Mirrors `app/(auth)/login.tsx`.
  const [isGoogleSubmitting, setIsGoogleSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [showPasswordHints, setShowPasswordHints] = useState(false);

  const topInset = Platform.OS === 'web' ? 67 : insets.top;
  const bottomInset = Platform.OS === 'web' ? 34 : Math.max(insets.bottom, 20);

  const handleRegister = async () => {
    const trimmedEmail = email.trim();
    if (!name.trim() || !trimmedEmail || !password.trim()) {
      setError(t('register.errorFillFields'));
      return;
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(trimmedEmail)) {
      setError(t('register.errorInvalidEmail'));
      return;
    }

    const hasMinLength = password.length >= 8;
    const hasUpper = /[A-Z]/.test(password);
    const hasLower = /[a-z]/.test(password);
    const hasNumber = /[0-9]/.test(password);
    const hasSpecial = /[^A-Za-z0-9]/.test(password);

    if (!hasMinLength || !hasUpper || !hasLower || !hasNumber || !hasSpecial) {
      setError(t('register.errorPasswordRequirements'));
      return;
    }
    setError('');
    setIsSubmitting(true);
    const result = await register(name.trim(), email.trim(), password);
    setIsSubmitting(false);
    if (!result.success) {
      setError(result.error || t('register.errorRegistrationFailed'));
      return;
    }
    // The account exists but no session was created — the user is not signed in
    // until the emailed code is verified.
    if (result.otpRequired) {
      router.push({
        pathname: '/(auth)/verify-otp',
        params: { email: result.email ?? trimmedEmail },
      });
    }
  };

  const handleGoogleSignup = async () => {
    if (isGoogleSubmitting) return;
    setError('');
    setIsGoogleSubmitting(true);
    let res;
    try {
      res = await loginWithGoogle();
    } finally {
      setIsGoogleSubmitting(false);
    }
    if (!res.success) {
      setError(res.error || t('register.errorGoogleSignUpFailed'));
      return;
    }
    // Google accounts verify by OTP too — signing in with Google proves the
    // Google account, not that this user should have a LifeWise session.
    if (res.otpRequired && res.email) {
      router.push({
        pathname: '/(auth)/verify-otp',
        params: { email: res.email },
      });
    }
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
          <Text style={[styles.title, { color: colors.text }]}>{t('register.title')}</Text>
          <Text style={[styles.subtitle, { color: colors.textSecondary }]}>{t('register.subtitle')}</Text>
        </Animated.View>

        {!!error && (
          <View style={[styles.errorBox, { backgroundColor: colors.dangerDim }]}>
            <Ionicons name="alert-circle" size={16} color={colors.danger} />
            <Text style={[styles.errorText, { color: colors.danger }]}>{error}</Text>
          </View>
        )}

        <Animated.View entering={Platform.OS !== 'web' ? FadeInDown.delay(150).duration(600) : undefined} style={styles.formSection}>
          <Animated.View entering={Platform.OS !== 'web' ? FadeInDown.delay(200).duration(600) : undefined}>
            <Text style={[styles.label, { color: colors.textSecondary }]}>{t('register.fullNameLabel')}</Text>
            <View style={[styles.inputWrap, { backgroundColor: colors.inputBg, borderColor: colors.inputBorder }]}>
              <Ionicons name="person-outline" size={20} color={colors.textTertiary} />
              <TextInput
                style={[styles.input, { color: colors.text }]}
                value={name}
                onChangeText={setName}
                placeholder={t('register.fullNamePlaceholder')}
                placeholderTextColor={colors.textTertiary}
                autoCapitalize="words"
                testID="register-name"
              />
            </View>
          </Animated.View>

          <Animated.View entering={Platform.OS !== 'web' ? FadeInDown.delay(250).duration(600) : undefined}>
            <Text style={[styles.label, { color: colors.textSecondary, marginTop: 16 }]}>{t('register.emailLabel')}</Text>
            <View style={[styles.inputWrap, { backgroundColor: colors.inputBg, borderColor: colors.inputBorder }]}>
              <Ionicons name="mail-outline" size={20} color={colors.textTertiary} />
              <TextInput
                style={[styles.input, { color: colors.text }]}
                value={email}
                onChangeText={setEmail}
                placeholder={t('register.emailPlaceholder')}
                placeholderTextColor={colors.textTertiary}
                keyboardType="email-address"
                autoCapitalize="none"
                autoComplete="email"
                testID="register-email"
              />
            </View>
          </Animated.View>

          <Animated.View entering={Platform.OS !== 'web' ? FadeInDown.delay(300).duration(600) : undefined}>
            <Text style={[styles.label, { color: colors.textSecondary, marginTop: 16 }]}>{t('register.passwordLabel')}</Text>
            <View style={[styles.inputWrap, { backgroundColor: colors.inputBg, borderColor: colors.inputBorder }]}>
              <Ionicons name="lock-closed-outline" size={20} color={colors.textTertiary} />
              <TextInput
                style={[styles.input, { color: colors.text }]}
                value={password}
                onChangeText={setPassword}
                placeholder={t('register.passwordPlaceholder')}
                placeholderTextColor={colors.textTertiary}
                secureTextEntry={!showPassword}
                testID="register-password"
                onFocus={() => setShowPasswordHints(true)}
              />
              <Pressable onPress={() => setShowPassword(!showPassword)} hitSlop={8}>
                <Ionicons name={showPassword ? 'eye-off-outline' : 'eye-outline'} size={20} color={colors.textTertiary} />
              </Pressable>
            </View>
          </Animated.View>

          {showPasswordHints && (
            <View style={styles.passwordHints}>
              <PasswordRule
                label={t('register.passwordRuleMinLength')}
                met={password.length >= 8}
                colors={colors}
              />
              <PasswordRule
                label={t('register.passwordRuleUppercase')}
                met={/[A-Z]/.test(password)}
                colors={colors}
              />
              <PasswordRule
                label={t('register.passwordRuleLowercase')}
                met={/[a-z]/.test(password)}
                colors={colors}
              />
              <PasswordRule
                label={t('register.passwordRuleNumber')}
                met={/[0-9]/.test(password)}
                colors={colors}
              />
              <PasswordRule
                label={t('register.passwordRuleSpecial')}
                met={/[^A-Za-z0-9]/.test(password)}
                colors={colors}
              />
            </View>
          )}

          <Animated.View entering={Platform.OS !== 'web' ? FadeInDown.delay(350).duration(600) : undefined}>
            <Pressable
              onPress={handleRegister}
              disabled={isSubmitting || isGoogleSubmitting}
              style={styles.submitBtnWrap}
              testID="register-submit"
            >
              <LinearGradient
                colors={[...colors.buttonGradient] as [string, string]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={styles.submitBtn}
              >
                {isSubmitting ? (
                  <PremiumLoader size={28} compact />
                ) : (
                  <Text style={styles.submitBtnText}>{t('register.createAccount')}</Text>
                )}
              </LinearGradient>
            </Pressable>
          </Animated.View>
        </Animated.View>

        <Animated.View entering={Platform.OS !== 'web' ? FadeInDown.delay(200).duration(600) : undefined}>
          <View style={styles.dividerRow}>
            <View style={[styles.dividerLine, { backgroundColor: colors.border }]} />
            <Text style={[styles.dividerText, { color: colors.textTertiary }]}>{t('register.or')}</Text>
            <View style={[styles.dividerLine, { backgroundColor: colors.border }]} />
          </View>

          <View style={styles.socialRow}>
            <Pressable
              onPress={handleGoogleSignup}
              disabled={isGoogleSubmitting || isSubmitting}
              style={[
                styles.googleBtn,
                {
                  backgroundColor: '#FFFFFF',
                  borderColor: colors.border,
                  opacity: isGoogleSubmitting || isSubmitting ? 0.7 : 1,
                },
              ]}
              testID="register-google"
            >
              {isGoogleSubmitting ? (
                <>
                  <PremiumLoader size={24} compact />
                  <Text style={[styles.googleBtnText, { color: colors.textSecondary }]}>
                    {t('register.verifying')}
                  </Text>
                </>
              ) : (
                <>
                  <Ionicons name="logo-google" size={24} color="#4285F4" />
                  <Text style={[styles.googleBtnText, { color: colors.text }]}>{t('register.continueWithGoogle')}</Text>
                </>
              )}
            </Pressable>
          </View>
        </Animated.View>

        <View style={styles.footerRow}>
          <Text style={[styles.footerText, { color: colors.textSecondary }]}>{t('register.haveAccount')}</Text>
          <Link href="/(auth)/login" asChild>
            <Pressable>
              <Text style={[styles.footerLink, { color: colors.accent }]}>{t('register.signIn')}</Text>
            </Pressable>
          </Link>
        </View>
      </ScrollView>
    </View>
  );
}

function PasswordRule({
  label,
  met,
  colors,
}: {
  label: string;
  met: boolean;
  colors: { textSecondary: string; success?: string };
}) {
  const successColor = (colors as any).success || '#16a34a';
  const textColor = met ? successColor : colors.textSecondary;
  return (
    <View style={styles.passwordRuleRow}>
      <Ionicons
        name={met ? 'checkmark-circle' : 'ellipse-outline'}
        size={16}
        color={textColor}
      />
      <Text style={[styles.passwordRuleText, { color: textColor }]}>{label}</Text>
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
  submitBtnWrap: {
    borderRadius: 14,
    overflow: 'hidden',
    marginTop: 24,
  },
  submitBtn: {
    // Fixed height — see the matching note in (auth)/login.tsx. The spinner that
    // replaces the label must not resize the button.
    height: 56,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 14,
  },
  submitBtnText: {
    fontFamily: 'Inter_700Bold',
    fontSize: 16,
    color: '#FFFFFF',
  },
  passwordHints: {
    marginTop: 8,
    marginHorizontal: 4,
    gap: 4,
  },
  passwordRuleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  passwordRuleText: {
    fontFamily: 'Inter_400Regular',
    fontSize: 12,
  },
  dividerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    marginBottom: 24,
  },
  dividerLine: { flex: 1, height: 1 },
  dividerText: {
    fontFamily: 'Inter_400Regular',
    fontSize: 13,
  },
  socialRow: {
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
