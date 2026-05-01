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
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Share, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { CaseLocationMap } from '@/components/cf/case-location-map';
import { AmberCTA, SecondaryCTA } from '@/components/cf/cta-button';
import { ErrorState } from '@/components/cf/error-state';
import { KeyFactsTable, type KeyFact } from '@/components/cf/key-facts';
import { PhotoFrame } from '@/components/cf/photo-frame';
import { PhotoGallery } from '@/components/cf/photo-gallery';
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
import { isMediaReconstruction } from '@/lib/types/database';

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

  // Hero swap state — gallery taps promote a media row into the PhotoFrame
  // slot. Hooks live up here, BEFORE any early returns, so the hook count
  // stays stable across renders. (A previous version put these after the
  // loading/error guards, which violated Rules of Hooks once `c` populated
  // on the second render and broke the screen with a "rendered more hooks
  // than during the previous render" abort that surfaced as a blank grey
  // screen.) primaryMediaRow returns null until media loads, which is fine.
  const defaultHero = useMemo(() => primaryMediaRow(data.media), [data.media]);
  const [heroId, setHeroId] = useState<string | null>(null);
  // Reset the promotion when the user navigates to a different case.
  // Guard against undefined slug during the first render before the route
  // params resolve.
  useEffect(() => setHeroId(null), [slug]);

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
  // heroMedia derives from the hooks declared above; falls back to the
  // primary photo when the user hasn't promoted anything.
  const heroMedia =
    (heroId && data.media.find((m) => m.id === heroId)) || defaultHero;
  const photoCaption = buildPhotoCaption(c, heroMedia, data.sources);
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
          uri={effectivePhotoUri(heroMedia)}
          caption={photoCaption}
          isReconstruction={isMediaReconstruction(heroMedia)}
          displayWarning={heroMedia?.display_warning ?? null}
        />

        <PhotoGallery
          media={data.media}
          heroId={heroMedia?.id ?? null}
          onSelectHero={(row) => setHeroId(row.id)}
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

          <AliasesRow aliases={c.victim_aliases} />

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

        <LastSeenBlock c={c} />

        <PhysicalDescriptionBlock c={c} />

        <CaseLocationPreview c={c} />

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

        {/* Report-an-issue link — case-scoped takedown form. Mono-caps under
            a hairline keeps it editorial and tail-of-flow; the family member
            who needs this finds it because it's right there on the page,
            without it competing with the primary tip CTA. */}
        <View
          style={{
            marginTop: 28,
            paddingHorizontal: 16,
            paddingTop: 14,
            borderTopWidth: 0.5,
            borderTopColor: tokens.color.border.subtle,
            alignItems: 'center',
          }}
        >
          <Pressable
            onPress={() =>
              router.push({
                pathname: '/takedown-request/[slug]',
                params: { slug: c.slug },
              })
            }
            accessibilityRole="button"
            accessibilityLabel="Report an issue with this case"
            hitSlop={12}
            style={({ pressed }) => [{ opacity: pressed ? 0.6 : 1 }]}
          >
            <MonoLabel
              size={tokens.size.monoChip}
              tracking={tokens.tracking.chip}
              color={tokens.color.text.secondary}
            >
              REPORT AN ISSUE WITH THIS CASE
            </MonoLabel>
          </Pressable>
        </View>
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

/**
 * Aliases row — "ALSO KNOWN AS / Maria · Mar · M. Doe". Lives between the
 * subtitle and the pill row when the case carries any aliases. Useful for
 * matching tipster memory against multiple identities the subject went by.
 * Hidden when victim_aliases is null or empty.
 */
function AliasesRow({ aliases }: { aliases: string[] | null }) {
  if (!aliases || aliases.length === 0) return null;
  return (
    <View style={{ marginTop: 10 }}>
      <MonoLabel
        size={tokens.size.monoLabel}
        tracking={tokens.tracking.label}
        color={tokens.color.text.secondary}
      >
        ALSO KNOWN AS
      </MonoLabel>
      <SansBody
        style={{
          marginTop: 4,
          color: tokens.color.body.reading,
          fontSize: tokens.size.body,
        }}
      >
        {aliases.join(' · ')}
      </SansBody>
    </View>
  );
}

