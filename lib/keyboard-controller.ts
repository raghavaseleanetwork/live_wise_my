import React from 'react';
import Constants from 'expo-constants';

/**
 * Single seam over `react-native-keyboard-controller`.
 *
 * That library is a native module. Expo Go ships a fixed set of native modules
 * and this is not one of them, so importing it there throws
 * `KeyboardControllerNative.getConstants is not a function` at module scope —
 * before any component renders. Because `KeyboardProvider` wraps `ThemeProvider`
 * in `app/_layout.tsx`, that single throw took down the entire tree: the layout
 * failed to export, and every child then reported "useTheme must be used within
 * a ThemeProvider". One missing native module, three unrelated-looking errors.
 *
 * In Expo Go we fall back to React Native's built-in keyboard handling. The
 * keyboard still works; it just lacks the smooth interactive animations the
 * library adds. In a dev/production build the real implementation is used
 * unchanged.
 *
 * Everything here resolves at module load and is `require`d lazily, so the
 * native module is never touched in Expo Go.
 */

/** Matches the detection already used in `lib/notifications.ts`. */
export const isExpoGo = Constants.appOwnership === 'expo';

/**
 * True when the real native keyboard controller is available.
 * Web has no native module either, but the library ships a web build, so only
 * Expo Go is excluded.
 */
export const hasNativeKeyboardController = !isExpoGo;

type AnyProps = Record<string, any>;

/**
 * Loads the library only when it can actually work.
 *
 * The `require` is inside a try/catch as well as behind the Expo Go check: a
 * bare `import` would be hoisted and evaluated regardless of the branch, which
 * is exactly the crash being avoided. The catch is a second line of defence for
 * any build where the native side is present but not linked.
 */
function loadModule(): AnyProps | null {
  if (!hasNativeKeyboardController) return null;
  try {
    return require('react-native-keyboard-controller');
  } catch {
    return null;
  }
}

const mod = loadModule();

/**
 * `KeyboardProvider` when available, otherwise a pass-through.
 *
 * The fallback renders children directly rather than a `View` — the provider is
 * a context boundary, not a layout element, so wrapping in a `View` here would
 * silently change flex behaviour in Expo Go only.
 */
export const KeyboardProvider: React.ComponentType<{ children?: React.ReactNode }> =
  mod?.KeyboardProvider ??
  (({ children }: { children?: React.ReactNode }) =>
    children as React.ReactElement | null);

/**
 * The library's `KeyboardAwareScrollView`, or `null` when unavailable so callers
 * can substitute a plain `ScrollView`.
 */
export const KeyboardAwareScrollView: React.ComponentType<AnyProps> | null =
  mod?.KeyboardAwareScrollView ?? null;

/**
 * The library's `KeyboardAvoidingView`, or `null` when unavailable so callers
 * can substitute React Native's own `KeyboardAvoidingView`.
 */
export const KeyboardAvoidingView: React.ComponentType<AnyProps> | null =
  mod?.KeyboardAvoidingView ?? null;
