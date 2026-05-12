# P3 Tips prefill probe — findings

**Date**: 2026-05-12
**Status**: Phase 0 complete — prefill is viable, proceed to Phase 1
**Context**: External-advisor input proposed "deep-link straight into a pre-populated P3 tip." Probing established that P3 has a built-in feature (`Additional Form Values`) that captures arbitrary URL query params and surfaces them to the operator. This document records the probe so Phase 1 can build on it without re-derivation.

---

## TL;DR

- P3 (`p3tips.com`) has an **Additional Form Values** feature that captures
  arbitrary `?key=value` query-string params, displays them on the tip
  form for the user to see, and submits them as hidden inputs so the
  receiving operator gets them in the tip payload.
- This is a **platform feature, not affiliate-configured** — works
  uniformly across all active P3 affiliates probed. Inactive affiliate
  IDs return a stub "Inactive Account" page rather than a fake form.
- No partner-program integration or per-affiliate setup needed for v1.
- URL recipe:
  `https://www.p3tips.com/tipform.aspx?ID={affiliate_id}&case={agency_case_ref}&url={case_detail_url}`

---

## Methodology

- HTTP GET probes only. **Zero tips submitted.** No operator queue load.
- Polite UA: `Mozilla/5.0 (compatible; ColdFile-research/1.0; +https://github.com/JamesTroy/ColdFiles)`.
- Probe value `COLDFILE-PROBE-12345` used so the marker is unmistakable
  if it appears in a response.
- Probe artifacts (response HTML) saved to `/tmp/p3-probe/*.html` during
  the session; not committed.

## Affiliates probed

| ID  | Status   | AFV panel | Account name (when rendered) |
|-----|----------|-----------|------------------------------|
| 1   | Inactive | n/a       | "Inactive Account" stub      |
| 50  | Inactive | n/a       | stub                         |
| 100 | Active   | ✅        | account key 1                |
| 107 | Active   | ✅        | Pennsylvania State Police    |
| 150 | Inactive | n/a       | stub                         |
| 200 | Inactive | n/a       | stub                         |
| 250 | Active   | ✅        | (not extracted)              |
| 300 | Active   | ✅        | (not extracted)              |
| 500 | Active   | ✅        | (not extracted)              |

Inactive responses are ~31 KB; active are 128–167 KB. The AFV panel is a
reliable presence marker — when the affiliate is active, the panel
renders.

## Query-param param-name handling

| Input name      | Displayed label | Captured in hidden input |
|-----------------|-----------------|--------------------------|
| `case`          | `case`          | ✅                       |
| `caseNumber`    | `caseNumber`    | ✅ (camelCase preserved) |
| `case-ref`      | `caseref`       | ✅ (hyphen stripped from label, value preserved) |
| `external_ref`  | `external ref`  | ✅ (underscore → space in label) |
| `agency`, `victim`, `url`, `date`, `note` | identity | ✅ |
| `p1`, `p2`, `p3` (single letter + digit) | — | ❌ — silently rejected, likely anti-spam |

**Rule**: use **lowercase simple words** as param names. Avoid hyphens
(stripped from label), underscores (rendered as space — usually fine,
just be deliberate), and single-letter+digit forms (rejected). `case` is
the cleanest label for the agency case reference.

## Value handling

The query value lands in **two places** with different treatment:

| Surface                  | Treatment of special chars      |
|--------------------------|---------------------------------|
| On-screen display        | Non-alphanumeric **stripped** (e.g. `2003/12345#x` displays as `200312345x`). Spaces preserved. |
| Hidden input `fldvalMemoN` (the value the operator receives at submit) | **Preserved verbatim** — slashes, hashes, URLs, dashes all survive. |

So:
- The user sees a sanitized preview before submitting.
- The operator sees the full clean value after submitting.

Long values: no truncation observed at 200 chars in the displayed form.
URLs as values (e.g. `&url=https://thecoldfile.app/c/jane-doe-2003`) round-trip cleanly to the hidden input.

## Param count

Tested with 6 simultaneous meaningful-named params — all 6 captured into
`fldvalMemo1`..`fldvalMemo6`. No apparent ceiling. (6 is more than v1
will need; `case` + `url` will likely be all that ships.)

## Form structure context

Each captured param produces three artifacts in the response HTML:

```html
<!-- visible to the user submitting -->
<div><strong>case</strong>: ABC12345</div>

<!-- hidden, submits with the form -->
<input type=hidden id=fldlblMemo11 value="case" />
<input type=hidden id=fldvalMemo21 value="ABC-12345" />
```

The `fldlblMemoNN` / `fldvalMemoNN` pair is what the operator-side
intake sees. The visible-div is what the tipster sees before they hit
submit — useful for reassuring them "yes the case ID got through" but
**not** a substitute for the hidden value, which is the operational
payload.

---

## Implications for Phase 1

The original implementation plan (see chat log 2026-05-12) stands with
two minor tweaks:

1. **Template placeholder → query-param-name mapping is explicit.**
   Internal placeholders can stay descriptive (`{case_external_ref}`)
   but the rendered query-param name should be the **short clean form**
   (`case=`). A small mapping table inside the constructor handles this:
   ```ts
   const PLACEHOLDER_TO_QUERY_PARAM = {
     case_external_ref: 'case',
     case_detail_url:   'url',
   };
   ```

2. **Whitelist for v1** (per the operator-context-only rule in the
   `feedback_tip_route_externalize.md` memory):
   - `{case_external_ref}` → `case=<agency case number>`
   - `{case_detail_url}` → `url=<https://thecoldfile.app/c/{slug}>`
   - Not allowed: victim name, age, sex, anything that re-identifies a
     person beyond the case reference.

## Implications for Phase 0 follow-up

Still on the to-do list, but **not gated on prefill working** (it does):

- **One operator conversation** with an LA Crime Stoppers contact to
  confirm `case` is the param name they'd want, vs. some agency-specific
  term. Cheap; informs the v1 default before per-affiliate backfill.
- **LA Crime Stoppers P3 affiliate ID** — not yet known. Probably
  documented at `lacrimestoppers.org` or via a `/tipform.aspx?ID=` link
  on that site. Needs to be looked up before Phase 5 backfill against
  `data/agencies/los_angeles.json`.

## What this does NOT change

- The audit-only model. Tip content still goes to P3, never to The
  Cold File. (See `feedback_tip_route_externalize.md`.)
- The four-tier resolution chain. Prefill is a leaf-stage URL
  construction, not a routing change.
- The 30 + state clearinghouses in `state-routes.ts`. They're
  `agency_phone` or `agency_form`, mostly not `crime_stoppers_p3`, so
  the template feature applies only where the route resolves to a P3
  destination.
