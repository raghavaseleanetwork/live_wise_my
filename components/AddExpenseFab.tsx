import React, { useCallback, useEffect, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
  interpolate,
  Easing,
} from 'react-native-reanimated';
import { useTheme } from '@/lib/theme-context';

/**
 * Expanding action button for expense entry — sits above the pill tab bar.
 *
 * Collapsed it is a single "+". Tapping fans the entry methods out vertically
 * above it and turns the trigger into an X, per the client's reference design.
 *
 * This exists because the entry methods had been bolted onto whatever home-screen
 * affordance was nearest — "Add Expense" was sharing state with a reminder
 * dialog, and scan/voice were reachable only from unrelated circles. One
 * dedicated launcher gives all of Methods 1-6 a single predictable home and
 * leaves the home screen's own actions alone.
 */

export interface FabAction {
  key: string;
  icon: string;
  label: string;
  onPress: () => void;
  /** Tint for the icon; falls back to the theme accent. */
  color?: string;
}

interface AddExpenseFabProps {
  actions: FabAction[];
  /** Extra offset when a screen renders its own bottom bar above the tab bar. */
  extraBottom?: number;
}

const SIZE = 56;
const ITEM_SIZE = 46;
const GAP = 12;

/**
 * Extra bottom padding a scrolling screen needs so its last row isn't hidden
 * behind the collapsed button. Add this to `useTabBarContentInset().bottom`.
 */
export const FAB_CONTENT_INSET = SIZE + 18;

