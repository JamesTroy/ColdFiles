/**
 * Case detail screen — slug-keyed.
 *
 * Wired to useCaseDetail() — three reads run in parallel (case row + agency
 * join, case_sources, case_media). Renders progressively as each settles.
 *
 * Every visual rule from docs/04_DESIGN_SYSTEM.md "Case detail screen" is
 * enforced by the cf/* components themselves, not by per-render styles. The
 * pill grammar, the photo-frame contract, the trust-disclosure caption, the
 * source-chip ordering — all carried by the primitives.
 */

import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AmberCTA, SecondaryCTA } from '@/components/cf/cta-button';
import { KeyFactsTable, type KeyFact } from '@/components/cf/key-facts';
import { PhotoFrame } from '@/components/cf/photo-frame';
import { ColdPill, UnsolvedPill } from '@/components/cf/pill';
import { SourceChipRow } from '@/components/cf/source-chip';
import { SuccessFlash } from '@/components/cf/success-flash';
import {
  Mono,
  MonoLabel,
  NarrativeText,
  SansBody,
  SansMedium,
  SerifTitle,
} from '@/components/cf/text';
import { TrustDisclosureCaption } from '@/components/cf/trust-disclosure';
import { tokens } from '@/constants/theme';
import { displayName, formatDateMonthDay, formatPlace } from '@/lib/format';
import { useCaseDetail } from '@/lib/hooks/use-case-detail';
import { useSubmittedTip } from '@/lib/hooks/use-submitted-tips';
import type { CaseMediaRow, CaseRowFull, CaseSourceRow } from '@/lib/types/database';

const KIND_DISPLAY: Record<CaseRowFull['kind'], string> = {
  homicide: 'Homicide',
  missing: 'Missing',
  unidentified: 'Unidentified',
  unclaimed: 'Unclaimed',
  suspicious_death: 'Suspicious Death',
};

