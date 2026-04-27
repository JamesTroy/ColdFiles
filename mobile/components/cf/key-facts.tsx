/**
 * Key-facts table — verifiable case data, separated from pills.
 *
 * Contract: pills = state + urgency. Key-facts = verifiable case data.
 * If a row would describe the user's relationship to the case, it's a pill,
 * not a row here. See "Pill grammar" in docs/04_DESIGN_SYSTEM.md.
 */

import { View } from 'react-native';

import { tokens } from '@/constants/theme';

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
        <View
          key={fact.label}
          style={{
            flexDirection: 'row',
            justifyContent: 'space-between',
            alignItems: 'baseline',
            paddingVertical: 9,
            borderBottomWidth: i < facts.length - 1 ? 0.5 : 0,
            borderBottomColor: tokens.color.border.subtle,
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
      ))}
    </View>
  );
}
