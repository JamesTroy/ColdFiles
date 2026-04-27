/**
 * Submit-tip modal.
 *
 * Choreography (docs/04_DESIGN_SYSTEM.md "Tip-flow choreography"):
 *
 *   T+0     User taps the AmberCTA.
 *           submit() fires (hashes content locally, hits tip-route-submit Edge
 *           Function, returns the resolved deep-link target). UI enters the
 *           anticipation state — CTA dims slightly, no spinner.
 *   T+200ms Attempt the deep link. Use Linking.canOpenURL to detect failure.
 *           ├─ success → fade modal away into the SuccessFlash on case detail
 *           └─ failure → swap the CTA for the FallbackBar (Copy link · phone)
 *
 * The 200ms anticipation pause is what gives the success flash room to read
 * as the success signal. Tune on a real device — the value lives in
 * ANTICIPATION_MS so it's one constant, not scattered timing.
 *
 * The hook itself does the optimistic server insert + content-hash + audit
 * row. The screen owns the UI timing.
 */

import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import * as Linking from 'expo-linking';
import { router } from 'expo-router';
import { useState } from 'react';
import {
  Pressable,
  ScrollView,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AmberCTA } from '@/components/cf/cta-button';
import { RadioCard } from '@/components/cf/radio-card';
import {
  InfoText,
  Mono,
  MonoLabel,
  SansBody,
  SansMedium,
  SerifTitle,
} from '@/components/cf/text';
import { TrustDisclosureCallout } from '@/components/cf/trust-disclosure';
import { tokens } from '@/constants/theme';
import { useSubmitTip, type SubmitTipResult } from '@/lib/hooks/use-submit-tip';

interface Route {
  id: string;
  agency: { name: string; short_name?: string };
  meta: string;
  recommended: boolean;
}

// Static sample for the LA-county v1 case — backend wiring lands when
// agencies + cases are queryable. Mirrors what tip-route-submit will return.
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

type ModalPhase = 'idle' | 'anticipating' | 'fallback';

export default function TipModalScreen() {
  const insets = useSafeAreaInsets();
  const [selectedId, setSelectedId] = useState(
    SAMPLE_ROUTES.find((r) => r.recommended)?.id ?? SAMPLE_ROUTES[0].id,
  );
  const [tipBody, setTipBody] = useState('');
  const [phase, setPhase] = useState<ModalPhase>('idle');
  const [fallbackResult, setFallbackResult] = useState<SubmitTipResult | null>(null);

  const selected = SAMPLE_ROUTES.find((r) => r.id === selectedId)!;
  const ctaLabel = tokens.tipFlow.ctaCopy(selected.agency);

  const { submit, submitting } = useSubmitTip();

  // The actual case_id from the route param. For sample data we use the slug
  // both as id and as slug (the hook's caseSlug field) — the Edge Function
  // resolves on caseId, the receipt store on caseSlug.
  const caseId = selected.id; // TODO: pull from route params + the case query
  const caseSlug = 'evans-1985';

  const handleSubmit = async () => {
    if (phase !== 'idle' && phase !== 'fallback') return;

    setPhase('anticipating');
    setFallbackResult(null);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});

    try {
      // T+0: optimistic insert via hook. Don't block the anticipation pause.
      const resultPromise = submit({
        caseId,
        caseSlug,
        content: tipBody,
        userAgentSummary: 'mobile/expo',
      });

      // T+0..anticipationMs: anticipation. Run the wait in parallel with the
      // insert so the deep-link attempt fires as soon as both are ready.
      await new Promise((r) => setTimeout(r, tokens.tipFlow.anticipationMs));
      const result = await resultPromise;

      // T+200ms: attempt deep link.
      const target = result.tip_url ?? (result.tip_phone ? `tel:${result.tip_phone}` : null);
      if (!target) {
        // No url and no phone — surface as fallback so the user isn't stuck.
        setFallbackResult(result);
        setPhase('fallback');
        return;
      }

      const canOpen = await Linking.canOpenURL(target).catch(() => false);
      if (!canOpen) {
        setFallbackResult(result);
        setPhase('fallback');
        return;
      }

      // Hand off. The case detail screen consumes the device-local receipt
      // (markCaseTipped already fired inside submit()) so when the user
      // returns, the bar shows the receipt state.
      await Linking.openURL(target);
      router.back();
    } catch {
      // submit() failed — also surface as fallback. Trust contract still holds.
      setFallbackResult(null);
      setPhase('fallback');
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: tokens.color.bg.base }}>
      <ScrollView contentContainerStyle={{ paddingTop: insets.top + 8, paddingBottom: 200 }}>
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

        <View style={{ paddingHorizontal: 16, paddingTop: 18 }}>
          <MonoLabel
            size={tokens.size.monoChip}
            tracking={tokens.tracking.chip}
            style={{ marginBottom: 10 }}
          >
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

        <View style={{ paddingHorizontal: 16, paddingTop: 18 }}>
          <MonoLabel
            size={tokens.size.monoChip}
            tracking={tokens.tracking.chip}
            style={{ marginBottom: 8 }}
          >
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
              editable={phase === 'idle'}
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

        <View style={{ paddingHorizontal: 16, paddingTop: 14 }}>
          <TrustDisclosureCallout agencyName={selected.agency.name} />
        </View>
      </ScrollView>

      {/* Sticky bar — switches between the AmberCTA and the FallbackBar. */}
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
        {phase === 'fallback' ? (
          <FallbackBar
            agencyName={fallbackResult?.agency_name ?? selected.agency.name}
            tipUrl={fallbackResult?.tip_url ?? null}
            tipPhone={fallbackResult?.tip_phone ?? null}
            onRetry={() => {
              setPhase('idle');
              handleSubmit();
            }}
          />
        ) : (
          <AmberCTA
            label={ctaLabel}
            loading={submitting || phase === 'anticipating'}
            onPress={handleSubmit}
          />
        )}
      </View>
    </View>
  );
}

