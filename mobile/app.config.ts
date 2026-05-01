/**
 * Expo dynamic config — replaces app.json so we can inject env-driven values
 * (Google Maps API key, future Sentry/Stripe/etc keys) at build time without
 * committing them. Static values stay where they are; dynamic ones use
 * process.env.
 *
 * Run `npx expo prebuild --clean -p android` after editing this file to
 * regenerate the native android/ tree.
 */

import type { ExpoConfig } from 'expo/config';

const config: ExpoConfig = {
  name: 'The Cold File',
  slug: 'coldfile',
  version: '1.0.0',
  orientation: 'portrait',
  icon: './assets/images/icon.png',
  scheme: 'coldfile',
  userInterfaceStyle: 'dark',
  newArchEnabled: true,
  ios: {
    supportsTablet: true,
    bundleIdentifier: 'com.matteblackdev.coldfile',
    infoPlist: {
      NSLocationWhenInUseUsageDescription:
        'Used to center the map on cases near you.',
      // Background "always" permission deferred until watch zones ship
      // (v1.0.1) — claiming it now would mismatch the privacy policy,
      // which says location is used briefly per query, not retained.
    },
    config: {
      // iOS uses Apple Maps by default — react-native-maps' MapView with no
      // provider prop renders MapKit, no key required. If we ever need
      // provider="google" on iOS, drop the Google iOS API key here.
      // googleMapsApiKey: process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY_IOS,
    },
  },
  android: {
    package: 'com.matteblackdev.coldfile',
    adaptiveIcon: {
      backgroundColor: '#0a0a0a',
      foregroundImage: './assets/images/android-icon-foreground.png',
      backgroundImage: './assets/images/android-icon-background.png',
      monochromeImage: './assets/images/android-icon-monochrome.png',
    },
    edgeToEdgeEnabled: true,
    versionCode: 1,
    // Android 14+ predictive back gesture. Recommended now, expected required
    // for API 36 targets. Enable so the system can render the predictive
    // animation; per-screen `gestureEnabled: false` still works on screens
    // where we want to prevent accidental back-swipes (e.g. /onboarding).
    predictiveBackGestureEnabled: true,
    // COARSE only — radius queries use Accuracy.Balanced (see lib/hooks/use-here.ts).
    // FINE_LOCATION would trigger Play's "precise location" disclosure and
    // mismatch the privacy policy / Data Safety form, both of which declare
    // approximate location only.
    permissions: ['ACCESS_COARSE_LOCATION'],
  },
  web: {
    output: 'static',
    favicon: './assets/images/favicon.png',
  },
  plugins: [
    'expo-router',
    [
      'expo-splash-screen',
      {
        image: './assets/images/splash-icon.png',
        // 240dp fills ~65% of a typical Android screen width. The asset
        // has its corner brackets at 10% inset so the visible-content
        // width reads at ~190dp — the right scale for a brand splash.
        imageWidth: 240,
        resizeMode: 'contain',
        backgroundColor: '#0a0a0a',
      },
    ],
    // MapLibre GL Native — open-source map SDK. No API key, no signup, no
    // Google Cloud. Tiles served by openfreemap.org (community-funded OSM).
    '@maplibre/maplibre-react-native',
    // expo-notifications — push delivery for watch-zone alerts, saved-case
    // updates, and tip status changes. Requires a native rebuild (NOT OTA).
    //
    // TODO(notification-icon): commission a 96×96 monochrome PNG and drop it
    // at mobile/assets/images/notification-icon.png. Until then we let the
    // plugin run with no `icon`, which falls back to the app icon — fine for
    // dev + closed testing, NOT acceptable for Play Store production submission
    // (Google strips colored icons in the status bar, leaving a grey square).
    // When the asset exists, change this entry to the array form:
    //   ['expo-notifications', {
    //     icon: './assets/images/notification-icon.png',
    //     color: '#c5a572',
    //   }]
    [
      'expo-notifications',
      {
        // icon: './assets/images/notification-icon.png',  // TODO: add asset
        color: '#c5a572', // tokens.color.accent.amber — splash backdrop accent
      },
    ],
  ],
  experiments: {
    typedRoutes: true,
    reactCompiler: true,
  },
  updates: {
    url: 'https://u.expo.dev/933d850a-4e1f-431b-9c0d-497094357a00',
  },
  // appVersion policy: OTA updates only reach clients on a matching `version`
  // (currently 1.0.0). Bumping to 1.0.1 cuts the OTA channel to 1.0.0 clients,
  // which is the right behavior — runtime contract changes need a new build.
  runtimeVersion: {
    policy: 'appVersion',
  },
  extra: {
    eas: {
      projectId: '933d850a-4e1f-431b-9c0d-497094357a00',
    },
  },
};

export default config;