export default function CaseDetailScreen() {
  const insets = useSafeAreaInsets();
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const [saved, setSaved] = useState(false);

  const { data, loading, error } = useCaseDetail(slug);
  const { receipt } = useSubmittedTip(slug);
  const c = data.case;

  if (loading && !c) {
    return <FullPageState>{<ActivityIndicator color={tokens.color.accent.amber} />}</FullPageState>;
  }

  if (error || !c) {
    return (
      <FullPageState>
        <SerifTitle size="h1" style={{ fontSize: 48, color: tokens.color.text.secondary, marginBottom: 16 }}>
          —
        </SerifTitle>
        <SansBody
          style={{
            color: tokens.color.text.secondary,
            textAlign: 'center',
            lineHeight: tokens.size.body * 1.5,
            paddingHorizontal: 32,
          }}
        >
          {error ? `Couldn't load case: ${error.message}` : 'This case is no longer available.'}
        </SansBody>
        <Pressable onPress={() => router.back()} style={{ marginTop: 24 }}>
          <Mono size={tokens.size.meta} style={{ color: tokens.color.accent.amber }}>
            ← Back
          </Mono>
        </Pressable>
      </FullPageState>
    );
  }

  const coldText = tokens.caseDetail.coldPill(
    c.incident_date ? new Date(c.incident_date) : null,
    c.incident_date_quality,
  );

  const facts = buildKeyFacts(c);
  const photoUri = primaryPhotoUri(data.media);
  const photoCaption = buildPhotoCaption(c, data.media[0] ?? null);
  const heroName = displayName(c);

  return (
    <View style={{ flex: 1, backgroundColor: tokens.color.bg.base }}>
      {/* Top chrome */}
      <View
        style={{
          paddingTop: insets.top + 6,
          paddingHorizontal: 16,
          paddingBottom: 12,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <CircleButton onPress={() => router.back()}>
          <Ionicons name="chevron-back" size={18} color={tokens.color.text.primary} />
        </CircleButton>
        <Mono
          size={tokens.size.monoLabel}
          style={{
            color: tokens.color.text.secondary,
            letterSpacing: tokens.size.monoLabel * tokens.tracking.label,
          }}
        >
          {c.case_number_primary ?? c.slug.toUpperCase()}
        </Mono>
        <CircleButton onPress={() => {}}>
          <Ionicons name="share-outline" size={16} color={tokens.color.text.primary} />
        </CircleButton>
      </View>

      <ScrollView contentContainerStyle={{ paddingBottom: 140 }}>
        <PhotoFrame uri={photoUri} caption={photoCaption} />

        <View style={{ paddingHorizontal: 16, paddingTop: 16 }}>
          <SerifTitle size="h1">{heroName}</SerifTitle>
          {c.victim_age != null ? (
            <SansBody
              style={{ color: tokens.color.text.secondary, fontSize: tokens.size.meta, marginTop: 4 }}
            >
              {`Age ${c.victim_age}${c.victim_race ? ` · ${c.victim_race}` : ''}`}
            </SansBody>
          ) : null}

          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 12 }}>
            <UnsolvedPill />
            <ColdPill text={coldText} />
          </View>
        </View>

        <View style={{ paddingHorizontal: 16, marginTop: 18 }}>
          <KeyFactsTable facts={facts} />
        </View>

        {c.narrative ? (
          <View style={{ paddingHorizontal: 16, marginTop: 18 }}>
            <MonoLabel size={tokens.size.monoChip} tracking={tokens.tracking.chip} style={{ marginBottom: 8 }}>
              CASE FILE
            </MonoLabel>
            <NarrativeText>{c.narrative}</NarrativeText>
            <Pressable onPress={() => {}}>
              <Mono size={tokens.size.meta} style={{ color: tokens.color.accent.amber, marginTop: 10 }}>
                Read full file →
              </Mono>
            </Pressable>
          </View>
        ) : null}

        {data.sources.length > 0 ? (
          <View style={{ paddingHorizontal: 16, marginTop: 18 }}>
            <MonoLabel size={tokens.size.monoChip} tracking={tokens.tracking.chip} style={{ marginBottom: 8 }}>
              {`SOURCES · ${data.sources.length}`}
            </MonoLabel>
            <SourceChipRow chips={sourceChipsFor(data.sources)} />
          </View>
        ) : null}
      </ScrollView>

      {/* Sticky bar */}
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
        {receipt ? (
          <ReceiptCaption agencyName={receipt.agencyName} submittedAt={receipt.submittedAt} />
        ) : null}

        <View style={{ flexDirection: 'row', gap: 10 }}>
          {receipt ? (
            <ReceiptCTA onPress={() => router.push(`/tip/${c.slug}`)} />
          ) : (
            <AmberCTA
              label="Submit a tip"
              onPress={() => router.push(`/tip/${c.slug}`)}
            />
          )}
          <SecondaryCTA active={saved} onPress={() => setSaved((s) => !s)}>
            <Ionicons
              name={saved ? 'star' : 'star-outline'}
              size={18}
              color={saved ? tokens.color.accent.amber : tokens.color.text.primary}
            />
          </SecondaryCTA>
        </View>
        <TrustDisclosureCaption />
      </View>
    </View>
  );
}

/**
 * Receipt caption: ✓ ROUTED TO {AGENCY} · {relative date}.
 * Mono caps in evidence.chrome — receipt register, not active.
 *
 * On a FRESH receipt (submitted within the last 5 seconds, i.e. the user just
 * came back from the agency's tip portal), the {AGENCY} segment fires the
 * SuccessFlash — the only sanctioned use of tip.success in the entire app.
 */
const FRESH_RECEIPT_WINDOW_MS = 5_000;

function ReceiptCaption({
  agencyName,
  submittedAt,
}: {
  agencyName: string;
  submittedAt: string;
}) {
  const label = relativeReceiptLabel(submittedAt);
  const ageMs = Date.now() - new Date(submittedAt).getTime();
  const isFresh = ageMs >= 0 && ageMs <= FRESH_RECEIPT_WINDOW_MS;

  // Identical layout for fresh and settled — only the agency-name segment
  // animates color. Two MonoLabels for the prefix/suffix bookends and a
  // SuccessFlash for the agency name in the middle.
  return (
    <View
      style={{
        flexDirection: 'row',
        flexWrap: 'wrap',
        marginBottom: 8,
        alignItems: 'baseline',
      }}
    >
      <MonoLabel
        size={tokens.size.monoLabel}
        tracking={tokens.tracking.chip}
        color={tokens.color.evidence.chrome}
      >
        {'✓ ROUTED TO '}
      </MonoLabel>
      <SuccessFlash
        trigger={isFresh}
        baseColor={tokens.color.evidence.chrome}
        style={{
          fontFamily: tokens.font.mono,
          fontSize: tokens.size.monoLabel,
          letterSpacing: tokens.size.monoLabel * tokens.tracking.chip,
        }}
      >
        {agencyName.toUpperCase()}
      </SuccessFlash>
      <MonoLabel
        size={tokens.size.monoLabel}
        tracking={tokens.tracking.chip}
        color={tokens.color.evidence.chrome}
      >
        {` · ${label}`}
      </MonoLabel>
    </View>
  );
}