export default function AddExpenseFab({ actions, extraBottom = 0 }: AddExpenseFabProps) {
  const { colors, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const [open, setOpen] = useState(false);
  // Kept mounted through the close animation so items animate out rather than
  // vanishing the instant `open` flips.
  const [visible, setVisible] = useState(false);

  const progress = useSharedValue(0);

  useEffect(() => {
    if (open) {
      setVisible(true);
      // Higher stiffness / lower mass = a spring that visually settles fast.
      // The previous values (damping 15, stiffness 190) looked soft and, combined
      // with the per-item stagger below, meant the top item didn't finish
      // appearing until well after the button itself felt "done" — read as lag.
      progress.value = withSpring(1, { damping: 18, stiffness: 320, mass: 0.4 });
    } else {
      progress.value = withTiming(0, { duration: 140, easing: Easing.out(Easing.quad) });
      const t = setTimeout(() => setVisible(false), 150);
      return () => clearTimeout(t);
    }
  }, [open, progress]);

  const toggle = useCallback(() => {
    if (Platform.OS !== 'web') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    setOpen((v) => !v);
  }, []);

  const runAction = useCallback((action: FabAction) => {
    setOpen(false);
    // Let the collapse begin before navigating, so the sheet/route transition
    // doesn't fight the fan-out animation.
    setTimeout(() => action.onPress(), 60);
  }, []);

  // Sit clear of the pill tab bar. These mirror app/(tabs)/_layout.tsx —
  // bottom: 12 + inset, height: 64, marginHorizontal: 32 — so if the tab bar
  // geometry changes there, change it here too.
  const TAB_BAR_HEIGHT = 64;
  const TAB_BAR_BOTTOM = 12;
  const TAB_BAR_GUTTER = 32;

  const bottom =
    (insets.bottom || 0) + TAB_BAR_BOTTOM + TAB_BAR_HEIGHT + 18 + extraBottom;
  // Align to the tab bar's own right edge rather than the screen edge, so the
  // button reads as belonging to the same layer instead of floating loose.
  const right = TAB_BAR_GUTTER + (insets.right || 0);

  // Tall enough to hold the trigger plus every fanned-out item. Mirrors the
  // `offset` formula in FabItem for the top-most item (stackIndex === length).
  const stackHeight =
    actions.length > 0
      ? SIZE + GAP + (actions.length - 1) * (ITEM_SIZE + GAP) + ITEM_SIZE
      : SIZE;

  const triggerStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${interpolate(progress.value, [0, 1], [0, 135])}deg` }],
  }));

  const scrimStyle = useAnimatedStyle(() => ({
    opacity: progress.value * 0.5,
  }));

  return (
    // Single positioned root so the scrim and the button stack in one explicit
    // context instead of relying on zIndex/elevation to agree across two
    // separate top-level siblings — that gap was letting the scrim's full-screen
    // Pressable win the touch over the trigger on some Android compositing
    // paths, which is part of the "sometimes not clickable" report.
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      {/* Tap-anywhere-to-close scrim. Rendered only while open so it never
          swallows touches on the screen underneath. */}
      {visible && (
        <Animated.View style={[styles.scrim, { backgroundColor: '#000' }, scrimStyle]}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setOpen(false)} />
        </Animated.View>
      )}

      {/* Explicit height so the fanned-out items stay INSIDE the wrap's bounds.
          Android does not deliver touches to children rendered outside their
          parent's box, so an auto-sized (trigger-height) wrap silently ate
          every tap on the expanded items. */}
      <View
        style={[styles.wrap, { right, bottom, height: stackHeight }]}
        pointerEvents="box-none"
      >
        {visible &&
          actions.map((action, index) => (
            <FabItem
              key={action.key}
              action={action}
              index={index}
              total={actions.length}
              progress={progress}
              colors={colors}
              isDark={isDark}
              onPress={() => runAction(action)}
            />
          ))}

        <Pressable
          onPress={toggle}
          accessibilityRole="button"
          accessibilityLabel={open ? 'Close add menu' : 'Add expense'}
          accessibilityState={{ expanded: open }}
          style={[
            styles.trigger,
            {
              backgroundColor: colors.accent,
              shadowOpacity: isDark ? 0.45 : 0.25,
            },
          ]}
        >
          <Animated.View style={triggerStyle}>
            <Ionicons name="add" size={30} color="#FFFFFF" />
          </Animated.View>
        </Pressable>
      </View>
    </View>
  );
}

function FabItem({
  action,
  index,
  total,
  progress,
  colors,
  isDark,
  onPress,
}: {
  action: FabAction;
  index: number;
  total: number;
  progress: Animated.SharedValue<number>;
  colors: any;
  isDark: boolean;
  onPress: () => void;
}) {
  // Bottom-most item is closest to the trigger, so stagger from the bottom up.
  const stackIndex = total - index;
  const offset = SIZE + GAP + (stackIndex - 1) * (ITEM_SIZE + GAP);

  // Small, capped stagger. The previous 0.06-per-item delay ate up to 0.24 of
  // progress before the top item even started animating (5 items), on top of
  // an already-soft spring — the two combined read as "slow to expand".
  const startDelay = Math.min((total - stackIndex) * 0.035, 0.15);

  // Lay the item out at its FINAL resting position (`bottom: offset`) rather
  // than at the trigger and sliding it up with translateY. RN hit-testing uses
  // layout, not the animated transform, so a translated item's touch target
  // stays behind at bottom:0 — every item's hit box ended up stacked on the
  // same spot above the trigger, and the ones drawn higher (Import statement,
  // Recurring expenses, Add expense) could not be tapped at all. Animating
  // only opacity/scale keeps the fan-out look while the hit box stays put and
  // correct.
  const style = useAnimatedStyle(() => {
    const delayed = Math.max(0, Math.min(1, (progress.value - startDelay) / (1 - startDelay)));
    return {
      opacity: delayed,
      transform: [
        // Small residual rise, purely cosmetic — well inside the item's own
        // height, so the visual never separates from the touch target.
        { translateY: interpolate(delayed, [0, 1], [GAP, 0]) },
        { scale: interpolate(delayed, [0, 1], [0.4, 1]) },
      ],
    };
  });

  return (
    <Animated.View
      style={[styles.item, { bottom: offset }, style]}
      pointerEvents="box-none"
    >
      <View style={styles.itemRow} pointerEvents="box-none">
        <Pressable
          onPress={onPress}
          accessibilityRole="button"
          accessibilityLabel={action.label}
          style={[
            styles.itemBtn,
            {
              backgroundColor: isDark ? colors.cardElevated || colors.card : '#FFFFFF',
              borderColor: colors.border,
              shadowOpacity: isDark ? 0.4 : 0.18,
            },
          ]}
        >
          <Ionicons name={action.icon as any} size={20} color={action.color || colors.accent} />
        </Pressable>

        <View
          style={[
            styles.labelPill,
            { backgroundColor: isDark ? 'rgba(15,23,42,0.92)' : 'rgba(255,255,255,0.96)', borderColor: colors.border },
          ]}
        >
          <Text style={[styles.labelText, { color: colors.text }]} numberOfLines={1}>
            {action.label}
          </Text>
        </View>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  scrim: { ...StyleSheet.absoluteFillObject, zIndex: 40 },
  wrap: { position: 'absolute', zIndex: 50, alignItems: 'flex-end' },
  trigger: {
    // Pinned to the bottom of the (now taller) wrap so growing the wrap to
    // contain the fanned-out items does not move the button itself.
    position: 'absolute',
    bottom: 0,
    right: 0,
    width: SIZE,
    height: SIZE,
    borderRadius: SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowRadius: 12,
    elevation: 8,
  },
  // `bottom` is supplied per-item so each hit box sits where it is drawn.
  item: { position: 'absolute', right: 0 },
  // Label sits to the LEFT of the icon, so it grows inward from the right edge
  // instead of running off the screen.
  itemRow: { flexDirection: 'row-reverse', alignItems: 'center', gap: 10 },
  itemBtn: {
    width: ITEM_SIZE,
    height: ITEM_SIZE,
    borderRadius: ITEM_SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowRadius: 9,
    elevation: 6,
    // Centre each item under the wider trigger. The row is reversed, so the
    // offset goes on the right edge.
    marginRight: (SIZE - ITEM_SIZE) / 2,
  },
  labelPill: {
    paddingHorizontal: 11,
    paddingVertical: 6,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    maxWidth: 170,
  },
  labelText: { fontSize: 12, fontWeight: '600' },
});
