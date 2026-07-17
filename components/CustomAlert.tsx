import React, { useEffect, useState } from 'react';
import {
  StyleSheet,
  Text,
  View,
  Pressable,
  Platform,
  Dimensions,
} from 'react-native';
import { BlurView } from 'expo-blur';
import { Ionicons } from '@expo/vector-icons';
import Animated, {
  FadeIn,
  FadeOut,
} from 'react-native-reanimated';
import { useAlert } from '@/lib/alert-context';
import { useTheme } from '@/lib/theme-context';
import { useSeniorMode } from '@/lib/senior-context';

const { width } = Dimensions.get('window');
const MODAL_WIDTH = Math.min(width * 0.85, 340);

export default function CustomAlert() {
  const { visible, options, hideAlert } = useAlert();
  const { colors, isDark } = useTheme();
  const { isSeniorMode } = useSeniorMode();

  const handleButtonPress = (onPress?: () => void) => {
    hideAlert();
    if (onPress) {
      setTimeout(onPress, 100);
    }
  };

  return (
    <View 
      style={StyleSheet.absoluteFill} 
      pointerEvents={visible ? "auto" : "none"}
    >
      {visible && options && (() => {
        const { title, message, type = 'info', buttons = [] } = options;
        
        const getIcon = () => {
          switch (type) {
            case 'success':
              return { name: 'checkmark-circle' as const, color: colors.accentMint };
            case 'error':
              return { name: 'close-circle' as const, color: colors.danger };
            case 'warning':
              return { name: 'warning' as const, color: colors.warning };
            case 'confirm':
              return { name: 'help-circle' as const, color: colors.accent };
            default:
              return { name: 'information-circle' as const, color: colors.accentBlue };
          }
        };

        const icon = getIcon();
        const defaultButtons = buttons.length > 0 ? buttons : [{ text: 'OK', style: 'default' as const }];

        return (
          <>
            <Animated.View
              entering={FadeIn.duration(250)}
              exiting={FadeOut.duration(200)}
              style={StyleSheet.absoluteFill}
            >
              {Platform.OS === 'ios' ? (
                <BlurView intensity={20} tint={isDark ? 'dark' : 'light'} style={StyleSheet.absoluteFill} />
              ) : (
                <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.4)' }]} />
              )}
              <Pressable style={StyleSheet.absoluteFill} onPress={hideAlert} />
            </Animated.View>

            <View style={styles.centeredView}>
              <Animated.View
                entering={FadeIn.duration(150)}
                exiting={FadeOut.duration(150)}
                style={[
                  styles.alertCard,
                  {
                    backgroundColor: colors.card,
                    borderColor: colors.border,
                    width: isSeniorMode ? MODAL_WIDTH + 40 : MODAL_WIDTH,
                  },
                ]}
              >
                <View style={styles.content}>
                  <View style={[styles.iconWrap, { backgroundColor: icon.color + '15' }]}>
                    <Ionicons name={icon.name} size={isSeniorMode ? 40 : 32} color={icon.color} />
                  </View>
                  <Text style={[styles.title, { color: colors.text }, isSeniorMode && { fontSize: 24 }]}>
                    {title}
                  </Text>
                  {!!message && (
                    <Text style={[styles.message, { color: colors.textSecondary }, isSeniorMode && { fontSize: 18 }]}>
                      {message}
                    </Text>
                  )}
                </View>

                <View style={[styles.buttonRow, defaultButtons.length > 2 && styles.buttonColumn]}>
                  {defaultButtons.map((btn, idx) => {
                    const isDestructive = btn.style === 'destructive';
                    const isCancel = btn.style === 'cancel';
                    
                    return (
                      <Pressable
                        key={idx}
                        onPress={() => handleButtonPress(btn.onPress)}
                        style={({ pressed }) => [
                          styles.button,
                          defaultButtons.length > 2 ? styles.columnButton : styles.rowButton,
                          {
                            backgroundColor: isDestructive ? colors.dangerDim : isCancel ? 'transparent' : colors.accentDim,
                            borderColor: isDestructive ? colors.danger + '40' : isCancel ? colors.border : colors.accent + '40',
                            borderWidth: isCancel ? 1 : 1,
                            opacity: pressed ? 0.7 : 1,
                          },
                        ]}
                      >
                        <Text
                          style={[
                            styles.buttonText,
                            {
                              color: isDestructive ? colors.danger : isCancel ? colors.textSecondary : colors.accent,
                            },
                            isSeniorMode && { fontSize: 18 },
                          ]}
                        >
                          {btn.text}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              </Animated.View>
            </View>
          </>
        );
      })()}
    </View>
  );
}

const styles = StyleSheet.create({
  centeredView: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  alertCard: {
    borderRadius: 24,
    borderWidth: 1,
    padding: 24,
    overflow: 'hidden',
  },
  content: {
    alignItems: 'center',
    marginBottom: 24,
  },
  iconWrap: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  title: {
    fontFamily: 'Inter_700Bold',
    fontSize: 20,
    textAlign: 'center',
    marginBottom: 8,
  },
  message: {
    fontFamily: 'Inter_400Regular',
    fontSize: 15,
    textAlign: 'center',
    lineHeight: 22,
  },
  buttonRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 12,
  },
  buttonColumn: {
    flexDirection: 'column',
    width: '100%',
  },
  button: {
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 100,
  },
  rowButton: {
    flex: 1,
  },
  columnButton: {
    width: '100%',
    marginBottom: 8,
  },
  buttonText: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 16,
  },
});
