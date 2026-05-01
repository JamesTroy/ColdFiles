# 11 — Legal-copy policy + canonical source list

The institutional-memory note that prevents the next round of source-list
drift. Read this before editing any legal copy or any in-app text that
names sources.

## The rule

> Source lists in user-facing copy describe **currently-active**
> sources — not dormant ones, not ones we plan to add. When the active
> source list changes (a new source goes live, an existing source is
> retired or goes dormant), update **all surfaces in the same commit**.

The four user-facing surfaces that name sources:

1. **Web Privacy Policy** — `app/legal/privacy/page.tsx`
2. **Web Terms of Service** — `app/legal/terms/page.tsx`
3. **Web Takedown** — `app/legal/takedown/page.tsx`
4. **In-app About** — `mobile/app/about.tsx`
5. **In-app Terms** — `mobile/app/terms.tsx`
6. **In-app Takedown** — `mobile/app/takedown.tsx`

Plus the listing-copy doc that tracks what gets pasted into Play Console:

7. **`docs/08_PLAY_STORE_LISTING.md`** — short description, long description,
   "What's new" copy, reviewer note. The Console fields paste *from* this
   doc, so updating the doc and the live Console listing happen
   sequentially, not in parallel.

## Canonical source list as of v1.0.0 (2026-05-01)

The active production sources at first ship are:

- **The Charley Project** — long-running volunteer archive of cold
  missing-persons cases.
- **The Doe Network** — international volunteer organization for
  unidentified-persons cases (UM = Unidentified Male, UF = Unidentified
  Female, etc.).
- **FBI Wanted** — the FBI's public Wanted bulletin (api.fbi.gov).
- **Los Angeles County Sheriff's Department homicide bureau** — agency-
  direct ingestion for the launch metro.

That's the four-source list that should appear in any current-state
listing copy. Order of mention is recognition-tiered: FBI is the most
recognizable name to a general audience, Charley/Doe signal community
depth to anyone who's done cold-case work, LASD gives the LA County
launch-metro proof point.

## Dormant sources (do NOT name in user-facing copy)

- **NamUs** — see [`sources/namus.ts`](../sources/namus.ts) and
  [`memory/project_namus_dormancy.md`](https://...). Three wake-up paths
  documented in the source file. **Do not reference NamUs in the
  privacy policy, terms, takedown form, About page, listing copy, or
  any marketing surface until at least one of those wake-up paths has
  closed and ingestion is live in production.** When NamUs wakes up,
  the v1.x release notes ("What's new" field) is the natural place to
  surface it — that's the moment that earns attention rather than
  spends it.
- **Project: Cold Case** — a former candidate source. Investigation
  showed it requires Playwright-class scraping (SPA + custom AJAX
  endpoints); deferred to v1.1 per
  [`memory/project_cold_case_deferred.md`](https://...). Same rule:
  not named in user-facing copy until live.

## Forward-permissive phrasing pattern

The user-facing copy now follows a category-first / list-second shape
so adding a new source is **disclosure**, not a policy amendment:

> "Cases come from publicly available federal, state, and local public
> records, including (currently) FBI Wanted, The Charley Project, The
> Doe Network, and the Los Angeles County Sheriff's Department
> homicide bureau. The current source list may expand or change over
> time as we add new public-records integrations or retire ones that
> are no longer maintained."

This template lets us:

- Commit to the **category** of source (federal/state/local public
  records) — the durable claim.
- Disclose the **current specific list** — the volatile claim.
- Pre-acknowledge that the volatile list will change — so adding a
  source later is honoring an existing commitment, not breaching one.

Use this exact category-first structure in the privacy policy. Terms,
takedown, and about can compress to "the current source list is
documented in our Privacy Policy" + reference rather than re-listing.
The privacy policy is the **single source of truth** for source
disclosure across all surfaces.

## Workflow when the source list changes

1. Update `docs/11_LEGAL_COPY_POLICY.md` (this file) — change the
   "Canonical source list as of v1.0.0" section.
2. Update `app/legal/privacy/page.tsx` — both the source-list section
   and the `lastUpdated` field.
3. Update `app/legal/terms/page.tsx` and `app/legal/takedown/page.tsx`
   — bump their `lastUpdated` even if the body text doesn't change
   (they reference the privacy policy for the live list).
4. Update `mobile/app/about.tsx`, `mobile/app/terms.tsx`,
   `mobile/app/takedown.tsx` — match the privacy policy phrasing.
5. Update `docs/08_PLAY_STORE_LISTING.md` — both the short and long
   descriptions, the "What's new" field, and the reviewer note.
6. Update the Play Console listing fields (paste from the doc).
7. Update the Data Safety form to reflect the new sources.
8. Single commit for steps 1-5 with a message describing the source
   change. Steps 6-7 happen in the Console.

## Why this matters

Play Store reviewers fetch the privacy-policy URL during review and
cross-check it against the listing's data declarations and the Data
Safety form. A source named in one surface but missing from another
is the exact mismatch that gets flagged in their standard checklist.
A reviewer rejection costs a day; this audit and the workflow above
cost twenty minutes.

The same rule applies post-launch: adding a state-level scraper in
v1.0.2 without updating the privacy policy is the same shape of
mistake as naming a dormant source in v1.0.0 — the privacy policy
must always describe the live data flows.
