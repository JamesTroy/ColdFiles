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
 * Per CLAUDE.md: hooks before early returns.
 */

import * as Clipboard from 'expo-clipboard';
import { router, Stack } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AmberCTA } from '@/components/cf/cta-button';
import { Mono, MonoLabel, SansBody, SerifTitle } from '@/components/cf/text';
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
      <ScrollView contentContainerStyle={{ paddingTop: insets.top + 8, paddingBottom: 32 }}>
        <View style={{ paddingHorizontal: 16, paddingBottom: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <View style={{ flex: 1 }}>
            <SerifTitle size="h2" style={{ fontSize: 22 }}>
              Diagnostics
            </SerifTitle>
            <MonoLabel
              size={tokens.size.monoLabel}
              color={tokens.color.text.secondary}
              style={{ marginTop: 4 }}
            >
              RUNTIME · BUILD · DEVICE
            </MonoLabel>
          </View>
          <Pressable
            onPress={() => router.back()}
            accessibilityRole="button"
            accessibilityLabel="Close"
            hitSlop={12}
            style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1, paddingHorizontal: 4 })}
          >
            <SansBody style={{ color: tokens.color.text.secondary, fontSize: 13 }}>Close</SansBody>
          </Pressable>
        </View>

        <Card>
          {items.map((item, idx) => (
            <Row
              key={item.label}
              label={item.label}
              value={item.value}
              isFirst={idx === 0}
            />
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

function Card({ children }: { children: React.ReactNode }) {
  return (
    <View
      style={{
        marginHorizontal: 16,
        marginBottom: 12,
        backgroundColor: tokens.color.bg.elev1,
        borderColor: tokens.color.border.subtle,
        borderWidth: 0.5,
        borderRadius: 6,
        overflow: 'hidden',
      }}
    >
      {children}
    </View>
  );
}

function Row({ label, value, isFirst }: { label: string; value: string; isFirst?: boolean }) {
  return (
    <View
      style={{
        paddingHorizontal: 13,
        paddingVertical: 13,
        borderTopWidth: isFirst ? 0 : 0.5,
        borderTopColor: tokens.color.border.subtle,
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        gap: 12,
      }}
    >
      <SansBody style={{ fontSize: 13.5 }}>{label}</SansBody>
      <Mono
        size={12}
        style={{ color: tokens.color.text.secondary, flexShrink: 1, textAlign: 'right' }}
        numberOfLines={1}
        ellipsizeMode="middle"
      >
        {value}
      </Mono>
    </View>
  );
}
