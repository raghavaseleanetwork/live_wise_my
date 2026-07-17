import {
  DMSans_400Regular,
  DMSans_500Medium,
  DMSans_700Bold,
  useFonts,
} from "@expo-google-fonts/dm-sans";
import { QueryClientProvider } from "@tanstack/react-query";
import { Stack, useSegments, useRouter } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, Platform, ActivityIndicator, Image } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import Animated, { FadeIn } from "react-native-reanimated";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { queryClient } from "@/lib/query-client";
import { ExpenseProvider } from "@/lib/expense-context";
import { AuthProvider, useAuth } from "@/lib/auth-context";
import { ThemeProvider, useTheme } from "@/lib/theme-context";
import { CurrencyProvider } from "@/lib/currency-context";
import { StatusBar } from "expo-status-bar";
import {
  addNotificationResponseReceivedListener,
  addNotificationReceivedListener,
  registerForPushNotifications,
  addPushTokenListener,
} from "@/lib/notifications";
import { emitCaregiverSync } from "@/lib/caregiver-sync";
import { registerSmsSyncTask } from "@/lib/sms-sync-task";
import { SeniorProvider } from "@/lib/senior-context";
import { AlertProvider } from "@/lib/alert-context";
import CustomAlert from "@/components/CustomAlert";

import PremiumLoader from "@/components/PremiumLoader";

SplashScreen.preventAutoHideAsync();

function AnimatedSplash() {
  return (
    <LinearGradient
      colors={["#ffffff", "#ffffff"]}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={splashStyles.container}
    >
      <Animated.View
        entering={FadeIn.duration(700)}
        style={splashStyles.content}
      >
        <Animated.View
          entering={FadeIn.duration(500)}
          style={splashStyles.logoShadow}
        >
          <Image
            source={require("../logo.png")}
            style={splashStyles.logo}
            resizeMode="contain"
          />
        </Animated.View>
        <Animated.Text
          entering={FadeIn.duration(600).delay(150)}
          style={splashStyles.title}
        >
          LifeWise
        </Animated.Text>
        <Animated.Text
          entering={FadeIn.duration(700).delay(250)}
          style={splashStyles.subtitle}
        >
          Your Intelligent Life Companion
        </Animated.Text>
        <View style={{ height: 100, marginTop: 24 }}>
          <PremiumLoader size={40} />
        </View>
      </Animated.View>
    </LinearGradient>
  );
}

const splashStyles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#ffffff",
  },
  content: {
    alignItems: "center",
  },
  logoShadow: {
    width: 140,
    height: 140,
    borderRadius: 40,
    padding: 8,
    backgroundColor: "#ffffff",
    marginBottom: 20,
  },
  logo: {
    width: "100%",
    height: "100%",
    borderRadius: 32,
  },
  title: {
    fontFamily: "Inter_700Bold",
    fontSize: 32,
    color: "#111827",
    letterSpacing: 0.8,
    marginTop: 4,
  },
  subtitle: {
    fontFamily: "Inter_400Regular",
    fontSize: 14,
    color: "rgba(31,41,55,0.6)",
    marginTop: 8,
  },
});

