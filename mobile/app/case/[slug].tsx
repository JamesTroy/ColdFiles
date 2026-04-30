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
import { ActivityIndicator, Pressable, ScrollView, Share, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AmberCTA, SecondaryCTA } from '@/components/cf/cta-button';
import { ErrorState } from '@/components/cf/error-state';
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
import { TrustDisclosureCallout, TrustDisclosureCaption } from '@/components/cf/trust-disclosure';
import { tokens } from '@/constants/theme';
import { displayName, formatDateMonthDay, formatPlace } from '@/lib/format';
import { useCaseDetail } from '@/lib/hooks/use-case-detail';
import { useFreshReceiptCount } from '@/lib/hooks/use-fresh-receipt';
import { useIsSaved } from '@/lib/hooks/use-saved-cases';
import { useSubmittedTip } from '@/lib/hooks/use-submitted-tips';
import { effectivePhotoUri } from '@/lib/photo-policy';
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

  const { data, loading, error, refetch } = useCaseDetail(slug);
  const { receipt } = useSubmittedTip(slug);
  const { isSaved, toggle: toggleSave } = useIsSaved(slug);
  const flashKey = useFreshReceiptCount(slug);
  const c = data.case;
  const [narrativeExpanded, setNarrativeExpanded] = useState(false);

  const handleShare = async () => {
    if (!c) return;
    const heroName = displayName(c);
    const place = c.location_text ?? c.location_city ?? '';
    const year = c.incident_date ? c.incident_date.slice(0, 4) : '';
    const yearAndPlace = [year, place].filter(Boolean).join(' · ');
    // Deep link back into the app for users who already have it; otherwise
    // the URL falls through to the web property at coldfile.app/case/{slug}.
    const url = `https://coldfile.app/case/${c.slug}`;
    const message = [
      `${heroName} — unsolved`,
      yearAndPlace,
      url,
      '',
      'Shared from The Cold File',
    ]
      .filter(Boolean)
      .join('\n');
    try {
      await Share.share({ message, url, title: heroName });
    } catch {
      // user dismissed, or no share sheet available — silent
    }
  };

  if (loading && !c) {
    return <FullPageState>{<ActivityIndicator color={tokens.color.accent.amber} />}</FullPageState>;
  }

  if (error || !c) {
    return (
      <FullPageState>
        <ErrorState
          title={error ? "Couldn't load this case." : 'This case is no longer available.'}
          detail={error?.message ?? null}
          onRetry={error ? refetch : undefined}
        />
        <Pressable
          onPress={() => router.back()}
          style={{ marginTop: 8 }}
          accessibilityRole="button"
          accessibilityLabel="Back"
          hitSlop={12}
        >
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
  const primaryMedia = primaryMediaRow(data.media);
  const photoCaption = buildPhotoCaption(c, primaryMedia);
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
        <CircleButton onPress={() => router.back()} accessibilityLabel="Back">
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
        <CircleButton onPress={handleShare} accessibilityLabel="Share case">
          <Ionicons name="share-outline" size={16} color={tokens.color.text.primary} />
        </CircleButton>
      </View>

      <ScrollView contentContainerStyle={{ paddingBottom: 140 }}>
        <PhotoFrame
          uri={effectivePhotoUri(primaryMedia)}
          caption={photoCaption}
          isReconstruction={primaryMedia?.is_reconstruction ?? false}
          displayWarning={primaryMedia?.display_warning ?? null}
        />

        <View style={{ paddingHorizontal: 16, paddingTop: 16 }}>
          <SerifTitle size="h1">{heroName}</SerifTitle>
          {subtitleFor(c) ? (
            <SansBody
              style={{ color: tokens.color.text.secondary, fontSize: tokens.size.meta, marginTop: 4 }}
            >
              {subtitleFor(c)}
            </SansBody>
          ) : null}

          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 12 }}>
            {c.status === 'open' ? <UnsolvedPill /> : null}
            {/* ResolvedPill rendering deferred to v1.0.1 — cases table lacks
                a resolved_at column to source the year. Closed-testing seed
                is all status='open' so the branch is never visible. */}
            <ColdPill text={coldText} />
          </View>
        </View>

        {receipt ? (
          <ReceiptBlock
            agencyName={receipt.agencyName}
            submittedAt={receipt.submittedAt}
            flashKey={flashKey}
          />
        ) : null}

        <View style={{ paddingHorizontal: 16, marginTop: 18 }}>
          <KeyFactsTable facts={facts} />
        </View>

        {c.narrative ? (
          <View style={{ paddingHorizontal: 16, marginTop: 22 }}>
            <MonoLabel
              size={tokens.size.monoChip}
              tracking={tokens.tracking.chip}
              color={tokens.color.text.secondary}
              style={{ marginBottom: 8 }}
            >
              CASE FILE
            </MonoLabel>
            <NarrativeText>
              {narrativeExpanded ? c.narrative : truncateNarrative(c.narrative)}
            </NarrativeText>
            {needsTruncation(c.narrative) ? (
              <Pressable
                onPress={() => setNarrativeExpanded((prev) => !prev)}
                accessibilityRole="button"
                accessibilityLabel={
                  narrativeExpanded ? 'Collapse case file' : 'Read full case file'
                }
                hitSlop={8}
              >
                <Mono
                  size={tokens.size.meta}
                  style={{ color: tokens.color.accent.amber, marginTop: 10 }}
                >
                  {narrativeExpanded ? 'Show less ←' : 'Read full file →'}
                </Mono>
              </Pressable>
            ) : null}
          </View>
        ) : null}

        {data.sources.length > 0 ? (
          <View style={{ paddingHorizontal: 16, marginTop: 22 }}>
            <MonoLabel
              size={tokens.size.monoChip}
              tracking={tokens.tracking.chip}
              color={tokens.color.text.secondary}
              style={{ marginBottom: 8 }}
            >
              {`SOURCES · ${data.sources.length}`}
            </MonoLabel>
            <SourceChipRow chips={sourceChipsFor(data.sources)} />
          </View>
        ) : null}

        {/* Body-position trust callout — same promise as the sticky-bar caption,
            longer prose. Only shown when there's no receipt; once they've tipped,
            the receipt block above already establishes the trust contract. */}
        {!receipt ? (
          <View style={{ paddingHorizontal: 16, marginTop: 22 }}>
            <TrustDisclosureCallout
              agencyName={c.primary_agency?.name ?? 'the investigating agency'}
            />
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
        <View style={{ flexDirection: 'row', gap: 10 }}>
          {receipt ? (
            <ReceiptCTA onPress={() => router.push(`/tip/${c.slug}`)} />
          ) : (
            <AmberCTA
              label="Submit a tip"
              onPress={() => router.push(`/tip/${c.slug}`)}
            />
          )}
          <SecondaryCTA
            active={isSaved}
            onPress={() => { void toggleSave(); }}
            accessibilityLabel={isSaved ? 'Remove from saved cases' : 'Save case'}
          >
            <Ionicons
              name={isSaved ? 'star' : 'star-outline'}
              size={18}
              color={isSaved ? tokens.color.accent.amber : tokens.color.text.primary}
            />
          </SecondaryCTA>
        </View>
        <TrustDisclosureCaption />
      </View>
    </View>
  );
}