/**
 * Receipt CTA — desaturated variant of the AmberCTA. Tappable to submit
 * another tip. Border carries the affordance, dim bg reinforces it (same
 * "border carries selection, bg reinforces" rule as the radio cards).
 */
function ReceiptCTA({ onPress }: { onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        {
          flex: 1,
          backgroundColor: tokens.color.bg.amberTintCard,
          borderColor: tokens.color.evidence.chrome,
          borderWidth: 1,
          paddingVertical: 14,
          borderRadius: tokens.radius.card,
          alignItems: 'center',
          justifyContent: 'center',
          opacity: pressed ? 0.85 : 1,
        },
      ]}
    >
      <SansMedium size={tokens.size.body} style={{ color: tokens.color.text.primary }}>
        Send another tip
      </SansMedium>
    </Pressable>
  );
}

function relativeReceiptLabel(iso: string): string {
  const submitted = new Date(iso);
  const now = new Date();
  const sameDay =
    submitted.getFullYear() === now.getFullYear() &&
    submitted.getMonth() === now.getMonth() &&
    submitted.getDate() === now.getDate();
  if (sameDay) return 'TODAY';

  const sameYear = submitted.getFullYear() === now.getFullYear();
  const month = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'][
    submitted.getMonth()
  ];
  if (sameYear) return `${month} ${submitted.getDate()}`;
  return `${month} ${submitted.getFullYear()}`;
}

function buildKeyFacts(c: CaseRowFull): KeyFact[] {
  const out: KeyFact[] = [
    { label: 'TYPE', value: KIND_DISPLAY[c.kind] },
  ];

  if (c.incident_date) {
    out.push({
      label: 'DATE',
      value: formatDateMonthDay(c.incident_date),
      mono: true,
    });
  } else if (c.incident_date_text) {
    out.push({ label: 'DATE', value: c.incident_date_text });
  }

  const place = formatPlace(c);
  if (place) out.push({ label: 'LOCATION', value: place });

  if (c.primary_agency?.name) {
    out.push({ label: 'AGENCY', value: c.primary_agency.name });
  }

  return out;
}

function primaryPhotoUri(media: CaseMediaRow[]): string | null {
  const primary = media.find((m) => m.is_primary && m.kind === 'photo_victim');
  if (primary?.url) return primary.url;
  const anyPhoto = media.find((m) => m.kind.startsWith('photo'));
  return anyPhoto?.url ?? null;
}

function buildPhotoCaption(c: CaseRowFull, primary: CaseMediaRow | null): string {
  const sourceLabel = primary?.source_id
    ? 'PHOTO 01' // sources name lookup happens in a future enrichment pass
    : 'PHOTO 01';
  const agencyName = c.primary_agency?.name?.toUpperCase() ?? 'CASE FILE';
  const year = c.incident_date ? c.incident_date.slice(0, 4) : '—';
  return `${sourceLabel} · ${agencyName} · ${year}`;
}

function sourceChipsFor(sources: CaseSourceRow[]): { slug: string; url: string }[] {
  return sources.map((s) => {
    // Show the source's slug (per design system — case-detail surface uses
    // SOURCE / lasd.org style chips).
    const display = s.source?.slug ?? new URL(s.source_url).hostname;
    return { slug: display, url: s.source_url };
  });
}

function CircleButton({
  children,
  onPress,
}: {
  children: React.ReactNode;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        {
          width: 32,
          height: 32,
          borderRadius: 16,
          backgroundColor: tokens.color.bg.elev1,
          borderWidth: 0.5,
          borderColor: tokens.color.border.strong,
          alignItems: 'center',
          justifyContent: 'center',
          opacity: pressed ? 0.7 : 1,
        },
      ]}
    >
      {children}
    </Pressable>
  );
}

function FullPageState({ children }: { children: React.ReactNode }) {
  return (
    <View
      style={{
        flex: 1,
        backgroundColor: tokens.color.bg.base,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {children}
    </View>
  );
}
