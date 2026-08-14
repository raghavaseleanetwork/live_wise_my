import React, { useState } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TextInput,
  Pressable,
  Platform,
  ScrollView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, router } from 'expo-router';
import { useAuth } from '@/lib/auth-context';
import { useTheme } from '@/lib/theme-context';
import { LoadingIndicator } from '@/components/PremiumLoader';
import { useTranslation } from 'react-i18next';

export default function VerifyOtpScreen() {
  const insets = useSafeAreaInsets();
  const { verifyOtp, resendOtp, user } = useAuth();
  const { colors } = useTheme();
  const { t } = useTranslation();
  const params = useLocalSearchParams<{ email?: string }>();
  // Verification is by email — the code is sent to the address the account was
  // created with. Falls back to the signed-in user's email for the case where
  // this screen is reached outside the signup flow.
  const email = params.email || user?.email || '';
  const [otp, setOtp] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [resending, setResending] = useState(false);
  const [error, setError] = useState('');

  const topInset = Platform.OS === 'web' ? 67 : insets.top;
  const bottomInset = Platform.OS === 'web' ? 34 : Math.max(insets.bottom, 20);

  const handleVerify = async () => {
    if (!otp.trim() || otp.length !== 6) {
      setError(t('verifyOtp.errorInvalidCode'));
      return;
    }
    if (!email) {
      setError(t('verifyOtp.errorEmailMissing'));
      return;
    }
    setError('');
    setIsSubmitting(true);
    const result = await verifyOtp(email, otp.trim());
    setIsSubmitting(false);
    if (result.success) {
      router.replace('/(tabs)');
    } else {
      setError(result.error || t('verifyOtp.errorVerifyFailed'));
    }
  };

  const handleResend = async () => {
    if (!email) return;
    setResending(true);
    setError('');
    const result = await resendOtp(email);
    setResending(false);
    if (result.success) {
      setOtp('');
    } else {
      setError(result.error || t('verifyOtp.errorResendFailed'));
    }
  };

  if (!email) {
    return (
      <View style={[styles.container, { backgroundColor: colors.bg }]}>
        <Text style={[styles.errorText, { color: colors.danger }]}>{t('verifyOtp.emailMissingNotice')}</Text>
        <Pressable onPress={() => router.back()}>
          <Text style={{ color: colors.accent }}>{t('verifyOtp.goBack')}</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.bg }]}>
      <ScrollView
        contentContainerStyle={[styles.scrollContent, { paddingTop: topInset + 40, paddingBottom: bottomInset + 20 }]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.headerSection}>
          <View style={[styles.logoCircle, { backgroundColor: colors.accentDim }]}>
            <Ionicons name="mail-open-outline" size={32} color={colors.accent} />
          </View>
          <Text style={[styles.title, { color: colors.text }]}>{t('verifyOtp.title')}</Text>
          <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
            {t('verifyOtp.subtitle', { email })}
          </Text>
        </View>

        {!!error && (
          <View style={[styles.errorBox, { backgroundColor: colors.dangerDim }]}>
            <Ionicons name="alert-circle" size={16} color={colors.danger} />
            <Text style={[styles.errorText, { color: colors.danger }]}>{error}</Text>
          </View>
        )}

        <View style={styles.formSection}>
          <Text style={[styles.label, { color: colors.textSecondary }]}>{t('verifyOtp.codeLabel')}</Text>
          <View style={[styles.inputWrap, { backgroundColor: colors.inputBg, borderColor: colors.inputBorder }]}>
            <Ionicons name="keypad-outline" size={20} color={colors.textTertiary} />
            <TextInput
              style={[styles.input, { color: colors.text }]}
              value={otp}
              onChangeText={(val) => { setOtp(val.replace(/\D/g, '').slice(0, 6)); setError(''); }}
              placeholder={t('verifyOtp.codePlaceholder')}
              placeholderTextColor={colors.textTertiary}
              keyboardType="number-pad"
              maxLength={6}
            />
          </View>

          <Pressable
            onPress={handleVerify}
            disabled={isSubmitting || otp.length !== 6}
            style={styles.submitBtnWrap}
          >
            <LinearGradient
              colors={[...colors.buttonGradient] as [string, string]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={[styles.submitBtn, (isSubmitting || otp.length !== 6) && styles.submitBtnDisabled]}
            >
              {isSubmitting ? (
                <LoadingIndicator color="#FFFFFF" />
              ) : (
                <Text style={styles.submitBtnText}>{t('verifyOtp.verify')}</Text>
              )}
            </LinearGradient>
          </Pressable>

          <Pressable onPress={handleResend} disabled={resending} style={styles.resendWrap}>
            <Text style={[styles.resendText, { color: colors.accent }]}>
              {resending ? t('verifyOtp.sending') : t('verifyOtp.resendPrompt')}
            </Text>
          </Pressable>
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
    marginBottom: 20,
  },
  title: { fontFamily: 'Inter_700Bold', fontSize: 28, marginBottom: 8 },
  subtitle: { fontFamily: 'Inter_400Regular', fontSize: 15, textAlign: 'center' },
  errorBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 14,
    borderRadius: 12,
    marginBottom: 20,
  },
  errorText: { fontFamily: 'Inter_500Medium', fontSize: 13, flex: 1 },
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
    fontSize: 18,
    paddingVertical: 16,
    letterSpacing: 4,
  },
  submitBtnWrap: { borderRadius: 14, overflow: 'hidden', marginTop: 24 },
  submitBtn: { paddingVertical: 18, alignItems: 'center', justifyContent: 'center', borderRadius: 14 },
  submitBtnDisabled: { opacity: 0.6 },
  submitBtnText: { fontFamily: 'Inter_700Bold', fontSize: 16, color: '#FFFFFF' },
  resendWrap: { alignItems: 'center', marginTop: 20 },
  resendText: { fontFamily: 'Inter_600SemiBold', fontSize: 14 },
});
