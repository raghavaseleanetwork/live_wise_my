import React from 'react';
import { StyleSheet, View, Text, ScrollView, Pressable, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@/lib/theme-context';

export default function PrivacyScreen() {
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
  const { colors } = useTheme();
  const topInset = Platform.OS === 'web' ? 67 : insets.top;

  return (
    <View style={[styles.container, { backgroundColor: colors.bg, paddingTop: topInset + 16 }]}>
      <View style={styles.headerRow}>
        <Pressable onPress={() => (router.canGoBack() ? router.back() : router.replace('/(tabs)'))} hitSlop={10}>
          <Ionicons name="arrow-back" size={24} color={colors.text} />
        </Pressable>
        <Text style={[styles.screenTitle, { color: colors.text }]}>{t('privacy.title')}</Text>
        <View style={{ width: 24 }} />
      </View>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 24, gap: 16 }}
        showsVerticalScrollIndicator={false}
      >
        <Text style={[styles.paragraph, styles.sectionTitle, { color: colors.text }]}>
          {t('privacy.intro')}
        </Text>

        <Text style={[styles.paragraphHeading, { color: colors.text }]}>{t('privacy.dataCollectionHeading')}</Text>
        <Text style={[styles.paragraph, { color: colors.textSecondary }]}>
          {t('privacy.dataCollectionBody')}
        </Text>

        <Text style={[styles.paragraphHeading, { color: colors.text }]}>{t('privacy.permissionsHeading')}</Text>
        <Text style={[styles.paragraph, { color: colors.textSecondary }]}>
          {t('privacy.permissionsBody1')}
        </Text>
        <Text style={[styles.paragraph, { color: colors.textSecondary }]}>
          {t('privacy.permissionsBody2')}
        </Text>

        <Text style={[styles.paragraphHeading, { color: colors.text }]}>{t('privacy.dataUsageHeading')}</Text>
        <Text style={[styles.paragraph, { color: colors.textSecondary }]}>
          {t('privacy.dataUsageBody')}
        </Text>
        <Text style={[styles.paragraph, { color: colors.textSecondary }]}>
          {t('privacy.dataNeverSold')}
        </Text>

        <Text style={[styles.paragraphHeading, { color: colors.text }]}>{t('privacy.securityHeading')}</Text>
        <Text style={[styles.paragraph, { color: colors.textSecondary }]}>
          {t('privacy.securityBody')}
        </Text>

        <Text style={[styles.paragraphHeading, { color: colors.text }]}>{t('privacy.contactHeading')}</Text>
        <Text style={[styles.paragraph, { color: colors.textSecondary }]}>
          {t('privacy.contactBody')}
        </Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    marginBottom: 12,
  },
  screenTitle: {
    fontFamily: 'Inter_700Bold',
    fontSize: 20,
  },
  paragraph: {
    fontFamily: 'Inter_400Regular',
    fontSize: 14,
    lineHeight: 20,
  },
  paragraphHeading: {
    fontFamily: 'Inter_700Bold',
    fontSize: 15,
    marginTop: 4,
  },
  sectionTitle: {
    fontFamily: 'Inter_400Regular',
    fontSize: 14,
    lineHeight: 20,
  },
});

