-- Migration 27 — extend watch_zone_hit trigger to fire on UPDATE OF
-- location_point as well as INSERT.
--
-- Audit finding: migration 19's `cases_watch_zone_hit_trigger` is
-- AFTER INSERT only. The persist pipeline's most common path inserts
-- a case row WITHOUT location_point (no coordinates from the source's
-- structured fields) and then UPDATEs the row with the geocoder's
-- result. Cases ingested via that path never fire the watch_zone_hit
-- trigger — watch-zone alerts are silently broken for the majority of
-- newly-ingested cases that get geocoded post-INSERT.
--
-- Fix: separate AFTER UPDATE trigger that fires only when
-- location_point transitioned NULL → non-NULL. The shared function
-- (notify_watch_zone_hit) already short-circuits when location_point
-- is null OR deleted_at is set, and is keyed on NEW.id, so it works
-- unchanged for both the INSERT and UPDATE entry points.
--
-- Idempotent: drop+create the trigger.

drop trigger if exists cases_watch_zone_hit_on_geocode_trigger on public.cases;

create trigger cases_watch_zone_hit_on_geocode_trigger
  after update of location_point on public.cases
  for each row
  when (
    -- Fire only when location_point transitions NULL → non-NULL.
    -- A re-geocode that moves the point (non-NULL → different non-NULL)
    -- shouldn't re-notify; the user was already notified at first
    -- geocode. A geocode that NULLs the point (rare) shouldn't notify.
    old.location_point is null
    and new.location_point is not null
    and new.deleted_at is null
  )
  execute function public.notify_watch_zone_hit();

-- The original AFTER INSERT trigger from migration 19 stays in place.
-- The two triggers cover the two entry points cleanly:
--   INSERT with location_point set       → INSERT trigger fires
--   INSERT without location_point set    → INSERT trigger short-circuits
--                                          on the location_point IS NULL guard
--   ... then UPDATE adds location_point  → this UPDATE trigger fires
--
-- Re-INSERT after a hard-delete migration (13/14/17/20/21 etc.) still
-- fires INSERT — that's the existing duplicate-notification risk noted
-- in the audit, captured under a separate ledger-based dedupe ticket.
