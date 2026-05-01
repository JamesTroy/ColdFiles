// Source registry. Every active source must be re-exported here.
// The runner dispatches by slug, so this file is the single source of truth
// for "which sources are wired in."

import type { SourceConfig } from '../supabase/functions/_shared/types.ts';
import { charleyProject } from './charley.ts';
import { doeNetwork } from './doe_network.ts';
import { doeNetworkUid } from './doe_network_uid.ts';
import { fbiWanted } from './fbi_wanted.ts';
import { namusUp } from './namus.ts';

export const SOURCES: SourceConfig[] = [
  charleyProject,
  doeNetwork,
  doeNetworkUid,
  fbiWanted,
  namusUp,
  // Week 2: project_cold_case
  // Week 4: lapd_unsolved, lasd_homicide
];

export const SOURCE_BY_SLUG: Record<string, SourceConfig> = Object.fromEntries(
  SOURCES.map((s) => [s.slug, s]),
);

export function getSourceOrThrow(slug: string): SourceConfig {
  const s = SOURCE_BY_SLUG[slug];
  if (!s) {
    throw new Error(
      `Unknown source slug "${slug}". Known: ${Object.keys(SOURCE_BY_SLUG).join(', ')}`,
    );
  }
  return s;
}
