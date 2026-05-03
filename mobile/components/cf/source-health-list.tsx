/**
 * SourceHealthList — per-source ingest-activity surface for the About
 * screen.
 *
 * The architectural conversation that drove this surface (see memory:
 * feedback_ingest_metric_axis):
 *
 *   • Wording names "checks" not "refreshes." A re-scrape that touches
 *     stale records sets the timestamp without anything meaningfully
 *     changing per-case. "Last checked" is mechanically accurate.
 *
 *   • Per-source, not corpus-wide max. A corpus-wide max collapses
 *     sources into one number and hides the "one stalls while others
 *     stay healthy" failure mode the signal exists to expose.
 *
 *   • Explicit state labels (HEALTHY / SLOW / STALLED) with color
 *     treatment. Hiding stale data is misleading by omission; owning
 *     the state with a label gives the user (and a screenshot) a
 *     legible answer instead of an ambiguous timestamp.
 *
 *   • About-screen placement, not footer. Footer would put a quality
 *     indicator in front of every user on every screen, requiring
 *     constant maintenance and reading as platform-dying on bad days
 *     to anyone who'd seen yesterday. About is where users who care
 *     about provenance go; appending source-checks to the existing
 *     source list is a natural extension of the same trust contract.
 *
 * Palette discipline: amber-only per CLAUDE.md (memory:
 * feedback_amber_is_ethical_posture). Healthy uses the secondary text
 * color (no special treatment); slow uses warm amber; stalled uses
 * amber-hot — the same color as the FreshDot, the existing
 * attention-color in the app.
 */

import type { ReactElement } from 'react';
import { View } from 'react-native';

import { tokens } from '@/constants/theme';

import {
  classifySourceState,
  formatTimeAgo,
  type SourceHealth,
  type SourceState,
} from '@/lib/hooks/use-source-health';

import { MonoLabel, NarrativeText } from './text';

interface Props {
  sources: SourceHealth[] | null;
  loading: boolean;
}

export function SourceHealthList({ sources, loading }: Props): ReactElement {
  if (loading && (sources === null || sources.length === 0)) {
    return (
      <NarrativeText style={{ color: tokens.color.text.disabled }}>
        Loading source status…
      </NarrativeText>
    );
  }
  if (!sources || sources.length === 0) {
    return (
      <NarrativeText style={{ color: tokens.color.text.disabled }}>
        Source status unavailable.
      </NarrativeText>
    );
  }
  return (
    <View>
      {sources.map((s) => (
        <SourceHealthRow key={s.source_slug} source={s} />
      ))}
    </View>
  );
}

function SourceHealthRow({ source }: { source: SourceHealth }) {
  const state = classifySourceState(source.last_checked);
  const ageLabel = formatTimeAgo(source.last_checked);
  return (
    <View
      style={{
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'baseline',
        paddingVertical: 8,
        borderBottomWidth: 0.5,
        borderBottomColor: tokens.color.border.subtle,
        gap: 12,
      }}
    >
      <NarrativeText style={{ flex: 1, flexShrink: 1 }}>
        {source.source_name}
      </NarrativeText>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 6 }}>
        <MonoLabel
          size={tokens.size.monoChip}
          tracking={tokens.tracking.chip}
          color={stateColor(state)}
        >
          {stateLabel(state)}
        </MonoLabel>
        <MonoLabel
          size={tokens.size.monoChip}
          tracking={tokens.tracking.chip}
          color={tokens.color.text.disabled}
        >
          · {ageLabel.toUpperCase()}
        </MonoLabel>
      </View>
    </View>
  );
}

function stateLabel(state: SourceState): string {
  switch (state) {
    case 'healthy':
      return 'HEALTHY';
    case 'slow':
      return 'SLOW';
    case 'stalled':
      return 'STALLED';
    case 'unknown':
      return 'UNKNOWN';
  }
}

function stateColor(state: SourceState): string {
  switch (state) {
    case 'healthy':
      return tokens.color.text.secondary;
    case 'slow':
      return tokens.color.accent.amber;
    case 'stalled':
      return tokens.color.accent.amberHot;
    case 'unknown':
      return tokens.color.text.disabled;
  }
}
