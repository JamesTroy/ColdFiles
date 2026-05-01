/**
 * BrandSplash — full-screen brand mark over the navigation tree at startup.
 *
 * Renders the same visual signature as the app icon: warm-ash background,
 * amber serif "C", four cream corner brackets framing it. Mirrors the
 * evidence-register treatment used elsewhere (PhotoFrame brackets, etc.).
 *
 * Why a JS-rendered splash AS WELL as the native one:
 *   - Native splash holds until JS bundle loads (Expo's preventAutoHide).
 *   - The native image is configured in app.config.ts and only changes on
 *     AAB rebuild. JS-rendered overlay lets us iterate on the brand
 *     reveal via OTA without rebuilding.
 *   - Even after native hides, fonts are still loading. The JS overlay
 *     covers that window and gives a deliberate brand beat (~400ms hold)
 *     before fading to the app — small thing, but it's the difference
 *     between "logo flashed once" and "logo registered."
 *
 * The fade is opacity-only via Animated; native driver, no layout
 * thrashing. pointerEvents flips to 'none' once visibility goes false so
 * taps fall through to the app immediately even during the fade.
 */

import { useEffect, useRef } from 'react';
import { Animated, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { tokens } from '@/constants/theme';

import { SerifTitle } from './text';

const LOGO_BOX = 240;
const BRACKET_ARM = 44;
const BRACKET_STROKE = 2.5;
const FADE_OUT_MS = 280;

interface BrandSplashProps {
  /** True while the splash is up; flip to false to fade and dismount. */
  visible: boolean;
  /** Called after the fade-out completes — parent can fully unmount. */
  onFadeComplete?: () => void;
}

export function BrandSplash({ visible, onFadeComplete }: BrandSplashProps) {
  const opacity = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (!visible) {
      Animated.timing(opacity, {
        toValue: 0,
        duration: FADE_OUT_MS,
        useNativeDriver: true,
      }).start(({ finished }) => {
        if (finished) onFadeComplete?.();
      });
    }
  }, [visible, opacity, onFadeComplete]);

  return (
    <Animated.View
      pointerEvents={visible ? 'auto' : 'none'}
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: tokens.color.bg.base,
        alignItems: 'center',
        justifyContent: 'center',
        opacity,
        zIndex: 9999,
      }}
    >
      <View
        style={{
          width: LOGO_BOX,
          height: LOGO_BOX,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <CornerBrackets />
        {/* The serif "C" — Newsreader 500 medium, amber. The fontSize is
            tuned so the C's visual weight balances the corner brackets at
            this 240dp container. lineHeight matches fontSize so the
            optical-center sits dead-center in the box. */}
        <SerifTitle
          size="h1"
          style={{
            fontSize: 150,
            lineHeight: 150,
            color: tokens.color.accent.amber,
            // Pull up slightly so the optical center of the serif glyph
            // (which sits a hair below geometric center) lands at the
            // bracket-frame center. ~4dp at 150pt looks right.
            marginTop: -4,
          }}
        >
          C
        </SerifTitle>
      </View>
    </Animated.View>
  );
}

function CornerBrackets() {
  // Four corner brackets framing the LOGO_BOX. Each is a small SVG with an
  // L-shaped path; positioned absolute at each corner of the parent. Same
  // technique as PhotoFrame's brackets but at splash scale.
  const stroke = BRACKET_STROKE;
  const arm = BRACKET_ARM;
  const color = tokens.color.text.primary;

  return (
    <View
      pointerEvents="none"
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
      }}
    >
      <Svg
        style={{ position: 'absolute', top: 0, left: 0 }}
        width={arm + stroke}
        height={arm + stroke}
      >
        <Path
          d={`M ${stroke / 2} ${arm} L ${stroke / 2} ${stroke / 2} L ${arm} ${stroke / 2}`}
          stroke={color}
          strokeWidth={stroke}
          fill="none"
        />
      </Svg>
      <Svg
        style={{ position: 'absolute', top: 0, right: 0 }}
        width={arm + stroke}
        height={arm + stroke}
      >
        <Path
          d={`M ${stroke / 2} ${stroke / 2} L ${arm} ${stroke / 2} L ${arm} ${arm}`}
          stroke={color}
          strokeWidth={stroke}
          fill="none"
        />
      </Svg>
      <Svg
        style={{ position: 'absolute', bottom: 0, left: 0 }}
        width={arm + stroke}
        height={arm + stroke}
      >
        <Path
          d={`M ${stroke / 2} ${stroke / 2} L ${stroke / 2} ${arm} L ${arm} ${arm}`}
          stroke={color}
          strokeWidth={stroke}
          fill="none"
        />
      </Svg>
      <Svg
        style={{ position: 'absolute', bottom: 0, right: 0 }}
        width={arm + stroke}
        height={arm + stroke}
      >
        <Path
          d={`M ${arm} ${stroke / 2} L ${arm} ${arm} L ${stroke / 2} ${arm}`}
          stroke={color}
          strokeWidth={stroke}
          fill="none"
        />
      </Svg>
    </View>
  );
}
