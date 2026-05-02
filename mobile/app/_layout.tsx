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
import { useEffect, useState } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import 'react-native-reanimated';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { BrandSplash } from '@/components/cf/brand-splash';
import { tokens } from '@/constants/theme';
import { useAuthCallback } from '@/lib/hooks/use-auth-callback';
import { useOnboarding } from '@/lib/hooks/use-onboarding';

// Native splash stays up until JS mounts. We then immediately call
// hideAsync() (in the layout's mount effect) and let our JS-rendered
// BrandSplash take over for the rest of the cold-launch window — through
// font-load and a 400ms brand beat. preventAutoHide keeps the native
// splash visible during the JS-bundle-parse phase so the user doesn't
// see a flash of system OS background between OS handoff and JS first
// paint.
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

  // JS-rendered brand splash overlay. Three-phase lifecycle:
  //   - mounted: true while the overlay is in the tree
  //   - visible: true while it's fully opaque (controls when fade starts)
  // BrandSplash is rendered from the very first JS paint — covers the
  // entire startup window from native-splash-handoff through font-load
  // through the 400ms brand beat. The "C" briefly renders in system serif
  // fallback during font load, then snaps to Newsreader; single glyph,
  // not visually noticeable, and the alternative (holding native splash
  // through font load) means the user only sees our brand for the last
  // ~400ms instead of the whole cold launch.
  // Per CLAUDE.md: hooks above any early return.
  const [splashMounted, setSplashMounted] = useState(true);
  const [splashVisible, setSplashVisible] = useState(true);

  // Catches the magic-link deep link on cold launch + warm. Without this
  // the email-OTP flow lands on coldfile://auth-callback but never creates
  // a session, because supabase-js is configured with detectSessionInUrl
  // false (correct for RN — see lib/supabase.ts).
  useAuthCallback();

  // Hide the native splash as soon as JS mounts — don't wait for fonts.
  // Our BrandSplash overlay covers the screen from this point so there's
  // no flash of un-themed app shell.
  useEffect(() => {
    SplashScreen.hideAsync().catch(() => {
      /* ignore */
    });
  }, []);

  // Once fonts have loaded, hold the brand for 400ms then trigger the
  // fade. Fonts loading triggers a single re-render of the C glyph from
  // system fallback into Newsreader; users typically don't notice at
  // splash scale.
  useEffect(() => {
    if (!fontsLoaded) return;
    const t = setTimeout(() => setSplashVisible(false), 400);
    return () => clearTimeout(t);
  }, [fontsLoaded]);

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: tokens.color.bg.base }}>
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
          <Stack.Screen
            name="takedown-request/[slug]"
            options={{ presentation: 'modal', animation: 'slide_from_bottom' }}
          />
          <Stack.Screen
            name="zone/[id]"
            options={{ animation: 'slide_from_right' }}
          />
          <Stack.Screen name="sign-in" options={{ animation: 'slide_from_bottom', presentation: 'modal' }} />
          <Stack.Screen name="search" options={{ animation: 'slide_from_bottom', presentation: 'modal' }} />
          <Stack.Screen name="delete-account" options={{ animation: 'slide_from_right' }} />
          <Stack.Screen name="data-export" options={{ animation: 'slide_from_right' }} />
          <Stack.Screen name="diagnostics" options={{ animation: 'slide_from_right' }} />
          <Stack.Screen name="notif-prefs" options={{ animation: 'slide_from_right' }} />
          <Stack.Screen name="tip-history" options={{ animation: 'slide_from_right' }} />
          <Stack.Screen name="region-prefs" options={{ animation: 'slide_from_right' }} />
        </Stack>
          <StatusBar style="light" backgroundColor={tokens.color.bg.base} />
        </ThemeProvider>
      </SafeAreaProvider>
      {/* Sits last in the tree so it overlays everything during the brand
          beat. Unmounts itself once the fade completes. */}
      {splashMounted ? (
        <BrandSplash
          visible={splashVisible}
          onFadeComplete={() => setSplashMounted(false)}
        />
      ) : null}
    </GestureHandlerRootView>
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