/**
 * Last-seen block — missing-person specifics. The schema carries date,
 * place, clothing, and circumstances; rendering them in a structured block
 * above the narrative makes them scannable for tipsters who only need to
 * verify "did I see this person on this date in this place wearing this?"
 * without having to read prose.
 *
 * Renders only for kind='missing' AND when at least one field is populated.
 * Other kinds use the standard incident_date in the key-facts table.
 */
function LastSeenBlock({ c }: { c: CaseRowFull }) {
  if (c.kind !== 'missing') return null;
  const hasAny =
    c.last_seen_date ||
    c.last_seen_text ||
    c.last_seen_clothing ||
    c.last_seen_circumstances;
  if (!hasAny) return null;

  const dateLine = c.last_seen_date
    ? formatDateMonthDay(c.last_seen_date)
    : null;
  const placeLine = c.last_seen_text;

  return (
    <View style={{ paddingHorizontal: 16, marginTop: 22 }}>
      <MonoLabel
        size={tokens.size.monoChip}
        tracking={tokens.tracking.chip}
        color={tokens.color.text.secondary}
        style={{ marginBottom: 10 }}
      >
        LAST SEEN
      </MonoLabel>
      {dateLine || placeLine ? (
        <SansMedium style={{ fontSize: 16, marginBottom: 6 }}>
          {[dateLine, placeLine].filter(Boolean).join(' · ')}
        </SansMedium>
      ) : null}
      {c.last_seen_clothing ? (
        <FactLine label="WEARING" value={c.last_seen_clothing} />
      ) : null}
      {c.last_seen_circumstances ? (
        <FactLine
          label="CIRCUMSTANCES"
          value={c.last_seen_circumstances}
          paragraph
        />
      ) : null}
    </View>
  );
}

function FactLine({
  label,
  value,
  paragraph = false,
}: {
  label: string;
  value: string;
  paragraph?: boolean;
}) {
  return (
    <View style={{ marginTop: 10 }}>
      <MonoLabel
        size={tokens.size.monoLabel}
        tracking={tokens.tracking.label}
        color={tokens.color.text.disabled}
      >
        {label}
      </MonoLabel>
      {paragraph ? (
        <NarrativeText style={{ marginTop: 4 }}>{value}</NarrativeText>
      ) : (
        <SansBody
          style={{
            marginTop: 4,
            fontSize: tokens.size.body,
            color: tokens.color.body.reading,
          }}
        >
          {value}
        </SansBody>
      )}
    </View>
  );
}

/**
 * Physical description block — sex / age / race / ethnicity / height /
 * weight / eyes / hair / distinguishing marks. The most load-bearing surface
 * for unidentified-person cases (the data that drives identifications);
 * still useful for named victims when families review tips against memory.
 *
 * Hidden when the case carries none of these fields. Each row hidden when
 * its specific field is null — no "Height: —" placeholders, just clean
 * absence.
 *
 * Heights/weights stored in metric in the schema; rendered in imperial here
 * because the user base is US-centric. Source-of-truth stays metric.
 */
function PhysicalDescriptionBlock({ c }: { c: CaseRowFull }) {
  const ageDisplay = formatAgeRange(c);
  const sexDisplay = formatSex(c.victim_sex);
  const heightDisplay = formatHeight(c.victim_height_cm);
  const weightDisplay = formatWeight(c.victim_weight_kg);

  const facts: { label: string; value: string }[] = [];
  if (sexDisplay) facts.push({ label: 'SEX', value: sexDisplay });
  if (ageDisplay) facts.push({ label: 'AGE', value: ageDisplay });
  if (c.victim_race) facts.push({ label: 'RACE', value: c.victim_race });
  if (c.victim_ethnicity) facts.push({ label: 'ETHNICITY', value: c.victim_ethnicity });
  if (heightDisplay) facts.push({ label: 'HEIGHT', value: heightDisplay });
  if (weightDisplay) facts.push({ label: 'WEIGHT', value: weightDisplay });
  if (c.victim_eye_color) facts.push({ label: 'EYES', value: c.victim_eye_color });
  if (c.victim_hair_color) facts.push({ label: 'HAIR', value: c.victim_hair_color });

  if (facts.length === 0 && !c.distinguishing_marks) return null;

  return (
    <View style={{ paddingHorizontal: 16, marginTop: 22 }}>
      <MonoLabel
        size={tokens.size.monoChip}
        tracking={tokens.tracking.chip}
        color={tokens.color.text.secondary}
        style={{ marginBottom: 10 }}
      >
        DESCRIPTION
      </MonoLabel>
      {facts.length > 0 ? (
        <KeyFactsTable facts={facts.map((f) => ({ ...f, mono: false }))} />
      ) : null}
      {c.distinguishing_marks ? (
        <View style={{ marginTop: 12 }}>
          <MonoLabel
            size={tokens.size.monoLabel}
            tracking={tokens.tracking.label}
            color={tokens.color.text.disabled}
          >
            DISTINGUISHING MARKS
          </MonoLabel>
          <NarrativeText style={{ marginTop: 4 }}>
            {c.distinguishing_marks}
          </NarrativeText>
        </View>
      ) : null}
    </View>
  );
}

