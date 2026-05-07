-- Migration 35 — case_events table for the per-case Timeline Reconstruction.
--
-- Public-facing chronological view of what's known to have happened in
-- what order on a given case. Editorially distinct from `case_updates`
-- (which is the internal change-log written by persist.ts:392 for
-- conflict_detected events and similar operator diagnostics — it stays
-- internal). Two tables, two purposes.
--
-- Editorial frame: family members of unidentified Does and missing
-- persons can spot temporal coincidence that aggregator narratives
-- bury under prose. NOT a forensic timeline (investigator territory),
-- NOT "true-crime browsing" — a public-record timeline that makes a
-- case legible to someone arriving cold. Three load-bearing rules,
-- each enforced at one specific layer:
--
--   1. Every row carries a verified source.
--      Schema-enforced via source_url NOT NULL and source_quote NOT NULL.
--      An extractor that can't quote the upstream text justifying the
--      event physically cannot insert the row. Same posture that
--      caught the PCC editorial-noise garbage (memory:
--      feedback_extractor_editorial_noise.md).
--
--   2. No editorial inference at extraction time.
--      Surface-level: the source_quote column carries the verbatim
--      text the extractor consumed; a future operator can audit any
--      row by reading the quote. If an extractor wants to insert an
--      event whose date or kind isn't directly in source text, the
--      missing source_quote forces the inference into the application
--      layer where it's reviewable, instead of the database where
--      it'd ship silently.
--
--   3. No event-row promotion of garbage.
--      The unique(case_id, ingest_signature) constraint plus the
--      idempotent persist path keeps re-scrapes from duplicating
--      existing events, while the case_id FK with ON DELETE CASCADE
--      ensures takedown / soft-delete on the parent case removes the
--      event trail too. RLS ties into the same takedown predicate
--      from migration 25.
--
-- Mobile-side rendering threshold (≥3 events to render the section)
-- is NOT a schema concern — it's a UI policy that lives in
-- mobile/components/cf/case-events-section.tsx (lands in PR #16
-- commit D). The schema accepts any number of events per case;
-- the surface decides when to show them.
--
-- DROP-then-CREATE for the type because re-applying with adjusted
-- enum values would 42P13 — same caveat migrations 29 + 33 + 34
-- already encoded the fix-shape for.

drop table if exists public.case_events;
drop type if exists case_event_kind;

