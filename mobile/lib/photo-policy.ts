/**
 * Photo URL resolution.
 *
 * The "no hot-link" guarantee for Charley Project / Doe Network is structurally
 * enforced upstream — the scraper (supabase/functions/_shared/media.ts) downloads
 * photo bytes to Supabase Storage BEFORE inserting the case_media row, and writes
 * the Storage public URL into `url`. Every persisted case_media row therefore
 * already points at our Storage, regardless of source. There is no separate
 * `mirror_url` column.
 *
 * This module preserves one client-side concern: TODO_PHOTO_URL placeholder
 * scaffolding (designer-mode sample data) still needs to render as the em-dash
 * placeholder, never as a broken image.
 *
 * See feedback_photo_sourcing_policy.md in project memory.
 */

import type { CaseMediaRow } from './types/database';

/**
 * Resolve a media row to the URL the client should render. Returns null for
 * unfilled placeholder rows so the PhotoFrame falls through to its em-dash
 * placeholder.
 */
export function effectivePhotoUri(media: CaseMediaRow | null | undefined): string | null {
  if (!media) return null;
  const url = media.url?.trim() || null;
  if (!url || url === 'TODO_PHOTO_URL') return null;
  return url;
}