/**
 * Fallback bar — replaces the AmberCTA when the deep-link attempt fails.
 *
 * Layout per the design doc: helper line above (mono 10px text.info on a 2px
 * you.here left edge — the user-trust-contract surface, since the app is
 * talking to the user about their routing problem), then a Copy-link button
 * + a tappable phone number.
 */
function FallbackBar({
  agencyName,
  tipUrl,
  tipPhone,
  onRetry,
}: {
  agencyName: string;
  tipUrl: string | null;
  tipPhone: string | null;
  onRetry: () => void;
}) {
  const [copied, setCopied] = useState(false);

  return (
    <View>
      <View
        style={{
          backgroundColor: tokens.color.bg.base,
          borderLeftWidth: 2,
          borderLeftColor: tokens.color.you.here,
          paddingVertical: 8,
          paddingHorizontal: 12,
          marginBottom: 12,
        }}
      >
        <InfoText>
          {`Couldn't open the ${agencyName} form. You can still route the tip manually.`}
        </InfoText>
      </View>

      <View style={{ flexDirection: 'row', gap: 10 }}>
        {tipUrl ? (
          <Pressable
            onPress={async () => {
              await Clipboard.setStringAsync(tipUrl);
              setCopied(true);
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
              setTimeout(() => setCopied(false), 1600);
            }}
            style={({ pressed }) => [
              {
                flex: 1,
                backgroundColor: tokens.color.accent.amber,
                paddingVertical: 14,
                borderRadius: tokens.radius.card,
                alignItems: 'center',
                justifyContent: 'center',
                opacity: pressed ? 0.85 : 1,
              },
            ]}
          >
            <SansMedium
              size={tokens.size.body}
              style={{ color: '#1a1408', letterSpacing: 0 }}
            >
              {copied ? 'Copied' : 'Copy link'}
            </SansMedium>
          </Pressable>
        ) : (
          <AmberCTA label="Try again" onPress={onRetry} />
        )}

        {tipPhone ? (
          <Pressable
            onPress={() => {
              Linking.openURL(`tel:${tipPhone}`).catch(() => {});
            }}
            style={({ pressed }) => [
              {
                paddingVertical: 14,
                paddingHorizontal: 16,
                borderRadius: tokens.radius.card,
                backgroundColor: tokens.color.bg.elev1,
                borderWidth: 0.5,
                borderColor: tokens.color.border.strong,
                alignItems: 'center',
                justifyContent: 'center',
                opacity: pressed ? 0.7 : 1,
              },
            ]}
          >
            <Mono size={tokens.size.body} style={{ color: tokens.color.text.primary }}>
              {tipPhone}
            </Mono>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}
