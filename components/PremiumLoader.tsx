import React, { useEffect } from 'react';
import { View, StyleSheet, Platform, StyleProp, ViewStyle } from 'react-native';
import Animated, {
  useAnimatedStyle,
  withRepeat,
  withTiming,
  useSharedValue,
  interpolate,
  withDelay,
  Easing,
} from 'react-native-reanimated';
import { Image } from 'expo-image';
import resolveAssetSource from 'react-native/Libraries/Image/resolveAssetSource';
import { LinearGradient } from 'expo-linear-gradient';
import { BlurView } from 'expo-blur';
import { useTheme } from '@/lib/theme-context';

/**
 * The app's loading indicator — the ONLY loader used anywhere in the app.
 *
 * The LifeWise mark sits at the centre, framed by the glass disc and orbited by
 * the progress ring, at every size. There is deliberately no size threshold
 * that drops the logo: the brand mark is the loader, and a plain ring is a
 * second, unbranded loader by another name.
 *
 * `logo={false}` still exists as an explicit escape hatch, but nothing in the
 * app passes it. Do not reintroduce a raw `ActivityIndicator` — see the note in
 * `LoadingIndicator` below.
 */

/**
 * Orbit diameter of the rotating indicator, as a multiple of `size`.
 *
 * Two values because the thing being orbited differs. In the branded form the
 * gradient disc (radius `size * 0.5`) fully contains the logo's corners
 * (`size * 0.62 / 2 * sqrt2` ≈ `size * 0.44`), so the DISC is what must be
 * cleared: 1.15 puts the ball ~7.5px outside its rim, close enough to belong to
 * the badge without drifting toward the glass edge. Without the logo there is
 * nothing to clear, and pushing the ball out that far would leave it floating
 * detached from the small gradient disc — so the plain form keeps the original
 * tight orbit.
 */
/**
 * At or above this, a loader is treated as a full-screen/block instance and
 * keeps its full padding; below it, it is inline (inside a button or row) and
 * is rendered compact so it does not change the host's height.
 */
const LOGO_MIN_FULLSCREEN_SIZE = 60;

const ORBIT_RATIO_WITH_LOGO = 1.15;
const ORBIT_RATIO_PLAIN = 0.7;

/**
 * Shared source object. `expo-image` keys its memory/disk cache on this, so
 * every loader in the app resolves the same cached decode rather than
 * re-reading the PNG per mount. See `preloadBrandAssets()`.
 */
export const BRAND_LOGO = require('../logo.png');

/**
 * Warms the image cache so the logo is ready before the first loader paints.
 *
 * Without this the splash mounts, misses the cache, and pops the mark in a
 * frame or two later — the exact flicker a splash screen exists to prevent.
 * Safe to call more than once; `expo-image` de-duplicates by URI.
 *
 * `Image.prefetch` takes URIs, not module ids, so the bundled `require()` has
 * to be resolved first. In a release build that resolves to a local `file://`
 * (or `asset://`) path and this is close to free; the win is in development,
 * where Metro serves the asset over HTTP and the first decode is a real
 * round-trip.
 */
export async function preloadBrandAssets(): Promise<void> {
  try {
    const uri = resolveAssetSource(BRAND_LOGO)?.uri;
    if (uri) await Image.prefetch(uri);
  } catch {
    // A cold cache costs a frame of pop-in, never a crash — the loader still
    // renders. Deliberately swallowed so startup cannot fail on a warm-up.
  }
}

/**
 * Padding around the glass disc, as a multiple of `size`.
 *
 * The glass is `size * 1.6` and the ring-2 pulse scales to 1.6x of `size`, so
 * `size * 1.6` is the real drawn extent; 2.5 was chosen as comfortable breathing
 * room on the splash, where the loader sits alone on the screen. Inside a button
 * that slack is not free — it is laid-out height, and at `size={20}` it made a
 * 50px box where the label it replaces is ~19px tall, so the button visibly grew
 * the moment it started loading. `compact` drops the wrapper to the drawn extent
 * so the loader occupies only what it actually paints.
 */
const WRAPPER_RATIO = 2.5;
const WRAPPER_RATIO_COMPACT = 1.6;

