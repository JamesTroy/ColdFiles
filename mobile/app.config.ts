/**
 * Expo dynamic config — replaces app.json so we can inject env-driven values
 * (Google Maps API key, future Sentry/Stripe/etc keys) at build time without
 * committing them. Static values stay where they are; dynamic ones use
 * process.env.
 *
 * Run `npx expo prebuild --clean -p android` after editing this file to
 * regenerate the native android/ tree.
 */

import {
  AndroidConfig,
  withAndroidManifest,
  type ConfigPlugin,
} from 'expo/config-plugins';
import type { ExpoConfig } from 'expo/config';

// Permissions that the audit (docs/audit/2026-05-07/data-security.md, Critical
// #1) requires removed from the generated AAB manifest. expo-location's plugin
// always merges in FINE_LOCATION (no opt-out); RN/Expo prebuild auto-injects
// the storage + overlay perms transitively. Privacy policy + Play Data Safety
// form commit to approximate-only location and no file-system access, so the
// manifest must match — `tools:node="remove"` strips them at manifest-merge.
const PERMISSIONS_TO_REMOVE = [
  'android.permission.ACCESS_FINE_LOCATION',
  'android.permission.READ_EXTERNAL_STORAGE',
  'android.permission.WRITE_EXTERNAL_STORAGE',
  'android.permission.SYSTEM_ALERT_WINDOW',
];

const withTightenedAndroidManifest: ConfigPlugin = (cfg) =>
  withAndroidManifest(cfg, (modConfig) => {
    const manifest = AndroidConfig.Manifest.ensureToolsAvailable(
      modConfig.modResults
    );

    const existing = manifest.manifest['uses-permission'] ?? [];
    const filtered = existing.filter(
      (p) => !PERMISSIONS_TO_REMOVE.includes(p.$['android:name'])
    );
    for (const name of PERMISSIONS_TO_REMOVE) {
      filtered.push({ $: { 'android:name': name, 'tools:node': 'remove' } });
    }
    manifest.manifest['uses-permission'] = filtered;

    // allowBackup=false keeps AsyncStorage (Supabase JWT, saved-case slugs,
    // tip receipts) out of Google Drive auto-backup. fullBackupContent=false
    // disables the legacy < API 31 path for the same reason.
    const application =
      AndroidConfig.Manifest.getMainApplicationOrThrow(manifest);
    application.$['android:allowBackup'] = 'false';
    (application.$ as Record<string, string>)['android:fullBackupContent'] =
      'false';

    modConfig.modResults = manifest;
    return modConfig;
  });

const config: ExpoConfig = {
  name: 'The Cold Files',
  slug: 'coldfile',
  version: '1.0.4',
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
    // Firebase Android client config. Required by FCM (which expo-notifications
    // uses under the hood) so the native side can register the device with
    // Firebase and obtain a token. Without this file the AAB throws
    // "FirebaseApp is not initialized" on Notifications.getExpoPushTokenAsync.
    //
    // The file IS committed despite being a credential file — Firebase
    // Android API keys are restricted to package name + SHA-1 fingerprint
    // per Google's security model, so leaking the key doesn't grant
    // access outside the app. EAS Build only ships git-tracked files,
    // so committing it is the practical move (matches most public Expo
    // projects). The rationale lives alongside the matching policy in
    // mobile/.gitignore. If you're setting up a fresh dev environment,
    // the file is in the repo — only pull a fresh copy from
    // Firebase Console → coldfiles → Project settings → Android app
    // when the key has been rotated or the package name has changed.
    googleServicesFile: './google-services.json',
    adaptiveIcon: {
      backgroundColor: '#0a0a0a',
      foregroundImage: './assets/images/android-icon-foreground.png',
      backgroundImage: './assets/images/android-icon-background.png',
      monochromeImage: './assets/images/android-icon-monochrome.png',
    },
    edgeToEdgeEnabled: true,
    versionCode: 5,
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
    // expo-location plugin — sets the iOS usage strings. Android FINE_LOCATION
    // is auto-merged by this plugin with no opt-out; the inline manifest
    // tightener below strips it at manifest-merge time.
    [
      'expo-location',
      {
        locationAlwaysAndWhenInUsePermission:
          'Used to center the map on cases near you. Approximate location only; not retained.',
        locationWhenInUsePermission:
          'Used to center the map on cases near you. Approximate location only; not retained.',
        isIosBackgroundLocationEnabled: false,
        isAndroidBackgroundLocationEnabled: false,
        isAndroidForegroundServiceEnabled: false,
      },
    ],
    // expo-notifications — push delivery for watch-zone alerts, saved-case
    // updates, and tip status changes. Requires a native rebuild (NOT OTA).
    //
    // The icon is the open-C brand mark rendered as a 96×96 white-on-
    // transparent PNG. Android system-tints monochrome notification icons
    // using the `color` property; that's why the source asset must be
    // alpha-only (white shape on transparent background). The asset was
    // generated programmatically — to regenerate, see the PIL one-liner
    // in the v1.0.1 push-notifications PR.
    [
      'expo-notifications',
      {
        icon: './assets/images/notification-icon.png',
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

export default withTightenedAndroidManifest(config);
