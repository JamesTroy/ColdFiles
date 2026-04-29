/**
 * EmptyState — overlay shown when a query returns zero rows.
 *
 * Sibling to ErrorState (same em-dash + serif treatment), but for the
 * not-an-error case: viewport with no cases, or a filter that excluded
 * everything. Rendered absolutely-positioned over the map; pointer-events
 * stay box-none on the wrapper so the user can keep panning.
 */

import type { ReactElement } from 'react';
import { View } from 'react-native';

import { tokens } from '@/constants/theme';

import { MonoLabel, SansBody, SerifTitle } from './text';

export type EmptyStateVariant = 'no-cases-in-region' | 'no-matches';

export interface EmptyStateProps {
  variant: EmptyStateVariant;
  /** Override default hint copy. */
  hint?: string;
}

const COPY: Record<EmptyStateVariant, { title: string; hint: string }> = {
  'no-cases-in-region': {
    title: 'No cases in this view',
    hint: 'Pan or zoom to see another area.',
  },
  'no-matches': {
    title: 'No matches',
    hint: 'Try removing a filter.',
  },
};

export function EmptyState({ variant, hint }: EmptyStateProps): ReactElement {
  const copy = COPY[variant];
  return (
    <View
      pointerEvents="box-none"
      style={{
        position: 'absolute',
        top: 0,
        bottom: 0,
        left: 0,
        right: 0,
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: 24,
      }}
    >
      <View
        style={{
          backgroundColor: tokens.color.bg.elev1,
          borderColor: tokens.color.border.strong,
          borderWidth: 0.5,
          paddingVertical: 20,
          paddingHorizontal: 24,
          minWidth: 240,
          alignItems: 'center',
          borderRadius: tokens.radius.card,
        }}
      >
        <SerifTitle
          size="h1"
          style={{
            fontSize: 36,
            color: tokens.color.text.secondary,
            lineHeight: 36,
            marginBottom: 10,
          }}
        >
          —
        </SerifTitle>
        <SansBody
          style={{
            color: tokens.color.text.primary,
            textAlign: 'center',
            marginBottom: 6,
          }}
        >
          {copy.title}
        </SansBody>
        <MonoLabel
          size={tokens.size.monoCaption}
          tracking={tokens.tracking.label}
          color={tokens.color.text.secondary}
        >
          {(hint ?? copy.hint).toUpperCase()}
        </MonoLabel>
      </View>
    </View>
  );
}