interface PremiumLoaderProps {
  size?: number;
  text?: string;
  /** Force the logo on or off. Defaults to on at `size >= 60`. */
  logo?: boolean;
  /**
   * Shrink the outer box to the loader's drawn extent. For inline use — inside
   * buttons and rows — where the standard padding would push the container's
   * height around.
   */
  compact?: boolean;
}

export default function PremiumLoader({
  size = 64,
  text,
  logo,
  compact = false,
}: PremiumLoaderProps) {
  const { colors, isDark } = useTheme();
  const progress = useSharedValue(0);
  const ring2Progress = useSharedValue(0);

  const showLogo = logo ?? true;

  useEffect(() => {
    progress.value = withRepeat(
      withTiming(1, { duration: 2000, easing: Easing.bezier(0.4, 0, 0.2, 1) }),
      -1,
      true
    );
    ring2Progress.value = withRepeat(
      withDelay(400, withTiming(1, { duration: 2000, easing: Easing.out(Easing.ease) })),
      -1,
      true
    );
  }, []);

  const pulseStyle = useAnimatedStyle(() => {
    const scale = interpolate(progress.value, [0, 1], [0.85, 1.15]);
    const opacity = interpolate(progress.value, [0, 1], [0.4, 0.8]);
    return {
      transform: [{ scale }],
      opacity,
    };
  });

  const ring2Style = useAnimatedStyle(() => {
    const scale = interpolate(ring2Progress.value, [0, 1], [1, 1.6]);
    const opacity = interpolate(ring2Progress.value, [0, 1], [0.4, 0]);
    return {
      transform: [{ scale }],
      opacity,
    };
  });

  const rotateStyle = useAnimatedStyle(() => {
    return {
      transform: [{ rotate: `${progress.value * 360}deg` }],
    };
  });

  /**
   * The logo breathes on the same clock as the ring but at a much shallower
   * amplitude. Matching the ring's 0.85-1.15 would make the brand mark appear
   * to throb, which reads as cheap; a 3% swing just keeps it alive.
   */
  const logoStyle = useAnimatedStyle(() => {
    const scale = interpolate(progress.value, [0, 1], [0.97, 1.03]);
    return { transform: [{ scale }] };
  });

  const themeColors = isDark
    ? [colors.accent, colors.accentMint, colors.accentBlue]
    : [colors.accent, colors.accentBlue, colors.accentMint];

  /**
   * Logo size relative to the gradient disc behind it.
   *
   * The disc is `size`; at 0.86 the logo left only ~7px of gradient showing,
   * which read as a tight collar rather than a surround. 0.62 gives the disc a
   * visible margin on every side so it frames the mark. The logo's own badge is
   * the focal element — the gradient is its halo, not a second badge.
   */
  const logoTile = size * 0.62;
  const orbitRatio = showLogo ? ORBIT_RATIO_WITH_LOGO : ORBIT_RATIO_PLAIN;
  const wrapperRatio = compact ? WRAPPER_RATIO_COMPACT : WRAPPER_RATIO;

  return (
    <View style={styles.container}>
      <View style={[styles.loaderWrapper, { width: size * wrapperRatio, height: size * wrapperRatio }]}>
        {/* Outer Glow / Ring 2 */}
        <Animated.View style={[
          styles.ring2,
          { width: size, height: size, borderColor: colors.accent, borderRadius: size / 2 },
          ring2Style
        ]} />

        {/* Glass Container */}
        <BlurView
          intensity={Platform.OS === 'ios' ? 25 : 80}
          tint={isDark ? 'dark' : 'light'}
          style={[styles.glass, { width: size * 1.6, height: size * 1.6, borderRadius: size * 0.8 }]}
        >
          {/* Pulsing Gradient Ring */}
          <Animated.View style={[styles.outerRing, { width: size, height: size }, pulseStyle]}>
            <LinearGradient
              colors={themeColors as any}
              style={[styles.gradient, { borderRadius: size / 2, borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.2)' }]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
            />
          </Animated.View>

          {/*
            Brand mark, drawn directly with NO backing tile.
            `logo.png` is RGBA and ~63% fully transparent — it already carries
            its own rounded-square colour badge, and the padding around that
            badge is see-through. An earlier version put it on an opaque white
            tile on the assumption the white field was baked into the file; it
            is not, so that tile rendered as a second, larger white square
            around the logo's own badge. Verified by defiltering the PNG:
            corner pixels are [0,0,0,0].
          */}
          {showLogo && (
            <Animated.View
              style={[
                styles.logoWrap,
                { width: logoTile, height: logoTile },
                logoStyle,
              ]}
            >
              <Image
                source={BRAND_LOGO}
                style={styles.logoImage}
                contentFit="contain"
                // Held in memory so repeated loader mounts never re-decode.
                cachePolicy="memory-disk"
                transition={0}
              />
            </Animated.View>
          )}

          {/*
            Rotating Indicator. At the original 0.7 it orbited inside the logo
            and tracked visibly across the mark. It now rides outside the
            gradient disc — see ORBIT_RATIO_WITH_LOGO for the geometry.
          */}
          <Animated.View
            style={[
              styles.innerRing,
              !showLogo && styles.innerRingTrail,
              { width: size * orbitRatio, height: size * orbitRatio },
              rotateStyle,
            ]}
          >
            <View style={[styles.centerPoint, { backgroundColor: colors.accent, shadowColor: colors.accent }]} />
          </Animated.View>
        </BlurView>

        {text && (
          <Animated.Text style={[styles.message, { color: colors.textSecondary }]}>
            {text}
          </Animated.Text>
        )}
      </View>
    </View>
  );
}

/**
 * Drop-in replacement for `<ActivityIndicator />`.
 *
 * Exists so call sites that used the OS spinner can render the branded loader
 * without each one having to work out a pixel size: it accepts the same
 * `size="small" | "large"` vocabulary and maps it onto `PremiumLoader`.
 *
 * `color` is accepted and ignored — the loader draws itself from the theme's
 * accent gradient, and honouring an arbitrary colour would mean tinting the
 * brand mark. It stays in the signature only so replacing an `ActivityIndicator`
 * is a rename rather than a prop-by-prop rewrite.
 *
 * `compact` follows `size` unless set explicitly. `small` is the in-button /
 * in-row case, where the standard 2.5x wrapper visibly grows the button the
 * moment it starts loading; `large` is the full-screen case, where that
 * padding is the breathing room the loader is meant to have.
 */
export function LoadingIndicator({
  size = 'small',
  compact,
  text,
  style,
}: {
  size?: 'small' | 'large' | number;
  compact?: boolean;
  text?: string;
  /** Accepted for parity with ActivityIndicator; the loader is theme-coloured. */
  color?: string;
  style?: StyleProp<ViewStyle>;
}) {
  // 28 keeps an inline loader close to the ~19px cap height of the button label
  // it replaces; 64 is the component's own full-screen default.
  const resolved = typeof size === 'number' ? size : size === 'large' ? 64 : 28;
  const isInline = resolved < LOGO_MIN_FULLSCREEN_SIZE;
  const loader = <PremiumLoader size={resolved} compact={compact ?? isInline} text={text} />;
  return style ? <View style={style}>{loader}</View> : loader;
}

const styles = StyleSheet.create({
  container: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  loaderWrapper: {
    justifyContent: 'center',
    alignItems: 'center',
    position: 'relative',
  },
  glass: {
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  ring2: {
    position: 'absolute',
    borderWidth: 2,
  },
  outerRing: {
    borderRadius: 999,
    justifyContent: 'center',
    alignItems: 'center',
  },
  gradient: {
    width: '100%',
    height: '100%',
  },
  logoWrap: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoImage: {
    width: '100%',
    height: '100%',
  },
  innerRing: {
    position: 'absolute',
    borderRadius: 999,
    opacity: 0.9,
  },
  /**
   * The quarter-arc trail behind the ball. Only drawn in the plain (no-logo)
   * form: at the wider branded orbit this 3px white arc sweeps a quadrant
   * directly across the mark, which is the crowding the wider orbit exists to
   * avoid. Branded form shows the travelling dot alone.
   */
  innerRingTrail: {
    borderLeftWidth: 3,
    borderTopWidth: 3,
    borderColor: '#FFF',
  },
  centerPoint: {
    width: 6,
    height: 6,
    borderRadius: 3,
    position: 'absolute',
    top: -3,
    left: '50%',
    marginLeft: -3,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 1,
    shadowRadius: 10,
    elevation: 8,
  },
  message: {
    marginTop: 24,
    fontFamily: 'Inter_600SemiBold',
    fontSize: 14,
    letterSpacing: 0.5,
    textAlign: 'center',
  }
});
