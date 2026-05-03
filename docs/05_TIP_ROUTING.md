# The Cold File — Tip Routing (Operational)

Per-agency tip-routing data and verification log. The design layer (`docs/04_DESIGN_SYSTEM.md`) assumes a clean route per case; this doc carries the messy real-world data that makes that assumption work.

**Source of truth is the `agencies` table.** This doc narrates the research; data lives in `data/agencies/{metro}.json` and is loaded via `npm run load:agencies`.

---

## Status

| Phase | Status | Calendar |
|-------|--------|----------|
| Day 1 — Structure | **Complete** | Schema field + LA-county seed file + loader script shipped |
| Day 2 — Research | **In progress** | Verify P3 portals; find non-P3 agency tip pages |
| Day 3 — Callbacks | **Blocked on day 2** | Submit one test tip per route; log replies |

The order matters: tip routing has external dependencies (PIO callbacks, P3 affiliate sites that change), so it's the long pole. Data quality work is internal and fits in the dead time between day-2 / day-3 callbacks.

---

## Schema

`agencies.routing_last_verified_at` is a nullable `timestamptz`.

| Value | Meaning |
|-------|---------|
| `null` | Never verified. The route in `tip_url` / `phone_tip` / `tip_route_kind` is a working assumption, not a confirmed live route. |
| Set to a date | Last successful verification. The weekly CI check (see "Long-term" below) updates this on a successful HEAD probe of `tip_url`. Phone-only routes get a manual update on the day a test tip was confirmed received. |

A partial index on this column makes "what's gone stale?" queries cheap:

```sql
create index agencies_routing_stale_idx on agencies(routing_last_verified_at)
  where active = true and tip_url is not null;
```

---

## Resolution order (per case)

The design assumes a clean recommended-route per case. The data model honors a four-tier fallback. The route the modal recommends is the first non-null value walking down this chain:

1. **`cases.tip_route_kind` + `cases.tip_url` + `cases.tip_phone`** — case-specific override. An FBI field office takes the lead on a case the local agency would otherwise own; the case row carries the override and the case-level route wins.
2. **`cases.primary_agency.tip_route_kind` + `agencies.tip_url` + `agencies.phone_tip`** — agency default. Most cases land here.
3. **A jurisdiction-appropriate fallback.** For US cases with no agency-level route, fall back to the agency's general phone if present; otherwise to the FBI tip line for federal-jurisdiction cases.
4. **Last resort: `tips.fbi.gov`** with `tip_route_kind = 'fbi_tip'`. Always live, always relevant for serious cold cases, never the ideal first choice.

The submit-tip modal's `RECOMMENDED` badge attaches to whichever route resolves at the highest priority. The other tiers still appear as alternatives — different jurisdictions and specific-detective relationships matter.

---

## LA County (v1 launch metro)

Source: `data/agencies/los_angeles.json`. Verified fields land in this table as days 2 and 3 progress. Working assumptions documented in the `notes` column of the JSON; not duplicated here.

| Slug | Agency | tip_route_kind | tip_url / phone_tip | Verified |
|------|--------|----------------|---------------------|----------|
| `lasd` | Los Angeles County Sheriff's Department | _tbd_ | _tbd_ | — |
| `lapd` | Los Angeles Police Department | _tbd_ | _tbd_ | — |
| `longbeach-pd` | Long Beach Police Department | _tbd_ | _tbd_ | — |
| `santa-monica-pd` | Santa Monica Police Department | _tbd_ | _tbd_ | — |
| `pasadena-pd` | Pasadena Police Department | _tbd_ | _tbd_ | — |
| `beverly-hills-pd` | Beverly Hills Police Department | _tbd_ | _tbd_ | — |
| `la-da-bi` | LA County DA Bureau of Investigation | _tbd_ | _tbd_ | — |
| `fbi-la` | FBI Los Angeles Field Office | `fbi_tip` | `https://tips.fbi.gov` | _tbd_ |

### LA County design implications surfaced by the seed pass

