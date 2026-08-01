import React from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';

import CustomModal from '@/components/CustomModal';
import { useTheme } from '@/lib/theme-context';

/**
 * Date/time picker that behaves correctly on both platforms.
 *
 * `@react-native-community/datetimepicker` is not one component but two, and
 * the difference is the whole reason this file exists:
 *
 * - **Android** — `<DateTimePicker>` is not a view. Mounting it opens the OS's
 *   own modal dialog immediately, and it dismisses itself when the user taps
 *   OK or Cancel. It renders nothing in the React tree.
 * - **iOS** — it IS a real inline view. It draws where it is placed and has no
 *   dismiss affordance of its own, so it needs a surrounding container with a
 *   Done button.
 *
 * Wrapping it in an app modal — the obvious-looking thing to do, and what
 * several screens did — is therefore correct on iOS and broken on Android: the
 * native dialog opens ON TOP of an app modal that renders as an empty shell
 * with a title and two dead buttons. That is the "Pick year" popup the client
 * reported: a stray empty card behind the real calendar, with a Cancel/Done
 * pair that fight the native OK/Cancel.
 *
 * This component renders the picker bare on Android and inside a modal on iOS,
 * so callers can express the intent once and get the right thing on both.
 */

interface DatePickerModalProps {
  visible: boolean;
  onClose: () => void;
  /** Title for the iOS container. Not shown on Android — the OS dialog has its own. */
  title?: string;
  value: Date;
  /** Fired with the chosen value when the user confirms. Never on cancel. */
  onConfirm: (date: Date) => void;
  mode?: 'date' | 'time';
  minimumDate?: Date;
  maximumDate?: Date;
}

export default function DatePickerModal({
  visible,
  onClose,
  title,
  value,
  onConfirm,
  mode = 'date',
  minimumDate,
  maximumDate,
}: DatePickerModalProps) {
  const { colors, isDark } = useTheme();

  // iOS holds the in-progress value so Done/Cancel can commit or discard it.
  // Android has no such step: its dialog's own OK IS the commit.
  const [draft, setDraft] = React.useState(value);

  // Re-seed whenever the picker is reopened, so it starts from the current
  // value rather than whatever was last scrolled to and cancelled.
  React.useEffect(() => {
    if (visible) setDraft(value);
  }, [visible, value]);

  if (!visible) return null;

  if (Platform.OS === 'android') {
    // No theming props here on purpose: `themeVariant`, `textColor` and
    // `accentColor` are iOS-only in this library. Android's dialog is styled by
    // the native app theme, so in dark mode it still renders as the stock
    // light-blue Material calendar. Fixing that means an Android theme change
    // (a `DialogTheme` in styles.xml via a config plugin), not a JS prop —
    // out of scope here, and NOT something a prop can achieve.
    return (
      <DateTimePicker
        value={value}
        mode={mode}
        display="default"
        minimumDate={minimumDate}
        maximumDate={maximumDate}
        onChange={(event, selected) => {
          // The Android dialog is already gone by the time this fires; closing
          // is bookkeeping so the caller's `visible` flag matches reality and
          // the picker can be reopened.
          onClose();
          if (event.type === 'dismissed' || !selected) return;
          onConfirm(selected);
        }}
      />
    );
  }

  return (
    <CustomModal visible={visible} onClose={onClose} showCloseButton={false}>
      {!!title && <Text style={[styles.title, { color: colors.text }]}>{title}</Text>}
      <View style={styles.pickerWrap}>
        <DateTimePicker
          value={draft}
          mode={mode}
          display="spinner"
          minimumDate={minimumDate}
          maximumDate={maximumDate}
          // iOS renders the picker inline, so it must follow the app's theme or
          // it shows black text on the dark modal.
          themeVariant={isDark ? 'dark' : 'light'}
          textColor={colors.text}
          onChange={(_, selected) => {
            if (selected) setDraft(selected);
          }}
        />
      </View>
      <View style={styles.actionsRow}>
        <Pressable onPress={onClose} style={styles.textBtn}>
          <Text style={[styles.textBtnLabel, { color: colors.textTertiary }]}>Cancel</Text>
        </Pressable>
        <Pressable
          onPress={() => {
            onConfirm(draft);
            onClose();
          }}
          style={[styles.primaryBtn, { backgroundColor: colors.accentDim }]}
        >
          <Text style={[styles.primaryBtnLabel, { color: colors.accent }]}>Done</Text>
        </Pressable>
      </View>
    </CustomModal>
  );
}

const styles = StyleSheet.create({
  title: {
    fontFamily: 'Inter_700Bold',
    fontSize: 18,
    textAlign: 'center',
  },
  pickerWrap: {
    paddingVertical: 16,
  },
  actionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 12,
  },
  textBtn: {
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  textBtnLabel: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 15,
  },
  primaryBtn: {
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 12,
  },
  primaryBtnLabel: {
    fontFamily: 'Inter_700Bold',
    fontSize: 15,
  },
});
