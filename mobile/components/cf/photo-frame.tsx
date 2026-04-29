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

import type { ReactElement } from 'react';
import { useState } from 'react';
import { Image, Pressable, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { tokens } from '@/constants/theme';

import { Mono, MonoLabel, SansBody, SerifTitle } from './text';

interface PhotoFrameProps {
  /**
   * Resolved photo URL (caller passes the result of `effectivePhotoUri`,
   * which applies the per-source mirror policy). Null → em-dash renders.
   */
  uri: string | null;
  /** Caption format: "PHOTO {NN} · {SOURCE_NAME} · {YEAR}". */
  caption: string;
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
  caption,
  isReconstruction = false,
  displayWarning = null,
  height = 200,
}: PhotoFrameProps): ReactElement {
  const [revealed, setRevealed] = useState(false);
  const gateActive = !!displayWarning && !revealed && !!uri;

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
      {uri ? (
        <Image
          source={{ uri }}
          style={{ width: '100%', height: '100%' }}
          resizeMode="cover"
          blurRadius={gateActive ? 28 : 0}
          accessibilityIgnoresInvertColors
        />
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
      <CaptionStrip caption={caption} />
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
          color: tokens.color.evidence.chrome,
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
          bottom: 28, // sit above the caption strip
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

function CaptionStrip({ caption }: { caption: string }) {
  return (
    <View
      pointerEvents="none"
      style={{
        position: 'absolute',
        bottom: 0,
        left: 0,
        right: 0,
        height: 28,
        backgroundColor: 'rgba(0,0,0,0.65)',
        justifyContent: 'center',
        paddingHorizontal: 14,
      }}
    >
      <MonoLabel
        size={tokens.size.monoCaption}
        tracking={tokens.tracking.chip}
        color={tokens.color.evidence.chrome}
      >
        {caption}
      </MonoLabel>
    </View>
  );
}