function formatSex(s: CaseRowFull['victim_sex']): string | null {
  if (!s || s === 'unknown') return null;
  if (s === 'male') return 'Male';
  if (s === 'female') return 'Female';
  return 'Other';
}

function formatAgeRange(c: CaseRowFull): string | null {
  if (c.victim_age != null) return String(c.victim_age);
  if (c.victim_age_min != null && c.victim_age_max != null) {
    return `${c.victim_age_min}–${c.victim_age_max} (estimated)`;
  }
  if (c.victim_age_min != null) return `~${c.victim_age_min}+ (estimated)`;
  if (c.victim_age_max != null) return `~${c.victim_age_max} (estimated)`;
  return null;
}

function formatHeight(cm: number | null): string | null {
  if (cm == null) return null;
  const totalInches = cm / 2.54;
  const feet = Math.floor(totalInches / 12);
  const inches = Math.round(totalInches - feet * 12);
  // ROunding can push 11.5" up to 12" and break the display. Carry to next foot.
  if (inches === 12) return `${feet + 1}′0″ (${cm} cm)`;
  return `${feet}′${inches}″ (${cm} cm)`;
}

function formatWeight(kg: number | null): string | null {
  if (kg == null) return null;
  const lbs = Math.round(kg * 2.20462);
  return `${lbs} lb (${kg} kg)`;
}

/**
 * Inline map preview — single amber pin at the case's location_point. Fixed
 * zoom 13, no gestures; the pan/zoom map experience lives on the Map tab,
 * this is just the spatial anchor for the case file. Renders only when the
 * generated lat/lng columns (migration 08) are populated.
 */
function CaseLocationPreview({ c }: { c: CaseRowFull }) {
  if (c.location_lat == null || c.location_lng == null) return null;
  return (
    <View
      style={{
        marginTop: 22,
        marginHorizontal: 16,
        height: 140,
        borderRadius: 8,
        overflow: 'hidden',
        borderWidth: 0.5,
        borderColor: tokens.color.border.subtle,
      }}
    >
      <CaseLocationMap
        lat={c.location_lat}
        lng={c.location_lng}
        kind={
          c.kind === 'unidentified' || c.kind === 'unclaimed'
            ? 'unidentified'
            : c.kind === 'missing'
              ? 'missing'
              : 'homicide'
        }
      />
    </View>
  );
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
 * Caption: "PHOTO 01 · {ATTRIBUTION} · {YEAR}".
 *
 * Attribution falls back through three levels:
 *   1. Case's primary investigating agency (clean join, when present).
 *   2. The case's first source (Doe Network / FBI / Charley / etc.) — most
 *      cases have a source even when no agency mapped, so this catches the
 *      bulk of what would otherwise read "ATTRIBUTION PENDING."
 *   3. The literal placeholder, for the rare row with neither.
 *
 * Per-photo `source_attribution` (a real column on `case_media`) is the
 * proper next-iteration model — it lets us surface family-credit lines from
 * Charley/Doe instead of just the source name. Deferred to v1.0.1.
 */
function buildPhotoCaption(
  c: CaseRowFull,
  _primary: CaseMediaRow | null,
  sources: CaseSourceRow[],
): string {
  const sourceLabel = 'PHOTO 01'; // numbering when we surface a gallery
  const agencyName = c.primary_agency?.name?.toUpperCase();
  const sourceName = sources[0]?.source?.name?.toUpperCase();
  const attribution = agencyName ?? sourceName ?? 'ATTRIBUTION PENDING';
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
