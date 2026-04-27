/**
 * Radio-card pattern for the submit-tip route picker.
 *
 * Selection contract:
 *   border carries selection (1px accent.amber)
 *   bg reinforces (bg.amberTintCard)
 *
 * A bg-only selection state without a border violates the system. See
 * docs/04_DESIGN_SYSTEM.md "Radio-card pattern". If a future "selected card"
 * proposal goes bg-only, push back.
 */

import { Pressable, View } from 'react-native';

import { tokens } from '@/constants/theme';

import { MonoLabel, SansBody, SansMedium } from './text';

interface RadioCardProps {
  title: string;
  /** Right-aligned mono-cap badge — e.g. "RECOMMENDED". Optional. */
  badge?: string;
  /** Meta line under the title. Format: "{anonymity} · {routing} · {reward}" with omittable segments. */
  meta?: string;
  selected: boolean;
  onPress: () => void;
}

export function RadioCard({ title, badge, meta, selected, onPress }: RadioCardProps) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        {
          backgroundColor: selected ? tokens.color.bg.amberTintCard : tokens.color.bg.elev1,
          borderColor: selected ? tokens.color.accent.amber : tokens.color.border.strong,
          borderWidth: selected ? 1 : 0.5,
          borderRadius: tokens.radius.card,
          padding: 14,
          opacity: pressed ? 0.85 : 1,
        },
      ]}
    >
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}>
        <RadioDot selected={selected} />
        <View style={{ flex: 1 }}>
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'baseline',
              justifyContent: 'space-between',
            }}
          >
            <SansMedium>{title}</SansMedium>
            {badge ? (
              <MonoLabel
                size={9}
                tracking={0.08}
                color={tokens.color.accent.amber}
              >
                {badge}
              </MonoLabel>
            ) : null}
          </View>
          {meta ? (
            <SansBody
              style={{
                marginTop: 4,
                color: tokens.color.text.secondary,
                lineHeight: tokens.size.body * 1.5,
                fontSize: tokens.size.meta,
              }}
            >
              {meta}
            </SansBody>
          ) : null}
        </View>
      </View>
    </Pressable>
  );
}

function RadioDot({ selected }: { selected: boolean }) {
  return (
    <View
      style={{
        width: 16,
        height: 16,
        borderRadius: 8,
        borderWidth: 1.5,
        borderColor: selected ? tokens.color.accent.amber : tokens.color.border.strong,
        alignItems: 'center',
        justifyContent: 'center',
        marginTop: 2,
      }}
    >
      {selected ? (
        <View
          style={{
            width: 8,
            height: 8,
            borderRadius: 4,
            backgroundColor: tokens.color.accent.amber,
          }}
        />
      ) : null}
    </View>
  );
}
