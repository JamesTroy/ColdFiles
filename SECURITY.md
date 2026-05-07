# Security policy

## Reporting a vulnerability

If you've found a security vulnerability in The Cold Files, please report
it privately rather than opening a public issue.

The fastest path is GitHub's private vulnerability reporting:

- Go to https://github.com/JamesTroy/ColdFiles/security/advisories/new
- Describe what you found, the impact, and reproduction steps if you have
  them. Don't worry about formatting — clarity over polish.
- We aim to acknowledge within 72 hours and provide a status update
  within 7 days.

If you prefer email, send to **arcaneonline1@gmail.com** with
"Cold Files security" in the subject line.

## What's in scope

- The mobile app code under `mobile/`
- The Supabase Edge Functions and shared library code under
  `supabase/functions/`
- The scraper config under `sources/`
- The migrations under `migrations/`
- The deployed app at https://cold-files.vercel.app

## What's not in scope

- Third-party dependencies (please report those upstream — we'll pull in
  fixes via Dependabot)
- Issues that require physical access to a user's unlocked device
- Theoretical attacks without a demonstrated impact path

## What gets a fast response

- Anything that exposes data the case-takedown predicate is supposed to
  protect (soft-deleted cases, `takedown_requested_at` rows leaking
  through public read paths)
- Authentication / RLS bypasses against the Supabase backend
- Tip-routing manipulation (sending tip submissions to the wrong agency)
- Push-notification spoofing or fan-out abuse
- Any path where a third party can read or modify another user's saved
  cases, watch zones, or submitted tips

## Coordinated disclosure

We follow standard coordinated-disclosure practice. We'll work with you
on a public-disclosure timeline once a fix is staged. If you want
attribution in the release notes, let us know in your report.

## Out-of-scope but still useful to flag

- Typos / dead links / broken images: open a regular GitHub issue
- General code-quality or test-coverage concerns: open a regular issue
  or a pull request

Thanks for helping keep the project safe for the families who use it.