/**
 * Subtitle under the serif name. Composes from age + race/role for known
 * victims, or the demographic estimate for Doe cases.
 */
function subtitleFor(c: CaseRowFull): string | null {
  if (c.victim_age != null) {
    return `Age ${c.victim_age}${c.victim_race ? ` · ${c.victim_race}` : ''}`;
  }
  if (c.victim_race) return c.victim_race;
  return null;
}

/** Truncate the narrative to ~40 words for the entry screen. */
function truncateNarrative(text: string): string {
  const words = text.split(/\s+/);
  if (words.length <= 42) return text;
  return words.slice(0, 40).join(' ') + '…';
}

/** True when the narrative is long enough to warrant the Read-full-file toggle. */
function needsTruncation(text: string): boolean {
  return text.split(/\s+/).length > 42;
}

/**
 * Receipt block — the post-tip "✓ ROUTED" card on case detail.
 *
 * Layout (matches prototype): tinted amber-card bg, 2px tip.success red left
 * edge, "TIP ROUTED" mono label up top (which fires the SuccessFlash on the
 * agency name when flashKey changes), agency-receipt body, mono time-ago.
 *
 * The flash event is driven by useFreshReceiptCount, set by useSubmitTip on a
 * successful handoff — a transient event flag, not a wall-clock window. See
 * lib/hooks/use-fresh-receipt.ts for the rationale.
 */
