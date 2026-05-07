/**
 * Hero photo frame — the evidence-register treatment.
 *
 * Corner brackets + caption strip frame any image as case-file material rather
 * than illustration. For cases without a photo, the same frame ships with a
 * centered serif em-dash — never a generic silhouette (which would feel
 * disrespectful for a victim).
 *
 * The `uri` prop is the already-resolved URL — callers run `effectivePhotoUri`
 * (lib/photo-policy.ts) to apply the per-source mirror policy upstream.
 * PhotoFrame just renders what it's given; em-dash if null. This keeps the
 * no-hot-link rule for Charley / Doe enforced at one chokepoint.
 *
 * Two orthogonal states layer on top of the photo:
 *   - is_reconstruction → "FORENSIC RECONSTRUCTION" pill in the top-left so
 *     users tapping a Doe pin don't mistake artist's rendering for a real
 *     photo. Always visible, even when the warning gate is up.
 *   - display_warning → tap-to-reveal gate. The photo renders blurred + dark
 *     until the user taps "View image"; lets us carry sensitive material
 *     without ambushing anyone with it on first scroll.
 *
 * See docs/04_DESIGN_SYSTEM.md "Hero photo frame".
 */

import { Image } from 'expo-image';
import type { ReactElement } from 'react';
import { useState } from 'react';
import { Pressable, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { tokens } from '@/constants/theme';

import { PhotoLightbox } from './photo-lightbox';
import { Mono, MonoLabel, SansBody, SerifTitle } from './text';

interface PhotoFrameProps {
  /**
   * Resolved photo URL (caller passes the result of `effectivePhotoUri`,
   * which applies the per-source mirror policy). Null → em-dash renders.
   */
  uri: string | null;
  /**
   * Caption — primary line (10px mono, evidence-chrome). Provenance:
   * "Shared by family · The Charley Project", "FBI Wanted bulletin",
   * "Released by LASD Homicide Bureau", etc.
   */
  captionPrimary: string;
  /**
   * Caption — secondary line (8px mono 70% alpha). Year and (eventually)
   * contextual metadata like contact-sheet / frame numbers. Optional —
   * single-line treatment when omitted.
   */
  captionSecondary?: string;
  /**
   * Joined caption ("primary · secondary") used by the lightbox where
   * the bottom-of-screen caption is rendered as one line. The PhotoFrame
   * itself uses captionPrimary + captionSecondary for the two-line ledger.
   */
  captionFlat?: string;
  /**
   * True when the imagery is artist-rendered (forensic reconstruction, age
   * progression, sketch). Renders a "FORENSIC RECONSTRUCTION" pill so users
   * don't read the rendering as a real photo.
   */
  isReconstruction?: boolean;
  /**
   * Gate the photo behind a tap-to-reveal when set. 'sensitive' for cases
   * that may include post-mortem material; 'graphic' for explicit content.
   * The gate disappears once the user taps once per mount.
   */
  displayWarning?: 'graphic' | 'sensitive' | null;
  height?: number;
}

const BRACKET_ARM = 14;

export function PhotoFrame({
  uri,
  captionPrimary,
  captionSecondary,
  captionFlat,
  isReconstruction = false,
  displayWarning = null,
  height = 200,
}: PhotoFrameProps): ReactElement {
  const [revealed, setRevealed] = useState(false);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const showImage = !!uri && !loadFailed;
  const gateActive = !!displayWarning && !revealed && showImage;
  // The image is tappable to open the lightbox once a uri exists and the
  // warning gate (if any) has been passed. Without a uri (or after a hot-link
  // 404) we render the em-dash placeholder, which isn't an image and
  // shouldn't expand.
  const expandable = showImage && !gateActive;

  return (
    <View
      style={{
        height,
        marginHorizontal: 16,
        borderRadius: tokens.radius.card,
        borderWidth: 0.5,
        borderColor: tokens.color.border.strong,
        overflow: 'hidden',
        backgroundColor: tokens.color.bg.elev1,
      }}
    >
      {showImage ? (
        <Pressable
          onPress={expandable ? () => setLightboxOpen(true) : undefined}
          disabled={!expandable}
          accessibilityRole={expandable ? 'button' : undefined}
          accessibilityLabel={expandable ? 'View photo full screen' : undefined}
          style={({ pressed }) => [
            {
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              opacity: pressed && expandable ? 0.92 : 1,
            },
          ]}
        >
          <Image
            source={{ uri: uri! }}
            style={{ flex: 1 }}
            contentFit="cover"
            cachePolicy="memory-disk"
            transition={150}
            blurRadius={gateActive ? 28 : 0}
            onError={() => setLoadFailed(true)}
            accessibilityIgnoresInvertColors
          />
        </Pressable>
      ) : (
        <View
          style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}
        >
          <SerifTitle
            size="h1"
            style={{
              fontSize: 48,
              color: tokens.color.text.secondary,
              lineHeight: 48,
            }}
          >
            —
          </SerifTitle>
        </View>
      )}

      <CornerBrackets />
      {gateActive ? (
        <WarningGate
          warning={displayWarning!}
          onReveal={() => setRevealed(true)}
        />
      ) : null}
      {/* ReconstructionPill renders AFTER the gate so the label stays
          visible OVER the dark cover. A user tapping a Doe case must know
          the imagery behind the gate is artist-rendered, not a real photo —
          otherwise they tap expecting a face and get an uncanny-valley
          rendering. The label outside the gate removes that surprise. */}
      {isReconstruction ? <ReconstructionPill /> : null}
      <CaptionStrip primaryLine={captionPrimary} secondaryLine={captionSecondary} />

      <PhotoLightbox
        visible={lightboxOpen}
        onClose={() => setLightboxOpen(false)}
        uri={uri}
        caption={captionFlat ?? captionPrimary}
        isReconstruction={isReconstruction}
      />
    </View>
  );
}

