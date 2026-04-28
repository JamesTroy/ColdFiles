/**
 * Me tab — profile, subscription, counts, source credits, about.
 *
 * Layout (matches prototype):
 *   - Three cards stacked
 *     1. Subscription · Premium upgrade row → Watch Zone screen
 *     2. Tips submitted · Cases saved (real counts from useMeCounts)
 *     3. Source credits · Takedown · About
 *   - Footer: app version + LLC line in mono evidence-chrome
 *
 * The Premium row routes to /watch-zone (the new screen below).
 */

import { router } from 'expo-router';
import { Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Mono, MonoLabel, SansBody, SerifTitle } from '@/components/cf/text';
import { tokens } from '@/constants/theme';
import { useMeCounts } from '@/lib/hooks/use-me-counts';

interface RowProps {
  label: string;
  value: string;
  valueColor?: string;
  valueMono?: boolean;
  onPress?: () => void;
}

export default function MeScreen() {
  const insets = useSafeAreaInsets();
  const counts = useMeCounts();

  return (
    <View style={{ flex: 1, backgroundColor: tokens.color.bg.base }}>
      <ScrollView contentContainerStyle={{ paddingTop: insets.top + 8, paddingBottom: 32 }}>
        <View style={{ paddingHorizontal: 16, paddingBottom: 16 }}>
          <SerifTitle size="h2" style={{ fontSize: 22 }}>
            Me
          </SerifTitle>
          <MonoLabel
            size={tokens.size.monoLabel}
            color={tokens.color.evidence.chrome}
            style={{ marginTop: 4 }}
          >
            ACCOUNT · SUBSCRIPTION · PRIVACY
          </MonoLabel>
        </View>

        {/* Card 1 — Subscription */}
        <Card>
          <Row label="Subscription" value="FREE" valueMono />
          <Row
            label="Premium · watch zones"
            value="UPGRADE →"
            valueColor={tokens.color.accent.amber}
            valueMono
            onPress={() => router.push('/watch-zone')}
          />
        </Card>

        {/* Card 2 — User counts */}
        <Card>
          <Row
            label="Tips submitted"
            value={String(counts.submittedTips)}
            valueMono
          />
          <Row
            label="Cases saved"
            value={String(counts.savedCases)}
            valueMono
          />
        </Card>

        {/* Card 3 — Sources / takedown / about */}
        <Card>
          <Row label="Source credits" value="5 sources" />
          <Row label="Takedown request" value="→" />
          <Row label="About · mission" value="→" />
        </Card>

        {/* Footer */}
        <View style={{ paddingHorizontal: 16, paddingTop: 16 }}>
          <MonoLabel
            size={tokens.size.monoLabel}
            color={tokens.color.evidence.chrome}
            style={{ lineHeight: 18 }}
          >
            THE COLD FILE · v0.1.0 (prototype){'\n'}MATTE BLACK DEV LLC · VENTURA, CA
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

function Row({ label, value, valueColor, valueMono, onPress }: RowProps) {
  const content = (
    <View
      style={{
        paddingHorizontal: 13,
        paddingVertical: 13,
        borderTopWidth: 0.5,
        borderTopColor: tokens.color.border.subtle,
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
      }}
    >
      <SansBody style={{ fontSize: 13.5 }}>{label}</SansBody>
      {valueMono ? (
        <Mono
          size={13}
          style={{ color: valueColor ?? tokens.color.text.secondary }}
        >
          {value}
        </Mono>
      ) : (
        <SansBody
          style={{ color: valueColor ?? tokens.color.text.secondary, fontSize: 13 }}
        >
          {value}
        </SansBody>
      )}
    </View>
  );

  if (onPress) {
    return (
      <Pressable onPress={onPress} style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}>
        {content}
      </Pressable>
    );
  }
  return content;
}
