import React, { useState, useRef } from 'react';
import {
  StyleSheet,
  Text,
  View,
  Pressable,
  Platform,
  FlatList,
  Dimensions,
  ViewToken,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useAuth } from '@/lib/auth-context';
import { useTheme } from '@/lib/theme-context';
import { useTranslation } from 'react-i18next';

const { width } = Dimensions.get('window');

const SLIDE_META = [
  { icon: 'analytics' as const, titleKey: 'onboarding.slide1Title', descriptionKey: 'onboarding.slide1Description', color: '#8B5CF6' },
  { icon: 'water' as const, titleKey: 'onboarding.slide2Title', descriptionKey: 'onboarding.slide2Description', color: '#3B82F6' },
  { icon: 'notifications' as const, titleKey: 'onboarding.slide3Title', descriptionKey: 'onboarding.slide3Description', color: '#F59E0B' },
];

function Slide({ item, colors, t }: { item: typeof SLIDE_META[0]; colors: any; t: (key: string) => string }) {
  return (
    <View style={[styles.slide, { width }]}>
      <View style={[styles.iconCircle, { backgroundColor: item.color + '15' }]}>
        <View style={[styles.iconInner, { backgroundColor: item.color + '25' }]}>
          <Ionicons name={item.icon} size={48} color={item.color} />
        </View>
      </View>
      <Text style={[styles.slideTitle, { color: colors.text }]}>{t(item.titleKey)}</Text>
      <Text style={[styles.slideDescription, { color: colors.textSecondary }]}>{t(item.descriptionKey)}</Text>
    </View>
  );
}

export default function OnboardingScreen() {
  const insets = useSafeAreaInsets();
  const { completeOnboarding } = useAuth();
  const { colors } = useTheme();
  const { t } = useTranslation();
  const [currentIndex, setCurrentIndex] = useState(0);
  const flatListRef = useRef<FlatList>(null);

  const topInset = Platform.OS === 'web' ? 67 : insets.top;
  const bottomInset = Platform.OS === 'web' ? 34 : Math.max(insets.bottom, 20);

  const onViewableItemsChanged = useRef(({ viewableItems }: { viewableItems: ViewToken[] }) => {
    if (viewableItems.length > 0 && viewableItems[0].index != null) {
      setCurrentIndex(viewableItems[0].index);
    }
  }).current;

  const viewabilityConfig = useRef({ viewAreaCoveragePercentThreshold: 50 }).current;

  const handleNext = () => {
    if (currentIndex < SLIDE_META.length - 1) {
      flatListRef.current?.scrollToIndex({ index: currentIndex + 1 });
    } else {
      handleGetStarted();
    }
  };

  const handleGetStarted = () => {
    completeOnboarding();
    router.replace('/(auth)/login');
  };

  const handleSkip = () => {
    handleGetStarted();
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.bg }]}>
      <View style={[styles.topBar, { paddingTop: topInset + 8 }]}>
        <View />
        <Pressable onPress={handleSkip} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Text style={[styles.skipText, { color: colors.textSecondary }]}>{t('onboarding.skip')}</Text>
        </Pressable>
      </View>

      <FlatList
        ref={flatListRef}
        data={SLIDE_META}
        renderItem={({ item }) => <Slide item={item} colors={colors} t={t} />}
        keyExtractor={(_, i) => i.toString()}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onViewableItemsChanged={onViewableItemsChanged}
        viewabilityConfig={viewabilityConfig}
        scrollEnabled={true}
      />

      <View style={[styles.bottomSection, { paddingBottom: bottomInset }]}>
        <View style={styles.dotsRow}>
          {SLIDE_META.map((_, i) => (
            <View
              key={i}
              style={[
                styles.dot,
                { backgroundColor: i === currentIndex ? colors.accent : colors.textTertiary },
                i === currentIndex && styles.dotActive,
              ]}
            />
          ))}
        </View>

        <Pressable onPress={handleNext} style={styles.nextBtnWrap}>
          <LinearGradient
            colors={[...colors.buttonGradient] as [string, string]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={styles.nextBtn}
          >
            <Text style={styles.nextBtnText}>
              {currentIndex === SLIDE_META.length - 1 ? t('onboarding.getStarted') : t('common.next')}
            </Text>
            <Ionicons name="arrow-forward" size={20} color="#FFFFFF" />
          </LinearGradient>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  topBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingBottom: 8,
  },
  skipText: {
    fontFamily: 'Inter_500Medium',
    fontSize: 15,
  },
  slide: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 40,
  },
  iconCircle: {
    width: 140,
    height: 140,
    borderRadius: 70,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 40,
  },
  iconInner: {
    width: 100,
    height: 100,
    borderRadius: 50,
    alignItems: 'center',
    justifyContent: 'center',
  },
  slideTitle: {
    fontFamily: 'Inter_700Bold',
    fontSize: 26,
    textAlign: 'center',
    marginBottom: 16,
  },
  slideDescription: {
    fontFamily: 'Inter_400Regular',
    fontSize: 16,
    textAlign: 'center',
    lineHeight: 24,
  },
  bottomSection: {
    paddingHorizontal: 24,
    gap: 24,
  },
  dotsRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 8,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  dotActive: {
    width: 24,
    borderRadius: 4,
  },
  nextBtnWrap: {
    borderRadius: 16,
    overflow: 'hidden',
  },
  nextBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 18,
    borderRadius: 16,
  },
  nextBtnText: {
    fontFamily: 'Inter_700Bold',
    fontSize: 17,
    color: '#FFFFFF',
  },
});
