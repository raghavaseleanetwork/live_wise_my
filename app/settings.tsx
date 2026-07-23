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
import { useAuth } from '@/lib/auth-context';
import { useTheme } from '@/lib/theme-context';
import { useCurrency, CURRENCIES, CurrencyOption } from '@/lib/currency-context';
import { useExpenses } from '@/lib/expense-context';
import { useSeniorMode } from '@/lib/senior-context';
import { useAlert } from '@/lib/alert-context';
import CustomModal from '@/components/CustomModal';

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
  const { user, logout } = useAuth();
  const { colors, mode, toggleTheme, isDark } = useTheme();
  const { currentCurrency, setCurrency, formatAmount } = useCurrency();
  const { monthlyBudget, setMonthlyBudget } = useExpenses();
  const { isSeniorMode, setSeniorMode } = useSeniorMode();
  const { showAlert } = useAlert();
  const [showCurrencyPicker, setShowCurrencyPicker] = useState(false);
  const [showBudgetModal, setShowBudgetModal] = useState(false);
  const [budgetInput, setBudgetInput] = useState(String(monthlyBudget || ''));

  const topInset = Platform.OS === 'web' ? 67 : insets.top;
  const bottomInset = Platform.OS === 'web' ? 34 : Math.max(insets.bottom, 20);

  const toggleSeniorMode = (val: boolean) => {
    setSeniorMode(val);
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
      title: 'Logout',
      message: 'Are you sure you want to logout?',
      type: 'confirm',
      buttons: [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Logout',
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
          <Text style={[styles.screenTitle, { color: colors.text }]}>Settings</Text>
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
            <Text style={[styles.profileName, { color: colors.text }]}>{user?.name || 'User'}</Text>
            <Text style={[styles.profileEmail, { color: colors.textSecondary }]}>{user?.email || 'user@email.com'}</Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={colors.textTertiary} />
        </Pressable>

        <Text style={[styles.sectionLabel, { color: colors.textSecondary }]}>Appearance</Text>
        <View style={[styles.settingsGroup, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <SettingRow
            icon="moon"
            label="Dark Mode"
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
            label="Senior Mode"
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
              Senior Mode makes the app easier to use with larger text, simple layout, and better visibility.
            </Text>
          </View>
        </View>

        <Text style={[styles.sectionLabel, { color: colors.textSecondary }]}>Preferences</Text>
        <View style={[styles.settingsGroup, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <SettingRow
            icon="cash"
            label="Currency"
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
            icon="wallet-outline"
            label="Monthly Budget"
            colors={colors}
            onPress={() => {
              setBudgetInput(String(monthlyBudget || ''));
              setShowBudgetModal(true);
            }}
            rightElement={
              <Pressable
                onPress={() => {
                  setBudgetInput(String(monthlyBudget || ''));
                  setShowBudgetModal(true);
                }}
                style={styles.currencyBadge}
              >
                <Text style={[styles.currencyBadgeText, { color: colors.accent }]}>
                  {formatAmount(monthlyBudget || 0)}
                </Text>
                <Ionicons name="chevron-forward" size={16} color={colors.textTertiary} />
              </Pressable>
            }
          />
        </View>

        <Text style={[styles.sectionLabel, { color: colors.textSecondary }]}>General</Text>
        <View style={[styles.settingsGroup, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <SettingRow icon="notifications-outline" label="Notifications" onPress={() => router.push('/notifications')} colors={colors} />
          <SettingRow icon="shield-checkmark-outline" label="Privacy" onPress={() => router.push('/privacy')} colors={colors} />
          <SettingRow icon="help-circle-outline" label="Help & Support" onPress={() => router.push('/support')} colors={colors} />
        </View>

        <Text style={[styles.sectionLabel, { color: colors.textSecondary }]}>Account</Text>
        <View style={[styles.settingsGroup, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <SettingRow icon="log-out-outline" label="Logout" onPress={handleLogout} danger colors={colors} />
        </View>

        <Text style={[styles.versionText, { color: colors.textTertiary }]}>LifeWise v1.0.0</Text>
      </ScrollView>

      <CustomModal visible={showCurrencyPicker} onClose={() => setShowCurrencyPicker(false)} showCloseButton={false}>
        <Text style={[styles.modalTitle, { color: colors.text }]}>Select Currency</Text>
        {CURRENCIES.map(curr => (
          <Pressable
            key={curr.code}
            onPress={() => { setCurrency(curr.code); setShowCurrencyPicker(false); }}
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
          <Text style={[styles.cancelBtnText, { color: colors.textSecondary }]}>Cancel</Text>
        </Pressable>
      </CustomModal>

      <CustomModal visible={showBudgetModal} onClose={() => setShowBudgetModal(false)} showCloseButton={false}>
        <Text style={[styles.modalTitle, { color: colors.text }]}>Set Monthly Budget</Text>
        <Text style={[styles.budgetHint, { color: colors.textSecondary }]}>
          This amount is used for the home screen budget bar and remaining balance.
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
          {[10000, 25000, 50000].map((preset) => (
            <Pressable
              key={preset}
              onPress={() => setBudgetInput(String(preset))}
              style={[styles.budgetPreset, { borderColor: colors.border }]}
            >
              <Text style={[styles.budgetPresetText, { color: colors.textSecondary }]}>
                {formatAmount(preset)}
              </Text>
            </Pressable>
          ))}
        </View>
        <Pressable
          onPress={async () => {
            const value = parseInt(budgetInput.replace(/[^0-9]/g, ''), 10);
            if (Number.isNaN(value) || value <= 0) {
              setBudgetInput(String(monthlyBudget || 0));
              setShowBudgetModal(false);
              return;
            }
            await setMonthlyBudget(value);
            setShowBudgetModal(false);
          }}
          style={[styles.cancelBtn, { borderColor: colors.border, marginTop: 20, backgroundColor: colors.accent }]}
        >
          <Text style={[styles.cancelBtnText, { color: '#FFFFFF' }]}>Save Budget</Text>
        </Pressable>
        <Pressable
          onPress={() => setShowBudgetModal(false)}
          style={[styles.cancelBtn, { borderColor: colors.border }]}
        >
          <Text style={[styles.cancelBtnText, { color: colors.textSecondary }]}>Cancel</Text>
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
    borderRadius: 20,
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
    textTransform: 'uppercase' as const,
    letterSpacing: 0.5,
    marginBottom: 10,
  },
  settingsGroup: {
    borderRadius: 18,
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
