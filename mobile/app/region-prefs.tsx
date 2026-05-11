/**
 * Region preferences — pin US states for filter + sort bias.
 *
 * Pinned states default-filter the case list and bias "Cases near me"
 * sorting. Cases outside the pinned set are still visible — pinning is
 * a sort/surface signal, not a hide-the-rest gate. The TrustDisclosure
 * callout repeats that promise on the screen so users don't think
 * pinning a state means "hide everything else".
 *
 * Per CLAUDE.md: hooks declared before any conditional return.
 */

import Ionicons from '@expo/vector-icons/Ionicons';
import { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  TextInput,
  View,
} from 'react-native';

import { PushScreenHeader } from '@/components/cf/screen-shell';
import {
  InfoText,
  Mono,
  MonoLabel,
  SansBody,
  SansMedium,
} from '@/components/cf/text';
import { tokens } from '@/constants/theme';
import { useRegionPrefs } from '@/lib/hooks/use-region-prefs';
import { US_STATES, type UsState } from '@/lib/us-states';

export default function RegionPrefsScreen() {
  const { pinnedStates, addState, removeState, ready } = useRegionPrefs();
  const [query, setQuery] = useState('');

  // Pinned-first sort + name/code filter. Computed even before `ready` so
  // hook count stays stable (the body renders a spinner via ready check
  // below, but the hook always fires).
  const sortedStates = useMemo<UsState[]>(() => {
    const pinnedSet = new Set(pinnedStates);
    const q = query.trim().toLowerCase();
    const filtered = q
      ? US_STATES.filter(
          (s) =>
            s.name.toLowerCase().includes(q) ||
            s.code.toLowerCase().includes(q),
        )
      : [...US_STATES];

    // Pinned states sort to top, in the order the user pinned them.
    // Unpinned states keep their alphabetical-by-name order from US_STATES.
    const pinnedRows: UsState[] = [];
    const unpinnedRows: UsState[] = [];
    for (const s of filtered) {
      if (pinnedSet.has(s.code)) pinnedRows.push(s);
      else unpinnedRows.push(s);
    }
    pinnedRows.sort(
      (a, b) => pinnedStates.indexOf(a.code) - pinnedStates.indexOf(b.code),
    );
    return [...pinnedRows, ...unpinnedRows];
  }, [pinnedStates, query]);

  const onToggle = (code: string) => {
    if (pinnedStates.includes(code)) {
      removeState(code).catch(() => {});
    } else {
      addState(code).catch(() => {});
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: tokens.color.bg.base }}>
      <PushScreenHeader title="Regions" subtitle="PINNED STATES" />

      {/* TrustDisclosure-style callout — bespoke copy, same visual language as
          components/cf/trust-disclosure.tsx (you.here left edge + info tint
          background + InfoText body). */}
      <View
        style={{
          marginHorizontal: 16,
          marginBottom: 12,
          backgroundColor: tokens.color.bg.infoTint,
          borderLeftWidth: 2,
          borderLeftColor: tokens.color.you.here,
          paddingVertical: 10,
          paddingHorizontal: 12,
        }}
      >
        <InfoText>
          Pinned states surface first in the case list and bias the map.
          Cases outside your pinned states are still visible.
        </InfoText>
      </View>

      {/* Search input — name or two-letter code, case-insensitive. Inline
          styling matches app/search.tsx since there's no shared
          search-input primitive yet. */}
      <View style={{ paddingHorizontal: 16, paddingBottom: 12 }}>
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search states (name or code)"
          placeholderTextColor={tokens.color.text.disabled}
          autoCapitalize="none"
          autoCorrect={false}
          style={{
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

      {!ready ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator color={tokens.color.accent.amber} />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={{ paddingBottom: 32 }}
          keyboardShouldPersistTaps="handled"
        >
          {sortedStates.length === 0 ? (
            <View style={{ paddingHorizontal: tokens.space.card, paddingTop: tokens.space.section }}>
              <SansBody style={{ color: tokens.color.text.secondary }}>
                No states match &quot;{query}&quot;.
              </SansBody>
            </View>
          ) : (
            <View
              style={{
                marginHorizontal: 16,
                backgroundColor: tokens.color.bg.elev1,
                borderColor: tokens.color.border.subtle,
                borderWidth: 0.5,
                borderRadius: 6,
                overflow: 'hidden',
              }}
            >
              {sortedStates.map((s, idx) => (
                <StateRow
                  key={s.code}
                  state={s}
                  pinned={pinnedStates.includes(s.code)}
                  isFirst={idx === 0}
                  onPress={() => onToggle(s.code)}
                />
              ))}
            </View>
          )}

          {/* Disabled-style explainer — lives below the list so the user
              sees the automatic-sort guarantee right after they pin
              something. */}
          <View
            style={{
              marginHorizontal: 16,
              marginTop: 12,
              paddingHorizontal: 13,
              paddingVertical: 11,
              borderColor: tokens.color.border.subtle,
              borderWidth: 0.5,
              borderRadius: 6,
              opacity: 0.7,
            }}
          >
            <MonoLabel
              size={tokens.size.monoLabel}
              color={tokens.color.text.disabled}
            >
              CASES SORTED BY PINNED STATES
            </MonoLabel>
            <SansBody
              style={{
                marginTop: 4,
                fontSize: 13,
                color: tokens.color.text.disabled,
              }}
            >
              Automatic. The case list and map use your pinned states to
              decide which cases appear first.
            </SansBody>
          </View>
        </ScrollView>
      )}
    </View>
  );
}

interface StateRowProps {
  state: UsState;
  pinned: boolean;
  isFirst: boolean;
  onPress: () => void;
}

function StateRow({ state, pinned, isFirst, onPress }: StateRowProps) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${pinned ? 'Unpin' : 'Pin'} ${state.name}`}
      accessibilityState={{ selected: pinned }}
      style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
    >
      <View
        style={{
          paddingHorizontal: 13,
          paddingVertical: 13,
          borderTopWidth: isFirst ? 0 : 0.5,
          borderTopColor: tokens.color.border.subtle,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 12,
        }}
      >
        <CheckGlyph pinned={pinned} />
        <View style={{ flex: 1 }}>
          <SansMedium size={tokens.size.body}>{state.name}</SansMedium>
        </View>
        <Mono
          size={12}
          style={{
            color: pinned
              ? tokens.color.accent.amber
              : tokens.color.text.secondary,
          }}
        >
          {state.code}
        </Mono>
      </View>
    </Pressable>
  );
}

/**
 * Tiny circular check affordance. Filled amber + dark glyph when pinned,
 * empty outline when not. Mirrors the shape-first encoding the rest of
 * the app uses for "selected" — no traffic-light coloring.
 */
function CheckGlyph({ pinned }: { pinned: boolean }) {
  return (
    <View
      style={{
        width: 22,
        height: 22,
        borderRadius: 11,
        borderWidth: 1,
        borderColor: pinned
          ? tokens.color.accent.amber
          : tokens.color.border.hairline,
        backgroundColor: pinned ? tokens.color.accent.amber : 'transparent',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {pinned ? (
        <Ionicons name="checkmark" size={14} color="#1a1408" />
      ) : null}
    </View>
  );
}
