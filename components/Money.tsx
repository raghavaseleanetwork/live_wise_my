import React, { useCallback, useState } from 'react';
import {
  ScrollView,
  Text,
  View,
  type LayoutChangeEvent,
  type NativeSyntheticEvent,
  type StyleProp,
  type TextLayoutEventData,
  type TextProps,
  type TextStyle,
} from 'react-native';

/**
 * A currency amount that always renders on one line.
 *
 * Currency conversion made amounts materially longer: `₹1.2L` is 5 characters,
 * the same figure in USD is `$1,519.49` at 9. Every screen in this app was laid
 * out against short rupee strings with fixed font sizes, so the longer forms
 * wrapped mid-number — the home hero broke "$1,519.49" across two lines with
 * the "9" alone on the second, which reads as a rendering fault rather than a
 * number.
 *
 * Wrapping is never the right answer for a currency figure: half a number on
 * one line and the rest on another is not a smaller version of the truth, it is
 * unreadable. So this shrinks to fit instead.
 *
 * `numberOfLines={1}` + `adjustsFontSizeToFit` is the combination that actually
 * works. Neither alone is enough:
 * - `numberOfLines` alone TRUNCATES with an ellipsis, turning ₹1,519 into
 *   "₹1,5…" — silently wrong rather than merely ugly.
 * - `adjustsFontSizeToFit` alone is ignored by React Native unless the line
 *   count is bounded.
 *
 * On Android `adjustsFontSizeToFit` needs an explicit `fontSize` to scale down
 * from; the style is resolved and a default supplied when a caller has not set
 * one, so the prop is never silently inert.
 *
 * ## Two-stage fit: shrink, then scroll
 *
 * Shrinking alone has a floor. Past roughly 50% the digits stop being legible,
 * so `minimumFontScale` caps how far it will go — and once that cap is hit, a
 * long enough amount (`₹12,34,567.89` in a third-width card) has nowhere left
 * to go and gets clipped at the card edge.
 *
 * So when the text still does not fit at its smallest allowed size, the amount
 * becomes horizontally scrollable in place: full size preserved, no digits
 * hidden, and the user can swipe the number itself to read the rest. This is
 * the fallback, not the default — scrolling is only offered when shrinking has
 * genuinely run out of room, because a number the user must swipe to read is
 * worse than one that merely got smaller.
 *
 * Detection uses `onTextLayout`, which reports the glyph runs React Native
 * actually laid out. Comparing the widest line against the measured container
 * width is what tells us the text overflowed even after scaling. `scrollable`
 * is opt-out via `scrollOnOverflow={false}` for callers inside an existing
 * horizontal scroll view, where a nested scroller would swallow the parent's
 * pan gesture.
 */

interface MoneyProps extends Omit<TextProps, 'numberOfLines' | 'style'> {
  children: React.ReactNode;
  style?: StyleProp<TextStyle>;
  /**
   * Smallest fraction of the original size this may shrink to. Below ~0.6 the
   * text is small enough that fitting it stops being a kindness.
   */
  minimumFontScale?: number;
  /**
   * When the amount still overflows at `minimumFontScale`, make it swipeable
   * rather than letting it clip. Pass `false` inside a horizontal ScrollView —
   * a nested horizontal scroller steals the parent's gesture.
   */
  scrollOnOverflow?: boolean;
}

/** Used when a caller's style has no fontSize — Android needs a concrete value. */
const DEFAULT_FONT_SIZE = 15;

/**
 * Sub-pixel slack. Text layout and view layout are measured by different passes
 * and routinely disagree by a fraction of a point on the same string; without a
 * tolerance that noise alone would flip perfectly-fitting amounts into scroll
 * mode.
 */
const OVERFLOW_EPSILON = 1;

export default function Money({
  children,
  style,
  minimumFontScale = 0.7,
  scrollOnOverflow = true,
  ...rest
}: MoneyProps) {
  const [availableWidth, setAvailableWidth] = useState(0);
  const [overflows, setOverflows] = useState(false);

  const handleLayout = useCallback((e: LayoutChangeEvent) => {
    setAvailableWidth(e.nativeEvent.layout.width);
  }, []);

  const handleTextLayout = useCallback(
    (e: NativeSyntheticEvent<TextLayoutEventData>) => {
      if (!scrollOnOverflow || !availableWidth) return;
      const lines = e.nativeEvent.lines;
      if (!lines?.length) return;
      const widest = Math.max(...lines.map((l) => l.width));
      setOverflows(widest > availableWidth + OVERFLOW_EPSILON);
    },
    [scrollOnOverflow, availableWidth]
  );

  const text = (
    <Text
      {...rest}
      style={[{ fontSize: DEFAULT_FONT_SIZE }, style]}
      numberOfLines={1}
      adjustsFontSizeToFit
      minimumFontScale={minimumFontScale}
      onTextLayout={scrollOnOverflow ? handleTextLayout : undefined}
    >
      {children}
    </Text>
  );

  if (!scrollOnOverflow) return text;

  // The wrapper measures the space the amount actually has. `minWidth: 0` lets
  // it shrink below its content inside a flex row — without it the wrapper
  // reports the text's natural width and nothing ever registers as overflowing.
  return (
    <View onLayout={handleLayout} style={{ minWidth: 0, flexShrink: 1 }}>
      {overflows ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          // The number is the content, not a scroll surface the user is meant
          // to fight — keep taps falling through to any enclosing Pressable.
          keyboardShouldPersistTaps="always"
        >
          {text}
        </ScrollView>
      ) : (
        text
      )}
    </View>
  );
}
