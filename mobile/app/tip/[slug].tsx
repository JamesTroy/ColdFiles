/**
 * Submit-tip modal.
 *
 * Three routing options, with the per-case override → agency-default →
 * federal-fallback resolution baked in. The recommended option carries the
 * RECOMMENDED badge; the others remain visible because some users have a
 * relationship with a specific detective or jurisdictional preference.
 *
 * The CTA copy uses tokens.tipFlow.ctaCopy() — which honors the
 * short_name → leading-acronym → "the agency" precedence chain so the button
 * never overflows on long agency names.
 *
 * The trust callout is non-negotiable. Repeated everywhere a tip is mentioned.
 */

import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AmberCTA } from '@/components/cf/cta-button';
import { RadioCard } from '@/components/cf/radio-card';
import {
  Mono,
  MonoLabel,
  SansBody,
  SerifTitle,
} from '@/components/cf/text';
import { TrustDisclosureCallout } from '@/components/cf/trust-disclosure';
import { tokens } from '@/constants/theme';

interface Route {
  id: string;
  agency: { name: string; short_name?: string };
  meta: string;
  recommended: boolean;
}

// Static sample for the LA-county v1 case — backend wiring lands when
// agencies + cases are queryable. The route shape mirrors what the resolver
// (case override → agency default → federal fallback) will return.
const SAMPLE_ROUTES: Route[] = [
  {
    id: 'la-crime-stoppers',
    agency: { name: 'LA Crime Stoppers', short_name: 'LA Crime Stoppers' },
    meta: 'Anonymous · routes to LASD detective on this case · reward eligible',
    recommended: true,
  },
  {
    id: 'lasd-direct',
    agency: { name: 'LASD Homicide Bureau', short_name: 'LASD Homicide' },
    meta: '323-890-5500 · direct line',
    recommended: false,
  },
  {
    id: 'fbi-tip',
    agency: { name: 'FBI Tip Line', short_name: 'FBI' },
    meta: 'Federal jurisdiction or interstate',
    recommended: false,
  },
];

export default function TipModalScreen() {
  const insets = useSafeAreaInsets();
  const [selectedId, setSelectedId] = useState(
    SAMPLE_ROUTES.find((r) => r.recommended)?.id ?? SAMPLE_ROUTES[0].id,
  );
  const [tipBody, setTipBody] = useState('');

  const selected = SAMPLE_ROUTES.find((r) => r.id === selectedId)!;
  const ctaLabel = tokens.tipFlow.ctaCopy(selected.agency);

  return (
    <View style={{ flex: 1, backgroundColor: tokens.color.bg.base }}>
      <ScrollView
        contentContainerStyle={{
          paddingTop: insets.top + 8,
          paddingBottom: 140,
        }}
      >
        {/* Grab handle */}
        <View
          style={{
            alignSelf: 'center',
            width: 36,
            height: 4,
            backgroundColor: tokens.color.border.strong,
            borderRadius: 2,
            marginTop: 4,
            marginBottom: 14,
          }}
        />

        {/* Title row */}
        <View
          style={{
            flexDirection: 'row',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
            paddingHorizontal: 16,
          }}
        >
          <View>
            <SerifTitle size="h2" style={{ fontSize: 19 }}>
              Submit a tip
            </SerifTitle>
            <SansBody
              style={{
                color: tokens.color.text.secondary,
                marginTop: 4,
                fontSize: tokens.size.meta,
              }}
            >
              re: David R. Evans · Oct 1985
            </SansBody>
          </View>
          <Pressable
            onPress={() => router.back()}
            style={({ pressed }) => [
              {
                width: 28,
                height: 28,
                borderRadius: 14,
                backgroundColor: tokens.color.bg.elev1,
                borderWidth: 0.5,
                borderColor: tokens.color.border.strong,
                alignItems: 'center',
                justifyContent: 'center',
                opacity: pressed ? 0.7 : 1,
              },
            ]}
          >
            <Ionicons name="close" size={16} color={tokens.color.text.secondary} />
          </Pressable>
        </View>

        {/* Route picker */}
        <View style={{ paddingHorizontal: 16, paddingTop: 18 }}>
          <MonoLabel size={tokens.size.monoChip} tracking={tokens.tracking.chip} style={{ marginBottom: 10 }}>
            ROUTE TO
          </MonoLabel>
          <View style={{ gap: 8 }}>
            {SAMPLE_ROUTES.map((route) => (
              <RadioCard
                key={route.id}
                title={route.agency.name}
                badge={route.recommended ? 'RECOMMENDED' : undefined}
                meta={route.meta}
                selected={selectedId === route.id}
                onPress={() => setSelectedId(route.id)}
              />
            ))}
          </View>
        </View>

        {/* Optional tip body — text composer (content never leaves the device until send) */}
        <View style={{ paddingHorizontal: 16, paddingTop: 18 }}>
          <MonoLabel size={tokens.size.monoChip} tracking={tokens.tracking.chip} style={{ marginBottom: 8 }}>
            YOUR TIP · OPTIONAL
          </MonoLabel>
          <View
            style={{
              backgroundColor: tokens.color.bg.base,
              borderColor: tokens.color.border.strong,
              borderWidth: 0.5,
              borderRadius: tokens.radius.card,
              padding: 12,
              minHeight: 80,
            }}
          >
            <TextInput
              value={tipBody}
              onChangeText={setTipBody}
              multiline
              placeholder={'e.g. "I knew David through PFF Bank in 1983–85. There was a colleague who…"'}
              placeholderTextColor="#4a4a4a"
              style={{
                color: tokens.color.text.primary,
                fontFamily: tokens.font.sans,
                fontSize: tokens.size.narrative,
                lineHeight: tokens.size.narrative * 1.5,
                minHeight: 60,
                fontStyle: tipBody ? 'normal' : 'italic',
              }}
            />
          </View>
        </View>

        {/* Trust callout — full version, blue edge + text.info body */}
        <View style={{ paddingHorizontal: 16, paddingTop: 14 }}>
          <TrustDisclosureCallout agencyName={selected.agency.name} />
        </View>
      </ScrollView>

      {/* Sticky CTA */}
      <View
        style={{
          backgroundColor: tokens.color.bg.base,
          borderTopWidth: 0.5,
          borderTopColor: tokens.color.border.subtle,
          paddingTop: 12,
          paddingHorizontal: 16,
          paddingBottom: insets.bottom > 0 ? insets.bottom + 8 : 28,
        }}
      >
        <AmberCTA
          label={ctaLabel}
          onPress={() => {
            // TODO: route to receiving agency, log tip_routings row, then
            // transition to success state with the tip.success flash.
            router.back();
          }}
        />
      </View>
    </View>
  );
}
