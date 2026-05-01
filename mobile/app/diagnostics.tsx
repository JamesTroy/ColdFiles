/**
 * Diagnostics screen — copy/paste-able runtime envelope for support tickets.
 *
 * Surfaces: app version, runtime version, update channel + IDs, platform,
 * OS version, locale, timezone. Anything unavailable renders as "—" rather
 * than crashing — Updates fields are null in dev / Expo Go.
 *
 * The "Copy diagnostics" amber CTA pushes the assembled plaintext block
 * onto the system clipboard and shows a 2s "Copied" inline confirmation.
 *
 * Per CLAUDE.md: hooks before early returns. Card / Row primitives come
 * from components/cf/screen-shell.
 */

import * as Clipboard from 'expo-clipboard';
import { Stack } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AmberCTA } from '@/components/cf/cta-button';
import { Card, PushScreenHeader, Row } from '@/components/cf/screen-shell';
import { MonoLabel } from '@/components/cf/text';
import { tokens } from '@/constants/theme';
import { assembleDiagnosticsText, collectDiagnostics } from '@/lib/diagnostics';

export default function DiagnosticsScreen() {
  const insets = useSafeAreaInsets();
  const items = useMemo(() => collectDiagnostics(), []);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(t);
  }, [copied]);

  const handleCopy = async () => {
    const text = assembleDiagnosticsText(items);
    try {
      await Clipboard.setStringAsync(text);
      setCopied(true);
    } catch {
      // Clipboard rejection is rare on RN; swallow rather than alert.
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: tokens.color.bg.base }}>
      <Stack.Screen options={{ headerShown: false }} />
      <PushScreenHeader title="Diagnostics" subtitle="DEVICE · BUILD" />
      <ScrollView contentContainerStyle={{ paddingBottom: 32 + insets.bottom }}>
        <Card>
          {items.map((item) => (
            <Row key={item.label} label={item.label} value={item.value} valueMono />
          ))}
        </Card>

        <View style={{ paddingHorizontal: 16, paddingTop: 8, flexDirection: 'row' }}>
          <AmberCTA label={copied ? 'Copied' : 'Copy diagnostics'} onPress={handleCopy} />
        </View>

        <View style={{ paddingHorizontal: 16, paddingTop: 16 }}>
          <MonoLabel
            size={tokens.size.monoLabel}
            color={tokens.color.text.secondary}
            style={{ lineHeight: 18 }}
          >
            INCLUDE THIS BLOCK WHEN EMAILING SUPPORT.
          </MonoLabel>
        </View>
      </ScrollView>
    </View>
  );
}
