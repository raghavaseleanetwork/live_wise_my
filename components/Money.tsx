import React from 'react';
import { Text, type StyleProp, type TextProps, type TextStyle } from 'react-native';

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
 */

interface MoneyProps extends Omit<TextProps, 'numberOfLines' | 'style'> {
  children: React.ReactNode;
  style?: StyleProp<TextStyle>;
  /**
   * Smallest fraction of the original size this may shrink to. Below ~0.6 the
   * text is small enough that fitting it stops being a kindness.
   */
  minimumFontScale?: number;
}

/** Used when a caller's style has no fontSize — Android needs a concrete value. */
const DEFAULT_FONT_SIZE = 15;

export default function Money({
  children,
  style,
  minimumFontScale = 0.7,
  ...rest
}: MoneyProps) {
  return (
    <Text
      {...rest}
      style={[{ fontSize: DEFAULT_FONT_SIZE }, style]}
      numberOfLines={1}
      adjustsFontSizeToFit
      minimumFontScale={minimumFontScale}
    >
      {children}
    </Text>
  );
}
