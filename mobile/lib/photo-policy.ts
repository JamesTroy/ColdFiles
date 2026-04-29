/**
 * Per-source photo URL policy.
 *
 * Some sources (Charley Project, Doe Network) run on donation- or
 * volunteer-funded bandwidth. Hot-linking from our app burns their
 * bandwidth — even briefly, even pre-launch. The policy memory
 * (`feedback_photo_sourcing_policy.md`) says: mirror these sources to
 * Supabase Storage; never hot-link.
 *
 * Comments and memories get skipped under pre-launch crunch when
 * someone is moving fast through TODO_PHOTO_URL slots — five entries to
 * fill, four of them (FBI / LASD / NamUs / federal) hot-link cleanly,
 * and the Charley one looks the same shape from the seed file. Easy
 * miss. So this module turns the policy into code: `effectivePhotoUri`
 * returns null for any mirror-required source whose `mirror_url` isn't
 * populated, and the PhotoFrame falls through to its em-dash
 * placeholder. The hot-link literally cannot ship.
 */

import type { CaseMediaRow } from './types/database';

/**
 * Source-attribution labels that must NOT be hot-linked. Bandwidth here
 * comes from donations / volunteers; we mirror to our own storage and
 * serve from there. Match against `case_media.source_attribution`
 * (case-insensitive) — this is per-photo attribution, not the case's
 * primary agency.
 */
const MIRROR_REQUIRED_SOURCES: readonly string[] = [
  'charley project',
  'the charley project',
  'doe network',
  'the doe network',
];

function isMirrorRequired(sourceAttribution: string | null | undefined): boolean {
  if (!sourceAttribution) return false;
  return MIRROR_REQUIRED_SOURCES.includes(sourceAttribution.trim().toLowerCase());
}

/**
 * Resolve a media row to the URL the client should actually render.
 *
 * Rules:
 *   1. TODO_PHOTO_URL placeholder → null (em-dash placeholder renders).
 *   2. Mirror-required source (Charley, Doe) → return mirror_url ONLY.
 *      If mirror_url is null/empty, return null even when `url` is
 *      populated. This is the no-hot-link guarantee.
 *   3. Other sources → mirror_url ?? url (mirror wins when set, source
 *      URL is the canonical fallback).
 *
 * In dev, logs a console.warn when rule (2) trips so seed-pass mistakes
 * surface immediately. Production stays silent — em-dash is the
 * user-facing fallback.
 */
export function effectivePhotoUri(media: CaseMediaRow | null | undefined): string | null {
  if (!media) return null;

  const url = media.url?.trim() || null;
  const mirror = media.mirror_url?.trim() || null;

  // Placeholder seed slot — not yet filled in.
  if (url === 'TODO_PHOTO_URL' && !mirror) return null;

  if (isMirrorRequired(media.source_attribution)) {
    if (!mirror) {
      if (__DEV__) {
        // eslint-disable-next-line no-console
        console.warn(
          `[photo-policy] Refusing to hot-link from ${media.source_attribution}. ` +
            `Populate mirror_url before this URL ships. case_media.id=${media.id}`,
        );
      }
      return null;
    }
    return mirror;
  }

  return mirror ?? url;
}
