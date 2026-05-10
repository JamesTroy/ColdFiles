/**
 * LegalDocScreen — shared chrome for About / Privacy / Terms / Takedown.
 *
 * Same case-file aesthetic: back-arrow chrome at the top, mono-cap section
 * headings, narrative body text. Content comes through as a structured array
 * of sections so the four screens stay free of layout duplication.
 *
 * The same content lives at https://coldfile.app/legal/{slug} (Next.js site,
 * separate codebase) for Play Console + offline rights-holder access. Keep
 * the wording in sync.
 */

import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import type { ReactElement } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { tokens } from '@/constants/theme';

import { Mono, MonoLabel, NarrativeText, SerifTitle } from './text';

export interface DocSection {
  heading?: string;
  body?: string[];
  /**
   * Optional custom content rendered after the body paragraphs. Used
   * sparingly — currently only the About screen uses this to render the
   * per-source health table. Most legal/policy screens are pure prose
   * and pass nothing here.
   */
  extra?: ReactElement;
}

export interface LegalDocProps {
  title: string;
  lastUpdated: string;
  sections: DocSection[];
}

export function LegalDocScreen({
  title,
  lastUpdated,
  sections,
}: LegalDocProps): ReactElement {
  const insets = useSafeAreaInsets();

  return (
    <View style={{ flex: 1, backgroundColor: tokens.color.bg.base }}>
      {/* Top chrome */}
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
          hitSlop={12}
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
          <Ionicons name="chevron-back" size={18} color={tokens.color.text.primary} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <SerifTitle size="h2" style={{ fontSize: 20 }}>
            {title}
          </SerifTitle>
          <MonoLabel
            size={tokens.size.monoLabel}
            color={tokens.color.text.secondary}
            style={{ marginTop: 2 }}
          >
            {`LAST UPDATED · ${lastUpdated}`}
          </MonoLabel>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: 16,
          paddingBottom: insets.bottom + 32,
        }}
      >
        {sections.map((section, i) => (
          <View key={i} style={{ marginTop: i === 0 ? 8 : 22 }}>
            {section.heading ? (
              <MonoLabel
                size={tokens.size.monoChip}
                tracking={tokens.tracking.chip}
                color={tokens.color.text.secondary}
                style={{ marginBottom: 8 }}
              >
                {section.heading}
              </MonoLabel>
            ) : null}
            {(section.body ?? []).map((paragraph, j) => (
              <NarrativeText
                key={j}
                style={{ marginBottom: j < (section.body?.length ?? 0) - 1 ? 12 : 0 }}
              >
                {paragraph}
              </NarrativeText>
            ))}
            {section.extra ? (
              <View style={{ marginTop: section.body && section.body.length > 0 ? 12 : 0 }}>
                {section.extra}
              </View>
            ) : null}
          </View>
        ))}

        <View style={{ marginTop: 32 }}>
          <Mono
            size={tokens.size.monoCaption}
            style={{
              color: tokens.color.text.secondary,
              letterSpacing: tokens.size.monoCaption * tokens.tracking.chip,
              lineHeight: tokens.size.monoCaption * 1.7,
            }}
          >
            MATTE BLACK DEV LLC · VENTURA, CA
          </Mono>
        </View>
      </ScrollView>
    </View>
  );
}
