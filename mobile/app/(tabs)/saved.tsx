/**
 * Saved tab — bookmarked cases.
 *
 * Wired to useSavedCases() which reads the AsyncStorage-backed receipt store
 * and hydrates each saved slug to the same row shape the List tab uses, so
 * we can reuse the CaseListRow treatment.
 *
 * Empty state matches the prototype: em-dash icon in a circle, serif title,
 * body explaining the premium push-notification upsell.
 */

import { router } from 'expo-router';
import { ActivityIndicator, Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PinGlyph } from '@/components/cf/pin';
import { MonoLabel, SansBody, SansMedium, SerifTitle } from '@/components/cf/text';
import { tokens } from '@/constants/theme';
import { kindLine } from '@/lib/format';
import { useSavedCases } from '@/lib/hooks/use-saved-cases';
import type { CaseKind, CaseRowMapNear } from '@/lib/types/database';

const PIN_KIND_FOR_LIST: Record<CaseKind, CaseKind> = {
  homicide: 'homicide',
  missing: 'missing',
  unidentified: 'unidentified',
  unclaimed: 'unidentified',
  suspicious_death: 'homicide',
};

export default function SavedScreen() {
  const insets = useSafeAreaInsets();
  const { rows, count, loading } = useSavedCases();

  return (
    <View style={{ flex: 1, backgroundColor: tokens.color.bg.base }}>
      <View style={{ paddingTop: insets.top + 8, paddingHorizontal: 16, paddingBottom: 12 }}>
        <SerifTitle size="h2" style={{ fontSize: 22 }}>
          Saved
        </SerifTitle>
        <MonoLabel
          size={tokens.size.monoLabel}
          color={tokens.color.evidence.chrome}
          style={{ marginTop: 4 }}
        >
          {count === 0 ? "CASES YOU'RE FOLLOWING" : `${count} CASE${count === 1 ? '' : 'S'} FOLLOWED`}
        </MonoLabel>
      </View>

      {loading ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator color={tokens.color.accent.amber} />
        </View>
      ) : rows.length === 0 ? (
        <EmptyState />
      ) : (
        <ScrollView contentContainerStyle={{ paddingBottom: 24 }}>
          {rows.map((row) => (
            <SavedRow key={row.slug} row={row} />
          ))}
        </ScrollView>
      )}
    </View>
  );
}

function SavedRow({ row }: { row: CaseRowMapNear }) {
  const display = displayName(row);
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
        <SansMedium>{display}</SansMedium>
        <MonoLabel
          size={tokens.size.monoLabel}
          tracking={tokens.tracking.label}
          color={tokens.color.evidence.chrome}
          style={{ marginTop: 4 }}
        >
          {kindLine(row)}
        </MonoLabel>
      </View>
    </Pressable>
  );
}

function displayName(row: CaseRowMapNear): string {
  if (row.victim_name) return row.victim_name;
  if (row.kind === 'unidentified' || row.kind === 'unclaimed') return 'Unidentified';
  return 'Name not released';
}

function EmptyState() {
  return (
    <View
      style={{
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: 32,
        gap: 14,
      }}
    >
      <View
        style={{
          width: 64,
          height: 64,
          borderRadius: 32,
          backgroundColor: tokens.color.bg.elev1,
          borderWidth: 0.5,
          borderColor: tokens.color.border.strong,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <SerifTitle
          size="h1"
          style={{ fontSize: 28, color: tokens.color.evidence.chrome, lineHeight: 28 }}
        >
          —
        </SerifTitle>
      </View>
      <SerifTitle size="h2" style={{ fontSize: 20 }}>
        Nothing saved yet
      </SerifTitle>
      <SansBody
        style={{
          color: tokens.color.text.secondary,
          textAlign: 'center',
          lineHeight: tokens.size.body * 1.55,
          maxWidth: 280,
        }}
      >
        Save a case to follow updates. Premium users get push notifications when a saved case has movement.
      </SansBody>
    </View>
  );
}
