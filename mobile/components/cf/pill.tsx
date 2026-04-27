/**
 * Status + urgency pills. Pills carry the user's relationship to the case
 * (state + urgency); they never restate verifiable case data. See "Pill grammar"
 * in docs/04_DESIGN_SYSTEM.md.
 *
 *   <UnsolvedPill>     status — case is open
 *   <ColdPill>         urgency — Ny cold or ~Ny cold; computed from incident_date
 *   <ResolvedPill>     30-day window after status flipped to identified/cleared
 *   <FilterChip>       active vs inactive filter (not technically a pill, same family)
 */

import { Pressable, View, type ViewStyle } from 'react-native';

import { tokens } from '@/constants/theme';

import { Mono, MonoLabel } from './text';

const pillBase: ViewStyle = {
  paddingVertical: 4,
  paddingHorizontal: 10,
  borderRadius: tokens.radius.pill,
  alignSelf: 'flex-start',
};

export function UnsolvedPill() {
  return (
    <View
      style={[
        pillBase,
        { backgroundColor: tokens.color.bg.amberTintPill },
      ]}
    >
      <MonoLabel size={tokens.size.monoChip} tracking={tokens.tracking.chip} color={tokens.color.accent.amber}>
        UNSOLVED
      </MonoLabel>
    </View>
  );
}

interface ColdPillProps {
  /** Result of `tokens.caseDetail.coldPill(...)`. If null, render nothing. */
  text: string | null;
}

export function ColdPill({ text }: ColdPillProps) {
  if (!text) return null;
  return (
    <View
      style={[
        pillBase,
        { backgroundColor: tokens.color.bg.elev1 },
      ]}
    >
      <Mono size={tokens.size.monoChip}>{text}</Mono>
    </View>
  );
}

interface ResolvedPillProps {
  /** Year the case resolved, e.g. 2025. */
  year: number;
}

export function ResolvedPill({ year }: ResolvedPillProps) {
  return (
    <View
      style={[
        pillBase,
        { backgroundColor: '#1a201b' },
      ]}
    >
      <MonoLabel size={tokens.size.monoChip} tracking={tokens.tracking.chip} color={tokens.color.status.resolved}>
        {`RESOLVED · ${year}`}
      </MonoLabel>
    </View>
  );
}

interface FilterChipProps {
  label: string;
  count?: number;
  active?: boolean;
  onPress?: () => void;
}

export function FilterChip({ label, count, active = false, onPress }: FilterChipProps) {
  const text = count !== undefined ? `${label} · ${count}` : label;
  return (
    <Pressable
      onPress={onPress}
      style={[
        {
          paddingVertical: 6,
          paddingHorizontal: 12,
          borderRadius: tokens.radius.chip,
          alignSelf: 'flex-start',
          marginRight: 6,
        },
        active
          ? { backgroundColor: tokens.color.accent.amber }
          : {
              borderWidth: StyleSheetHairline,
              borderColor: tokens.color.border.strong,
            },
      ]}
    >
      <Mono
        size={tokens.size.meta}
        style={{
          color: active ? '#1a1408' : tokens.color.text.secondary,
        }}
      >
        {text}
      </Mono>
    </Pressable>
  );
}

// 0.5px on @2x/@3x devices. Fixed import to keep the chip border crisp.
const StyleSheetHairline = 0.5;
