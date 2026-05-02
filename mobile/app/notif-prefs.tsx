/**
 * Notifications screen — ABSOLUTE MINIMUM diagnostic.
 *
 * Bisecting a render failure on Pixel 10 Pro XL Android 16. Previous attempts:
 *   v1: full screen → grey (module-level import throws)
 *   v2: ErrorBoundary around full screen → grey (boundary didn't catch)
 *   v3: stub w/ screen-shell primitives + tokens → crash on navigate
 *   v4 (this): only react + react-native, hardcoded colors, no aliases.
 *
 * If v4 crashes too: cause is upstream — route registration, _layout.tsx
 * stack screen entry, or a native module side effect that runs whenever
 * any tab pushes to /notifications. Look there.
 *
 * If v4 renders: add back imports one tier at a time:
 *   tier 1: tokens, useSafeAreaInsets
 *   tier 2: PushScreenHeader, Card, SansBody (screen-shell primitives)
 *   tier 3: useNotificationPrefs (AsyncStorage hook)
 *   tier 4: usePushToken (expo-notifications consumer — the chief suspect)
 */

import { Text, View } from 'react-native';

export default function NotificationsScreen() {
  return (
    <View style={{ flex: 1, backgroundColor: '#000', padding: 50, paddingTop: 100 }}>
      <Text style={{ color: '#fff', fontSize: 24, marginBottom: 16 }}>
        Notifications (diagnostic v4)
      </Text>
      <Text style={{ color: '#aaa', fontSize: 14 }}>
        If you can read this, the route renders fine and the bug is in a
        component or hook the original screen pulled in.
      </Text>
    </View>
  );
}
