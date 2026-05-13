/**
 * Dynamic OG share card for /case/{slug}.
 *
 * Renders a 1200×630 image at request time when a crawler / social-card
 * scraper fetches /case/{slug}/opengraph-image. Next.js wires the
 * resulting URL into the page's <meta property="og:image"> automatically
 * via the file-system convention.
 *
 * Design: matches the marketing landing's dark + amber posture. No
 * victim photo here — that interacts with feedback_photo_sourcing_policy
 * (mirror-vs-hot-link) and deserves a separate pass. Text-only card is
 * dignified, fast to render, and avoids the photo policy entirely on
 * the social-preview surface.
 *
 * Uses system fonts intentionally — next/font isn't available inside
 * ImageResponse, and shipping the full Newsreader/Inter family as
 * inlined buffers would balloon every OG render. The card's job is to
 * convey "Cold File · this case" at thumbnail size; system fonts are
 * sufficient for that signal.
 */

import { ImageResponse } from 'next/og';

import { getServerSupabase } from '@/lib/supabase-server';

export const runtime = 'nodejs';
export const contentType = 'image/png';
export const size = { width: 1200, height: 630 };
export const alt = 'A case on The Cold File';

interface OgCaseRow {
  slug: string;
  kind: 'homicide' | 'missing' | 'unidentified' | 'unclaimed' | 'suspicious_death';
  victim_name: string | null;
  incident_date: string | null;
  location_city: string | null;
  location_state: string | null;
}

const KIND_LABEL: Record<OgCaseRow['kind'], string> = {
  homicide: 'HOMICIDE',
  missing: 'MISSING',
  unidentified: 'UNIDENTIFIED PERSON',
  unclaimed: 'UNCLAIMED',
  suspicious_death: 'SUSPICIOUS DEATH',
};

async function fetchOgCase(slug: string): Promise<OgCaseRow | null> {
  const supabase = getServerSupabase();
  const { data } = await supabase
    .from('cases')
    .select(
      'slug, kind, victim_name, incident_date, location_city, location_state',
    )
    .eq('slug', slug)
    .is('deleted_at', null)
    .maybeSingle();
  return (data as unknown as OgCaseRow) ?? null;
}

export default async function CaseOgImage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const c = await fetchOgCase(slug);

  const name =
    c?.victim_name ??
    (c?.kind === 'unidentified' ? 'Unidentified Person' : 'A case on The Cold File');
  const year = c?.incident_date ? c.incident_date.slice(0, 4) : null;
  const place = c
    ? [c.location_city, c.location_state].filter(Boolean).join(', ')
    : null;
  const kindLabel = c ? KIND_LABEL[c.kind] : 'COLD CASE';

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          backgroundColor: '#0a0a0a',
          padding: 64,
          color: '#f5f1ea',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            color: '#c5a572',
            fontSize: 22,
            letterSpacing: '0.12em',
            fontWeight: 600,
          }}
        >
          <span>THE COLD FILE</span>
          <span>{kindLabel}</span>
        </div>

        <div
          style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
          }}
        >
          <div
            style={{
              fontSize: 84,
              lineHeight: 1.05,
              fontWeight: 500,
              marginBottom: 24,
              color: '#f5f1ea',
              maxWidth: 1000,
            }}
          >
            {name}
          </div>
          {(year || place) && (
            <div
              style={{
                fontSize: 30,
                letterSpacing: '0.04em',
                color: '#a09b95',
              }}
            >
              {[year, place].filter(Boolean).join(' · ')}
            </div>
          )}
        </div>

        <div
          style={{
            borderTop: '1px solid #2a2a2a',
            paddingTop: 24,
            display: 'flex',
            justifyContent: 'space-between',
            color: '#5a5550',
            fontSize: 18,
            letterSpacing: '0.08em',
          }}
        >
          <span>coldfile.app</span>
          <span>UNSOLVED</span>
        </div>
      </div>
    ),
    { ...size },
  );
}
