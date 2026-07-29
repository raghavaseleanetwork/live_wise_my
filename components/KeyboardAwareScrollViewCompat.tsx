// template
import { Platform, ScrollView, ScrollViewProps } from "react-native";
// Type-only import: erased at build time, so it never pulls the native module
// into the bundle. The runtime value comes from the guarded seam below.
import type { KeyboardAwareScrollViewProps } from "react-native-keyboard-controller";
import { KeyboardAwareScrollView } from "@/lib/keyboard-controller";

type Props = KeyboardAwareScrollViewProps & ScrollViewProps;

export function KeyboardAwareScrollViewCompat({
  children,
  keyboardShouldPersistTaps = "handled",
  ...props
}: Props) {
  // Plain ScrollView on web, and in Expo Go where the native controller is
  // absent and `KeyboardAwareScrollView` is therefore null.
  if (Platform.OS === "web" || !KeyboardAwareScrollView) {
    return (
      <ScrollView keyboardShouldPersistTaps={keyboardShouldPersistTaps} {...props}>
        {children}
      </ScrollView>
    );
  }
  return (
    <KeyboardAwareScrollView
      keyboardShouldPersistTaps={keyboardShouldPersistTaps}
      {...props}
    >
      {children}
    </KeyboardAwareScrollView>
  );
}
