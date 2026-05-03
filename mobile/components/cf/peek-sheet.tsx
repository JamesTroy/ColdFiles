/**
 * Peek sheet — the bottom sheet that appears on a map pin tap.
 *
 * Map state is preserved underneath. Users tap pin → peek → close → next pin
 * in rapid sequence; any transition that loses map context breaks that flow.
 *
 * Layout (matches prototype):
 *   - 36×3 grab handle
 *   - SELECTED · {distance} away          Open →
 *   - {Victim Name}                        (serif 18px — arrival begins here)
 *   - HOMICIDE · 1985 · CLAREMONT, CA      (mono cap, evidence.chrome, BELOW name)
 *
 * Pills only appear on the case-detail screen, never here. The kind/year/place
 * line is the meta affordance for surfaces without a key-facts table.
 */

import { Ionicons } from '@expo/vector-icons';
import { Pressable, View } from 'react-native';

import { tokens } from '@/constants/theme';
import { distancePhrase } from '@/lib/format';

import { MonoLabel, SerifTitle } from './text';

interface PeekSheetProps {
  /** Distance in miles, e.g. "1.4". null when location is unknown — renders "SELECTED" without the trailing miles. */
  distanceMiles: number | null;
  /** "HOMICIDE · 1985 · CLAREMONT, CA". Full mono-cap line including separators. */
  kindLine: string;
  /** Victim name; for unidentifieds, "Unidentified Female, est. 18–25". */
  victimName: string;
  /** Tap anywhere on the sheet → opens the case detail. */
  onOpen: () => void;
  /** Tap the X dismiss button → clears the pin selection. */
  onDismiss?: () => void;
}

export function PeekSheet({
  distanceMiles,
  kindLine,
  victimName,
  onOpen,
  onDismiss,
}: PeekSheetProps) {
  return (
    <Pressable
      onPress={onOpen}
      style={{
        backgroundColor: tokens.color.bg.elev1,
        paddingHorizontal: 18,
        paddingTop: 8,
        paddingBottom: 16,
        borderTopWidth: 0.5,
        borderTopColor: tokens.color.border.strong,
        borderTopLeftRadius: 16,
        borderTopRightRadius: 16,
      }}
    >
      {/* Grab handle */}
      <View
        style={{
          alignSelf: 'center',
          width: 36,
          height: 3,
          backgroundColor: tokens.color.border.strong,
          borderRadius: 2,
          marginBottom: 10,
        }}
      />

      {/* Dismiss — top-right, only when caller wires onDismiss. The Pressable
          stops propagation so tapping the X doesn't also fire the sheet's
          onOpen. */}
      {onDismiss ? (
        <Pressable
          onPress={(e) => {
            e.stopPropagation();
            onDismiss();
          }}
          accessibilityRole="button"
          accessibilityLabel="Close preview"
          hitSlop={12}
          style={{
            position: 'absolute',
            top: 8,
            right: 12,
            width: 28,
            height: 28,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Ionicons
            name="close"
            size={18}
            color={tokens.color.text.secondary}
          />
        </Pressable>
      ) : null}

      {/* Section label row */}
      <View
        style={{
          flexDirection: 'row',
          justifyContent: 'space-between',
          alignItems: 'baseline',
          marginBottom: 4,
        }}
      >
        <MonoLabel
          size={tokens.size.monoLabel}
          tracking={tokens.tracking.label}
          color={tokens.color.text.secondary}
        >
          {distanceMiles == null ? 'SELECTED' : `SELECTED · ${distancePhrase(distanceMiles)}`}
        </MonoLabel>
        <MonoLabel
          size={tokens.size.monoChip}
          color={tokens.color.accent.amber}
        >
          Open →
        </MonoLabel>
      </View>

      {/* Victim name — serif (the arrival signal) */}
      <SerifTitle size="h2" style={{ fontSize: 18 }}>
        {victimName}
      </SerifTitle>

      {/* Kind line — mono caps below the name */}
      <MonoLabel
        size={tokens.size.monoChip}
        tracking={tokens.tracking.chip}
        color={tokens.color.text.secondary}
        style={{ marginTop: 4 }}
      >
        {kindLine}
      </MonoLabel>
    </Pressable>
  );
}
