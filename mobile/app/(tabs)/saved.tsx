/**
 * Saved tab — bookmarked cases + watch zones.
 *
 * Empty-state placeholder for now; user_watches integration lands when
 * supabase-js is wired (architecture rule: read paths from a bare client).
 */

import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { MonoLabel, SansBody, SerifTitle } from '@/components/cf/text';
import { tokens } from '@/constants/theme';

export default function SavedScreen() {
  const insets = useSafeAreaInsets();
  return (
    <View
      style={{
        flex: 1,
        backgroundColor: tokens.color.bg.base,
        paddingTop: insets.top + 8,
      }}
    >
      <View style={{ paddingHorizontal: 16, paddingBottom: 12 }}>
        <SerifTitle size="h2" style={{ fontSize: 19 }}>
          Saved
        </SerifTitle>
        <MonoLabel size={tokens.size.monoLabel} style={{ marginTop: 2 }}>
          0 CASES · 0 WATCH ZONES
        </MonoLabel>
      </View>

      <View
        style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 }}
      >
        <SerifTitle
          size="h1"
          style={{ fontSize: 48, color: tokens.color.text.secondary, marginBottom: 16 }}
        >
          —
        </SerifTitle>
        <SansBody
          style={{
            color: tokens.color.text.secondary,
            textAlign: 'center',
            lineHeight: tokens.size.body * 1.5,
          }}
        >
          Cases you save and zones you watch appear here. Tap the ★ on any case to bookmark it.
        </SansBody>
      </View>
    </View>
  );
}
