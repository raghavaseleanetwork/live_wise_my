import React, { useState, useEffect } from 'react';
import {
  StyleSheet,
  Text,
  View,
  ScrollView,
  Pressable,
  Platform,
  Switch,
  TextInput,
  Image,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/lib/auth-context';
import { useTheme } from '@/lib/theme-context';
import { useCurrency, CURRENCIES, CurrencyOption } from '@/lib/currency-context';
import { useLanguage } from '@/lib/language-context';
import { useExpenses } from '@/lib/expense-context';
import { useSeniorMode } from '@/lib/senior-context';
import { useAlert } from '@/lib/alert-context';
import { useSubscription } from '@/lib/subscription-context';
import { useAppLock, biometricIcon, biometricLabel } from '@/lib/app-lock-context';
import CustomModal from '@/components/CustomModal';
import PlanBadge from '@/components/PlanBadge';
import Money from '@/components/Money';

function SettingRow({
  icon,
  label,
  rightElement,
  onPress,
  danger,
  colors,
}: {
  icon: string;
  label: string;
  rightElement?: React.ReactNode;
  onPress?: () => void;
  danger?: boolean;
  colors: any;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress && !rightElement}
      style={[styles.settingRow, { borderBottomColor: colors.border }]}
    >
      <View style={styles.settingLeft}>
        <View style={[styles.settingIcon, { backgroundColor: danger ? colors.dangerDim : colors.accentDim }]}>
          <Ionicons name={icon as any} size={18} color={danger ? colors.danger : colors.accent} />
        </View>
        <Text style={[styles.settingLabel, { color: danger ? colors.danger : colors.text }]}>{label}</Text>
      </View>
      {rightElement || (onPress && (
        <Ionicons name="chevron-forward" size={18} color={colors.textTertiary} />
      ))}
    </Pressable>
  );
}

