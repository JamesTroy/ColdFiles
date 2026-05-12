# The Cold File — DNA Funding Routing

Per-case "Fund DNA work on this case" handoff. Externalizes forensic-genetic-genealogy donations to Othram DNA Solves and Season of Justice the same way tip routing externalizes to P3 Tips.

**Cold File does not process payments, hold case-tied funds, or collect any donor data.** The CTA logs the click + destination on our side, then deep-links the user out. Everything after that — donor identity, amount, card data, family communication, lab logistics — belongs to the external platform.

See migration 48 for the schema, `feedback_dna_funding_externalize` in the auto-memory for the posture rationale, and `feedback_tip_route_externalize` for the parallel pattern this mirrors.

---

## Posture

| Principle | Why |
|-----------|-----|
| **External-only.** No in-app payment processing, no held funds, no per-case donation tallies on our side. | Forensic-genetic-genealogy has solved 1,300+ cold cases since 2018; the labs and 501c3s already have the donor relationships, the receipt compliance, and the family-coordination infrastructure. Owning the money flow on our side adds payment-processor surface area + risk of looking like we're monetizing victims. Cold File's value-add is *targeting the donation at the case the user just read about* — the moment of intent, not the transaction. |
| **Per-case URL only — no org-level fallback.** | The whole donation hook is "this specific case." Routing to a generic "donate to cold cases" landing page wastes the intent. When a case has no per-case URL, the CTA is hidden — the user falls back to the tip CTA, which is universal. |
| **Audit-only logging.** Server-side log of (case_id, ts, ip_hash). No donor identity, amount, payment method. | Same posture as `tip_routings` (mig 04). The Edge Function uses service-role to write; anon has no direct path to `dna_funding_handoffs`. |
| **Rate-limited per ip_hash.** 5/min, 30/hour. | Mirrors `tip-route-submit` so the abuse surface is identical-shaped. |
| **Fail-open on the deep link.** If the Edge Function fails (rate-limited, network), the client falls back to the URL it already has on the case row. | Missing audit rows are recoverable. A broken donor click is not. |

---

## Routing chain

There isn't one. Unlike tip routing (Tier 1/2/2.5/3), DNA funding either has a per-case URL or it doesn't. That's deliberate — see the "Per-case URL only" row above.

```
cases.dna_funding_url + cases.dna_funding_kind
   ├─ both set    → CTA visible, dna-funding-route Edge Function
   └─ either null → CTA hidden
```

---

## Schema (migration 48)

| Column | Type | Purpose |
|--------|------|---------|
| `cases.dna_funding_url` | `text` nullable | Destination URL — Othram DNA Solves crowdfunding page, Season of Justice case page, etc. Per-case only. |
| `cases.dna_funding_kind` | `text` CHECK | `'othram' | 'season_of_justice' | 'other'`. Add new values via a future migration before populating them. |
| `dna_funding_handoffs` | table | Audit log: `case_id`, `created_at`, `user_id`, `routed_to_url`, `routed_to_kind`, `ip_hash`, `user_agent_summary`. RLS-locked; service-role only. |

---

## Data population

The migration adds the schema. The actual `dna_funding_url` values are an **operator-side manual task** — there's no scraper. Per case:

1. Check Othram DNA Solves (`dnasolves.com`) for the case slug or victim name. If a fundraiser exists, paste the URL into `cases.dna_funding_url` and set `dna_funding_kind = 'othram'`.
2. If no Othram page, check Season of Justice (`seasonofjustice.org/cases` or equivalent). If they're funding this case, paste the URL + set `dna_funding_kind = 'season_of_justice'`.
3. Otherwise leave both null — the CTA stays hidden.

This is a slow accumulation task — typically a few cases at a time as the operator notices fundraisers being announced. See `docs/research/dna-funding-probe.md` for the initial probe + the URL format check that should be repeated whenever Othram or SoJ change their site structure.

---

## Edge Function — `dna-funding-route`

| Endpoint | `POST /functions/v1/dna-funding-route` |
|----------|---------------------------------------|
| Auth | Anon — same posture as `tip-route-submit`. |
| Body | `{ case_id: uuid, user_agent_summary?: string }` |
| Returns | `{ funding_url: string, funding_kind: DnaFundingKind }` |
| Errors | `400` invalid case_id · `404` no funding route (client should have hidden the CTA) · `429` rate-limited · `500` internal |

The function reads `cases.dna_funding_url` + `cases.dna_funding_kind`, resolves via the shared helper `resolveDnaFundingRoute`, inserts an audit row, and returns the URL. The client deep-links to the returned URL with `Linking.openURL`.

---

## Mobile surface

The CTA lives in the scroll body of the case-detail screen, **not** in the sticky bar. The sticky bar carries the universal tip CTA ("I think I know something"); DNA funding is a per-case opportunity that surfaces only when a fundraiser exists. Placement is between SOURCES and the tip-trust callout — close enough to the case context to feel earned, separate enough from the tip-trust posture to not get conflated.

The component is `components/cf/dna-funding-callout.tsx`. Visual contract:
- Amber-bordered card (consistent with the ethical-posture palette per `feedback_amber_is_ethical_posture`)
- `FUND DNA WORK ON THIS CASE` header (mono-cap)
- One-sentence trust disclosure: which platform, donations go directly to the lab, Cold File does not process payments
- Single CTA: `OPEN FUNDING PAGE →`

---

## Out of scope

- In-app payment processing or donation UI. Anti-fit, see "Posture" above.
- Per-case donation totals displayed on our side. Anti-fit — that's the lab's data, not ours, and showing a running total could chill donations on a case that "already has enough." Let the platform handle its own social proof.
- Family donation requests we surface on their behalf without a verified rights-holder. Same posture as the photo policy (`feedback_photo_legal_posture`).
- Pushing donation prompts via notifications. The alert loop is reserved for case-state changes (new case in zone, update on followed case); it's the moat and it should not get diluted into fundraising prompts.
