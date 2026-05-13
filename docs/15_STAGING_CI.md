# Staging Supabase + CI smoke

The `.github/workflows/staging-smoke.yml` workflow runs both
`scripts/smoke-test-watch-zone-hit.sh` and
`scripts/smoke-test-notify-fanout.sh ingest_alive_alarm` against a
**staging** Supabase project on every PR that touches a smoke-relevant
surface. If a smoke fails, the PR check is red — the producer trigger
chain or the notify-fanout dispatcher broke against a real DB, and
the PR doesn't merge until the smoke clears.

This file is the one-time operator setup and the ongoing drift-check
ritual. The workflow itself is inert (`if: vars.STAGING_ENABLED ==
'true'`) until step 5 below.

## One-time setup

### 1. Create the staging Supabase project

- New project on Supabase free tier. Name `coldfile-staging`.
- Same region as prod.
- Record three values:
  - **Project URL** (`https://<ref>.supabase.co`)
  - **Service-role key** (Settings → API → `service_role` key —
    NOT the anon key, the smoke scripts bypass RLS)
  - **Project ref** (the `<ref>` slug from the URL; also in
    Settings → General)

### 2. Apply all migrations to staging

Same procedure as prod. From the repo root:

```bash
# Set the staging DB connection (find it in Settings → Database).
export STAGING_DB_URL="postgresql://postgres:[PASSWORD]@db.<ref>.supabase.co:5432/postgres"

# Apply numbered migrations in order. Each is idempotent on a fresh
# DB but assumes a forward-only apply order — DO NOT re-run on a DB
# that already has them; use the count check below.
for f in migrations/[0-9]*.sql; do
  echo "→ $f"
  psql "$STAGING_DB_URL" -v ON_ERROR_STOP=1 -f "$f"
done
```

Verify migration tail:

```bash
psql "$STAGING_DB_URL" -c "\d cases" | head
psql "$STAGING_DB_URL" -c "select count(*) from pg_proc where proname='smoke_cleanup';"  # mig 28
```

### 3. Seed staging Vault secrets

The producer triggers (`notify_watch_zone_hit`, `check_ingest_alive`)
read three values from `vault.secrets`:

```sql
-- service-role for pg_net Authorization header
select vault.create_secret('<STAGING_SERVICE_ROLE_KEY>', 'service_role_key');

-- the synthetic operator user the ingest_alive_alarm test posts to
-- (create the user first via auth.users insert, copy its UUID)
select vault.create_secret('<STAGING_OPERATOR_USER_UUID>', 'operator_user_id');

-- match prod's threshold (99 is the smoke test's default for visible
-- alarm body; bump higher if you want the alarm path to stay quiet
-- between explicit smoke runs)
select vault.create_secret('99', 'ingest_alive_threshold_hours');
```

Beware whitespace in vault names per `feedback_silent_whitespace_in_config`
— paste the keys exactly, no leading/trailing spaces.

### 4. Create the synthetic operator user

The smoke scripts use synthetic auth users that get cleaned up via
`smoke_cleanup` after each run. But the ingest_alive_alarm test posts
to a **persistent** operator user that needs to exist across runs:

```bash
curl -sS -X POST "$STAGING_URL/auth/v1/admin/users" \
  -H "apikey: $STAGING_SERVICE_ROLE_KEY" \
  -H "Authorization: Bearer $STAGING_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{"email":"smoke-operator@example.invalid","email_confirm":true}' \
  | jq -r '.id'
```

Record the UUID; this is `STAGING_OPERATOR_USER_ID`.

### 5. Add GitHub Actions secrets and enable the workflow

Settings → Secrets and variables → Actions:

**Secrets:**
- `STAGING_SUPABASE_URL`
- `STAGING_SUPABASE_SERVICE_ROLE_KEY`
- `STAGING_SUPABASE_PROJECT_REF`
- `STAGING_OPERATOR_USER_ID`
- `SUPABASE_ACCESS_TOKEN` (already exists for `deploy-functions.yml` —
  shared, not duplicated)

**Variables:**
- `STAGING_ENABLED` = `true`

Until `STAGING_ENABLED` is set, the workflow short-circuits — no
red Xs from a half-configured project.

## Ongoing — schema-sync ritual (monthly)

Staging drifts from prod whenever a migration ships to prod without
being applied to staging. The PR-smoke surfaces this immediately
(missing-table error during smoke), but the failure is at the wrong
end of the loop — better to catch it proactively.

**Once a month**, sync prod schema to staging:

```bash
# From a machine with prod DB credentials (operator-only — NOT CI).
PROD_DB_URL="postgresql://postgres:[PROD_PASS]@db.<prod-ref>.supabase.co:5432/postgres"
STAGING_DB_URL="postgresql://postgres:[STG_PASS]@db.<stg-ref>.supabase.co:5432/postgres"

# Schema-only dump from prod.
pg_dump --schema-only --no-owner --no-privileges "$PROD_DB_URL" > /tmp/prod_schema.sql

# Wipe staging public schema and reapply. Staging data is synthetic-
# only (smoke artifacts), so a wipe is safe.
psql "$STAGING_DB_URL" -c "drop schema public cascade; create schema public;"
psql "$STAGING_DB_URL" -v ON_ERROR_STOP=1 -f /tmp/prod_schema.sql

# Reseed Vault secrets (they survive the drop schema, but re-verify).
psql "$STAGING_DB_URL" -c "select name from vault.decrypted_secrets;"
```

Do NOT put prod DB credentials into GitHub Actions to automate this.
The cost of one rogue workflow run with prod write access dwarfs the
half-hour-a-month of operator time the manual ritual costs.

## Known limitations

- **Push delivery is not asserted.** Staging has no real devices.
  Smokes pass on `{"sent":0,"note":"no recipients"}` for the
  dispatcher path; the producer-trigger path (`watch_zone_hit`) is
  still fully asserted because pg_net + the dispatcher response code
  are observable.
- **Concurrent PRs serialize.** `concurrency: staging-smoke` queues
  runs — a second PR's smoke waits for the first to finish (~3 min
  per run). If queueing becomes painful, the next step is per-PR
  Supabase branching (a paid feature) or moving smoke off the shared
  staging project.
- **Migration drift is operator-detected, not auto-applied.** A PR
  that ships a migration will smoke-fail until the migration is
  applied to staging. That's the design — same gate as prod.
