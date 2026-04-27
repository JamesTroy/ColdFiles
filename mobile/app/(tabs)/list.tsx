/**
 * List tab — recent cases.
 *
 * Wired to useCaseList() against the cases table. Each row uses the design
 * system's list-row treatment: PinGlyph leading, mono-cap kind/year/place
 * line above the victim name (NOT a pill — pills only on detail screens),
 * Inter Medium 16px name (NOT serif — serif is reserved for arrival).
 */

import { router } from 'expo-router';
import { ActivityIndicator, Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PinGlyph } from '@/components/cf/pin';
import { MonoLabel, SansBody, SansMedium, SerifTitle } from '@/components/cf/text';
import { tokens } from '@/constants/theme';
import { kindLine } from '@/lib/format';
import { useCaseList } from '@/lib/hooks/use-case-list';
import type { CaseKind, CaseRowMapNear } from '@/lib/types/database';

const PIN_KIND_FOR_LIST: Record<CaseKind, CaseKind> = {
  homicide: 'homicide',
  missing: 'missing',
  unidentified: 'unidentified',
  unclaimed: 'unidentified',
  suspicious_death: 'homicide',
};

export default function ListScreen() {
  const insets = useSafeAreaInsets();
  const { data: rows, loading, error, source } = useCaseList({ limit: 100 });

  return (
    <View style={{ flex: 1, backgroundColor: tokens.color.bg.base }}>
      <View style={{ paddingTop: insets.top + 8, paddingHorizontal: 16, paddingBottom: 12 }}>
        <SerifTitle size="h2" style={{ fontSize: 19 }}>
          List
        </SerifTitle>
        <MonoLabel size={tokens.size.monoLabel} style={{ marginTop: 2 }}>
          {`${rows.length} CASES · CHRONOLOGICAL${source === 'sample' ? ' · SAMPLE' : ''}`}
        </MonoLabel>
      </View>

      {loading && rows.length === 0 ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator color={tokens.color.accent.amber} />
        </View>
      ) : error ? (
        <View style={{ paddingHorizontal: 16 }}>
          <SansBody style={{ color: tokens.color.text.secondary }}>
            Couldn't load cases: {error.message}
          </SansBody>
        </View>
      ) : rows.length === 0 ? (
        <EmptyState />
      ) : (
        <ScrollView contentContainerStyle={{ paddingBottom: 24 }}>
          {rows.map((row) => (
            <CaseListRow key={row.slug} row={row} />
          ))}
        </ScrollView>
      )}
    </View>
  );
}

function CaseListRow({ row }: { row: CaseRowMapNear }) {
  return (
    <Pressable
      onPress={() => router.push(`/case/${row.slug}`)}
      style={({ pressed }) => [
        {
          paddingHorizontal: 16,
          paddingVertical: 14,
          borderBottomWidth: 0.5,
          borderBottomColor: tokens.color.border.subtle,
          opacity: pressed ? 0.7 : 1,
          flexDirection: 'row',
          alignItems: 'flex-start',
        },
      ]}
    >
      <View style={{ marginRight: 12, marginTop: 4 }}>
        <PinGlyph kind={PIN_KIND_FOR_LIST[row.kind]} />
      </View>
      <View style={{ flex: 1 }}>
        <MonoLabel
          size={tokens.size.monoLabel}
          tracking={tokens.tracking.label}
          color={tokens.color.evidence.chrome}
          style={{ marginBottom: 4 }}
        >
          {kindLine(row)}
        </MonoLabel>
        <SansMedium>{listDisplayName(row)}</SansMedium>
      </View>
    </Pressable>
  );
}

function listDisplayName(row: CaseRowMapNear): string {
  if (row.victim_name) return row.victim_name;
  if (row.kind === 'unidentified' || row.kind === 'unclaimed') return 'Unidentified';
  return 'Name not released';
}

function EmptyState() {
  return (
    <View
      style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 }}
    >
      <SerifTitle
        size="h1"
        style={{ fontSize: 48, color: tokens.color.text.secondary, marginBottom: 16 }}
      >
        —
      </SerifTitle>
      <SansBody
        style={{
          color: tokens.color.text.secondary,
          textAlign: 'center',
          lineHeight: tokens.size.body * 1.5,
        }}
      >
        No cases match the current filters.
      </SansBody>
    </View>
  );
}
