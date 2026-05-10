/**
 * Key-facts table — verifiable case data, separated from pills.
 *
 * Contract: pills = state + urgency. Key-facts = verifiable case data.
 * If a row would describe the user's relationship to the case, it's a pill,
 * not a row here. See "Pill grammar" in docs/04_DESIGN_SYSTEM.md.
 */

import { Fragment } from 'react';
import { View } from 'react-native';

import { tokens } from '@/constants/theme';

import { Divider } from './divider';
import { Mono, MonoLabel, SansBody } from './text';

export interface KeyFact {
  label: string;
  value: string;
  /** Default false — sans 12px. When true, value renders in mono (used for DATE, case numbers). */
  mono?: boolean;
}

export function KeyFactsTable({ facts }: { facts: KeyFact[] }) {
  return (
    <View
      style={{
        backgroundColor: tokens.color.bg.elev1,
        borderColor: tokens.color.border.subtle,
        borderWidth: 0.5,
        borderRadius: tokens.radius.card,
        paddingHorizontal: 14,
        paddingVertical: 12,
      }}
    >
      {facts.map((fact, i) => (
        <Fragment key={fact.label}>
          <View
            style={{
              flexDirection: 'row',
              justifyContent: 'space-between',
              alignItems: 'baseline',
              paddingVertical: 9,
            }}
          >
            <MonoLabel
              size={tokens.size.monoChip}
              tracking={tokens.tracking.chip}
            >
              {fact.label}
            </MonoLabel>
            {fact.mono ? (
              <Mono size={tokens.size.monoData} style={{ textAlign: 'right', flexShrink: 1 }}>
                {fact.value}
              </Mono>
            ) : (
              <SansBody style={{ textAlign: 'right', flexShrink: 1, fontSize: tokens.size.meta }}>
                {fact.value}
              </SansBody>
            )}
          </View>
          {i < facts.length - 1 ? <Divider /> : null}
        </Fragment>
      ))}
    </View>
  );
}
