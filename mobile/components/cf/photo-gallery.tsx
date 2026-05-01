/**
 * PhotoGallery — horizontal thumbnail strip below the hero PhotoFrame.
 *
 * Surfaces every case_media row beyond the primary photo so users can see
 * reconstructions, age progressions, sketches, clothing, distinguishing
 * marks, etc. — the photo evidence that turns "case index entry" into
 * "case file."
 *
 * Behavior:
 *   - Tap a thumbnail → the parent swaps it into the hero PhotoFrame slot.
 *     The previously-displayed photo goes back into the gallery, so the
 *     gallery always shows everything except whatever's currently hero.
 *   - Each thumbnail has a kind label below it (RECONSTRUCTION / AGE
 *     PROGRESSION / SKETCH / CLOTHING / EVIDENCE). The label is the
 *     editorial signal that distinguishes a sketch from a real photo —
 *     critical for cold cases where users might otherwise read a forensic
 *     reconstruction as "what the person actually looks like."
 *   - display_warning='graphic' / 'sensitive' renders the thumbnail blurred
 *     with a small CAUTION badge overlay. Tap behavior is unchanged — the
 *     PhotoFrame's existing tap-to-reveal gate kicks in once it lands in
 *     the hero slot.
 *
 * Rendered only when there are 2+ media rows. With only one photo, it's
 * already the hero and the gallery would be empty.
 */

import type { ReactElement } from 'react';
import { Image, Pressable, ScrollView, View } from 'react-native';
import Svg, { Ellipse, Rect } from 'react-native-svg';

import { tokens } from '@/constants/theme';
import { effectivePhotoUri } from '@/lib/photo-policy';
import type { CaseMediaRow } from '@/lib/types/database';

import { MonoLabel, SerifTitle } from './text';

const THUMB_SIZE = 64;

const KIND_LABEL: Record<CaseMediaRow['kind'], string | null> = {
  photo_victim: null, // No label needed — the default photo type
  sketch_victim: 'SKETCH',
  reconstruction: 'RECONSTRUCTION',
  age_progression: 'AGE PROGRESSION',
  photo_clothing: 'CLOTHING',
  photo_jewelry: 'JEWELRY',
  photo_evidence: 'EVIDENCE',
  photo_location: 'LOCATION',
  sketch_poi: 'POI SKETCH',
  document: 'DOCUMENT',
};

interface PhotoGalleryProps {
  /** All media rows for the case. The currently-hero row is filtered out. */
  media: CaseMediaRow[];
  /** Currently-hero row's id. */
  heroId: string | null;
  /** Tap → request the parent swap this row into the hero slot. */
  onSelectHero: (row: CaseMediaRow) => void;
}

export function PhotoGallery({
  media,
  heroId,
  onSelectHero,
}: PhotoGalleryProps): ReactElement | null {
  const items = media.filter((m) => m.id !== heroId);
  if (items.length === 0) return null;
  return (
    <View style={{ marginTop: 14 }}>
      <MonoLabel
        size={tokens.size.monoLabel}
        tracking={tokens.tracking.label}
        color={tokens.color.text.secondary}
        style={{ paddingHorizontal: 16, marginBottom: 8 }}
      >
        OTHER IMAGES
      </MonoLabel>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: 16, gap: 10 }}
      >
        {items.map((row) => (
          <GalleryThumb key={row.id} row={row} onPress={() => onSelectHero(row)} />
        ))}
      </ScrollView>
    </View>
  );
}

function GalleryThumb({ row, onPress }: { row: CaseMediaRow; onPress: () => void }) {
  const uri = effectivePhotoUri(row);
  const label = KIND_LABEL[row.kind];
  const gated = row.display_warning === 'graphic' || row.display_warning === 'sensitive';

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={
        label ? `View ${label.toLowerCase()}` : 'View image'
      }
      style={({ pressed }) => [
        { width: THUMB_SIZE, opacity: pressed ? 0.7 : 1 },
      ]}
    >
      <View
        style={{
          width: THUMB_SIZE,
          height: THUMB_SIZE,
          borderRadius: 4,
          overflow: 'hidden',
          backgroundColor: tokens.color.bg.elev2,
          borderWidth: 0.5,
          borderColor: tokens.color.border.hairline,
        }}
      >
        {uri ? (
          <Image
            source={{ uri }}
            style={{ width: '100%', height: '100%' }}
            resizeMode="cover"
            blurRadius={gated ? 16 : 0}
            accessibilityIgnoresInvertColors
          />
        ) : (
          <SilhouetteFallback />
        )}
        {gated ? (
          <View
            pointerEvents="none"
            style={{
              position: 'absolute',
              inset: 0,
              backgroundColor: 'rgba(10,10,10,0.55)',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <MonoLabel
              size={8}
              tracking={tokens.tracking.chip}
              color={tokens.color.accent.amber}
            >
              SENSITIVE
            </MonoLabel>
          </View>
        ) : null}
      </View>
      {label ? (
        <MonoLabel
          size={9}
          tracking={tokens.tracking.label}
          color={tokens.color.text.disabled}
          style={{ marginTop: 6, textAlign: 'center' }}
        >
          {label}
        </MonoLabel>
      ) : null}
    </Pressable>
  );
}

function SilhouetteFallback() {
  return (
    <View
      style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}
    >
      <Svg width={THUMB_SIZE} height={THUMB_SIZE} viewBox="0 0 64 64">
        <Rect width="64" height="64" fill={tokens.color.silhouette.bg} />
        <Ellipse cx="32" cy="24" rx="11" ry="13" fill={tokens.color.silhouette.figure} />
        <Ellipse cx="32" cy="52" rx="16" ry="13" fill={tokens.color.silhouette.figure} />
      </Svg>
      <SerifTitle
        size="h2"
        style={{
          position: 'absolute',
          color: tokens.color.text.disabled,
          fontSize: 18,
          lineHeight: 18,
        }}
      >
        —
      </SerifTitle>
    </View>
  );
}
