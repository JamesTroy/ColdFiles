/**
 * Notif-prefs — diagnostic v6 with explicit version marker.
 *
 * If the user reports "still crashes," the version marker tells us
 * whether the OTA actually applied. v4 said "diagnostic v4" — if the
 * device shows v6 here, OTAs are landing. If it shows v4, the OTA path
 * itself isn't reaching this device, and the crash is from the OLD
 * route file (no longer in the bundle).
 */

import { Text, View } from 'react-native';

export default function NotifPrefsScreen() {
  return (
    <View
      style={{
        flex: 1,
        backgroundColor: '#000',
        padding: 24,
        paddingTop: 80,
      }}
    >
      <Text
        style={{
          color: '#c5a572',
          fontSize: 28,
          fontWeight: 'bold',
          marginBottom: 12,
        }}
      >
        DIAG v6
      </Text>
      <Text style={{ color: '#fff', fontSize: 16, marginBottom: 16 }}>
        Notifications (renamed → /notif-prefs)
      </Text>
      <Text style={{ color: '#aaa', fontSize: 13, lineHeight: 20 }}>
        If you can read this, the OTA bundle landed and the route registration
        is fine. The previous crashes were either (a) a stale bundle, or (b)
        specific to the file content we&apos;ve since simplified.
      </Text>
      <Text style={{ color: '#aaa', fontSize: 13, lineHeight: 20, marginTop: 16 }}>
        Next step: tap back, try Pinned regions from Me to confirm sibling
        routes work.
      </Text>
    </View>
  );
}
