/**
 * PhotoLightbox — full-frame photo viewer.
 *
 * Opened by tapping the hero PhotoFrame on the case-detail screen. Renders the
 * already-resolved image URI (caller passes the result of `effectivePhotoUri`,
 * same chokepoint as PhotoFrame) on a near-black backdrop, sized to the screen
 * via `Dimensions.get('window')` and `resizeMode: contain` so the whole image
 * is visible without cropping.
 *
 * Why explicit pixel dimensions instead of `width:'100%'`/`height:'100%'`:
 * RN's Image with percentage dimensions inside a centering flex parent
 * sometimes collapses to its (0×0) intrinsic size before the network image
 * loads, leaving the frame blank. Hard-pinning to window dimensions gives the
 * Image a guaranteed canvas; `resizeMode: contain` then letterboxes it.
 *
 * Backdrop tap and the top-right close affordance both dismiss. Reconstruction
 * imagery keeps its label so users don't lose the artist-rendered context when
 * the photo fills the screen. The warning gate is intentionally NOT re-applied
 * here — the lightbox only opens when the user has already chosen to view the
 * photo (either no warning, or they've already passed the gate on the hero).
 */

import { Ionicons } from '@expo/vector-icons';
import type { ReactElement } from 'react';
import { Dimensions, Image, Modal, Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { tokens } from '@/constants/theme';

import { Mono, MonoLabel } from './text';

interface PhotoLightboxProps {
  visible: boolean;
  onClose: () => void;
  uri: string | null;
  caption: string;
  isReconstruction?: boolean;
}

export function PhotoLightbox({
  visible,
  onClose,
  uri,
  caption,
  isReconstruction = false,
}: PhotoLightboxProps): ReactElement {
  const insets = useSafeAreaInsets();
  const { width: screenW, height: screenH } = Dimensions.get('window');

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <View style={{ flex: 1, backgroundColor: 'rgba(5,4,3,0.97)' }}>
        {/* Tap-anywhere-to-close backdrop. The image renders ON TOP of this
            Pressable as a sibling so its layout isn't constrained by the
            backdrop's flex centering — the backdrop just provides the dim
            and the catch-all tap target. */}
        <Pressable
          onPress={onClose}
          style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
          accessibilityRole="button"
          accessibilityLabel="Close photo"
        />

        {uri ? (
          <View
            pointerEvents="none"
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: screenW,
              height: screenH,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Image
              source={{ uri }}
              style={{ width: screenW, height: screenH }}
              resizeMode="contain"
              accessibilityIgnoresInvertColors
            />
          </View>
        ) : null}

        {isReconstruction ? (
          <View
            pointerEvents="none"
            style={{
              position: 'absolute',
              top: insets.top + 14,
              left: 16,
              paddingVertical: 4,
              paddingHorizontal: 8,
              borderRadius: 3,
              backgroundColor: 'rgba(10,10,10,0.75)',
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
        ) : null}

        <Pressable
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Close photo"
          hitSlop={12}
          style={({ pressed }) => [
            {
              position: 'absolute',
              top: insets.top + 8,
              right: 12,
              width: 36,
              height: 36,
              borderRadius: 18,
              backgroundColor: 'rgba(10,10,10,0.7)',
              borderWidth: 0.5,
              borderColor: tokens.color.border.strong,
              alignItems: 'center',
              justifyContent: 'center',
              opacity: pressed ? 0.7 : 1,
            },
          ]}
        >
          <Ionicons name="close" size={18} color={tokens.color.text.primary} />
        </Pressable>

        <View
          pointerEvents="none"
          style={{
            position: 'absolute',
            bottom: insets.bottom + 18,
            left: 16,
            right: 16,
            alignItems: 'center',
          }}
        >
          <MonoLabel
            size={10}
            tracking={tokens.tracking.label}
            color={tokens.color.evidence.chrome}
            style={{ textAlign: 'center' }}
          >
            {caption}
          </MonoLabel>
        </View>
      </View>
    </Modal>
  );
}
