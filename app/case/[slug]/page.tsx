/**
 * Per-case share landing — coldfile.app/case/{slug}
 *
 * Server-rendered. The mobile app builds share URLs of this shape (see
 * mobile/app/case/[slug].tsx handleShare); before this page existed every
 * share 404'd. Today the page exists primarily as a share-landing + SEO
 * surface; it is intentionally NOT a full case viewer.
 *
 * Read posture mirrors the mobile case-detail screen (use-case-detail.ts):
 * the case row plus a small primary_agency join, gated by RLS. The page
 * shows enough to confirm "this is the right case" + a clear path to the
 * app. The full investigation belongs in-app.
 *
 * Photo handling: deliberately omitted in V1. The mobile app's
 * effectivePhotoUri encodes the mirror-vs-hot-link policy per
 * feedback_photo_sourcing_policy; replicating that on the web tier needs
 * its own pass. Until then, text-only landing keeps us strictly inside
 * the documented posture.
 *
 * Per the project rules: no comments / forum / community surface here.
 * Read-only landing + app deep-link CTA.
 */

import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { getServerSupabase } from '@/lib/supabase-server';

const SITE_URL = 'https://coldfile.app';
const PLAY_STORE_URL =
  'https://play.google.com/store/apps/details?id=com.matteblackdev.coldfile';

interface CaseShareRow {
  slug: string;
  kind: 'homicide' | 'missing' | 'unidentified' | 'unclaimed' | 'suspicious_death';
  victim_name: string | null;
  incident_date: string | null;
  location_city: string | null;
  location_state: string | null;
  narrative_short: string | null;
  case_number_primary: string | null;
  primary_agency: { name: string | null } | null;
}

const KIND_LABEL: Record<CaseShareRow['kind'], string> = {
  homicide: 'Homicide',
  missing: 'Missing',
  unidentified: 'Unidentified Person',
  unclaimed: 'Unclaimed',
  suspicious_death: 'Suspicious Death',
};

async function fetchCase(slug: string): Promise<CaseShareRow | null> {
  const supabase = getServerSupabase();
  const { data, error } = await supabase
    .from('cases')
    .select(
      'slug, kind, victim_name, incident_date, location_city, location_state, narrative_short, case_number_primary, primary_agency:agencies!cases_primary_agency_id_fkey ( name )',
    )
    .eq('slug', slug)
    .is('deleted_at', null)
    .maybeSingle();

  if (error) {
    console.error('case-share-landing: case fetch failed', {
      slug,
      message: error.message,
    });
    return null;
  }
  return (data as unknown as CaseShareRow) ?? null;
}

function displayName(c: CaseShareRow): string {
  if (c.victim_name) return c.victim_name;
  if (c.kind === 'unidentified') return 'Unidentified Person';
  return 'Unnamed case';
}

function formatPlace(c: CaseShareRow): string | null {
  const parts = [c.location_city, c.location_state].filter(Boolean);
  return parts.length > 0 ? parts.join(', ') : null;
}

function formatYear(c: CaseShareRow): string | null {
  if (!c.incident_date) return null;
  return c.incident_date.slice(0, 4);
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const c = await fetchCase(slug);
  if (!c) {
    return {
      title: 'Case not found',
      robots: { index: false, follow: false },
    };
  }

  const name = displayName(c);
  const place = formatPlace(c);
  const year = formatYear(c);
  const kindLabel = KIND_LABEL[c.kind];

  // Title shape mirrors the share-text the mobile app emits:
  //   "{Name} — unsolved · {Year} · {Place}"
  // Browsers truncate at ~60 chars; the leading "Name" wins on truncation.
  const titleParts = [name];
  const sub = [year, place].filter(Boolean).join(' · ');
  if (sub) titleParts.push(sub);
  const title = titleParts.join(' — ');

  const description =
    c.narrative_short ??
    `${kindLabel}${place ? ` in ${place}` : ''}${
      year ? `, ${year}` : ''
    }. Read the case on The Cold File.`;

  return {
    title,
    description,
    alternates: { canonical: `/case/${slug}` },
    openGraph: {
      title,
      description,
      url: `/case/${slug}`,
      type: 'article',
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
    },
  };
}

