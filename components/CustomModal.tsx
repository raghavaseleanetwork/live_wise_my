import React from 'react';
import {
  StyleSheet,
  View,
  Pressable,
  Modal,
  Platform,
  Dimensions,
  KeyboardAvoidingView,
} from 'react-native';
import { BlurView } from 'expo-blur';
import { Ionicons } from '@expo/vector-icons';
import Animated, {
  FadeIn,
  FadeOut,
} from 'react-native-reanimated';
import { useTheme } from '@/lib/theme-context';
import { useSeniorMode } from '@/lib/senior-context';

interface CustomModalProps {
  visible: boolean;
  onClose: () => void;
  children: React.ReactNode;
  height?: number | string;
  showCloseButton?: boolean;
  fullScreen?: boolean;
  backdropColor?: string;
}

const { height: SCREEN_HEIGHT } = Dimensions.get('window');

export default function CustomModal({
  visible,
  onClose,
  children,
  height = 'auto',
  showCloseButton = true,
  fullScreen = false,
  backdropColor,
}: CustomModalProps) {
  const { colors, isDark } = useTheme();
  const { isSeniorMode } = useSeniorMode();

  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      onRequestClose={onClose}
    >
      <View style={[styles.container, fullScreen && styles.fullScreenContainer]}>
        {visible && (
          <>
            <Animated.View
              entering={FadeIn.duration(300)}
              exiting={FadeOut.duration(200)}
              style={StyleSheet.absoluteFill}
            >
              {Platform.OS === 'ios' ? (
                <BlurView intensity={25} tint={isDark ? 'dark' : 'light'} style={StyleSheet.absoluteFill} />
              ) : (
                <View style={[StyleSheet.absoluteFill, { backgroundColor: backdropColor || 'rgba(0,0,0,0.5)' }]} />
              )}
              <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
            </Animated.View>

            <KeyboardAvoidingView
              behavior={Platform.OS === 'ios' ? 'padding' : undefined}
              style={[styles.keyboardView, fullScreen && styles.fullScreenContainer]}
            >
              <Animated.View
                entering={FadeIn.duration(150)}
                exiting={FadeOut.duration(150)}
                style={[
                  styles.modalCard,
                  {
                    backgroundColor: fullScreen ? (backdropColor || colors.bg) : colors.card,
                    borderColor: colors.border,
                    height: height as any,
                    maxHeight: SCREEN_HEIGHT * (fullScreen ? 1 : 0.85),
                    width: fullScreen ? '100%' : Math.min(Dimensions.get('window').width * 0.9, 400),
                  },
                  fullScreen && styles.fullScreenSheet,
                ]}
              >
                {!fullScreen && showCloseButton && (
                  <Pressable
                    onPress={onClose}
                    style={[
                      styles.closeBtn,
                      { backgroundColor: colors.border + '40' },
                      isSeniorMode && { width: 44, height: 44, borderRadius: 22 }
                    ]}
                  >
                    <Ionicons name="close" size={isSeniorMode ? 28 : 20} color={colors.text} />
                  </Pressable>
                )}

                <View style={[styles.content, fullScreen && { paddingTop: 60 }]}>
                  {children}
                </View>
              </Animated.View>
            </KeyboardAvoidingView>
          </>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  fullScreenContainer: {
    width: '100%',
    height: '100%',
  },
  keyboardView: {
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalCard: {
    borderRadius: 32,
    borderWidth: 1,
    paddingBottom: 24,
    overflow: 'hidden',
  },
  fullScreenSheet: {
    height: '100%',
    maxHeight: '100%',
    borderRadius: 0,
    borderTopWidth: 0,
    paddingBottom: 0,
  },
  closeBtn: {
    position: 'absolute',
    top: 24,
    // Matches `content`'s horizontal padding so the button lines up with the
    // modal's text gutter instead of sitting closer to the edge than the title.
    right: 24,
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10,
  },
  content: {
    paddingHorizontal: 24,
    paddingTop: 32,
  },
});
