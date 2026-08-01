import React, { useEffect } from 'react';
import { View, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
  withSpring,
  withDelay,
  Easing,
  interpolate,
} from 'react-native-reanimated';
import { CategoryType, CATEGORIES } from '@/lib/data';

interface CategoryIconProps {
  category: CategoryType;
  size?: number;
  color?: string;
  animate?: boolean;
}

const AnimatedIonicons = Animated.createAnimatedComponent(Ionicons);

const CategoryIcon = React.memo(({ 
  category, 
  size = 24, 
  color, 
  animate = true 
}: CategoryIconProps): React.ReactElement => {
  const safeCategory = (category || 'others').toLowerCase() as CategoryType;
  const catData = CATEGORIES[safeCategory] || CATEGORIES.others;
  const iconName = catData.icon;
  const iconColor = color || catData.color;

  // Animation shared values
  const scale = useSharedValue(1);
  const rotation = useSharedValue(0);
  const translateY = useSharedValue(0);
  const opacity = useSharedValue(1);

  useEffect(() => {
    if (!animate) return;

    // Category-specific animations
    switch (category) {
      case 'food':
        // Elastic scale bounce
        scale.value = withRepeat(
          withSequence(
            withSpring(1.25, { damping: 10, stiffness: 100 }),
            withSpring(1.0, { damping: 10, stiffness: 100 })
          ),
          -1,
          true
        );
        break;

      case 'health':
      case 'habits':
        // Heartbeat pulse
        scale.value = withRepeat(
          withSequence(
            withTiming(1.2, { duration: 400, easing: Easing.bezier(0.4, 0, 0.2, 1) }),
            withTiming(1.0, { duration: 600 })
          ),
          -1,
          true
        );
        break;

      case 'shopping':
        // Floating sway
        translateY.value = withRepeat(
          withSequence(
            withTiming(-5, { duration: 1200, easing: Easing.inOut(Easing.ease) }),
            withTiming(0, { duration: 1200, easing: Easing.inOut(Easing.ease) })
          ),
          -1,
          true
        );
        rotation.value = withRepeat(
          withSequence(
            withTiming(5, { duration: 1200 }),
            withTiming(-5, { duration: 1200 })
          ),
          -1,
          true
        );
        break;

      case 'bills':
      case 'finance':
      case 'education':
        // Gentle floating bounce
        translateY.value = withRepeat(
          withSequence(
            withTiming(-4, { duration: 1500, easing: Easing.inOut(Easing.ease) }),
            withTiming(0, { duration: 1500, easing: Easing.inOut(Easing.ease) })
          ),
          -1,
          true
        );
        break;

      case 'subscriptions':
      case 'entertainment':
        // Constant slow rotation with slight pulse
        rotation.value = withRepeat(
          withTiming(360, { duration: 8000, easing: Easing.linear }),
          -1,
          false
        );
        scale.value = withRepeat(
          withTiming(1.1, { duration: 2000 }),
          -1,
          true
        );
        break;

      case 'transport':
      case 'travel':
        // Moving shake/wiggle
        rotation.value = withRepeat(
          withSequence(
            withTiming(15, { duration: 150 }),
            withTiming(-15, { duration: 150 })
          ),
          4, // Just a few times
          true
        );
        // Then repeat every few seconds
        translateY.value = withRepeat(
          withSequence(
            withTiming(-2, { duration: 500 }),
            withTiming(0, { duration: 500 }),
            withDelay(2000, withTiming(0, { duration: 100 }))
          ),
          -1,
          true
        );
        break;

      case 'work':
      case 'tasks':
        // Subtle tilt wiggle
        rotation.value = withRepeat(
          withSequence(
            withTiming(10, { duration: 2000 }),
            withTiming(-10, { duration: 2000 })
          ),
          -1,
          true
        );
        break;

      case 'investment':
        // Rapid growth pulse
        scale.value = withRepeat(
          withSequence(
            withTiming(1.3, { duration: 800 }),
            withTiming(1.0, { duration: 800 })
          ),
          -1,
          true
        );
        break;

      case 'family':
      case 'events':
        // Gentle scale focus
        scale.value = withRepeat(
          withTiming(1.15, { duration: 3000, easing: Easing.inOut(Easing.ease) }),
          -1,
          true
        );
        break;

      default:
        // Floating scale focus for 'others'
        scale.value = withRepeat(
          withTiming(1.1, { duration: 2000, easing: Easing.inOut(Easing.ease) }),
          -1,
          true
        );
        opacity.value = withRepeat(
          withTiming(0.8, { duration: 2000 }),
          -1,
          true
        );
        break;
    }
  }, [category, animate]);

  const animatedStyle = useAnimatedStyle(() => {
    const transforms: any[] = [{ scale: scale.value }];
    
    if (rotation.value !== 0) {
      transforms.push({ rotate: `${rotation.value}deg` });
    }
    
    if (translateY.value !== 0) {
      transforms.push({ translateY: translateY.value });
    }

    return {
      opacity: opacity.value,
      transform: transforms,
    };
  });

  return (
    <Animated.View style={[styles.container, animatedStyle, { width: size, height: size }]}>
      <Ionicons
        name={iconName as any}
        size={size}
        color={iconColor}
        style={[styles.glyph, { width: size, height: size, lineHeight: size, fontSize: size }]}
      />
    </Animated.View>
  );
});

export default CategoryIcon;

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Icon fonts render a line box taller than `size`, and the overflow hangs
  // below — pinning lineHeight to size keeps the glyph centred in its wrapper.
  glyph: {
    textAlign: 'center',
    textAlignVertical: 'center',
    includeFontPadding: false,
  },
});
