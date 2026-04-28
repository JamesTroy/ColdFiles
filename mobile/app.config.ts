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
  version: '0.1.0',
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
        'Used to center the map on cases near you and to power Watch Zone alerts.',
      NSLocationAlwaysAndWhenInUseUsageDescription:
        'Used to deliver Watch Zone alerts when a saved zone has new activity.',
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
    // Android 14+ predictive back gesture. Recommended now, expected required
    // for API 36 targets. Enable so the system can render the predictive
    // animation; per-screen `gestureEnabled: false` still works on screens
    // where we want to prevent accidental back-swipes (e.g. /onboarding).
    predictiveBackGestureEnabled: true,
    permissions: ['ACCESS_COARSE_LOCATION', 'ACCESS_FINE_LOCATION'],
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
        imageWidth: 200,
        resizeMode: 'contain',
        backgroundColor: '#0a0a0a',
      },
    ],
    // MapLibre GL Native — open-source map SDK. No API key, no signup, no
    // Google Cloud. Tiles served by openfreemap.org (community-funded OSM).
    '@maplibre/maplibre-react-native',
  ],
  experiments: {
    typedRoutes: true,
    reactCompiler: true,
  },
};

export default config;