-- Enum scope rule: every value in this taxonomy MUST map to a structured
-- signal in at least one current or near-term-scoped source. Speculative
-- values ("we might extract this someday") are forever in Postgres once
-- shipped — removing them later requires coordinating a type-change
-- migration with anything referencing the type. Cut now, add back via
-- a separate migration when the extractor is real. See deferred list
-- below the type definition.
create type case_event_kind as enum (
  -- Incident-anchor events: the case-level crime / disappearance / discovery.
  'incident',                   -- PCC: parsed incident_date from yoast description
  'last_seen',                  -- Doe MP: missing_since;  Charley: Missing Since field
  'remains_found',              -- Doe UID: date_of_discovery (already parsed as incident_date)

  -- Source-published events: editorial milestones in case visibility.
  'case_spotlight_published',   -- PCC: yoast.article_published_time on the victim post

  -- Status-change events: mirrors case_status flips with their own date.
  'status_resolved_arrest',     -- PCC: classifier → 'cleared_arrest' (PR #15)
  'status_resolved_other',      -- PCC: classifier → 'cleared_other'; Doe MP/UID: is_closed='X'
  'status_identified'           -- Doe UID: is_identified='X'
);

-- Future enum additions — add via separate migration when a source
-- publishes structured signal for them, not before. Each entry below
-- has a noted blocker on the current corpus:
--
--   archive_feature        — synthesized from case_sources.first_ingested_at
--                            is internal-state signal (when WE first saw the
--                            source row), not a source-published editorial
--                            milestone. Fails the same source-published
--                            discipline the rest of this schema enforces;
--                            same shape as the case_updates / case_events
--                            split that motivated two tables. Add back if
--                            a source ever publishes a structured "this
--                            case re-featured / re-promoted on date X"
--                            signal — none of the four current sources do.
--   reported_missing       — narrative-locked across all four sources;
--                            Charley has it in prose only.
--   agency_assigned        — agency name + phone are structurally present
--                            (Doe MP/UID, Charley, PCC) but NO event date
--                            on the agency record; without a date, this
--                            is metadata, not a timeline event. Add when
--                            a source surfaces "agency took the case on
--                            date X" structurally.
--   photo_published        — Doe UID has reconstruction signal but no
--                            clean source publish-date; would require
--                            diff-detection logic that doesn't exist.
--   media_coverage         — third-party press / podcast feature; no
--                            current source carries this without inference.
--                            Reserved for future newspaper-archive or
--                            podcast-metadata sources.
--   suspect_named, suspect_cleared, reward_changed, dna_milestone,
--   case_reopened          — agency-side / investigative signals; none of
--                            the four current sources tag these as
--                            structured records. Reserved for agency-direct
--                            sources (LASD homicide bureau, etc.).
--   status_located         — missing-person located; no current source
--                            flips this as a structured event.
--   status_withdrawn       — family / agency takedown; lives at the
--                            cases.takedown_requested_at column today,
--                            not as an event.

comment on type case_event_kind is
  'Closed taxonomy of public-record timeline event kinds. Every value maps to a structured signal in a current source. Add a new value via migration when a real source publishes structured signal for it — never to express something an extractor inferred from prose. See migration 35 body comment for the deferred-additions list.';


create table public.case_events (
  id                    uuid primary key default gen_random_uuid(),
  case_id               uuid not null references public.cases(id) on delete cascade,

  -- Event semantics.
  event_kind            case_event_kind not null,
  headline              text not null,
  -- Optional fuller body. Keep brief — the surface caps display at ~3
  -- lines. Long-form prose belongs in the source URL the user can tap
  -- through to.
  body                  text,

  -- When the event happened in the world (NOT when ingested).
  --
  --   event_at         exact instant (rare; usually null for cold cases)
  --   event_date       date-precision floor — the canonical timeline anchor
  --   event_date_end   range end; null means single-date event
  --   event_date_text  free-form ('summer 1985', 'c. 1987-1988') — preserved
  --                    verbatim from the source for display when ranges or
  --                    fuzziness can't be machine-encoded
  --   event_date_quality  reuses the same enum the case-level incident_date
  --                    uses (exact / approximate / year_only / suspect /
  --                    unknown). For Doe scrape-observed status flips, use
  --                    'approximate' and surface the cron-cadence caveat in
  --                    UI copy — don't introduce a new enum value just for
  --                    that case. (Source-extraction agent's recommendation,
  --                    user-greenlit.)
  event_at              timestamptz,
  event_date            date,
  event_date_end        date,
  event_date_quality    date_quality not null default 'unknown',
  event_date_text       text,

  -- Source attribution. Hybrid: FK first, denormalized fallback.
  --
  --   case_source_id   FK to the case_sources row that produced this event.
  --                    Null when the event synthesizes across multiple
  --                    sources or is operator-entered (rare; future admin
  --                    tool).
  --   source_id        FK to sources for the originating source row.
  --                    Denormalized so a stats/grouping query can read
  --                    "events by source" without joining through
  --                    case_sources.
  --   source_url       Canonical URL backing this event. NOT NULL — every
  --                    timeline entry must be traceable to a verifiable
  --                    URL the user can tap through. No "according to
  --                    multiple reports" footnote-style fallback.
  --   source_quote     SCHEMA-ENFORCED ANTI-INFERENCE. Every timeline
  --                    row must carry the verbatim text the extractor
  --                    consumed to justify the event — NOT NULL is
  --                    physical. The whole point of catching the PCC
  --                    editorial-noise garbage was that "convention"
  --                    wasn't enough; this column makes the rule
  --                    structural. (Memory: feedback_extractor_editorial_noise.
  --                    User-greenlit strict; revisit if/when operator-
  --                    entered events become a real surface.)
  case_source_id        uuid references public.case_sources(id) on delete set null,
  source_id             uuid references public.sources(id),
  source_url            text not null,
  source_quote          text not null,

  -- Idempotency. Computed in TypeScript at extract time by
  -- computeEventSignature() in supabase/functions/_shared/case-events.ts
  -- (lands in PR #16 commit B), as
  --   sha256(source_url || '|' || event_kind || '|' ||
  --          coalesce(event_date_text, event_date::text, ''))
  -- and uniqued per case via the table-level constraint below.
  --
  -- Mirrors the existing case_sources.payload_hash precedent
  -- (migrations/01_schema.sql:255 — text not null, no GENERATED clause,
  -- no trigger; the extractor writes the hash directly via persist.ts).
  -- Schema enforcement is the unique constraint + NOT NULL; a wrong-shape
  -- hash from a buggy extractor still passes the column type, but
  -- duplicate rows are caught and an extractor that forgets the column
  -- entirely fails NOT NULL.
  --
  -- Headline is deliberately NOT in the hash — source titles drift
  -- between scrapes (PCC sometimes edits post titles post-publication),
  -- and a headline-sensitive hash would create duplicate rows on those
  -- drifts. (Data agent recommended including headline; revised per
  -- source-extraction agent's drift observation, user-greenlit.)
  ingest_signature      text not null,

  -- Per-event takedown. Inherits from cases.takedown_requested_at via
  -- the public-read RLS policy below; this column lets an operator
  -- redact a single event without a takedown on the whole case (rare —
  -- a published photo that needs scrubbing while the case stays
  -- visible).
  takedown_requested_at timestamptz,

  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),

  unique(case_id, ingest_signature)
);

-- Indexes.
--
-- Primary read pattern on the case-detail screen: SELECT every event
-- for a single case_id, ordered by event date desc (or asc — UI policy
-- TBD; the index is bidirectional). The COALESCE puts exact-instant
-- events ahead of date-only events that share the same calendar day
-- — the right ordering for status-update events that arrived later in
-- the same day as a publish-time event.
create index case_events_case_chrono_idx
  on public.case_events (
    case_id,
    coalesce(event_at, event_date::timestamptz) desc nulls last,
    created_at desc
  );

-- Source-grouped reads ("events from PCC", "events from Doe Network").
create index case_events_source_idx
  on public.case_events (source_id)
  where source_id is not null;

-- Kind-filtered reads (future feature: "show only status-change events").
-- Cheap to add now; UI surface for the filter is deferred.
create index case_events_kind_idx
  on public.case_events (event_kind);


-- RLS.
alter table public.case_events enable row level security;

-- Public read mirrors cases_public_read (migration 25): exclude
-- soft-deleted cases AND takedown-requested cases. Per-event takedown
-- (case_events.takedown_requested_at) is also honored independently.
create policy case_events_public_read on public.case_events
  for select using (
    case_events.takedown_requested_at is null
    and exists (
      select 1
      from public.cases c
      where c.id = case_events.case_id
        and c.deleted_at is null
        and c.takedown_requested_at is null
    )
  );

-- updated_at trigger using the existing touch_updated_at function from
-- migration 01.
create trigger case_events_touch_updated_at
  before update on public.case_events
  for each row execute function touch_updated_at();


-- Comments for documentation surfaces (PostgREST schema browser, future
-- API reference doc per architecture-review issue).
comment on table public.case_events is
  'Public-facing per-case timeline. Every row carries a verified source URL + verbatim quote. Distinct from case_updates (internal change-log).';

comment on column public.case_events.source_quote is
  'Verbatim source text justifying this event. NOT NULL — schema-enforced anti-inference per the editorial-noise rule (memory: feedback_extractor_editorial_noise).';

comment on column public.case_events.ingest_signature is
  'sha256(source_url + event_kind + coalesce(event_date_text, event_date::text, "")). Computed in TypeScript at extract time by computeEventSignature() in supabase/functions/_shared/case-events.ts. Mirrors case_sources.payload_hash pattern (TypeScript-computed, schema-uniqued; not a generated column or trigger). Headline excluded — source titles drift.';

comment on column public.case_events.event_date_quality is
  'Reuses the date_quality enum from cases.incident_date_quality. For Doe scrape-observed status flips (no source publish-date available), use approximate and surface the cron-cadence caveat in UI copy.';
