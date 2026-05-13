/**
 * sitemap.xml for coldfile.app.
 *
 * Static URLs: marketing index + four legal pages + account/delete. The
 * /feature-graphic page is intentionally excluded (Play Store asset, not
 * a destination — disallowed in robots.ts as well).
 *
 * Dynamic URLs: one entry per non-deleted case at /case/{slug}. This is
 * the SEO surface that puts us in the running against Charley Project /
 * Doe Network on victim-name long-tail (project_landgrab_playbook_2026_05).
 * `lastModified` uses `cases.last_changed_at` — when we last detected a
 * change in any source — because that's the freshness signal Google
 * cares about for re-crawl prioritization (per feedback_ingest_metric_axis).
 *
 * Order: most-recently-changed first. Google reads top-down on large
 * sitemaps; fresh cases get re-discovered faster.
 *
 * Cap: 50,000 URLs is the per-sitemap hard limit for sitemap.xml. When
 * the public case count crosses ~40k, switch to generateSitemaps() and
 * paginate. We won't hit that this year given current ingest velocity
 * (per feedback_ingest_metric_axis on steady-state delta), so the simple
 * single-file shape is correct now.
 *
 * Revalidation: 1h. Tighter would re-query the DB on every Google fetch
 * with little benefit; the limit on Google's re-fetch cadence dominates.
 */

import type { MetadataRoute } from 'next';

import { getServerSupabase } from '@/lib/supabase-server';

const SITE_URL = 'https://coldfile.app';
const LAST_UPDATED = '2026-04-29';
const SITEMAP_HARD_LIMIT = 50_000;

export const revalidate = 3600;

interface CaseSitemapRow {
  slug: string;
  kind: 'homicide' | 'missing' | 'unidentified' | 'unclaimed' | 'suspicious_death';
  last_changed_at: string;
}

async function fetchCaseSitemapRows(): Promise<CaseSitemapRow[]> {
  try {
    const supabase = getServerSupabase();
    const { data, error } = await supabase
      .from('cases')
      .select('slug, kind, last_changed_at')
      .is('deleted_at', null)
      .order('last_changed_at', { ascending: false })
      .limit(SITEMAP_HARD_LIMIT);

    if (error) {
      // A transient DB error must not blank the sitemap — return empty
      // so the static routes still serve. Log loudly; Vercel function
      // logs are where this surfaces.
      console.error('sitemap: cases query failed', { message: error.message });
      return [];
    }
    return (data as CaseSitemapRow[]) ?? [];
  } catch (err) {
    // Two failure modes land here:
    //   1. Build-time prerender — NEXT_PUBLIC_SUPABASE_URL/_ANON_KEY
    //      not present in the build sandbox; getServerSupabase() throws.
    //      The ISR re-render at request time has the vars and produces
    //      a full sitemap on the next revalidation, so degrading to
    //      static-only on the build pass is the correct posture (do
    //      NOT break the build over a missing-preview-env condition).
    //   2. Unexpected runtime throw inside the Supabase client
    //      constructor or fetch path. Same posture: log, degrade.
    console.error('sitemap: cases fetch threw', {
      message: err instanceof Error ? err.message : String(err),
    });
    return [];
  }
}

const STATIC_ROUTES: MetadataRoute.Sitemap = [
  {
    url: `${SITE_URL}/`,
    lastModified: LAST_UPDATED,
    changeFrequency: 'monthly',
    priority: 1.0,
  },
  {
    url: `${SITE_URL}/legal/privacy`,
    lastModified: LAST_UPDATED,
    changeFrequency: 'yearly',
    priority: 0.5,
  },
  {
    url: `${SITE_URL}/legal/terms`,
    lastModified: LAST_UPDATED,
    changeFrequency: 'yearly',
    priority: 0.5,
  },
  {
    url: `${SITE_URL}/legal/takedown`,
    lastModified: LAST_UPDATED,
    changeFrequency: 'yearly',
    priority: 0.5,
  },
  {
    url: `${SITE_URL}/account/delete`,
    lastModified: LAST_UPDATED,
    changeFrequency: 'yearly',
    priority: 0.4,
  },
];

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const cases = await fetchCaseSitemapRows();

  const caseRoutes: MetadataRoute.Sitemap = cases.map((c) => ({
    url: `${SITE_URL}/case/${c.slug}`,
    lastModified: new Date(c.last_changed_at),
    // Unidentified cases change less often than homicides/missings.
    changeFrequency: c.kind === 'unidentified' ? 'monthly' : 'weekly',
    // Slight priority bump for homicide; everything else 0.7.
    priority: c.kind === 'homicide' ? 0.8 : 0.7,
  }));

  return [...STATIC_ROUTES, ...caseRoutes];
}