export default async function CaseSharePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const c = await fetchCase(slug);
  if (!c) notFound();

  const name = displayName(c);
  const place = formatPlace(c);
  const year = formatYear(c);
  const kindLabel = KIND_LABEL[c.kind];
  const deepLink = `coldfile://case/${slug}`;
  const agencyName = c.primary_agency?.name ?? null;

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <main className="container" style={{ flex: 1 }}>
        <p className="mono-cap" style={{ marginBottom: 12 }}>
          THE COLD FILE · {kindLabel.toUpperCase()}
        </p>

        <h1
          className="serif"
          style={{
            fontSize: 'clamp(28px, 6vw, 44px)',
            lineHeight: 1.15,
            margin: '0 0 12px 0',
            color: 'var(--text-primary)',
          }}
        >
          {name}
        </h1>

        {(year || place) && (
          <p
            className="mono"
            style={{
              fontSize: 13,
              letterSpacing: '0.04em',
              color: 'var(--text-secondary)',
              margin: '0 0 28px 0',
            }}
          >
            {[year, place].filter(Boolean).join(' · ')}
          </p>
        )}

        {c.narrative_short && (
          <p
            style={{
              fontSize: 17,
              lineHeight: 1.65,
              color: 'var(--body-reading)',
              margin: '0 0 32px 0',
              maxWidth: 640,
            }}
          >
            {c.narrative_short}
          </p>
        )}

        {/* App-handoff block. The deep link routes installed users into the
            in-app case detail; users without the app fall through to Play
            Store. The text CTA below the link is the honest fallback —
            iOS users go to a not-yet-listed App Store entry; explicit
            "Android only" reads as transparent rather than broken. */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 12,
            marginBottom: 32,
          }}
        >
          <a
            href={deepLink}
            style={{
              display: 'inline-block',
              padding: '14px 24px',
              backgroundColor: 'var(--accent-amber)',
              color: 'var(--bg-base)',
              textDecoration: 'none',
              borderRadius: 8,
              fontWeight: 600,
              alignSelf: 'flex-start',
              minHeight: 44,
              lineHeight: 1.2,
            }}
          >
            Open in The Cold File app
          </a>
          <Link
            href={PLAY_STORE_URL}
            style={{
              color: 'var(--text-secondary)',
              fontSize: 14,
              alignSelf: 'flex-start',
            }}
          >
            Don&apos;t have the app yet? Get it on Google Play (Android · iOS coming soon).
          </Link>
        </div>

        {/* Trust posture — repeats the marketing-page promise in case this
            is the user's first contact with the brand via a shared link. */}
        <div
          style={{
            borderTop: '0.5px solid var(--border-subtle)',
            paddingTop: 24,
            color: 'var(--text-secondary)',
            fontSize: 14,
            lineHeight: 1.6,
            maxWidth: 640,
          }}
        >
          <p style={{ margin: '0 0 12px 0' }}>
            Cold File is a read-only directory. Tips you submit go directly
            to {agencyName ?? 'the investigating agency'} — never held or
            seen by us.
          </p>
          {c.case_number_primary && (
            <p className="mono" style={{ fontSize: 12, color: 'var(--evidence-chrome)', margin: 0 }}>
              CASE # {c.case_number_primary}
            </p>
          )}
        </div>
      </main>

      <footer
        style={{
          padding: '24px',
          borderTop: '0.5px solid var(--border-subtle)',
          textAlign: 'center',
        }}
      >
        <p className="mono-cap" style={{ margin: 0 }}>
          <Link
            href="/"
            style={{ color: 'var(--text-secondary)', marginRight: 12 }}
          >
            THE COLD FILE
          </Link>
          <Link
            href="/legal/takedown"
            style={{ color: 'var(--text-secondary)' }}
          >
            REPORT AN ISSUE WITH THIS CASE
          </Link>
        </p>
      </footer>
    </div>
  );
}
