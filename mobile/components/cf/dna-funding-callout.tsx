/**
 * DnaFundingCallout — per-case "Fund DNA work on this case" surface.
 *
 * Visible only when the case row carries both `dna_funding_url` and
 * `dna_funding_kind` (migration 48). Tapping the CTA triggers an audit
 * log via the dna-funding-route Edge Function, then deep-links to the
 * external funding platform (Othram DNA Solves or Season of Justice).
 *
 * Posture: Cold File never processes payments or holds case-tied funds.
 * See docs/13_DNA_FUNDING.md + feedback_dna_funding_externalize memory.
 *
 * Placement note: lives in the scroll content (NOT the sticky bar) so it
 * doesn't compete with the primary tip CTA. The tip CTA is the universal
 * action; DNA funding is a per-case opportunity that surfaces only when
 * a fundraiser exists.
 */

import { useCallback } from 'react';
import { ActivityIndicator, Linking, Pressable, View } from 'react-native';

import { tokens } from '@/constants/theme';
import { useDnaFundingHandoff } from '@/lib/hooks/use-dna-funding-handoff';
import type { DnaFundingKind } from '@/lib/types/database';

import { InfoText, MonoLabel } from './text';

interface DnaFundingCalloutProps {
  caseId: string;
  fundingKind: DnaFundingKind;
  /**
   * Fallback URL used only when the Edge Function fails. The case row
   * already carries the URL from the case query, so passing it here
   * avoids a second round-trip if the audit insert fails — we still
   * route the user, the audit just has a gap. Trade made because the
   * money-handoff has to feel reliable; missing audit rows are
   * recoverable, a broken donor click is not.
   */
  fallbackFundingUrl: string;
}

const PLATFORM_LABEL: Record<DnaFundingKind, string> = {
  othram: 'Othram (DNA Solves)',
  season_of_justice: 'Season of Justice',
  other: 'an independent forensic lab',
};

export function DnaFundingCallout({
  caseId,
  fundingKind,
  fallbackFundingUrl,
}: DnaFundingCalloutProps) {
  const { submit, submitting } = useDnaFundingHandoff();

  const onPress = useCallback(async () => {
    let target = fallbackFundingUrl;
    try {
      const result = await submit({
        caseId,
        userAgentSummary: 'mobile',
      });
      target = result.funding_url;
    } catch {
      // Audit insert failed (or rate-limited) — fall back to the URL we
      // already have on the case row. The audit gap is acceptable; a
      // broken donor click isn't.
    }
    Linking.openURL(target).catch(() => {});
  }, [caseId, fallbackFundingUrl, submit]);

  return (
    <View
      style={{
        marginHorizontal: 16,
        marginTop: 22,
        padding: 14,
        borderWidth: 0.5,
        borderColor: tokens.color.accent.amber,
        borderRadius: tokens.radius.card,
        backgroundColor: tokens.color.bg.base,
      }}
    >
      <MonoLabel
        size={tokens.size.monoChip}
        tracking={tokens.tracking.chip}
        color={tokens.color.accent.amber}
        style={{ marginBottom: 6 }}
      >
        FUND DNA WORK ON THIS CASE
      </MonoLabel>

      <InfoText style={{ marginBottom: 12 }}>
        {`${PLATFORM_LABEL[fundingKind]} is raising funds for forensic-genetic-genealogy work on this case. Donations go directly to the lab — Cold File does not process or receive payments.`}
      </InfoText>

      <Pressable
        onPress={onPress}
        disabled={submitting}
        accessibilityRole="button"
        accessibilityLabel="Open funding page for this case"
        accessibilityState={{ busy: submitting, disabled: submitting }}
        hitSlop={8}
        style={({ pressed }) => [
          {
            alignSelf: 'flex-start',
            paddingVertical: 8,
            paddingHorizontal: 0,
            opacity: submitting ? 0.6 : pressed ? 0.6 : 1,
            flexDirection: 'row',
            alignItems: 'center',
            gap: 8,
          },
        ]}
      >
        <MonoLabel
          size={tokens.size.monoChip}
          tracking={tokens.tracking.chip}
          color={tokens.color.accent.amber}
        >
          OPEN FUNDING PAGE →
        </MonoLabel>
        {submitting ? (
          <ActivityIndicator size="small" color={tokens.color.accent.amber} />
        ) : null}
      </Pressable>
    </View>
  );
}
