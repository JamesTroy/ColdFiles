# The Cold File — Abuse Signals (stub)

We collect three columns on `tip_routings` for abuse detection: `content_hash`, `ip_hash`, and `user_agent_summary`. The plaintext of the tip never round-trips the server — only the salted SHA-256 of the body. See `docs/04_DESIGN_SYSTEM.md` "Content hash" for the algorithm.

The cross-case-same-hash query is the spam signal — the same exact tip body submitted across many cases is a near-certain "I'm broadcasting noise to every cold case." `ip_hash` bursts within a short window are the rate-limit signal. Neither is wired to alerting yet.

We will wire alerting when we have enough volume to know what "normal" looks like — burst patterns, repeat-tipper distributions, length distributions. Building the alerting now would just calibrate against an empty dataset and ship false positives in week one. Track as a post-launch + 4-week deliverable; revisit this doc once the table has real rows.

The decoration vs. wiring distinction: the schema columns existing without the alerting wired is *not* decorative as long as the columns are correctly populated. Populated columns are the lever; alerting is one possible use of the lever.

## Future scope

When this doc gets fleshed out, it should cover:

- Spam signal — `select content_hash, count(distinct case_id) from tip_routings group by content_hash having count(*) > N`. Threshold TBD on real data.
- Rate-limit — `ip_hash` bursts. Probably 30 routings per `ip_hash` per hour as a soft cap, with a moderation queue, not a hard reject.
- Suppression list — content hashes matching a curated list of known noise (chain-letter copypasta, AI-generated junk).
- Anomaly per case — sudden burst of tips on a previously-quiet case. Cross-reference with case last_changed_at — a burst on a case that just hit news is normal; a burst on a case that hasn't moved in a year is investigative.

None of these is built. The schema can support all of them once we know what the right thresholds are.
