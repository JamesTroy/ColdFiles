/**
 * Trust-disclosure surfaces — the legal posture, repeated.
 *
 * <TrustDisclosureCallout>  Full version with you.here left edge + text.info body.
 *                            Used in: submit-tip modal, tip-success screen, FAQ.
 *
 * <TrustDisclosureCaption>  Short mono-cap version.
 *                            Used in: case-detail sticky bar, anywhere a tip is mentioned.
 *
 * Same promise, different lengths. The redundancy is the point — the privacy
 * posture being repeated until it's load-bearing in the user's understanding
 * of the product. See "Trust-disclosure surfaces" in docs/04_DESIGN_SYSTEM.md.
 */

import { View } from 'react-native';

import { tokens } from '@/constants/theme';

import { InfoText, MonoLabel } from './text';

interface TrustDisclosureCalloutProps {
  /** Receiving agency's full name — appears in the disclosure copy. */
  agencyName: string;
}

export function TrustDisclosureCallout({ agencyName }: TrustDisclosureCalloutProps) {
  return (
    <View
      style={{
        backgroundColor: tokens.color.bg.infoTint,
        borderLeftWidth: 2,
        borderLeftColor: tokens.color.you.here,
        paddingVertical: 10,
        paddingHorizontal: 12,
      }}
    >
      <InfoText>
        {tokens.tipFlow.disclosureSurfaces.modal(agencyName)}
      </InfoText>
    </View>
  );
}

export function TrustDisclosureCaption() {
  return (
    <MonoLabel
      size={tokens.size.monoLabel}
      tracking={tokens.tracking.chip}
      style={{ marginTop: 8 }}
    >
      {tokens.tipFlow.disclosureSurfaces.caseDetailCaption}
    </MonoLabel>
  );
}
