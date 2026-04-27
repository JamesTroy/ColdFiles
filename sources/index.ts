// Source registry. Every active source must be re-exported here.
// The runner dispatches by slug, so this file is the single source of truth
// for "which sources are wired in."

import type { SourceConfig } from '../supabase/functions/_shared/types.ts';
import { charleyProject } from './charley.ts';

export const SOURCES: SourceConfig[] = [
  charleyProject,
  // Week 2: doe_network, project_cold_case
  // Week 3: namus
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
