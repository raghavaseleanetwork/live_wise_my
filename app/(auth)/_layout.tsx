import { Stack } from 'expo-router';
import { useTheme } from '@/lib/theme-context';

export default function AuthLayout() {
  const { colors } = useTheme();

  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: colors.bg },
      }}
    >
      <Stack.Screen name="login" />
      <Stack.Screen name="register" />
      {/*
        Reached after register/login/Google when the account's email is not yet
        verified. Registered explicitly rather than relying on file-convention
        discovery so it sits alongside the routes that push to it.
      */}
      <Stack.Screen name="verify-otp" />
    </Stack>
  );
}
