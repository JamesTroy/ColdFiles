/**
 * Hero photo frame — the evidence-register treatment.
 *
 * Corner brackets + caption strip frame any image as case-file material rather
 * than illustration. For cases without a photo, the same frame ships with a
 * centered serif em-dash — never a generic silhouette (which would feel
 * disrespectful for a victim).
 *
 * See docs/04_DESIGN_SYSTEM.md "Hero photo frame".
 */

import { Image } from 'expo-image';
import type { ReactElement } from 'react';
import { View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { tokens } from '@/constants/theme';

import { MonoLabel, SerifTitle } from './text';

interface PhotoFrameProps {
  /** Image source URI. When null, the em-dash placeholder renders inside the frame. */
  uri: string | null;
  /** Caption format: "PHOTO {NN} · {SOURCE_NAME} · {YEAR}". */
  caption: string;
  height?: number;
}

const BRACKET_ARM = 14;

export function PhotoFrame({ uri, caption, height = 200 }: PhotoFrameProps): ReactElement {
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
          contentFit="cover"
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
      <CaptionStrip caption={caption} />
    </View>
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
