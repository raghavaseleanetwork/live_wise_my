import React, { useState } from 'react';
import {
  StyleSheet,
  Text,
  View,
  ScrollView,
  Pressable,
  TextInput,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { useTheme } from '@/lib/theme-context';
import { useAuth } from '@/lib/auth-context';
import { useAlert } from '@/lib/alert-context';
import { inviteCaregiver } from '@/lib/family-caregivers';
import { LoadingIndicator } from '@/components/PremiumLoader';

export default function InviteCaregiverScreen() {
  const router = useRouter();
  const { memberId, memberName } = useLocalSearchParams<{ memberId: string; memberName?: string }>();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const { token } = useAuth();
  const { showAlert } = useAlert();
  const { t } = useTranslation();

  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);

  const handleInvite = async () => {
    const trimmed = email.trim();
    if (!trimmed || !/^\S+@\S+\.\S+$/.test(trimmed)) {
      setError(t('familyCaregivers.errorInvalidEmail'));
      return;
    }
    setSending(true);
    setError('');
    try {
      await inviteCaregiver(String(memberId), trimmed, token);
      showAlert({ title: t('familyCaregivers.inviteSentTitle'), message: t('familyCaregivers.inviteSentMessage', { email: trimmed }), type: 'success' });
      router.back();
    } catch (e: any) {
      const msg = String(e?.message || '');
      if (msg.includes('400')) {
        setError(t('familyCaregivers.errorCannotInviteSelf'));
      } else if (msg.includes('403')) {
        setError(t('familyCaregivers.errorOnlyOwner'));
      } else if (msg.includes('409')) {
        setError(t('familyCaregivers.errorAlreadyConnected'));
      } else {
        setError(t('familyCaregivers.errorSendFailed'));
      }
      setSending(false);
    }
  };

  const headerHeight = 110 + insets.top;

  return (
    <View style={[styles.container, { backgroundColor: colors.bg }]}>
      <LinearGradient colors={colors.heroGradient as any} style={[styles.header, { height: headerHeight, paddingTop: insets.top }]}>
        <View style={styles.headerTop}>
          <Pressable onPress={() => router.back()} style={styles.backBtn} hitSlop={12}>
            <Ionicons name="chevron-back" size={24} color={colors.text} />
          </Pressable>
          <Text style={[styles.headerTitle, { color: colors.text }]}>{t('familyCaregivers.inviteHeaderTitle')}</Text>
          <View style={styles.backBtn} />
        </View>
        {memberName ? <Text style={[styles.headerSubtitle, { color: colors.textSecondary }]}>{t('familyCaregivers.connectedTo', { name: memberName })}</Text> : null}
      </LinearGradient>

      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: insets.bottom + 40 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        <Text style={[styles.introText, { color: colors.textSecondary }]}>
          {t('familyCaregivers.inviteIntroText', { member: memberName || t('familyCaregivers.thisMember') })}
        </Text>
        {!!error && <Text style={[styles.errorText, { color: colors.danger }]}>{error}</Text>}

        <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>{t('familyCaregivers.emailLabel')}</Text>
        <TextInput
          style={[styles.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.inputBg }]}
          value={email}
          onChangeText={setEmail}
          placeholder={t('familyCaregivers.emailPlaceholder')}
          placeholderTextColor={colors.textTertiary}
          autoCapitalize="none"
          keyboardType="email-address"
          autoFocus
        />

        <Pressable onPress={handleInvite} disabled={sending} style={[styles.primaryBtn, { backgroundColor: colors.accent, opacity: sending ? 0.6 : 1 }]}>
          {sending ? <LoadingIndicator color="#FFF" size="small" /> : <Text style={styles.primaryBtnLabel}>{t('familyCaregivers.sendInvite')}</Text>}
        </Pressable>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { paddingHorizontal: 20, justifyContent: 'center', borderBottomLeftRadius: 32, borderBottomRightRadius: 32 },
  headerTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  backBtn: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontFamily: 'Inter_700Bold', fontSize: 17, flex: 1, textAlign: 'center' },
  headerSubtitle: { fontFamily: 'Inter_500Medium', fontSize: 13, marginTop: 4, textAlign: 'center' },
  introText: { fontFamily: 'Inter_400Regular', fontSize: 13, lineHeight: 19, marginBottom: 12 },
  primaryBtn: { borderRadius: 14, paddingVertical: 15, alignItems: 'center', marginTop: 28 },
  primaryBtnLabel: { fontFamily: 'Inter_700Bold', fontSize: 15, color: '#FFF' },
  errorText: { fontFamily: 'Inter_500Medium', fontSize: 13, marginBottom: 10, textAlign: 'center' },
  fieldLabel: { fontFamily: 'Inter_600SemiBold', fontSize: 12, marginBottom: 6, marginTop: 4 },
  input: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontFamily: 'Inter_500Medium', fontSize: 14 },
});
