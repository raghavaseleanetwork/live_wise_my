import { Tabs } from "expo-router";
import { BlurView } from "expo-blur";
import { Platform, StyleSheet, View, Text } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import React from "react";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "@/lib/theme-context";

function ClassicTabLayout() {
  const { colors, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const isWeb = Platform.OS === "web";
  const isIOS = Platform.OS === "ios";
  const activeColor = "#7C3AED"; // unified purple accent
  const inactiveColor = "#9CA3AF";
  const tabBarBottom = 12 + (insets.bottom || 0);
  // OUTER spacing only (distance from screen edges)
  const OUTER_GUTTER = 32;

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: activeColor,
        tabBarInactiveTintColor: inactiveColor,
        tabBarShowLabel: false,
        tabBarStyle: {
          position: "absolute" as const,
          left: 0,
          right: 0,
          marginHorizontal: OUTER_GUTTER + Math.max(insets.left || 0, insets.right || 0),
          bottom: tabBarBottom,
          height: 64,
          borderRadius: 999,
          // No inner padding; spacing comes from equal-width tab items
          paddingHorizontal: 0,
          paddingTop: 0,
          paddingBottom: 0,
          backgroundColor: colors.tabBarBg,
          elevation: 0,
          borderTopWidth: 1,
          borderTopColor: colors.border,
        },
        tabBarItemStyle: {
          flex: 1,
          height: "100%",
          paddingVertical: 0,
          paddingHorizontal: 0,
          justifyContent: "center",
          alignItems: "center",
        },
        tabBarIconStyle: {
          width: "100%",
          height: "100%",
          marginTop: 0,
          marginBottom: 0,
        },
        tabBarBackground: () =>
          isIOS ? (
            <BlurView
              intensity={80}
              tint={colors.blurTint}
              style={StyleSheet.absoluteFill}
            />
          ) : isWeb ? (
            <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.tabBarBg }]} />
          ) : null,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Home",
          tabBarIcon: ({ focused }) => (
            <View style={[styles.tabItem, focused && styles.tabItemActive]}>
              <Ionicons
                name="home"
                size={22}
                color={focused ? activeColor : inactiveColor}
              />
            </View>
          ),
        }}
      />
      <Tabs.Screen
        name="family"
        options={{
          title: "Family Hub",
          tabBarIcon: ({ focused }) => (
            <View style={[styles.tabItem, focused && styles.tabItemActive]}>
              <Ionicons
                name="people"
                size={22}
                color={focused ? activeColor : inactiveColor}
              />
            </View>
          ),
          tabBarLabel: () => null,
        }}
      />
      <Tabs.Screen
        name="bills"
        options={{
          title: "Reminders",
          tabBarIcon: ({ focused }) => (
            <View style={[styles.tabItem, focused && styles.tabItemActive]}>
              <Ionicons
                name="notifications"
                size={22}
                color={focused ? activeColor : inactiveColor}
              />
            </View>
          ),
          tabBarLabel: () => null,
        }}
      />
      <Tabs.Screen
        name="reports"
        options={{
          title: "Report",
          tabBarIcon: ({ focused }) => (
            <View style={[styles.tabItem, focused && styles.tabItemActive]}>
              <Ionicons
                name="pie-chart"
                size={22}
                color={focused ? activeColor : inactiveColor}
              />
            </View>
          ),
          tabBarLabel: () => null,
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: "Settings",
          tabBarIcon: ({ focused }) => (
            <View style={[styles.tabItem, focused && styles.tabItemActive]}>
              <Ionicons
                name="person"
                size={22}
                color={focused ? activeColor : inactiveColor}
              />
            </View>
          ),
          tabBarLabel: () => null,
        }}
      />
      {/* Routable but hidden from the tab bar — reached via Home > Quick Reach */}
      <Tabs.Screen name="transactions" options={{ href: null }} />
      <Tabs.Screen name="leaks" options={{ href: null }} />
    </Tabs>
  );
}

export default function TabLayout() {
  // Always use the custom pill-style tab bar to match the design.
  return <ClassicTabLayout />;
}

const styles = StyleSheet.create({
  tabItem: {
    width: 40,
    height: 40,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
  },
  tabItemActive: {
    backgroundColor: "rgba(124, 58, 237, 0.16)",
  },
  tabLabel: {
    fontFamily: "Inter_500Medium",
    fontSize: 11,
  },
});