function AuthGate() {
  const { user, token, isLoading, hasOnboarded, isAuthenticated } = useAuth();
  const { colors } = useTheme();
  const segments = useSegments();
  const router = useRouter();
  const [showSplash, setShowSplash] = useState(true);

  useEffect(() => {
    if (!isLoading) {
      const timer = setTimeout(() => setShowSplash(false), 1200);
      return () => clearTimeout(timer);
    }
  }, [isLoading]);

  useEffect(() => {
    if (isLoading || showSplash) return;

    const inAuthGroup = segments[0] === '(auth)';
    const inOnboarding = segments[0] === 'onboarding';
    const inTabs = segments[0] === '(tabs)';
    const inSettings = segments[0] === 'settings';

    if (!hasOnboarded && !inOnboarding) {
      router.replace('/onboarding');
    } else if (hasOnboarded && !isAuthenticated && !inAuthGroup) {
      router.replace('/(auth)/login');
    } else if (isAuthenticated && (inAuthGroup || inOnboarding)) {
      router.replace('/(tabs)');
    }
  }, [isAuthenticated, isLoading, hasOnboarded, segments, showSplash]);

  useEffect(() => {
    if (!isAuthenticated || !token) return;
    registerForPushNotifications(token).catch((e) => {
      if (__DEV__) console.log("[Push] Registration error", e);
    });

    registerSmsSyncTask().catch((e) => {
      if (__DEV__) console.log("[BackgroundSync] Registration error", e);
    });

    let sub: { remove: () => void } | null = null;
    (async () => {
      const nextSub = await addPushTokenListener((newToken) => {
        // if (__DEV__) console.log("[Push] Token refreshed:", newToken);
        registerForPushNotifications(token);
      });
      sub = nextSub;
    })();

    return () => sub?.remove();
  }, [isAuthenticated, token]);

  useEffect(() => {
    let cancelled = false;
    let sub: { remove: () => void } | null = null;

    (async () => {
      const nextSub = await addNotificationResponseReceivedListener((response) => {
        const data = response.notification.request.content.data as any;
        if (data?.type === "reminder" && data?.billId) {
          router.push({
            pathname: "/bill-details/[billId]",
            params: { billId: String(data.billId) },
          } as any);
        }
      });

      // If the component unmounted before the async attach completed, remove immediately.
      if (cancelled) {
        nextSub.remove();
        return;
      }
      sub = nextSub;
    })();

    return () => {
      cancelled = true;
      sub?.remove();
    };
  }, [router]);

  useEffect(() => {
    let cancelled = false;
    let sub: { remove: () => void } | null = null;

    (async () => {
      const nextSub = await addNotificationReceivedListener((notification) => {
        const data = notification.request.content.data as any;
        if (data?.type === "sync" && data?.memberId) {
          emitCaregiverSync(String(data.memberId));
        }
      });

      if (cancelled) {
        nextSub.remove();
        return;
      }
      sub = nextSub;
    })();

    return () => {
      cancelled = true;
      sub?.remove();
    };
  }, []);

  if (isLoading || showSplash) {
    return <AnimatedSplash />;
  }

  return (
    <>
      <StatusBar style={colors.statusBarStyle} />
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="bill-details/[billId]" />
        <Stack.Screen name="edit-reminder" options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
        <Stack.Screen name="onboarding" />
        <Stack.Screen name="(auth)" />
        <Stack.Screen name="settings" />
        <Stack.Screen name="life-memory" />
        <Stack.Screen name="family" />
        <Stack.Screen name="add-family-member" options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
        <Stack.Screen name="edit-family-member" options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
        <Stack.Screen name="add-medicine" options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
        <Stack.Screen name="family-member-detail/[memberId]" />
        <Stack.Screen name="family-appointments/[memberId]" />
        <Stack.Screen name="family-health/[memberId]" />
        <Stack.Screen name="family-stock/[memberId]" />
        <Stack.Screen name="family-routine/[memberId]" />
        <Stack.Screen name="family-bills/[memberId]" />
        <Stack.Screen name="family-subscriptions/[memberId]" />
        <Stack.Screen name="family-expenses/[memberId]" />
        <Stack.Screen name="family-tasks/[memberId]" />
        <Stack.Screen name="family-documents/[memberId]" />
        <Stack.Screen name="family-checkin/[memberId]" />
        <Stack.Screen name="family-travel/[memberId]" />
        <Stack.Screen name="family-emergency/[memberId]" />
        <Stack.Screen name="family-custom/[memberId]" />
        <Stack.Screen name="family-caregivers/[memberId]" />
        <Stack.Screen name="caregiver-invites" />
        <Stack.Screen name="assistant" />
        <Stack.Screen name="+not-found" />
      </Stack>
      <CustomAlert />
    </>
  );
}

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    // Keep Inter_* aliases so existing styles across the app
    // automatically render with DM Sans without editing every file.
    Inter_400Regular: DMSans_400Regular,
    Inter_500Medium: DMSans_500Medium,
    Inter_600SemiBold: DMSans_500Medium,
    Inter_700Bold: DMSans_700Bold,
    Inter_800ExtraBold: DMSans_700Bold,
    Dmsans_500SemiBold: DMSans_500Medium,
  });

  useEffect(() => {
    if (fontsLoaded || fontError) {
      SplashScreen.hideAsync();
    }
  }, [fontsLoaded, fontError]);

  if (!fontsLoaded && !fontError) return null;

  return (
    <QueryClientProvider client={queryClient}>
      <GestureHandlerRootView style={{ flex: 1 }}>
        <KeyboardProvider>
          <ThemeProvider>
            <ErrorBoundary>
              <CurrencyProvider>
                <SeniorProvider>
                  <AlertProvider>
                    <AuthProvider>
                      <ExpenseProvider>
                        <AuthGate />
                      </ExpenseProvider>
                    </AuthProvider>
                  </AlertProvider>
                </SeniorProvider>
              </CurrencyProvider>
            </ErrorBoundary>
          </ThemeProvider>
        </KeyboardProvider>
      </GestureHandlerRootView>
    </QueryClientProvider>
  );
}