The architecture doc assumed a two-tier model (agency → P3). LA County alone is closer to four-tier:

1. **Most agencies → LA Crime Stoppers (P3)** — LASD, LAPD probably resolve here. ~80% of LA-county cold cases.
2. **Agency-specific Crime Stoppers affiliate** — Long Beach PD goes through Long Beach Crime Stoppers, not LA Crime Stoppers. The P3 affiliate is per-jurisdiction, not per-county.
3. **Agency-direct only (no P3)** — Santa Monica, Beverly Hills, possibly Pasadena depending on day-2 findings. Tip routes through `agency_form` (web) or `agency_phone`.
4. **DA Bureau of Investigation** — separate intake from the original investigating agency, applies to a small subset of LASD-investigated cases the DA's office prioritized.

The design doc's CTA-copy chain (`Send to {short_name}` → leading-acronym fallback → `the agency`) handles this correctly because the receiver name comes from `case.primary_agency.short_name ?? .name`. No design change required — the data carries the complexity.

---

## Day 2 — Research checklist

For each agency in `los_angeles.json`, do the following and update the JSON:

1. **Find the live tip page.** Visit the agency's website. Some agencies have a dedicated cold-case form distinct from their general tip line — the cold-case form is the right route. Note the URL.
2. **Check the P3 affiliate coverage.** P3 affiliates (LA Crime Stoppers, OC Crime Stoppers, Long Beach Crime Stoppers, etc.) publish coverage maps. Some include unincorporated territory; some don't. Verify the affiliate covers the agency's actual jurisdiction.
3. **Pick `tip_route_kind`** from the enum:
   - `crime_stoppers_p3` — the agency uses a Crime Stoppers P3 affiliate as the public anonymous tip pipeline. `tip_url` is the P3 portal.
   - `agency_form` — the agency's own web form. `tip_url` is that page.
   - `agency_phone` — phone-only intake. `phone_tip` is the line; `tip_url` is null.
   - `fbi_tip` — federal cases.
   - `email` — last-resort, manual review intake.
4. **Update the JSON.** Set `tip_route_kind`, `tip_url`, `phone_tip`. Leave `routing_last_verified_at` null until day 3 confirms a live receipt.

Re-run `npm run load:agencies` after each edit to push to the dev DB.

### Day 2 research notes

_(Populate as research lands. Format per agency: agency slug, finding, URL, source.)_

---

## Day 3 — Callback log

For each populated route, submit one test tip identifying yourself as the developer of an aggregator that will route public cold-case tips. Most agency PIO offices are happy to confirm receipt and explain their internal routing.

When a route is confirmed, set `routing_last_verified_at` to the date of the confirmation. The agencies that don't respond go in the log with `routing_last_verified_at` left null and a `notes` annotation: _"live route, no confirmation feedback loop, monitor for issues."_

### Day 3 callback log

_(One row per attempt. Format: date · agency · route · contact · result.)_

---

## Long-term: weekly verification CI

A weekly Edge Function should run against the agencies table:

- For each `agencies` row with non-null `tip_url` and `active = true`:
  - HEAD-probe the URL with the polite UA + 30s timeout
  - On 2xx: update `routing_last_verified_at` to `now()`
  - On 4xx / 5xx: leave the field stale, append a row to a `routing_drift_log` table (TBD), and alert
- Phone-only routes get no automated check. Annual manual re-verification.
- Dashboard: `select * from agencies where routing_last_verified_at < now() - interval '30 days' and tip_url is not null;`

Not built yet. Track as a Week 6+ deliverable, post-launch.

---

## Adding a new metro

1. Create `data/agencies/{metro_slug}.json` matching the LA file's shape.
2. Populate with day-1 honest nulls (identity only, route fields null).
3. Run `npm run load:agencies`.
4. Walk the agency list through day-2 / day-3 the same way — research, then verify.
5. Append a per-metro section to this doc with the verified-table once day 3 lands.

The schema is locked; this is just data.
