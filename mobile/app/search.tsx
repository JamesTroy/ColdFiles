/**
 * Search — slug, victim name, or location across all loaded cases.
 *
 * Lightweight client-side filter over `useCaseList()` — fine for V1's launch
 * metro (LA County, ~50–100 cases). When the dataset grows, this swaps to a
 * server-side `cases_search` RPC with full-text indexing.
 */

import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Mono, MonoLabel, NarrativeText, SansBody, SansMedium, SerifTitle } from '@/components/cf/text';
import { tokens } from '@/constants/theme';
import { useCaseList } from '@/lib/hooks/use-case-list';
import type { CaseRowMapNear } from '@/lib/types/database';

export default function SearchScreen() {
  const insets = useSafeAreaInsets();
  const [query, setQuery] = useState('');
  const { data: cases } = useCaseList({ limit: 200 });

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return cases.filter((c) => {
      const fields = [
        c.victim_name,
        c.location_text,
        c.location_city,
        c.slug,
        c.narrative_short,
      ]
        .filter((v): v is string => typeof v === 'string')
        .map((v) => v.toLowerCase());
      return fields.some((f) => f.includes(q));
    });
  }, [cases, query]);

  return (
    <View style={{ flex: 1, backgroundColor: tokens.color.bg.base }}>
      <View
        style={{
          paddingTop: insets.top + 6,
          paddingHorizontal: 16,
          paddingBottom: 12,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 12,
        }}
      >
        <Pressable
          onPress={() => router.back()}
          accessibilityLabel="Back"
          accessibilityRole="button"
          hitSlop={16}
          style={({ pressed }) => [
            {
              width: 36,
              height: 36,
              borderRadius: 18,
              backgroundColor: tokens.color.bg.elev1,
              borderWidth: 0.5,
              borderColor: tokens.color.border.strong,
              alignItems: 'center',
              justifyContent: 'center',
              opacity: pressed ? 0.7 : 1,
            },
          ]}
        >
          <Ionicons name="close" size={20} color={tokens.color.text.primary} />
        </Pressable>
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search names, places, slugs"
          placeholderTextColor={tokens.color.text.disabled}
          autoCapitalize="none"
          autoCorrect={false}
          autoFocus
          style={{
            flex: 1,
            backgroundColor: tokens.color.bg.elev1,
            borderColor: tokens.color.border.strong,
            borderWidth: 0.5,
            borderRadius: 6,
            paddingHorizontal: 12,
            paddingVertical: 10,
            color: tokens.color.text.primary,
            fontFamily: tokens.font.sans,
            fontSize: tokens.size.body,
          }}
        />
      </View>

      <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 32 }}>
        {!query.trim() ? (
          <NarrativeText style={{ color: tokens.color.text.secondary, marginTop: 16 }}>
            Start typing to search across cases. Match by victim name, city,
            agency case number, or any word in the case summary.
          </NarrativeText>
        ) : results.length === 0 ? (
          <View style={{ marginTop: 32, alignItems: 'center' }}>
            <SerifTitle
              size="h1"
              style={{ fontSize: 48, color: tokens.color.text.secondary, lineHeight: 48 }}
            >
              —
            </SerifTitle>
            <SansBody style={{ marginTop: 16, color: tokens.color.text.secondary }}>
              No matches for &quot;{query}&quot;.
            </SansBody>
          </View>
        ) : (
          <>
            <MonoLabel
              size={tokens.size.monoChip}
              tracking={tokens.tracking.chip}
              color={tokens.color.text.secondary}
              style={{ marginTop: 16, marginBottom: 8 }}
            >
              {`RESULTS · ${results.length}`}
            </MonoLabel>
            {results.map((c) => (
              <ResultRow key={c.slug} row={c} onPress={() => router.push(`/case/${c.slug}`)} />
            ))}
          </>
        )}
      </ScrollView>
    </View>
  );
}

function ResultRow({ row, onPress }: { row: CaseRowMapNear; onPress: () => void }) {
  const subtitle = [row.location_text, row.incident_date?.slice(0, 4)]
    .filter(Boolean)
    .join(' · ');
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Open case ${row.victim_name ?? 'unidentified'}`}
      style={({ pressed }) => [
        {
          paddingVertical: 14,
          borderBottomWidth: 0.5,
          borderBottomColor: tokens.color.border.subtle,
          opacity: pressed ? 0.7 : 1,
        },
      ]}
    >
      <SansMedium>{row.victim_name ?? 'Unidentified'}</SansMedium>
      {subtitle ? (
        <Mono
          size={tokens.size.meta}
          style={{ color: tokens.color.text.secondary, marginTop: 3 }}
        >
          {subtitle}
        </Mono>
      ) : null}
    </Pressable>
  );
}
