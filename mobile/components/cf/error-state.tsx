/**
 * ErrorState — generic full-section error block with retry.
 *
 * Use when a hook returns `error` and the screen doesn't have data to show.
 * Centered em-dash glyph (matches the "no photo" design language), short
 * human-friendly message, and a "Try again" CTA. Detail strings from the
 * underlying error are passed through but kept secondary so we don't dump
 * stack traces at users.
 */

import type { ReactElement } from 'react';
import { View } from 'react-native';

import { tokens } from '@/constants/theme';

import { AmberCTA } from './cta-button';
import { Mono, SansBody, SerifTitle } from './text';

export interface ErrorStateProps {
  /** What happened, in plain English. "Couldn't load cases." */
  title?: string;
  /** Underlying error message. Shown small under the title; may be technical. */
  detail?: string | null;
  /** Tap "Try again" → fires this. Hide the button by leaving onRetry undefined. */
  onRetry?: () => void;
  retryLabel?: string;
}

export function ErrorState({
  title = "Couldn't load that.",
  detail,
  onRetry,
  retryLabel = 'Try again',
}: ErrorStateProps): ReactElement {
  return (
    <View
      style={{
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: 32,
        paddingVertical: 48,
      }}
    >
      <SerifTitle
        size="h1"
        style={{
          fontSize: 56,
          color: tokens.color.text.secondary,
          lineHeight: 56,
          marginBottom: 16,
        }}
      >
        —
      </SerifTitle>
      <SansBody
        style={{
          color: tokens.color.text.primary,
          textAlign: 'center',
          marginBottom: 8,
        }}
      >
        {title}
      </SansBody>
      {detail ? (
        <Mono
          size={tokens.size.meta}
          style={{
            color: tokens.color.text.secondary,
            textAlign: 'center',
            marginBottom: 16,
          }}
        >
          {detail}
        </Mono>
      ) : null}
      {onRetry ? (
        <View style={{ marginTop: 16, width: '100%' }}>
          <AmberCTA label={retryLabel} onPress={onRetry} />
        </View>
      ) : null}
    </View>
  );
}
