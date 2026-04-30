/**
 * Root layout — loads fonts, locks dark theme, configures the navigation stack.
 *
 * Dark mode IS the design — useColorScheme() is intentionally ignored. If a
 * future light variant is greenlit (see "Light mode" in docs/04_DESIGN_SYSTEM.md)
 * it inverts surfaces + text only and keeps accents and pins untouched.
 */

import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
} from '@expo-google-fonts/inter';
import {
  JetBrainsMono_500Medium,
  JetBrainsMono_600SemiBold,
} from '@expo-google-fonts/jetbrains-mono';
import { Newsreader_500Medium } from '@expo-google-fonts/newsreader';
import { DarkTheme, ThemeProvider } from '@react-navigation/native';
import { useFonts } from 'expo-font';
import { router, Stack, usePathname } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { View } from 'react-native';
import 'react-native-reanimated';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { tokens } from '@/constants/theme';
import { useAuthCallback } from '@/lib/hooks/use-auth-callback';
import { useOnboarding } from '@/lib/hooks/use-onboarding';

// Hold the splash until fonts have loaded — prevents a flash of system-fallback
// type that would betray the case-file aesthetic.
SplashScreen.preventAutoHideAsync().catch(() => {
  /* ignore — already hidden in some lifecycles */
});

export const unstable_settings = {
  anchor: '(tabs)',
};

const navTheme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    background: tokens.color.bg.base,
    card: tokens.color.bg.elev1,
    text: tokens.color.text.primary,
    primary: tokens.color.accent.amber,
    border: tokens.color.border.subtle,
    notification: tokens.color.tip.success,
  },
};

export default function RootLayout() {
  // Keys here must match the `font.*` keys in constants/theme.ts.
  const [fontsLoaded] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Newsreader_500Medium,
    JetBrainsMono_500Medium,
    JetBrainsMono_600SemiBold,
  });

  // Catches the magic-link deep link on cold launch + warm. Without this
  // the email-OTP flow lands on coldfile://auth-callback but never creates
  // a session, because supabase-js is configured with detectSessionInUrl
  // false (correct for RN — see lib/supabase.ts).
  useAuthCallback();

  useEffect(() => {
    if (fontsLoaded) {
      SplashScreen.hideAsync().catch(() => {
        /* ignore */
      });
    }
  }, [fontsLoaded]);

  if (!fontsLoaded) {
    // Splash is up; render nothing rather than fallback type.
    return <View style={{ flex: 1, backgroundColor: tokens.color.bg.base }} />;
  }

  return (
    <SafeAreaProvider>
      <ThemeProvider value={navTheme}>
        <OnboardingGate />
        <Stack
          screenOptions={{
            contentStyle: { backgroundColor: tokens.color.bg.base },
            headerShown: false,
            animation: 'fade',
          }}
        >
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="onboarding" options={{ animation: 'fade', gestureEnabled: false }} />
          <Stack.Screen name="auth-callback" options={{ animation: 'fade', gestureEnabled: false }} />
          <Stack.Screen
            name="case/[slug]"
            options={{
              animation: 'slide_from_right',
            }}
          />
          <Stack.Screen
            name="tip/[slug]"
            options={{
              presentation: 'modal',
              animation: 'slide_from_bottom',
            }}
          />
          <Stack.Screen
            name="watch-zone"
            options={{
              animation: 'slide_from_right',
            }}
          />
          <Stack.Screen name="about" options={{ animation: 'slide_from_right' }} />
          <Stack.Screen name="privacy" options={{ animation: 'slide_from_right' }} />
          <Stack.Screen name="terms" options={{ animation: 'slide_from_right' }} />
          <Stack.Screen name="takedown" options={{ animation: 'slide_from_right' }} />
          <Stack.Screen name="sign-in" options={{ animation: 'slide_from_bottom', presentation: 'modal' }} />
          <Stack.Screen name="search" options={{ animation: 'slide_from_bottom', presentation: 'modal' }} />
          <Stack.Screen name="delete-account" options={{ animation: 'slide_from_right' }} />
        </Stack>
        <StatusBar style="light" backgroundColor={tokens.color.bg.base} />
      </ThemeProvider>
    </SafeAreaProvider>
  );
}

/**
 * Redirects to /onboarding on first launch and back to / when complete.
 * Renders nothing — purely a side-effect component so the redirect can use
 * `router.replace` without unmounting the app on first paint.
 */
function OnboardingGate() {
  const { state } = useOnboarding();
  const pathname = usePathname();

  useEffect(() => {
    if (state === 'pending' && pathname !== '/onboarding') {
      router.replace('/onboarding');
    }
  }, [state, pathname]);

  return null;
}
