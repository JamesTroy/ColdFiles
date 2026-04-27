/**
 * List tab — chronological / alphabetical case browse.
 *
 * Each row uses the design system's list-row treatment:
 *   - Mono-cap kind line above the victim name (HOMICIDE / 1985 / CLAREMONT, CA)
 *   - Inter Medium 16px victim name (NOT serif — serif is reserved for arrival)
 *   - PinGlyph at 12px on the leading edge to reinforce kind via shape
 *
 * Backend wiring lands when supabase-js is configured. Today this is sample data
 * proving the row treatment matches the design.
 */

import { router } from 'expo-router';
import { Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PinGlyph, type PinKind } from '@/components/cf/pin';
import { MonoLabel, SansMedium, SerifTitle } from '@/components/cf/text';
import { tokens } from '@/constants/theme';

interface CaseRow {
  slug: string;
  victimName: string;
  kindLine: string;
  pinKind: PinKind;
}

const SAMPLE_ROWS: CaseRow[] = [
  {
    slug: 'evans-1985',
    victimName: 'David R. Evans',
    kindLine: 'HOMICIDE / 1985 / CLAREMONT, CA',
    pinKind: 'homicide',
  },
  {
    slug: 'aarlie-2011',
    victimName: 'John Andrew Aarlie',
    kindLine: 'MISSING / 2011 / YAKIMA, WA',
    pinKind: 'missing',
  },
  {
    slug: 'doe-1985',
    victimName: 'Unidentified Female, est. 18–25',
    kindLine: 'UNIDENTIFIED / RECOVERED 1985 / LOS ANGELES, CA',
    pinKind: 'unidentified',
  },
  {
    slug: 'talmon-1974',
    victimName: 'Duane Robert Talmon',
    kindLine: 'MISSING / 1974 / BUFFALO, NY',
    pinKind: 'missing',
  },
];

export default function ListScreen() {
  const insets = useSafeAreaInsets();
  return (
    <View style={{ flex: 1, backgroundColor: tokens.color.bg.base }}>
      <View style={{ paddingTop: insets.top + 8, paddingHorizontal: 16, paddingBottom: 12 }}>
        <SerifTitle size="h2" style={{ fontSize: 19 }}>
          List
        </SerifTitle>
        <MonoLabel size={tokens.size.monoLabel} style={{ marginTop: 2 }}>
          {`${SAMPLE_ROWS.length} CASES · CHRONOLOGICAL`}
        </MonoLabel>
      </View>

      <ScrollView contentContainerStyle={{ paddingBottom: 24 }}>
        {SAMPLE_ROWS.map((row) => (
          <Pressable
            key={row.slug}
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
              <PinGlyph kind={row.pinKind} />
            </View>
            <View style={{ flex: 1 }}>
              <MonoLabel
                size={tokens.size.monoLabel}
                tracking={tokens.tracking.label}
                color={tokens.color.evidence.chrome}
                style={{ marginBottom: 4 }}
              >
                {row.kindLine}
              </MonoLabel>
              <SansMedium>{row.victimName}</SansMedium>
            </View>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}
