/**
 * Me tab — profile, notification settings, premium tier, FAQ.
 *
 * Surfaces the trust-disclosure callout (full version) under "How does
 * The Cold File handle tips?" — same promise, repeated. Per the design
 * system: redundancy is the point.
 */

import { ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { TrustDisclosureCallout } from '@/components/cf/trust-disclosure';
import { MonoLabel, SansBody, SansMedium, SerifTitle } from '@/components/cf/text';
import { tokens } from '@/constants/theme';

export default function MeScreen() {
  const insets = useSafeAreaInsets();
  return (
    <View style={{ flex: 1, backgroundColor: tokens.color.bg.base }}>
      <ScrollView
        contentContainerStyle={{
          paddingTop: insets.top + 8,
          paddingBottom: 32,
        }}
      >
        <View style={{ paddingHorizontal: 16, paddingBottom: 16 }}>
          <SerifTitle size="h2" style={{ fontSize: 19 }}>
            Me
          </SerifTitle>
          <MonoLabel size={tokens.size.monoLabel} style={{ marginTop: 2 }}>
            FREE TIER
          </MonoLabel>
        </View>

        {/* Settings rows — placeholders */}
        <Section label="ALERTS">
          <Row label="Watch zones" value="0 zones" />
          <Row label="Push notifications" value="Off" />
        </Section>

        <Section label="ACCOUNT">
          <Row label="Sign in" value="—" />
          <Row label="Premium" value="Upgrade" valueColor={tokens.color.accent.amber} />
        </Section>

        <Section label="HOW IT WORKS">
          <View style={{ paddingHorizontal: 16, paddingTop: 8 }}>
            <SansBody
              style={{
                color: tokens.color.text.secondary,
                lineHeight: tokens.size.body * 1.6,
                marginBottom: 12,
              }}
            >
              The Cold File is a directory of public unsolved-case data —
              missing persons, unidentified decedents, and unsolved homicides —
              aggregated from public sources and routed back to the
              investigating agency.
            </SansBody>
            <SansMedium size={tokens.size.body} style={{ marginBottom: 8 }}>
              How does The Cold File handle tips?
            </SansMedium>
            <TrustDisclosureCallout agencyName="the investigating agency" />
          </View>
        </Section>
      </ScrollView>
    </View>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={{ marginTop: 18 }}>
      <View style={{ paddingHorizontal: 16, paddingBottom: 8 }}>
        <MonoLabel size={tokens.size.monoLabel}>{label}</MonoLabel>
      </View>
      {children}
    </View>
  );
}

function Row({
  label,
  value,
  valueColor,
}: {
  label: string;
  value: string;
  valueColor?: string;
}) {
  return (
    <View
      style={{
        paddingHorizontal: 16,
        paddingVertical: 14,
        borderTopWidth: 0.5,
        borderBottomWidth: 0.5,
        borderColor: tokens.color.border.subtle,
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        backgroundColor: tokens.color.bg.elev1,
      }}
    >
      <SansBody>{label}</SansBody>
      <SansBody style={{ color: valueColor ?? tokens.color.text.secondary }}>{value}</SansBody>
    </View>
  );
}
