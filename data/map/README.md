# MAP (Murder Accountability Project) — data directory

This directory holds:

1. Reference instructions for re-downloading the raw MAP SHR (Supplementary
   Homicide Report) CSV from `murderdata.org`.
2. A small synthetic fixture (`montana_sample.csv`) that exercises the
   `homicide_aggregates` schema end-to-end without depending on a network
   download or on a license clarification with MAP.
3. A starter ORI → coordinate lookup for Montana
   (`agencies_ori_montana_sample.json`), used by the ingest script to
   resolve each SHR row's agency to an approximate centroid.

The actual licensed MAP SHR CSV is **not** checked in. Per
`docs/integrations/map-ingestion-plan.md` § 1, the redistribution posture
hasn't been clarified with Tom Hargrove yet — we hold off on committing
the upstream artifact until that's resolved. The fixture lets Phase 1
schema + RPC + ingest-script work proceed in parallel.

## Why Montana

`docs/integrations/map-ingestion-plan.md` § 5 (Phase 1) recommends MT
for the pilot:

- Small population → manageable row count (~hundreds-to-low-thousands of
  SHR rows for the full corpus 1976–present, not the ~150k of CA).
- Underrepresented in the existing ColdFiles `cases` corpus, so the
  MAP integration is visibly additive rather than duplicative.
- Rural / merged-agency tail is well represented, which gives an
  honest read on the ORI→centroid geocoder before scaling up.

## Downloading the upstream CSV

Source: `https://www.murderdata.org/p/data-docs.html` (probed
2026-05-11; last refresh on that page was 2026-03-22).

The page links to Dropbox-hosted files. Exact URLs may rotate when MAP
publishes a new release. Re-derive each time:

```sh
# 1. Fetch the data-docs page so you can read the current Dropbox URLs.
curl -L -o /tmp/map-data-docs.html https://www.murderdata.org/p/data-docs.html

# 2. Grep out the SHR CSV link. As of 2026-05-11 the inline anchor was
#    a Dropbox URL pointing at "SHR1976_2024.csv" (or similar). Inspect:
grep -i 'shr.*\.csv' /tmp/map-data-docs.html

# 3. Download the CSV. Replace <URL> with the link you found above.
#    Use `?dl=1` on Dropbox links to force a direct download instead
#    of the preview page.
curl -L -o data/map/shr_<source_release>.csv "<URL>"

# 4. Download the data dictionary PDF so column meanings are pinned to
#    the same release.
curl -L -o data/map/MAPdefinitionsSHR.pdf \
  "https://www.dropbox.com/s/lo6tgo8nnbpqeru/MAPdefinitionsSHR.pdf?dl=1"
```

`<source_release>` follows the convention from
`docs/integrations/map-ingestion-plan.md` § 3 — a date stamp matching
the page's "Last update" line, e.g. `2026_03_22`. Pass the same value
to the ingest script's `--source-release` flag.

## Sanity-checking the CSV before ingest

The plan documents 31 SHR variables (§ 1, "SHR columns"). The actual
header in any given release may differ — MAP renames columns between
releases occasionally. Before kicking off an ingest:

```sh
# Header inspection
head -1 data/map/shr_<source_release>.csv | tr ',' '\n' | nl

# Row count
wc -l data/map/shr_<source_release>.csv

# Per-state row count (column position depends on the header — adjust)
csvcut -c State data/map/shr_<source_release>.csv | sort | uniq -c | sort -rn
```

Update `scripts/ingest-map-shr.ts`'s `COLUMN_MAP` constant if the
header diverges from the names documented in the plan.

## The synthetic Montana fixture

`montana_sample.csv` is a hand-built fixture that mirrors the column
shape documented in the plan (§ 1). It contains 12 rows spanning four
Montana agencies across 1985–2022 — enough to exercise:

- Solved + unsolved rows (the `Solved` flag).
- FBI-reported + FOIA-obtained rows (the `Source` flag).
- Multi-victim incidents (same ORI/year/month/incident#, different
  victim ordinals).
- Several weapon / circumstance / relationship code values.
- One agency that's a city PD and one that's a county sheriff
  (different ORI → centroid mappings).

The values are **synthetic**, not real victims. SHR is already
anonymized upstream (no names, no addresses, month-and-year dates), so
there's no privacy risk from the synthetic data either way — but the
specific row contents do not correspond to actual incidents.

Use the fixture by running:

```sh
npm run ingest:map -- --state MT --source-release fixture_2026_05_11 \
  --csv data/map/montana_sample.csv \
  --ori-map data/map/agencies_ori_montana_sample.json \
  --database-url "$DATABASE_URL"
```

(See `scripts/ingest-map-shr.ts` for the full flag list and behavior.)

## The ORI → coordinate lookup

`agencies_ori_montana_sample.json` is a 4-agency starter for Montana.
Each entry contains:

```json
{
  "ori": "MT0560100",
  "agency_name": "Billings Police Department",
  "agency_type": "city_pd",
  "state": "MT",
  "city": "Billings",
  "county": "Yellowstone",
  "centroid_lat": 45.7833,
  "centroid_lng": -108.5007,
  "centroid_source": "city_hall"
}
```

For the full ingest, this file scales up to ~20k rows nationwide via
the FBI Crime Data Explorer's ORI directory + a Mapbox geocode pass
(see `docs/integrations/map-ingestion-plan.md` § 4e). That bulk lookup
is a separate effort and is **not** required for Phase 1 sample work.

## File index

- `README.md` — this file.
- `montana_sample.csv` — 12-row synthetic SHR fixture for MT.
- `agencies_ori_montana_sample.json` — 4-agency ORI → centroid lookup.
- `shr_*.csv` — gitignored. Real MAP CSV downloads land here after
  the licensing clarification with Tom Hargrove is resolved.
- `MAPdefinitionsSHR.pdf` — gitignored. The official data dictionary;
  download alongside each CSV release.
