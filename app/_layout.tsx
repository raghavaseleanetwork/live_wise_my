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
import { View, Text, StyleSheet, Platform } from "react-native";
// expo-image, not RN Image: shares the cache warmed by `preloadBrandAssets()`
// so the splash mark is already decoded when this paints.
import { Image } from "expo-image";
import { GestureHandlerRootView } from "react-native-gesture-handler";
// Guarded re-export: the real provider in a dev/production build, a
// pass-through in Expo Go, which has no native module for it.
import { KeyboardProvider } from "@/lib/keyboard-controller";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import Animated, { FadeIn } from "react-native-reanimated";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { queryClient } from "@/lib/query-client";
import { ExpenseProvider } from "@/lib/expense-context";
import { AuthProvider, useAuth } from "@/lib/auth-context";
import {
  flushFamilyRecordQueue,
  setFamilyRecordsAuthToken,
} from "@/lib/family-records-sync";
import { ThemeProvider, useTheme } from "@/lib/theme-context";
import { CurrencyProvider, useCurrency } from "@/lib/currency-context";
import { SubscriptionProvider, useSubscription } from "@/lib/subscription-context";
import { PaywallProvider } from "@/lib/paywall-context";
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
import { makeFamilyReminderId } from "@/lib/family-reminders";
import CustomAlert from "@/components/CustomAlert";

import PremiumLoader, { BRAND_LOGO, preloadBrandAssets } from "@/components/PremiumLoader";

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
            source={BRAND_LOGO}
            style={splashStyles.logo}
            contentFit="contain"
            cachePolicy="memory-disk"
            transition={0}
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
  const { backfillRateHistory } = useCurrency();
  const {
    isLoading: subLoading,
    canStartTrial,
    startTrial,
  } = useSubscription();
  const segments = useSegments();
  const router = useRouter();
  const [showSplash, setShowSplash] = useState(true);

  // Pull the server's rate history once, so amounts from before this install
  // convert at their own date's rate rather than today's. Needs a token, and
  // `CurrencyProvider` sits outside `AuthProvider`, so it is triggered here
  // where both are in scope. No-ops after the first successful run.
  useEffect(() => {
    if (!token) return;
    void backfillRateHistory(token);
  }, [token, backfillRateHistory]);

  // Family Hub records sync through plain functions rather than a React hook,
  // so the token is published to that layer here. Without it every record write
  // stays device-local — which is exactly the bug where a caregiver never saw
  // the owner's appointments. Flushing on (re)connect retries anything that was
  // queued while offline.
  useEffect(() => {
    setFamilyRecordsAuthToken(token ?? null);
    if (token) void flushFamilyRecordQueue();
  }, [token]);

  // Auto-activate the one-time 7-day Family trial on the first authenticated
  // run (doc §5.3: every new user gets it on install, no card required). Also
  // grants it to existing users on their first run after this ships.
  useEffect(() => {
    if (isAuthenticated && !subLoading && canStartTrial) {
      startTrial();
    }
  }, [isAuthenticated, subLoading, canStartTrial, startTrial]);

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

        // Most specific match first, then a generic `data.route` fallback.
        //
        // The fallback matters: it lets the backend add a new notification kind
        // and have taps land correctly WITHOUT shipping a new client build —
        // it just has to include `route`. Without it every new push type opens
        // the app to wherever it happened to be, which is what medicine pushes
        // (`type: 'medication'`) did before this block existed.
        if (data?.type === "reminder" && data?.billId) {
          router.push({
            pathname: "/bill-details/[billId]",
            params: { billId: String(data.billId) },
          } as any);
          return;
        }

        // Family reminders open their own detail screen — the same destination
        // as tapping the row in the Reminders tab, so a notification and a tap
        // never land somewhere different. The composite id is rebuilt from the
        // payload's identity triple, since the push carries the parts rather
        // than the assembled id.
        if (data?.type === "family-reminder" && data?.memberId && data?.sourceKind && data?.sourceId) {
          router.push({
            pathname: "/family-reminder/[reminderId]",
            params: {
              reminderId: makeFamilyReminderId(
                String(data.memberId),
                data.sourceKind,
                String(data.sourceId),
              ),
            },
          } as any);
          return;
        }

        // Medicine doses. The server has always sent these with
        // `type: 'medication'`, but nothing here handled them, so tapping did
        // nothing at all.
        if (data?.type === "medication" && data?.memberId && data?.medId) {
          router.push({
            pathname: "/medicine-details/[memberId]/[medId]",
            params: { memberId: String(data.memberId), medId: String(data.medId) },
          } as any);
          return;
        }

        // Caregiver invites — a caregiver's own phone, not the member's.
        if (data?.type === "caregiver-invite") {
          router.push("/caregiver-invites" as any);
          return;
        }

        // Generic fallback for any payload that names its own destination.
        if (typeof data?.route === "string" && data.route.startsWith("/")) {
          router.push(data.route as any);
          return;
        }

        // Nothing routable — open the notification list rather than leaving the
        // user on whatever screen was last open, which reads as a dead tap.
        router.push("/notifications" as any);
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
        <Stack.Screen name="subscription/index" />
        <Stack.Screen name="subscription/compare" />
        <Stack.Screen name="life-memory" />
        <Stack.Screen name="family" />
        <Stack.Screen name="add-family-member" options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
        <Stack.Screen name="edit-family-member" options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
        <Stack.Screen name="add-medicine" options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
        <Stack.Screen name="add-expense" />
        <Stack.Screen name="add-recurring-expense" />
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
        <Stack.Screen name="family-appointments/add" />
        <Stack.Screen name="family-health/add" />
        <Stack.Screen name="family-stock/add" />
        <Stack.Screen name="family-routine/add" />
        <Stack.Screen name="family-bills/add" />
        <Stack.Screen name="family-subscriptions/add" />
        <Stack.Screen name="family-expenses/add" />
        <Stack.Screen name="family-tasks/add" />
        <Stack.Screen name="family-documents/add" />
        <Stack.Screen name="family-checkin/add" />
        <Stack.Screen name="family-travel/add" />
        <Stack.Screen name="family-custom/add" />
        <Stack.Screen name="family-custom/setup" />
        <Stack.Screen name="family-caregivers/add" />
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

  // Warm the logo cache before the native splash is dismissed. Once it hides,
  // our own splash paints immediately — a cold image cache at that moment shows
  // an empty frame where the mark should be. Failure is non-blocking: the
  // splash still hides, the logo just pops in a frame late.
  useEffect(() => {
    if (fontsLoaded || fontError) {
      preloadBrandAssets().finally(() => {
        SplashScreen.hideAsync();
      });
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
                      <SubscriptionProvider>
                        <PaywallProvider>
                          <ExpenseProvider>
                            <AuthGate />
                          </ExpenseProvider>
                        </PaywallProvider>
                      </SubscriptionProvider>
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
