/**
 * Case detail screen.
 *
 * The destination from every map peek and list row. Every primitive on this
 * screen is a tokenized component — every visual rule from
 * docs/04_DESIGN_SYSTEM.md "Case detail screen" is enforced by the components
 * themselves, not by re-decided per-render styles.
 *
 *   PhotoFrame        evidence-register hero (corner brackets + caption strip)
 *   SerifTitle        victim name — arrival starts here
 *   Pills row         UNSOLVED + (cold OR resolved). Case kind is NOT a pill — it's in the key-facts table.
 *   KeyFactsTable     verifiable case data (TYPE / DATE / LOCATION / AGENCY)
 *   NarrativeText     truncated to ~40 words; "Read full file →" affordance
 *   SourceChipRow     trust-weight DESC + last_ingested_at DESC ordering
 *   Sticky bar        AmberCTA "Submit a tip" + SecondaryCTA save (★)
 *   Trust caption     under the bar — required, not optional
 */

import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AmberCTA, SecondaryCTA } from '@/components/cf/cta-button';
import { KeyFactsTable } from '@/components/cf/key-facts';
import { PhotoFrame } from '@/components/cf/photo-frame';
import { ColdPill, UnsolvedPill } from '@/components/cf/pill';
import { SourceChipRow } from '@/components/cf/source-chip';
import {
  Mono,
  MonoLabel,
  NarrativeText,
  SansBody,
  SerifTitle,
} from '@/components/cf/text';
import { TrustDisclosureCaption } from '@/components/cf/trust-disclosure';
import { tokens } from '@/constants/theme';

// Static sample case so the screen renders without backend wiring. Will be
// replaced by a Supabase query keyed on slug when the data layer is wired.
const SAMPLE_CASE = {
  slug: 'evans-1985',
  caseNumber: 'CASE-LASD-1985-0413',
  victimName: 'David R. Evans',
  metaSubtitle: 'Age 57 · VP, Pomona First Federal',
  photoUri: null as string | null,
  photoCaption: 'PHOTO 01 · LASD HOMICIDE BUREAU · 1985',
  incidentDate: new Date('1985-10-13'),
  dateQuality: 'exact' as const,
  facts: [
    { label: 'TYPE', value: 'Homicide' },
    { label: 'DATE', value: 'Oct 13, 1985', mono: true },
    { label: 'LOCATION', value: 'Claremont, CA' },
    { label: 'AGENCY', value: 'LASD Homicide Bureau' },
  ],
  narrative:
    'Mr. Evans was found beaten to death inside his Claremont residence on a Sunday evening. His body was discovered by Claremont Police Officers responding to a possible burglary call from neighbors. At the time, the investigation had…',
  sources: [
    { slug: 'lasd.org', url: 'https://lasd.org' },
    { slug: 'projectcoldcase', url: 'https://projectcoldcase.org' },
  ],
  agency: { name: 'LA Crime Stoppers', short_name: 'LA Crime Stoppers' },
};

export default function CaseDetailScreen() {
  const insets = useSafeAreaInsets();
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const [saved, setSaved] = useState(false);

  // TODO: Supabase query keyed on slug. For now use the sample.
  const c = SAMPLE_CASE;
  const coldText = tokens.caseDetail.coldPill(c.incidentDate, c.dateQuality);

  return (
    <View style={{ flex: 1, backgroundColor: tokens.color.bg.base }}>
      {/* Top chrome — back, case number (mono), share */}
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
          {c.caseNumber}
        </Mono>
        <CircleButton onPress={() => {}}>
          <Ionicons name="share-outline" size={16} color={tokens.color.text.primary} />
        </CircleButton>
      </View>

      <ScrollView contentContainerStyle={{ paddingBottom: 140 }}>
        <PhotoFrame uri={c.photoUri} caption={c.photoCaption} />

        <View style={{ paddingHorizontal: 16, paddingTop: 16 }}>
          <SerifTitle size="h1">{c.victimName}</SerifTitle>
          <SansBody style={{ color: tokens.color.text.secondary, fontSize: tokens.size.meta, marginTop: 4 }}>
            {c.metaSubtitle}
          </SansBody>

          {/* Pills row — state + urgency only. Case kind lives in KeyFactsTable. */}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 12 }}>
            <UnsolvedPill />
            <ColdPill text={coldText} />
          </View>
        </View>

        <View style={{ paddingHorizontal: 16, marginTop: 18 }}>
          <KeyFactsTable facts={c.facts} />
        </View>

        <View style={{ paddingHorizontal: 16, marginTop: 18 }}>
          <MonoLabel size={tokens.size.monoChip} tracking={tokens.tracking.chip} style={{ marginBottom: 8 }}>
            CASE FILE
          </MonoLabel>
          <NarrativeText>{c.narrative}</NarrativeText>
          <Pressable onPress={() => {}}>
            <Mono
              size={tokens.size.meta}
              style={{ color: tokens.color.accent.amber, marginTop: 10 }}
            >
              Read full file →
            </Mono>
          </Pressable>
        </View>

        <View style={{ paddingHorizontal: 16, marginTop: 18 }}>
          <MonoLabel size={tokens.size.monoChip} tracking={tokens.tracking.chip} style={{ marginBottom: 8 }}>
            {`SOURCES · ${c.sources.length}`}
          </MonoLabel>
          <SourceChipRow chips={c.sources} />
        </View>
      </ScrollView>

      {/* Sticky bar — AmberCTA + SecondaryCTA, with trust caption beneath */}
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
          <AmberCTA
            label="Submit a tip"
            onPress={() => router.push(`/tip/${slug ?? c.slug}`)}
          />
          <SecondaryCTA active={saved} onPress={() => setSaved((s) => !s)}>
            <Ionicons
              name={saved ? 'star' : 'star-outline'}
              size={18}
              color={saved ? tokens.color.accent.amber : tokens.color.text.primary}
            />
          </SecondaryCTA>
        </View>
        {/* Required trust caption — non-negotiable per design doc */}
        <TrustDisclosureCaption />
      </View>
    </View>
  );
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
