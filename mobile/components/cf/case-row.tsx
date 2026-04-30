/**
 * CaseRow — shared row component for every case-list surface.
 *
 * Two contexts use this today:
 *   - The Map screen's bottom sheet (mobile/components/cf/map-bottom-sheet.tsx)
 *   - The List tab (mobile/app/(tabs)/list.tsx)
 *
 * They are intentionally one component. Drift between the two contexts —
 * different stripe widths, different metadata layout, different fresh-dot
 * behavior — is the kind of tear-down that costs a v1.0.3 sprint of "why
 * don't these match" tickets. Lock the shared shape now while it's only
 * being used in two places.
 *
 * The visual contract:
 *   - 3dp left-edge stripe in the case-kind color (pin grammar). Replaces
 *     the generic silhouette thumbnail; same scan signal in 1/15 the width,
 *     and reads as case-file index rather than catalog.
 *   - Optional small thumbnail (silhouette / em-dash / dimmed-for-Doe) when
 *     the parent passes `withThumbnail`. The bottom sheet uses it; the List
 *     tab doesn't, since the editorial scan is denser without it.
 *   - SansMedium name; mono caps kindLine; optional mono trailing meta line.
 *   - Fresh-dot prefix on the name when daysSinceUpdate <= FRESH_DAY_LIMIT.
 *     Only renders when the parent supplies a daysSinceUpdate.
 *   - Highlighted state (amber tint) used by the bottom sheet to mark the
 *     pin-tap-selected row. List tab leaves it false.
 */

import type { ReactElement } from 'react';
import { Pressable, View } from 'react-native';
import Svg, { Ellipse, Rect } from 'react-native-svg';

import { tokens } from '@/constants/theme';
import { kindLine } from '@/lib/format';
import type { CaseKind, CaseRowMapNear } from '@/lib/types/database';

import { MonoLabel, SansMedium, SerifTitle } from './text';

export const FRESH_DAY_LIMIT = 10;

export interface CaseRowProps {
  row: CaseRowMapNear;
  onPress: () => void;
  /** Days since last_changed_at. Drives the fresh-dot prefix. */
  daysSinceUpdate?: number | null;
  /** Optional third line of metadata (locality, "updated today", agency). */
  trailingLine?: string | null;
  /** Pin highlight — amber tint behind the row. */
  highlighted?: boolean;
  /**
   * When true, renders the 48dp silhouette thumbnail to the right of the
   * stripe. The bottom sheet wants it (the sheet is visually denser and the
   * thumbnail anchors the row); the List tab leaves it false (the tab is
   * scan-first, and the stripe alone is the visual anchor).
   */
  withThumbnail?: boolean;
}

export function CaseRow({
  row,
  onPress,
  daysSinceUpdate = null,
  trailingLine = null,
  highlighted = false,
  withThumbnail = false,
}: CaseRowProps): ReactElement {
  const display = displayName(row);
  const isFresh =
    daysSinceUpdate != null && daysSinceUpdate <= FRESH_DAY_LIMIT;

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        {
          flexDirection: 'row',
          alignItems: 'flex-start',
          gap: 12,
          paddingHorizontal: 18,
          paddingVertical: 14,
          borderBottomWidth: 0.5,
          borderBottomColor: tokens.color.border.subtle,
          opacity: pressed ? 0.7 : 1,
          backgroundColor: highlighted
            ? tokens.color.bg.amberTintCard
            : 'transparent',
        },
      ]}
    >
      {/* Left-edge case-kind stripe. Anchors visual scanning by kind without
          the catalog feel of a 56dp thumbnail. */}
      <View
        style={{
          width: 3,
          alignSelf: 'stretch',
          marginLeft: -10,
          marginRight: withThumbnail ? 4 : 8,
          backgroundColor: stripeColor(row.kind),
          borderRadius: 2,
        }}
      />

      {withThumbnail ? <Thumbnail hasPhoto={!!row.has_photo} kind={row.kind} /> : null}

      <View style={{ flex: 1, minWidth: 0 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          {isFresh ? <FreshDot /> : null}
          <SansMedium style={{ flexShrink: 1 }}>{display}</SansMedium>
        </View>
        <MonoLabel
          size={tokens.size.monoLabel}
          tracking={tokens.tracking.label}
          color={tokens.color.text.secondary}
          style={{ marginTop: 4 }}
        >
          {kindLine(row)}
        </MonoLabel>
        {trailingLine ? (
          <MonoLabel
            size={11}
            tracking={0}
            color={tokens.color.text.disabled}
            style={{ marginTop: 6 }}
          >
            {trailingLine}
          </MonoLabel>
        ) : null}
      </View>
    </Pressable>
  );
}

function Thumbnail({ hasPhoto, kind }: { hasPhoto: boolean; kind: CaseKind }) {
  const isDoe = kind === 'unidentified' || kind === 'unclaimed';
  return (
    <View
      style={{
        width: 48,
        height: 48,
        borderRadius: 4,
        backgroundColor: tokens.color.bg.elev2,
        borderWidth: 0.5,
        borderColor: tokens.color.border.strong,
        overflow: 'hidden',
        alignItems: 'center',
        justifyContent: 'center',
        opacity: isDoe ? 0.5 : 1,
      }}
    >
      {hasPhoto ? (
        <Svg width="48" height="48" viewBox="0 0 56 56">
          <Rect width="56" height="56" fill={tokens.color.silhouette.bg} />
          <Ellipse cx="28" cy="22" rx="10" ry="12" fill={tokens.color.silhouette.figure} />
          <Ellipse cx="28" cy="46" rx="14" ry="11" fill={tokens.color.silhouette.figure} />
        </Svg>
      ) : (
        <SerifTitle
          size="h1"
          style={{ fontSize: 24, color: tokens.color.text.secondary, lineHeight: 24 }}
        >
          —
        </SerifTitle>
      )}
    </View>
  );
}

function FreshDot() {
  return (
    <View
      style={{
        width: 6,
        height: 6,
        borderRadius: 3,
        backgroundColor: tokens.color.accent.amberHot,
        marginRight: 8,
      }}
    />
  );
}

function stripeColor(kind: CaseKind): string {
  if (kind === 'unidentified' || kind === 'unclaimed') return tokens.color.pin.doe;
  if (kind === 'missing') return tokens.color.pin.missing;
  return tokens.color.pin.homicide; // homicide + suspicious_death
}

function displayName(row: CaseRowMapNear): string {
  if (row.victim_name) return row.victim_name;
  if (row.kind === 'unidentified' || row.kind === 'unclaimed') return 'Unidentified person';
  return 'Name not released';
}