function ReconstructionPill() {
  return (
    <View
      pointerEvents="none"
      style={{
        position: 'absolute',
        top: 8,
        left: 8,
        paddingVertical: 3,
        paddingHorizontal: 7,
        borderRadius: 3,
        backgroundColor: 'rgba(10, 10, 10, 0.75)',
        borderWidth: 0.5,
        borderColor: tokens.color.evidence.chrome,
      }}
    >
      <Mono
        size={tokens.size.monoCaption}
        style={{
          color: tokens.color.text.secondary,
          letterSpacing: tokens.size.monoCaption * tokens.tracking.chip,
        }}
      >
        FORENSIC RECONSTRUCTION
      </Mono>
    </View>
  );
}

function WarningGate({
  warning,
  onReveal,
}: {
  warning: 'graphic' | 'sensitive';
  onReveal: () => void;
}) {
  const heading = warning === 'graphic' ? 'Graphic content' : 'Sensitive content';
  const sub =
    warning === 'graphic'
      ? 'This image may include explicit material. Tap to view.'
      : 'This image may be difficult to view. Tap to view.';
  return (
    <Pressable
      onPress={onReveal}
      style={({ pressed }) => [
        {
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          bottom: 44, // sit above the two-line ledger caption strip
          backgroundColor: 'rgba(10, 10, 10, 0.78)',
          alignItems: 'center',
          justifyContent: 'center',
          paddingHorizontal: 24,
          opacity: pressed ? 0.85 : 1,
        },
      ]}
    >
      <MonoLabel
        size={tokens.size.monoChip}
        tracking={tokens.tracking.chip}
        color={tokens.color.accent.amber}
        style={{ marginBottom: 6 }}
      >
        {heading.toUpperCase()}
      </MonoLabel>
      <SansBody
        style={{
          color: tokens.color.text.secondary,
          fontSize: tokens.size.meta,
          textAlign: 'center',
          lineHeight: tokens.size.meta * 1.45,
        }}
      >
        {sub}
      </SansBody>
    </Pressable>
  );
}