function ReceiptBlock({
  agencyName,
  submittedAt,
  flashKey,
}: {
  agencyName: string;
  submittedAt: string;
  flashKey: number;
}) {
  const time = relativeReceiptLabel(submittedAt);
  return (
    <View
      style={{
        marginHorizontal: 16,
        marginTop: 16,
        paddingVertical: 12,
        paddingHorizontal: 14,
        backgroundColor: tokens.color.bg.amberTintCard,
        borderColor: tokens.color.evidence.chrome,
        borderWidth: 0.5,
        borderLeftColor: tokens.color.tip.success,
        borderLeftWidth: 2,
        borderRadius: 4,
        gap: 4,
      }}
    >
      <SuccessFlash
        flashKey={flashKey}
        baseColor={tokens.color.text.secondary}
        style={{
          fontFamily: tokens.font.mono,
          fontSize: tokens.size.monoLabel,
          letterSpacing: tokens.size.monoLabel * tokens.tracking.label,
        }}
      >
        TIP ROUTED
      </SuccessFlash>
      <SansBody style={{ color: tokens.color.text.primary, fontSize: tokens.size.narrative }}>
        {`${agencyName} received your tip.`}
      </SansBody>
      <MonoLabel
        size={tokens.size.monoLabel}
        tracking={0}
        color={tokens.color.text.disabled}
      >
        {time}
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
  const elapsedSec = Math.max(0, Math.floor((now.getTime() - submitted.getTime()) / 1000));
  if (elapsedSec < 60) return `${elapsedSec}s ago`;
  if (elapsedSec < 3600) return `${Math.floor(elapsedSec / 60)}m ago`;
  if (elapsedSec < 86400) return `${Math.floor(elapsedSec / 3600)}h ago`;

  const month = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'][
    submitted.getMonth()
  ];
  const sameYear = submitted.getFullYear() === now.getFullYear();
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

/**
 * The primary media row to render in the hero PhotoFrame. Prefers the
 * `is_primary` victim photo; falls back to any photo or reconstruction
 * (an unidentified case may only have a forensic reconstruction).
 */
function primaryMediaRow(media: CaseMediaRow[]): CaseMediaRow | null {
  const primary = media.find((m) => m.is_primary && m.kind === 'photo_victim');
  if (primary) return primary;
  const anyPhoto = media.find((m) => m.kind.startsWith('photo'));
  if (anyPhoto) return anyPhoto;
  // Last resort: a Doe with only a reconstruction available.
  return media.find((m) => m.kind === 'reconstruction' || m.kind === 'sketch_victim') ?? null;
}

/**
 * Caption: "PHOTO 01 · {SOURCE_ATTRIBUTION} · {YEAR}".
 * Per-photo attribution comes from the media row, not the case agency —
 * the photo's provenance can differ from the investigating agency
 * (NamUs portrait vs LASD bulletin).
 */
function buildPhotoCaption(c: CaseRowFull, primary: CaseMediaRow | null): string {
  const sourceLabel = 'PHOTO 01'; // numbering when we surface a gallery
  // Honest attribution: when neither the media row nor the case carries
  // provenance, render "ATTRIBUTION PENDING" rather than the lazy "CASE
  // FILE" fallback. This makes seed-data gaps visible instead of papering
  // over them — the photo policy treats attribution as mandatory, not
  // optional.
  const attribution =
    primary?.source_attribution?.toUpperCase() ??
    c.primary_agency?.name?.toUpperCase() ??
    'ATTRIBUTION PENDING';
  const year = c.incident_date ? c.incident_date.slice(0, 4) : '—';
  return `${sourceLabel} · ${attribution} · ${year}`;
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
  accessibilityLabel,
}: {
  children: React.ReactNode;
  onPress: () => void;
  accessibilityLabel?: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      hitSlop={12}
      style={({ pressed }) => [
        {
          width: 40,
          height: 40,
          borderRadius: 20,
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
