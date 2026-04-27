/**
 * Peek sheet — the bottom sheet that appears on a map pin tap.
 *
 * Map state is preserved underneath. Users tap pin → peek → close → next pin
 * in rapid sequence; any transition that loses map context breaks that flow.
 *
 * Layout:
 *   - 36×3 grab handle
 *   - SELECTED · {distance} away          Open →
 *   - HOMICIDE / 1985 / CLAREMONT, CA     (mono-cap, evidence.chrome)
 *   - {Victim Name}                       (serif 20px — arrival begins here)
 *
 * The kind/year/place line goes above the name, matching list-row treatment.
 * Pills only appear on the case detail screen, never here.
 */

import { Pressable, View } from 'react-native';

import { tokens } from '@/constants/theme';

import { MonoLabel, SerifTitle } from './text';

interface PeekSheetProps {
  /** Distance in miles, e.g. "1.4". */
  distanceMiles: number;
  /** "HOMICIDE / 1985 / CLAREMONT, CA". Full mono-cap line including separators. */
  kindLine: string;
  /** Victim name; for unidentifieds, "Unidentified Female, est. 18–25". */
  victimName: string;
  /** Tap anywhere on the sheet → opens the case detail. */
  onOpen: () => void;
}

export function PeekSheet({
  distanceMiles,
  kindLine,
  victimName,
  onOpen,
}: PeekSheetProps) {
  return (
    <Pressable
      onPress={onOpen}
      style={{
        backgroundColor: tokens.color.bg.elev1,
        paddingHorizontal: 16,
        paddingTop: 12,
        paddingBottom: 16,
        borderTopWidth: 0.5,
        borderTopColor: tokens.color.border.subtle,
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

      {/* Section label row */}
      <View
        style={{
          flexDirection: 'row',
          justifyContent: 'space-between',
          alignItems: 'baseline',
          marginBottom: 6,
        }}
      >
        <MonoLabel size={tokens.size.monoLabel}>
          {`SELECTED · ${distanceMiles.toFixed(1)} mi away`}
        </MonoLabel>
        <MonoLabel
          size={tokens.size.monoLabel}
          color={tokens.color.accent.amber}
        >
          OPEN →
        </MonoLabel>
      </View>

      {/* Kind / year / place — above the name. evidence.chrome color. */}
      <MonoLabel
        size={tokens.size.monoChip}
        tracking={tokens.tracking.label}
        color={tokens.color.evidence.chrome}
        style={{ marginBottom: 4 }}
      >
        {kindLine}
      </MonoLabel>

      {/* Victim name — serif. Arrival begins here. */}
      <SerifTitle size="h2">{victimName}</SerifTitle>
    </Pressable>
  );
}
