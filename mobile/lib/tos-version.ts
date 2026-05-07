/**
 * Single source of truth for the current Terms of Service version.
 *
 * Bumped whenever the in-app terms.tsx ships a material change — i.e.,
 * a change a reasonable user would care about (new arbitration clause,
 * altered liability cap, new indemnification scope, etc.). Editorial
 * cleanups, typo fixes, and clarifications that don't change rights
 * or obligations should NOT bump this; they don't deserve a banner.
 *
 * The matching value lives in `mobile/app/terms.tsx` as the
 * `lastUpdated` prop. Keep them in sync. A future refactor can pull
 * the date from this file directly so they can never drift.
 *
 * The banner in components/cf/terms-update-banner.tsx compares the
 * user's stored acked version to this constant. When they differ,
 * the banner fires once. When the user dismisses (or visits the
 * Terms screen), the new value lands in AsyncStorage and the banner
 * disappears.
 */
export const CURRENT_TOS_VERSION = '2026-05-08';

/**
 * One-line summary of the most recent material change. Surfaced in
 * the banner so a user understands the magnitude of the change
 * without having to open the full Terms.
 *
 * Keep this honest and specific — vague summaries like "we've
 * updated our Terms" are a known anti-pattern that erodes trust.
 */
export const LATEST_TOS_CHANGE_SUMMARY =
  'Updated dispute-resolution terms (arbitration, class-action waiver, 30-day opt-out window).';