export default function SettingsScreen() {
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
  const { user, logout, updateProfile } = useAuth();
  const { colors, mode, toggleTheme, isDark } = useTheme();
  const { currentCurrency, setCurrency, formatAmount, convertForDisplay, convertForStorage } = useCurrency();
  const { currentLanguage, languages, setLanguage } = useLanguage();
  const { monthlyBudget, setMonthlyBudget } = useExpenses();
  const { isSeniorMode, setSeniorMode } = useSeniorMode();
  const { showAlert } = useAlert();
  const { currentPlan, isTrialProvidingPlan } = useSubscription();
  const {
    isSupported: lockSupported,
    isEnabled: lockEnabled,
    biometricKind,
    setEnabled: setLockEnabled,
  } = useAppLock();
  const [showCurrencyPicker, setShowCurrencyPicker] = useState(false);
  const [showLanguagePicker, setShowLanguagePicker] = useState(false);
  const [showBudgetModal, setShowBudgetModal] = useState(false);
  const [budgetInput, setBudgetInput] = useState(String(monthlyBudget || ''));

  const topInset = Platform.OS === 'web' ? 67 : insets.top;
  const bottomInset = Platform.OS === 'web' ? 34 : Math.max(insets.bottom, 20);

  const toggleSeniorMode = (val: boolean) => {
    setSeniorMode(val);
  };

  // The switch is driven by `lockEnabled` from the provider, not local state, so
  // a cancelled or failed authentication simply leaves it where it was — there
  // is no optimistic flip to roll back.
  const toggleAppLock = async (val: boolean) => {
    const ok = await setLockEnabled(val);
    if (!ok) {
      showAlert({
        title: val ? t('settings.appLockOnFailed') : t('settings.appLockOffFailed'),
        message: t('settings.appLockFailedMessage'),
        type: 'error',
      });
    }
  };

  const handleBack = () => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace('/(tabs)');
    }
  };

  const handleLogout = () => {
    showAlert({
      title: t('settings.logout'),
      message: t('settings.logoutConfirm'),
      type: 'confirm',
      buttons: [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('settings.logout'),
          style: 'destructive',
          onPress: () => logout().then(() => router.replace('/(auth)/login')),
        },
      ],
    });
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.bg }]}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[styles.scrollContent, { paddingTop: topInset + 16, paddingBottom: bottomInset + 20 }]}
      >
        <View style={styles.headerRow}>
          <Pressable onPress={handleBack} hitSlop={10} testID="settings-back">
            <Ionicons name="arrow-back" size={24} color={colors.text} />
          </Pressable>
          <Text style={[styles.screenTitle, { color: colors.text }]}>{t('settings.title')}</Text>
          <View style={{ width: 24 }} />
        </View>

        <Pressable
          onPress={() => router.push('/profile')}
          style={[styles.profileCard, { backgroundColor: colors.card, borderColor: colors.border }]}
        >
          <View style={[styles.avatarCircle, { backgroundColor: colors.accentDim }]}>
            {(user as any)?.avatarUrl ? (
              <Image source={{ uri: (user as any).avatarUrl }} style={styles.avatarImage} />
            ) : (
              <Ionicons name="person" size={28} color={colors.accent} />
            )}
          </View>
          <View style={styles.profileInfo}>
            <Text style={[styles.profileName, { color: colors.text }]}>{user?.name || t('common.user')}</Text>
            <Text style={[styles.profileEmail, { color: colors.textSecondary }]}>{user?.email || 'user@email.com'}</Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={colors.textTertiary} />
        </Pressable>

        <Text style={[styles.sectionLabel, { color: colors.textSecondary }]}>{t('settings.appearance')}</Text>
        <View style={[styles.settingsGroup, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <SettingRow
            icon="moon"
            label={t('settings.darkMode')}
            colors={colors}
            rightElement={
              <Switch
                value={isDark}
                onValueChange={toggleTheme}
                trackColor={{ false: colors.inputBorder, true: colors.accent + '50' }}
                thumbColor={isDark ? colors.accent : '#ccc'}
              />
            }
          />
          <SettingRow
            icon="accessibility"
            label={t('settings.seniorMode')}
            colors={colors}
            rightElement={
              <Switch
                value={isSeniorMode}
                onValueChange={toggleSeniorMode}
                trackColor={{ false: colors.inputBorder, true: colors.accent + '50' }}
                thumbColor={isSeniorMode ? colors.accent : '#ccc'}
              />
            }
          />
          <View style={{ paddingHorizontal: 16, paddingBottom: 16 }}>
            <Text style={{ fontFamily: 'Inter_400Regular', fontSize: 13, color: colors.textSecondary, lineHeight: 18 }}>
              {t('settings.seniorModeHint')}
            </Text>
          </View>
        </View>

        <Text style={[styles.sectionLabel, { color: colors.textSecondary }]}>{t('settings.preferences')}</Text>
        <View style={[styles.settingsGroup, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <SettingRow
            icon="cash"
            label={t('settings.currency')}
            colors={colors}
            onPress={() => setShowCurrencyPicker(true)}
            rightElement={
              <Pressable onPress={() => setShowCurrencyPicker(true)} style={styles.currencyBadge}>
                <Text style={[styles.currencyBadgeText, { color: colors.accent }]}>
                  {currentCurrency.symbol} {currentCurrency.code}
                </Text>
                <Ionicons name="chevron-forward" size={16} color={colors.textTertiary} />
              </Pressable>
            }
          />
          <SettingRow
            icon="language"
            label={t('settings.language')}
            colors={colors}
            onPress={() => setShowLanguagePicker(true)}
            rightElement={
              <Pressable onPress={() => setShowLanguagePicker(true)} style={styles.currencyBadge}>
                <Text style={[styles.currencyBadgeText, { color: colors.accent }]}>
                  {currentLanguage.nativeLabel}
                </Text>
                <Ionicons name="chevron-forward" size={16} color={colors.textTertiary} />
              </Pressable>
            }
          />
          <SettingRow
            icon="wallet-outline"
            label={t('settings.monthlyBudget')}
            colors={colors}
            onPress={() => {
              setBudgetInput(monthlyBudget ? String(Math.round(convertForDisplay(monthlyBudget))) : '');
              setShowBudgetModal(true);
            }}
            rightElement={
              <Pressable
                onPress={() => {
                  setBudgetInput(monthlyBudget ? String(Math.round(convertForDisplay(monthlyBudget))) : '');
                  setShowBudgetModal(true);
                }}
                style={styles.currencyBadge}
              >
                <Money style={[styles.currencyBadgeText, { color: colors.accent }]}>
                  {formatAmount(monthlyBudget || 0)}
                </Money>
                <Ionicons name="chevron-forward" size={16} color={colors.textTertiary} />
              </Pressable>
            }
          />
        </View>

        <Text style={[styles.sectionLabel, { color: colors.textSecondary }]}>{t('settings.subscription')}</Text>
        <View style={[styles.settingsGroup, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <SettingRow
            icon="pricetags-outline"
            label={t('settings.managePlan')}
            onPress={() => router.push('/subscription' as any)}
            colors={colors}
            rightElement={
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <PlanBadge plan={currentPlan} trial={isTrialProvidingPlan} size="sm" />
                <Ionicons name="chevron-forward" size={18} color={colors.textTertiary} />
              </View>
            }
          />
        </View>

        {/*
          Hidden entirely when the device can't do this — no biometric hardware,
          nothing enrolled, or the web build. A visible toggle that cannot work
          reads as a broken feature, so there simply isn't one.
        */}
        {lockSupported && (
          <>
            <Text style={[styles.sectionLabel, { color: colors.textSecondary }]}>{t('settings.security')}</Text>
            <View style={[styles.settingsGroup, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <SettingRow
                icon={biometricIcon(biometricKind)}
                label={t('settings.appLock')}
                colors={colors}
                rightElement={
                  <Switch
                    value={lockEnabled}
                    onValueChange={toggleAppLock}
                    trackColor={{ false: colors.inputBorder, true: colors.accent + '50' }}
                    thumbColor={lockEnabled ? colors.accent : '#ccc'}
                  />
                }
              />
              <View style={{ paddingHorizontal: 16, paddingBottom: 16 }}>
                <Text style={{ fontFamily: 'Inter_400Regular', fontSize: 13, color: colors.textSecondary, lineHeight: 18 }}>
                  {t('settings.appLockHint', { method: biometricLabel(biometricKind, t).toLowerCase() })}
                </Text>
              </View>
            </View>
          </>
        )}

        <Text style={[styles.sectionLabel, { color: colors.textSecondary }]}>{t('settings.general')}</Text>
        <View style={[styles.settingsGroup, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <SettingRow icon="notifications-outline" label={t('settings.notifications')} onPress={() => router.push('/notifications')} colors={colors} />
          <SettingRow icon="shield-checkmark-outline" label={t('settings.privacy')} onPress={() => router.push('/privacy')} colors={colors} />
          <SettingRow icon="help-circle-outline" label={t('settings.helpSupport')} onPress={() => router.push('/support')} colors={colors} />
        </View>

        <Text style={[styles.sectionLabel, { color: colors.textSecondary }]}>{t('settings.account')}</Text>
        <View style={[styles.settingsGroup, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <SettingRow icon="log-out-outline" label={t('settings.logout')} onPress={handleLogout} danger colors={colors} />
        </View>

        <Text style={[styles.versionText, { color: colors.textTertiary }]}>LifeWise v1.0.0</Text>
      </ScrollView>

      <CustomModal visible={showCurrencyPicker} onClose={() => setShowCurrencyPicker(false)} showCloseButton={false}>
        <Text style={[styles.modalTitle, { color: colors.text }]}>{t('settings.selectCurrency')}</Text>
        {CURRENCIES.map(curr => (
          <Pressable
            key={curr.code}
            onPress={() => {
              setCurrency(curr.code);
              // Mirror to the server so reminder EMAILS use this currency too —
              // the backend has no other way to know what the user picked.
              // Fire-and-forget: the in-app switch is local and must not wait
              // on the network, and a failed sync only affects email rendering.
              void updateProfile({ preferredCurrency: curr.code });
              setShowCurrencyPicker(false);
            }}
            style={[
              styles.currencyRow,
              { borderBottomColor: colors.border },
              curr.code === currentCurrency.code && { backgroundColor: colors.accentDim },
            ]}
          >
            <Text style={[styles.currencySymbol, { color: colors.accent }]}>{curr.symbol}</Text>
            <View style={styles.currencyInfo}>
              <Text style={[styles.currencyCode, { color: colors.text }]}>{curr.code}</Text>
              <Text style={[styles.currencyName, { color: colors.textSecondary }]}>{curr.name}</Text>
            </View>
            {curr.code === currentCurrency.code && (
              <Ionicons name="checkmark-circle" size={22} color={colors.accent} />
            )}
          </Pressable>
        ))}
        <Pressable onPress={() => setShowCurrencyPicker(false)} style={[styles.cancelBtn, { borderColor: colors.border }]}>
          <Text style={[styles.cancelBtnText, { color: colors.textSecondary }]}>{t('common.cancel')}</Text>
        </Pressable>
      </CustomModal>

      <CustomModal visible={showLanguagePicker} onClose={() => setShowLanguagePicker(false)} showCloseButton={false}>
        <Text style={[styles.modalTitle, { color: colors.text }]}>{t('settings.selectLanguage')}</Text>
        {languages.map(lang => (
          <Pressable
            key={lang.code}
            onPress={() => {
              setLanguage(lang.code);
              // Same rationale as the currency sync above: the server has no
              // other way to know which language to render emails/notifications
              // in. NOT YET CONSUMED server-side — see
              // backend-team/I18N-backend-requirements.md.
              void updateProfile({ preferredLanguage: lang.code });
              setShowLanguagePicker(false);
            }}
            style={[
              styles.currencyRow,
              { borderBottomColor: colors.border },
              lang.code === currentLanguage.code && { backgroundColor: colors.accentDim },
            ]}
          >
            <View style={styles.currencyInfo}>
              <Text style={[styles.currencyCode, { color: colors.text }]}>{lang.nativeLabel}</Text>
              <Text style={[styles.currencyName, { color: colors.textSecondary }]}>{lang.label}</Text>
            </View>
            {lang.code === currentLanguage.code && (
              <Ionicons name="checkmark-circle" size={22} color={colors.accent} />
            )}
          </Pressable>
        ))}
        <Pressable onPress={() => setShowLanguagePicker(false)} style={[styles.cancelBtn, { borderColor: colors.border }]}>
          <Text style={[styles.cancelBtnText, { color: colors.textSecondary }]}>{t('common.cancel')}</Text>
        </Pressable>
      </CustomModal>

      <CustomModal visible={showBudgetModal} onClose={() => setShowBudgetModal(false)} showCloseButton={false}>
        <Text style={[styles.modalTitle, { color: colors.text }]}>{t('settings.setMonthlyBudget')}</Text>
        <Text style={[styles.budgetHint, { color: colors.textSecondary }]}>
          {t('settings.monthlyBudgetHint')}
        </Text>
        <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'center' }}>
          <TextInput
            style={{
              fontFamily: 'Inter_600SemiBold',
              fontSize: 24,
              color: colors.text,
              textAlign: 'right',
            }}
            value={budgetInput}
            onChangeText={(t: string) => setBudgetInput(t.replace(/[^0-9]/g, ''))}
            keyboardType="number-pad"
            placeholder="0"
            placeholderTextColor={colors.textTertiary}
          />
          <Text
            style={[
              styles.currencyCode,
              { color: colors.textSecondary, fontSize: 14, marginLeft: 6 },
            ]}
          >
            {currentCurrency.code}
          </Text>
        </View>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 14 }}>
          {/*
            Presets are INR (the storage currency), so both the label and the
            value written into the box must be converted — otherwise a user on
            USD sees "$116" on a button that fills the field with 10000.
          */}
          {[10000, 25000, 50000].map((preset) => (
            <Pressable
              key={preset}
              onPress={() => setBudgetInput(String(Math.round(convertForDisplay(preset))))}
              style={[styles.budgetPreset, { borderColor: colors.border }]}
            >
              <Money style={[styles.budgetPresetText, { color: colors.textSecondary }]}>
                {formatAmount(preset)}
              </Money>
            </Pressable>
          ))}
        </View>
        <Pressable
          onPress={async () => {
            const typed = parseInt(budgetInput.replace(/[^0-9]/g, ''), 10);
            if (Number.isNaN(typed) || typed <= 0) {
              setBudgetInput(String(Math.round(convertForDisplay(monthlyBudget || 0))));
              setShowBudgetModal(false);
              return;
            }
            // The field is in the user's currency; the budget is stored in INR.
            await setMonthlyBudget(Math.round(convertForStorage(typed)));
            setShowBudgetModal(false);
          }}
          style={[styles.cancelBtn, { borderColor: colors.border, marginTop: 20, backgroundColor: colors.accent }]}
        >
          <Text style={[styles.cancelBtnText, { color: '#FFFFFF' }]}>{t('settings.saveBudget')}</Text>
        </Pressable>
        <Pressable
          onPress={() => setShowBudgetModal(false)}
          style={[styles.cancelBtn, { borderColor: colors.border }]}
        >
          <Text style={[styles.cancelBtnText, { color: colors.textSecondary }]}>{t('common.cancel')}</Text>
        </Pressable>
      </CustomModal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scrollContent: { paddingHorizontal: 20 },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 24,
  },
  screenTitle: {
    fontFamily: 'Inter_700Bold',
    fontSize: 20,
  },
  profileCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 20,
    borderRadius: 16,
    borderWidth: 1,
    marginBottom: 28,
    gap: 16,
  },
  avatarCircle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  avatarImage: {
    width: '100%',
    height: '100%',
  },
  profileInfo: { flex: 1 },
  profileName: {
    fontFamily: 'Inter_700Bold',
    fontSize: 18,
    marginBottom: 4,
  },
  profileEmail: {
    fontFamily: 'Inter_400Regular',
    fontSize: 13,
  },
  sectionLabel: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 12,
    letterSpacing: 0.5,
    marginBottom: 10,
  },
  settingsGroup: {
    borderRadius: 16,
    borderWidth: 1,
    overflow: 'hidden',
    marginBottom: 24,
  },
  settingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
  },
  settingLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  settingIcon: {
    width: 34,
    height: 34,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  settingLabel: {
    fontFamily: 'Inter_500Medium',
    fontSize: 15,
  },
  currencyBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  currencyBadgeText: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 14,
  },
  versionText: {
    fontFamily: 'Inter_400Regular',
    fontSize: 12,
    textAlign: 'center',
    marginTop: 8,
  },
  modalContainer: { paddingHorizontal: 24, paddingBottom: 24 },
  modalTitle: { fontFamily: 'Inter_700Bold', fontSize: 20, textAlign: 'center', marginBottom: 16 },
  currencyRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 14, paddingHorizontal: 16, borderBottomWidth: 1, borderRadius: 12, gap: 14, marginBottom: 2 },
  currencySymbol: { fontFamily: 'Inter_700Bold', fontSize: 22, width: 32, textAlign: 'center' },
  currencyInfo: { flex: 1 },
  currencyCode: { fontFamily: 'Inter_600SemiBold', fontSize: 16 },
  currencyName: { fontFamily: 'Inter_400Regular', fontSize: 12, marginTop: 2 },
  cancelBtn: { marginTop: 12, borderRadius: 14, borderWidth: 1, paddingVertical: 16, alignItems: 'center' },
  cancelBtnText: { fontFamily: 'Inter_600SemiBold', fontSize: 15 },
  budgetHint: {
    fontFamily: 'Inter_400Regular',
    fontSize: 13,
    marginBottom: 14,
    textAlign: 'center',
  },
  budgetInputBox: {
    borderRadius: 16,
    borderWidth: 1,
    paddingVertical: 14,
    paddingHorizontal: 16,
    alignItems: 'center',
  },
  budgetPreset: {
    flex: 1,
    borderRadius: 12,
    borderWidth: 1,
    paddingVertical: 10,
    alignItems: 'center',
    marginHorizontal: 4,
  },
  budgetPresetText: {
    fontFamily: 'Inter_500Medium',
    fontSize: 13,
  },
});
