/**
 * Source chip — links out to the original case page on the source's site.
 *
 * Layout in the case detail screen sorts by trust_weight DESC + last_ingested_at DESC,
 * so the leftmost chip is always the most authoritative source. That's what makes
 * the aggregator framing legally defensible (skeptical user's first tap goes
 * to the agency's own page, not to a third-party aggregator).
 */

import { Pressable, View } from 'react-native';
import * as WebBrowser from 'expo-web-browser';

import { tokens } from '@/constants/theme';

import { MonoLabel } from './text';

interface SourceChipProps {
  /** Display text — e.g. "lasd.org", "charley_project". Render with the SOURCE / prefix. */
  slug: string;
  /** External URL to open on tap. */
  url: string;
}

export function SourceChip({ slug, url }: SourceChipProps) {
  return (
    <Pressable
      onPress={() => {
        // Source URLs come from scraper output (case_sources.source_url), so
        // gate the scheme to http(s) before handing to expo-web-browser. A
        // poisoned row with javascript:/data:/file: would otherwise reach the
        // system in-app browser and try to execute.
        if (!/^https?:\/\//i.test(url)) return;
        WebBrowser.openBrowserAsync(url).catch(() => {
          /* swallow — opening the browser shouldn't crash the app */
        });
      }}
      style={({ pressed }) => [
        {
          paddingVertical: 4,
          paddingHorizontal: 8,
          borderRadius: 4,
          borderWidth: 0.5,
          borderColor: tokens.color.evidence.chrome,
          backgroundColor: tokens.color.bg.base,
          marginRight: 6,
          marginBottom: 6,
          opacity: pressed ? 0.7 : 1,
        },
      ]}
    >
      <MonoLabel
        size={tokens.size.monoLabel}
        tracking={tokens.tracking.chip}
        color={tokens.color.text.secondary}
      >
        {`SOURCE / ${slug}`}
      </MonoLabel>
    </Pressable>
  );
}

export function SourceChipRow({ chips }: { chips: SourceChipProps[] }) {
  return (
    <View
      style={{
        flexDirection: 'row',
        flexWrap: 'wrap',
      }}
    >
      {chips.map((c) => (
        <SourceChip key={c.slug} {...c} />
      ))}
    </View>
  );
}
