# DNA Funding Probe (Phase 0)

Operator-side probe stub for the per-case DNA funding handoff (mig 48). The migration adds the schema; this doc carries the URL-format reconnaissance + the initial population plan.

Run before populating `cases.dna_funding_url` in production. Re-run whenever Othram or Season of Justice change their site structure, the same way `docs/research/p3-prefill-probe.md` is re-run when P3 changes theirs.

---

## Probe goals

1. Confirm Othram DNA Solves has stable, public per-case URLs we can deep-link to.
2. Confirm Season of Justice has the same (or org-level fallback only — which means SoJ entries get `dna_funding_kind = 'other'` until they expose per-case pages).
3. Cross-reference the live Cold File LA-county case set against active fundraisers to size the initial backfill.
4. Document the URL format so operator-side population doesn't rely on tribal knowledge.

---

## Probe checklist

For each platform:

- [ ] Land on the platform's case index. Confirm it's public (no auth wall).
- [ ] Inspect 5 case URLs. Identify the format (slug-based, ID-based, mixed).
- [ ] Check whether closed/funded cases stay live or 404. (404 is fine; we just need to know whether to nullify the column when a fundraiser ends.)
- [ ] Confirm the destination page works on mobile webview without forced login.
- [ ] Note any rate-limiting or anti-scrape signals — we won't scrape, but ops-side curl during population shouldn't trip a WAF.

Once the format is documented, run a name-match pass: for each LA-county case in `cases`, search the platform for the victim name + year. Cases with a hit get a candidate URL noted; the operator confirms before pasting into `dna_funding_url`.

---

## Initial backfill plan (LA county)

- Active LA-county cases in v1: ~120 (Charley + Doe + Project: Cold Case + Doe UID, filtered to `location_state = 'CA'` + LA-radius bbox).
- Expected hit rate is low — fundraisers exist for a small fraction of cold cases. Rough estimate: 5–15 cases.
- Budget: ~20 minutes of probe per platform, then the name-match pass should be under an hour for both platforms.

---

## What we will NOT do

- **Scrape the platforms to auto-populate.** Population is manual + operator-confirmed. The platforms are awareness-grateful but not friendly to bulk-extraction, and a mistaken auto-fill would route a donor to the wrong case's lab work — much worse failure mode than an empty CTA.
- **Backfill via fuzzy name match alone.** A name match is a candidate, not a confirmation. The operator opens the candidate URL, confirms victim name + incident year + location match before pasting.
- **Cross-link cases that share a platform fundraiser.** Some platform pages cover regional clusters ("Unidentified women from the I-5 corridor"). For v1 we only populate per-individual-case URLs; cluster URLs are deferred until the pattern/serial view (Phase 3 of the roadmap) lands.

---

## Refresh cadence

Annual at minimum; sooner if a platform announces a site redesign. The CHECK constraint on `dna_funding_kind` will cause an insert to fail if a new platform shows up before its kind is added — that's the safety net for "the operator started populating a new platform without updating the schema."