function CornerBrackets() {
  // 1px stroke in evidence.chrome on each corner.
  const stroke = tokens.color.evidence.chrome;
  return (
    <View
      pointerEvents="none"
      style={{ position: 'absolute', inset: 0 }}
    >
      <Svg
        style={{ position: 'absolute', top: 0, left: 0 }}
        width={BRACKET_ARM + 2}
        height={BRACKET_ARM + 2}
      >
        <Path d={`M 1 ${BRACKET_ARM + 1} L 1 1 L ${BRACKET_ARM + 1} 1`} stroke={stroke} strokeWidth={1} fill="none" />
      </Svg>
      <Svg
        style={{ position: 'absolute', top: 0, right: 0 }}
        width={BRACKET_ARM + 2}
        height={BRACKET_ARM + 2}
      >
        <Path d={`M 1 1 L ${BRACKET_ARM + 1} 1 L ${BRACKET_ARM + 1} ${BRACKET_ARM + 1}`} stroke={stroke} strokeWidth={1} fill="none" />
      </Svg>
      <Svg
        style={{ position: 'absolute', bottom: 0, left: 0 }}
        width={BRACKET_ARM + 2}
        height={BRACKET_ARM + 2}
      >
        <Path d={`M 1 1 L 1 ${BRACKET_ARM + 1} L ${BRACKET_ARM + 1} ${BRACKET_ARM + 1}`} stroke={stroke} strokeWidth={1} fill="none" />
      </Svg>
      <Svg
        style={{ position: 'absolute', bottom: 0, right: 0 }}
        width={BRACKET_ARM + 2}
        height={BRACKET_ARM + 2}
      >
        <Path d={`M ${BRACKET_ARM + 1} 1 L ${BRACKET_ARM + 1} ${BRACKET_ARM + 1} L 1 ${BRACKET_ARM + 1}`} stroke={stroke} strokeWidth={1} fill="none" />
      </Svg>
    </View>
  );
}

/**
 * Two-line ledger caption — evidence-tag rhythm.
 *
 * Line 1 (10px mono, evidence.chrome): identifier + source.
 *   PHOTO 01 / LASD HOMICIDE BUREAU
 *
 * Line 2 (8px mono 70% alpha): contextual metadata.
 *   1985  (or "1985 · CONTACT SHEET 03 · FRAME 12" once those fields ship)
 *
 * Backwards-compat: callers may still pass a flat `caption` string; we
 * split on " · " into primary/secondary so existing buildPhotoCaption()
 * usage works without a migration. New callers should pass primaryLine +
 * secondaryLine directly for full control.
 */
function CaptionStrip({
  caption,
  primaryLine,
  secondaryLine,
}: {
  caption?: string;
  primaryLine?: string;
  secondaryLine?: string;
}) {
  let line1 = primaryLine ?? '';
  let line2 = secondaryLine ?? '';
  if (!line1 && caption) {
    // Split "PHOTO 01 · {ATTRIBUTION} · {YEAR}" → "PHOTO 01 · ATTRIBUTION"
    // on line 1, "YEAR" on line 2. Keeps the two-line aesthetic without
    // forcing every call site to refactor immediately.
    const parts = caption.split(' · ');
    if (parts.length >= 3) {
      line1 = parts.slice(0, parts.length - 1).join(' · ');
      line2 = parts[parts.length - 1];
    } else {
      line1 = caption;
    }
  }

  return (
    <View
      pointerEvents="none"
      style={{
        position: 'absolute',
        bottom: 0,
        left: 0,
        right: 0,
        paddingTop: 8,
        paddingBottom: 8,
        paddingHorizontal: 14,
        backgroundColor: 'rgba(0,0,0,0.7)',
      }}
    >
      <MonoLabel
        size={10}
        tracking={tokens.tracking.label}
        color={tokens.color.evidence.chrome}
      >
        {line1}
      </MonoLabel>
      {line2 ? (
        <MonoLabel
          size={8}
          tracking={0.12}
          color={tokens.color.evidence.chrome}
          style={{ marginTop: 2, opacity: 0.7 }}
        >
          {line2}
        </MonoLabel>
      ) : null}
    </View>
  );
}
