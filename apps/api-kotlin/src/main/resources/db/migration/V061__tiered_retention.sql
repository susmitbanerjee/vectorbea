-- =============================================================================
-- V061__tiered_retention.sql
--
-- Tiered retention on top of the P12 partition/archive machinery.
--
-- ── RETENTION IS A DELETION, NOT A FILTER ───────────────────────────────────
-- Nothing here adds a `WHERE hidden = false`. Data past retention is GONE from
-- Postgres. A read-time filter leaves the bytes present, still billed, still
-- reachable by any path that forgets the predicate — an export, a direct API
-- call, a support query, the next feature. There is exactly one filter-shaped
-- thing in this file (`retention_effective_days`, which computes a CUTOFF), and
-- it decides what to delete, not what to show.
--
-- ── WHAT THE MEASUREMENT SAID, AND WHAT IT CHANGED ──────────────────────────
-- Measured on 2026-09-04 against postgres:16, 2,000,000 events in one monthly
-- partition (2.88 GB), 40 workspaces interleaved, 50k rows each:
--
--   per-workspace row delete, cold cache    49,679 rows   22.8 s    0 bytes freed
--   per-workspace row delete, warm cache    49,680 rows    0.8 s    0 bytes freed
--   VACUUM after 250k deletes                    --      84.0 s    0 bytes freed
--   DETACH + DROP PARTITION                 2,000,000      1.8 s    2955 MB freed
--
-- Three consequences, and each one shaped something below.
--
--   1. A ROW-LEVEL DELETE RETURNS NO STORAGE. VACUUM frees the space for REUSE
--      inside the same table; the file on disk stays at its high-water mark
--      until the partition is dropped. Deleting 12.5% of the rows made the
--      table GROW, 2880 MB to 2955 MB, before vacuum. So row-level deletion is
--      here for CORRECTNESS — the data is gone, which is §1 — and the storage
--      lever is, and remains, the partition drop.
--
--   2. THE DELETE IS HEAP-BOUND, NOT INDEX-BOUND. `Heap Blocks: exact=50000`
--      for 50,000 rows: one block per row, because workspaces interleave in
--      insert order, so one workspace's month is scattered across the whole
--      heap. The index scan was 30 ms of a 22.8 s statement. That is why this
--      migration does NOT add a (workspace_id, created_at) index to
--      `run_events` — it already has `run_events_workspace_idx`, the planner
--      picks it, and a better index would improve 0.1% of the cost. `run_spans`
--      gets one only because it has no workspace index at all and would
--      otherwise sequential-scan.
--
--   3. THE REAL STORAGE WINS ARE THE UNPARTITIONED ONES. `run_payloads` and
--      `run_payload_blobs` hold the largest content per row and are not
--      partitioned, so their rows can only ever be reclaimed by deletion — and
--      `run_payloads.expires_at` plus its index have been sitting unused since
--      V040 waiting for exactly this. Warm-tier archive objects are the other:
--      purging one returns real bytes to the object store immediately.
--
-- The follow-on this argues for — partitioning traces by RETENTION CLASS as
-- well as month, so a free-tier partition can be dropped 7 days after its month
-- ends instead of being pinned for a year by one Enterprise workspace — is
-- written up in docs/RETENTION.md §9. It is a re-partition of the hottest table
-- in the system and belongs in a maintenance window, not in this migration.
-- =============================================================================


-- ═══════════════════════════════════════════════════════════════════════════
-- 1. Two new entitlement keys
--
-- The other four (runs, events, traces, payloads) landed in V060. Archives are
-- a fifth entity — an object in a bucket outlives the partition it came from,
-- and its cost curve is completely different from a Postgres row's.
-- ═══════════════════════════════════════════════════════════════════════════
INSERT INTO plan_entitlements (plan_code, key, kind, scope, int_value, num_value, note) VALUES
    -- How long a warm-tier export stays readable before it is purged.
    ('free',       'retention_days_archives', 'limit', 'workspace', 14,  NULL, NULL),
    ('pro',        'retention_days_archives', 'limit', 'workspace', 90,  NULL, NULL),
    ('team',       'retention_days_archives', 'limit', 'workspace', 180, NULL, NULL),
    ('enterprise', 'retention_days_archives', 'limit', 'workspace', 365, NULL, NULL),

    -- How long a DOWNGRADE is honoured at the old window before the new one
    -- starts deleting. A setting and not a limit: it is a duration the job
    -- reads, not a ceiling anything is compared against.
    ('free',       'retention_grace_days', 'setting', 'account', NULL, 30, NULL),
    ('pro',        'retention_grace_days', 'setting', 'account', NULL, 30, NULL),
    ('team',       'retention_grace_days', 'setting', 'account', NULL, 30, NULL),
    ('enterprise', 'retention_grace_days', 'setting', 'account', NULL, 60, NULL)
ON CONFLICT (plan_code, key) DO NOTHING;


-- ═══════════════════════════════════════════════════════════════════════════
-- 2. workspace_retention_state — what the window WAS, so a cut can be graced
--
-- ── WHY THIS TABLE HAS TO EXIST ─────────────────────────────────────────────
-- Entitlements are stateless: `resolve_entitlements` tells you a workspace is
-- on 7 days, and cannot tell you it was on 90 yesterday. Without that, a
-- downgrade deletes 83 days of somebody's traces the first time the sweep runs
-- after the plan change — before they have seen a warning, let alone exported.
-- This is customer-owned data; getting it wrong is a support problem and
-- possibly a legal one.
--
-- So the sweeper OBSERVES the effective window on every pass and records it. A
-- window that shrank opens a grace period; a window that grew takes effect
-- immediately (nobody needs protecting from more retention).
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS workspace_retention_state (
    workspace_id   UUID        NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,

    -- runs | events | traces | payloads | archives. Text and not an enum: a
    -- sixth entity should be a line of Kotlin, not a migration.
    entity         TEXT        NOT NULL,

    /* The window the plan says right now. */
    effective_days INTEGER     NOT NULL,

    /* The window in force before the most recent CUT, and null once the grace
       for that cut has been consumed. While it is non-null and grace_until is
       in the future, THIS is the window the sweeper obeys. */
    previous_days  INTEGER,

    changed_at     TIMESTAMPTZ,
    grace_until    TIMESTAMPTZ,

    /* When the workspace was told, so the UI can say "we warned you on the 4th"
       and so a second sweep does not re-notify. */
    notified_at    TIMESTAMPTZ,
    /* When they were offered an export for the data about to go. */
    export_offered_at TIMESTAMPTZ,

    updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),

    PRIMARY KEY (workspace_id, entity)
);

CREATE INDEX IF NOT EXISTS workspace_retention_state_grace_idx
    ON workspace_retention_state (grace_until)
    WHERE grace_until IS NOT NULL;

COMMENT ON TABLE workspace_retention_state IS
    'Per workspace and entity: the retention window now, the window before the '
    'last cut, and when that cut stops being graced. The sweeper obeys '
    'GREATEST(effective, previous) until grace_until passes.';


-- ═══════════════════════════════════════════════════════════════════════════
-- 3. retention_sweeps — the heartbeat (§6)
--
-- "A retention job that silently stopped is how you discover storage growth
-- three months late, and this codebase has shipped two scheduled functions with
-- no caller already."
--
-- So the job's last success is a ROW, queryable by the health endpoint and by
-- an alert, rather than a log line nobody greps. A sweep that starts and never
-- finishes leaves `finished_at` null and `status = 'running'`, which is a
-- different and equally important signal from "has not started in three days".
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS retention_sweeps (
    id              UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    started_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    finished_at     TIMESTAMPTZ,
    status          TEXT        NOT NULL DEFAULT 'running'
        CHECK (status IN ('running','succeeded','failed','interrupted')),

    workspaces_seen INTEGER     NOT NULL DEFAULT 0,
    rows_deleted    BIGINT      NOT NULL DEFAULT 0,
    bytes_freed     BIGINT      NOT NULL DEFAULT 0,
    partitions_dropped INTEGER  NOT NULL DEFAULT 0,
    archives_purged INTEGER     NOT NULL DEFAULT 0,

    /* Truncated and sanitized by the caller. Never a stack trace. */
    error           TEXT,
    /* Which worker held the lock, for an operator chasing a stuck sweep. */
    worker_id       TEXT
);

CREATE INDEX IF NOT EXISTS retention_sweeps_recent_idx
    ON retention_sweeps (started_at DESC);

-- Answers "when did this last work" in one indexed row, which is what the
-- health endpoint and the staleness alert both need.
CREATE INDEX IF NOT EXISTS retention_sweeps_success_idx
    ON retention_sweeps (finished_at DESC) WHERE status = 'succeeded';

COMMENT ON TABLE retention_sweeps IS
    'One row per retention sweep. The last succeeded row IS the heartbeat: '
    '/api/health/retention reads it and alerts on staleness.';


-- ═══════════════════════════════════════════════════════════════════════════
-- 4. retention_deletions — the audit (§7)
--
-- What was deleted, for which workspace, under which policy, when. A support
-- question ("where did my run from March go?") and a compliance question ("show
-- me this was deleted, and on whose authority") are the same query against this
-- table, and neither can be answered from a log that has rotated.
--
-- Append-only in practice; not enforced with a trigger the way `audit_log` is,
-- because this is machine-written operational history rather than a governance
-- record, and a corrective UPDATE by an operator is legitimate here.
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS retention_deletions (
    id            UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    sweep_id      UUID        REFERENCES retention_sweeps(id) ON DELETE SET NULL,

    /* Nullable: a partition drop is not attributable to one workspace. Recorded
       with a null workspace and a scope of the partition name, because "we
       dropped everyone's July events" is exactly as auditable a fact. */
    workspace_id  UUID,
    entity        TEXT        NOT NULL,

    /* The policy that authorised it, denormalised on purpose. The plan can
       change tomorrow; the reason this row went must not. */
    policy_days   INTEGER     NOT NULL,
    policy_source TEXT        NOT NULL,   -- plan | override | grace | platform_floor
    plan_code     TEXT,

    /* Everything older than this went. */
    cutoff        TIMESTAMPTZ NOT NULL,
    /* Partition name, object key, or 'rows' — what was operated on. */
    scope         TEXT        NOT NULL,

    rows_deleted  BIGINT      NOT NULL DEFAULT 0,
    bytes_freed   BIGINT      NOT NULL DEFAULT 0,

    /* Where it went first, when it went anywhere. Null means it was deleted
       with no export — which is legitimate for data that was already archived,
       and is exactly what an auditor will ask about. */
    export_key    TEXT,

    deleted_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS retention_deletions_workspace_idx
    ON retention_deletions (workspace_id, deleted_at DESC);
CREATE INDEX IF NOT EXISTS retention_deletions_sweep_idx
    ON retention_deletions (sweep_id);


-- ═══════════════════════════════════════════════════════════════════════════
-- 5. workspace_exports — export before delete (§5)
--
-- Two callers, one ledger: a user pressing Export, and the sweeper exporting a
-- slice it is about to delete. Recording both the same way is what makes
-- "was this data exported before it went" answerable from one place — and it
-- is what turns a retention limit from punitive into defensible.
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS workspace_exports (
    id            UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    workspace_id  UUID        NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,

    /* on_demand | pre_deletion. The second is the sweeper's. */
    kind          TEXT        NOT NULL DEFAULT 'on_demand'
        CHECK (kind IN ('on_demand','pre_deletion')),

    /* Which entities are in the bundle, e.g. '{runs,events,spans}'. */
    entities      TEXT[]      NOT NULL DEFAULT '{}',

    period_start  TIMESTAMPTZ,
    period_end    TIMESTAMPTZ,

    /* 'queued' is what the API writes: it has no exporter of its own, and an
       export is a streamed multi-gigabyte job that has no business happening
       inside an HTTP request. The worker drains queued rows on a short poll, so
       the request returns an id immediately and the client watches the row. */
    status        TEXT        NOT NULL DEFAULT 'running'
        CHECK (status IN ('queued','running','ready','failed')),

    object_key    TEXT,
    format        TEXT        NOT NULL DEFAULT 'ndjson.gz',
    checksum      TEXT,
    row_count     BIGINT      NOT NULL DEFAULT 0,
    byte_count    BIGINT      NOT NULL DEFAULT 0,
    error         TEXT,

    requested_by_user_id UUID,

    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    /* When the bundle itself stops being served. An export is not a second
       permanent copy — that would defeat the retention it exists to soften. */
    expires_at    TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS workspace_exports_workspace_idx
    ON workspace_exports (workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS workspace_exports_expiry_idx
    ON workspace_exports (expires_at) WHERE expires_at IS NOT NULL;


-- ═══════════════════════════════════════════════════════════════════════════
-- 6. The one index the measurement justified
--
-- `run_spans` has no workspace index at all — only a partial one on failures —
-- so a per-workspace delete would sequential-scan every partition. `run_events`
-- deliberately gets nothing: it already has `run_events_workspace_idx`, the
-- planner picks it, and the measured index scan was 30 ms of a 22.8 s delete.
-- Adding a composite there would optimise 0.1% of the cost and add an index to
-- maintain on the hottest write path in the system.
--
-- SIZE-GUARDED, following V028's precedent. `CREATE INDEX` on a partitioned
-- parent takes ACCESS EXCLUSIVE on every partition for the duration; on a large
-- deployment that is a maintenance-window operation with
-- `CREATE INDEX CONCURRENTLY` per partition and ATTACH, not something an
-- automated deploy should decide to do.
-- ═══════════════════════════════════════════════════════════════════════════
DO $$
DECLARE
    row_estimate BIGINT;
    max_inline   CONSTANT BIGINT := 5000000;
BEGIN
    IF to_regclass('public.run_spans') IS NULL THEN
        RAISE NOTICE 'run_spans does not exist - skipping';
        RETURN;
    END IF;

    SELECT COALESCE(SUM(c.reltuples)::bigint, 0) INTO row_estimate
      FROM pg_class c
      JOIN pg_inherits i ON i.inhrelid = c.oid
      JOIN pg_class p    ON p.oid = i.inhparent
     WHERE p.relname = 'run_spans';

    IF row_estimate > max_inline THEN
        RAISE WARNING
            'run_spans has ~% rows - SKIPPING the retention index. Build it in a '
            'window: CREATE INDEX ON ONLY run_spans (workspace_id, created_at); '
            'then CREATE INDEX CONCURRENTLY per partition and ATTACH PARTITION '
            'each to it. Without this index the per-workspace span sweep '
            'sequential-scans and RetentionSweeper will log it as such.',
            row_estimate;
        RETURN;
    END IF;

    CREATE INDEX IF NOT EXISTS run_spans_workspace_created_idx
        ON run_spans (workspace_id, created_at);
END $$;


-- ═══════════════════════════════════════════════════════════════════════════
-- 7. Policy resolution, with grace
-- ═══════════════════════════════════════════════════════════════════════════

/**
 * The window the sweeper must obey for one workspace and entity, and why.
 *
 * Returns the days AND the source, because the audit row records which policy
 * authorised a deletion and "30 days, because they downgraded on the 4th and
 * grace runs to the 4th of next month" is a different fact from "30 days,
 * because that is the plan".
 *
 * GRACE IS A MAXIMUM, NOT A SWAP. While a cut is graced the window is
 * GREATEST(new, old) — so a workspace that downgrades and then upgrades past
 * its old window is not held back by a stale `previous_days`.
 */
CREATE OR REPLACE FUNCTION retention_effective_days(
    p_workspace_id UUID,
    p_entity       TEXT
) RETURNS TABLE (days INTEGER, source TEXT)
LANGUAGE plpgsql STABLE AS $$
DECLARE
    plan_days INTEGER;
    st        RECORD;
BEGIN
    plan_days := workspace_retention_days(p_workspace_id, p_entity);

    SELECT * INTO st FROM workspace_retention_state
     WHERE workspace_id = p_workspace_id AND entity = p_entity;

    IF st IS NULL OR st.previous_days IS NULL OR st.grace_until IS NULL
       OR st.grace_until <= now() THEN
        days := plan_days;
        source := 'plan';
        RETURN NEXT;
        RETURN;
    END IF;

    days := GREATEST(plan_days, st.previous_days);
    source := CASE WHEN days > plan_days THEN 'grace' ELSE 'plan' END;
    RETURN NEXT;
END;
$$;

/**
 * Record what the plan says now, and open a grace period if it shrank.
 *
 * Called by the sweeper for every workspace on every pass, BEFORE it deletes
 * anything. That ordering is the whole protection: a downgrade is always
 * observed at least one full sweep before the shorter window could bite, so
 * there is no pass in which a workspace both learns of a cut and loses data to
 * it.
 *
 * Returns true when a NEW cut was opened, so the caller knows to notify.
 */
CREATE OR REPLACE FUNCTION retention_observe_policy(
    p_workspace_id UUID,
    p_entity       TEXT,
    p_grace_days   INTEGER
) RETURNS BOOLEAN
LANGUAGE plpgsql VOLATILE AS $$
DECLARE
    plan_days INTEGER;
    st        RECORD;
    opened    BOOLEAN := false;
BEGIN
    plan_days := workspace_retention_days(p_workspace_id, p_entity);

    SELECT * INTO st FROM workspace_retention_state
     WHERE workspace_id = p_workspace_id AND entity = p_entity;

    IF st IS NULL THEN
        -- First observation. NOT a cut: we have no evidence the window was ever
        -- longer, and treating an unknown history as a downgrade would grant
        -- every workspace a free grace period on the day this ships.
        INSERT INTO workspace_retention_state (workspace_id, entity, effective_days)
        VALUES (p_workspace_id, p_entity, plan_days)
        ON CONFLICT (workspace_id, entity) DO NOTHING;
        RETURN false;
    END IF;

    IF plan_days < st.effective_days THEN
        -- A CUT. Grace from now, carrying the OLD window forward.
        --
        -- GREATEST against any grace already running: two downgrades in a month
        -- must not shorten the protection the first one bought. A customer who
        -- goes Team -> Pro -> Free is in more trouble, not less.
        UPDATE workspace_retention_state
           SET previous_days = GREATEST(COALESCE(previous_days, 0), st.effective_days),
               effective_days = plan_days,
               changed_at   = now(),
               grace_until  = GREATEST(COALESCE(grace_until, now()),
                                       now() + make_interval(days => p_grace_days)),
               notified_at  = NULL,
               export_offered_at = NULL,
               updated_at   = now()
         WHERE workspace_id = p_workspace_id AND entity = p_entity;
        opened := true;

    ELSIF plan_days > st.effective_days THEN
        -- An upgrade. Immediate, and it closes any running grace: the new
        -- window is at least as generous, so there is nothing left to protect.
        UPDATE workspace_retention_state
           SET effective_days = plan_days,
               previous_days  = NULL,
               grace_until    = NULL,
               changed_at     = now(),
               updated_at     = now()
         WHERE workspace_id = p_workspace_id AND entity = p_entity;
    END IF;

    RETURN opened;
END;
$$;


-- ═══════════════════════════════════════════════════════════════════════════
-- 8. Storage measurement (the acceptance criterion)
--
-- "Measured storage per workspace falls after the first full cycle."
--
-- ── AN ESTIMATE, AND HONEST ABOUT IT ────────────────────────────────────────
-- Postgres has no per-tenant byte counter. `pg_total_relation_size` is
-- per-table, and a workspace owns a slice of a dozen shared tables. So this
-- computes rows x average row width, where the width comes from
-- `pg_column_size` over a BOUNDED SAMPLE of that workspace's own rows — not
-- from `pg_class` statistics, which are absent until something has ANALYZEd the
-- table, and not from every row, which would be a full scan of the tables it is
-- measuring.
--
-- It is therefore an ESTIMATE, and the number that matters is the DELTA before
-- and after a sweep, where the estimation error largely cancels. Anyone reading
-- it as an invoice line is reading it wrong, and the comment on the function
-- says so.
-- ═══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION workspace_storage_bytes(p_workspace_id UUID)
RETURNS TABLE (entity TEXT, rows BIGINT, bytes BIGINT)
LANGUAGE plpgsql STABLE AS $$
DECLARE
    r         RECORD;
    n         BIGINT;
    avg_width NUMERIC;
BEGIN
    FOR r IN
        SELECT * FROM (VALUES
            ('runs',     'agent_runs'),
            ('events',   'run_events'),
            ('traces',   'run_spans'),
            ('payloads', 'run_payloads')
        ) AS t(ent, tbl)
    LOOP
        EXECUTE format('SELECT count(*)::bigint FROM %I WHERE workspace_id = $1', r.tbl)
          INTO n USING p_workspace_id;

        /* WIDTH FROM A BOUNDED SAMPLE, not from pg_class.
         *
         * The first version of this divided `relpages * block_size` by
         * `reltuples`, which is the textbook estimate and returned ZERO for every
         * table here: `reltuples` is -1 until a table has been ANALYZEd, and a
         * freshly migrated database — or a newly partitioned one — has not been.
         * The byte column read 0.00 while the row counts moved correctly, which
         * is the worst kind of wrong: plausible, and silently useless.
         *
         * `pg_column_size(t.*)` over at most 500 of the workspace's own rows is
         * bounded, needs no statistics, and measures THIS tenant's rows rather
         * than the table average — which matters, because one workspace's events
         * can carry payloads an order of magnitude larger than another's.
         */
        EXECUTE format(
            'SELECT COALESCE(avg(pg_column_size(t.*)), 0)::numeric
               FROM (SELECT * FROM %I WHERE workspace_id = $1 LIMIT 500) t', r.tbl)
          INTO avg_width USING p_workspace_id;

        entity := r.ent;
        rows   := n;
        bytes  := (n * COALESCE(avg_width, 0))::bigint;
        RETURN NEXT;
    END LOOP;

    -- Payload blobs are the one place the real byte count is cheap, because the
    -- table stores the body. No estimate needed.
    SELECT COALESCE(count(*), 0), COALESCE(SUM(length(b.body)), 0)
      INTO rows, bytes
      FROM run_payload_blobs b
      JOIN run_payloads p ON p.object_key = b.key
     WHERE p.workspace_id = p_workspace_id;
    entity := 'payload_blobs';
    RETURN NEXT;
END;
$$;

COMMENT ON FUNCTION workspace_storage_bytes(UUID) IS
    'ESTIMATED bytes per workspace, from rows x statistical row width. Read the '
    'DELTA across a sweep, not the absolute number: the estimation error is '
    'stable and cancels, the absolute value is not an invoice line.';


-- ═══════════════════════════════════════════════════════════════════════════
-- 9. The floor the partition drop already uses, corrected
--
-- V028 drives `run_events_drop_expired_partitions` from
-- `MAX(log_retention_days)` in `workspace_usage_policies` — the pre-S3 column
-- that S3 superseded. Left alone it would ignore every plan: a workspace whose
-- entitlement says 365 days would have its partitions dropped at the old
-- column's 30, which is data loss from a column nobody edits any more.
--
-- Replaced by the true maximum across resolved entitlements. A partition holds
-- every workspace's rows, so the floor has to be the MOST generous window in
-- the system — keeping data one workspace no longer needs is a storage cost,
-- while dropping data another workspace paid for is a breach.
-- ═══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION retention_platform_floor_days(p_entity TEXT)
RETURNS INTEGER
LANGUAGE sql STABLE AS $$
    SELECT GREATEST(
        COALESCE((
            SELECT MAX(d.days)
              FROM workspaces w
              CROSS JOIN LATERAL retention_effective_days(w.id, p_entity) d
        ), 0),
        COALESCE((SELECT MAX(log_retention_days) FROM workspace_usage_policies), 0),
        7
    )
$$;

COMMENT ON FUNCTION retention_platform_floor_days(TEXT) IS
    'The longest window any workspace is entitled to, including grace. A time '
    'partition holds every tenant, so this is the only cutoff at which dropping '
    'one is safe. 7 days is the absolute floor: a bug that returned 0 must not '
    'be able to drop this month.';

CREATE OR REPLACE FUNCTION run_events_drop_expired_partitions()
RETURNS TABLE(dropped TEXT) AS $$
DECLARE
    keep_days  INTEGER;
    cutoff     DATE;
    part       RECORD;
BEGIN
    keep_days := retention_platform_floor_days('events');

    -- One month of slack beyond the retention window: a partition is only
    -- dropped once its NEWEST row is past retention, never merely its oldest.
    cutoff := (date_trunc('month', now()) - make_interval(days => keep_days) - interval '1 month')::date;

    FOR part IN
        SELECT c.relname
          FROM pg_class c
          JOIN pg_inherits i ON i.inhrelid = c.oid
          JOIN pg_class p ON p.oid = i.inhparent
         WHERE p.relname = 'run_events'
           AND c.relname ~ '^run_events_[0-9]{4}_[0-9]{2}$'
           AND to_date(substring(c.relname from 12), 'YYYY_MM') < cutoff
    LOOP
        EXECUTE format('ALTER TABLE run_events DETACH PARTITION %I', part.relname);
        EXECUTE format('DROP TABLE %I', part.relname);
        dropped := part.relname;
        RETURN NEXT;
    END LOOP;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION run_events_drop_expired_partitions IS
    'Detach-and-drop retention driven by retention_platform_floor_days(''events'') '
    '- the longest window ANY workspace is entitled to, grace included. Detach '
    'precedes drop so the drop is not holding a lock readers wait behind.';


-- ═══════════════════════════════════════════════════════════════════════════
-- 10. Payload expiry, per workspace
--
-- `run_payloads.expires_at` and `idx_run_payloads_expiry` were added in V040 for
-- "the reaper (P12)", which never arrived. The column was stamped from the
-- workspace's `log_retention_days` at write time — so rows written before a plan
-- change carry the old window, which is nearly the grace behaviour by accident
-- but is not it, and rows written before V060 carry the pre-S3 default.
--
-- The sweeper deletes on the LIVE policy instead of the stamped column, because
-- a stamped expiry cannot honour a downgrade grace and cannot be corrected
-- without rewriting every row. `expires_at` stays as a fast pre-filter — it is
-- indexed and it is never longer than the live window in practice — and the
-- live cutoff is the authority.
-- ═══════════════════════════════════════════════════════════════════════════

/**
 * Delete one bounded batch of a workspace's expired payloads. Returns the rows
 * deleted and the bytes they held.
 *
 * BATCHED AND RESUMABLE BY CONSTRUCTION. No cursor, no offset, no state to
 * lose: each call deletes up to `p_limit` of whatever is still expired. Kill the
 * job anywhere and the next call resumes, because "what is expired" is
 * recomputed from the data rather than remembered. Idempotency is free for the
 * same reason — a second call finds nothing left to do.
 *
 * The blob rows go with their metadata, in the same statement, so there is no
 * window in which a payload row points at a blob that is gone.
 */
CREATE OR REPLACE FUNCTION retention_purge_payloads(
    p_workspace_id UUID,
    p_cutoff       TIMESTAMPTZ,
    p_limit        INTEGER DEFAULT 5000
) RETURNS TABLE (rows_deleted BIGINT, bytes_freed BIGINT)
LANGUAGE plpgsql VOLATILE AS $$
BEGIN
    WITH doomed AS (
        SELECT p.ref, p.object_key, p.size_bytes
          FROM run_payloads p
         WHERE p.workspace_id = p_workspace_id
           AND p.created_at < p_cutoff
         ORDER BY p.created_at
         LIMIT p_limit
    ),
    blobs AS (
        DELETE FROM run_payload_blobs b
         USING doomed d
         WHERE b.key = d.object_key
        RETURNING b.key, length(b.body) AS blob_bytes
    ),
    meta AS (
        DELETE FROM run_payloads p
         USING doomed d
         WHERE p.ref = d.ref
        RETURNING p.size_bytes
    )
    SELECT COALESCE((SELECT count(*) FROM meta), 0),
           COALESCE((SELECT SUM(size_bytes) FROM meta), 0)
         + COALESCE((SELECT SUM(blob_bytes) FROM blobs), 0)
      INTO rows_deleted, bytes_freed;

    RETURN NEXT;
END;
$$;

/**
 * Delete one bounded batch of a workspace's expired RUNS.
 *
 * The ~20 tables with `ON DELETE CASCADE` on `agent_runs` go with them, which is
 * the entire point of doing it here rather than enumerating children: a child
 * table added next year is covered by its own foreign key, and a list in Kotlin
 * would not be.
 *
 * `ctid`-free and offset-free: the batch is chosen by `created_at`, the same
 * predicate that decides expiry, so a partially completed run of this is
 * indistinguishable from one that had less to do.
 */
CREATE OR REPLACE FUNCTION retention_purge_runs(
    p_workspace_id UUID,
    p_cutoff       TIMESTAMPTZ,
    p_limit        INTEGER DEFAULT 1000
) RETURNS BIGINT
LANGUAGE plpgsql VOLATILE AS $$
DECLARE
    n BIGINT;
BEGIN
    WITH doomed AS (
        SELECT r.id FROM agent_runs r
         WHERE r.workspace_id = p_workspace_id
           AND r.created_at < p_cutoff
           -- Never delete a run that is still going. A sweep that removed a
           -- running row would orphan its lease, its checkpoint and its queue
           -- message, and the reconciler would spend the rest of the day
           -- looking for it.
           AND r.status IN ('succeeded','failed','cancelled','expired')
         ORDER BY r.created_at
         LIMIT p_limit
    )
    DELETE FROM agent_runs a USING doomed d WHERE a.id = d.id;
    GET DIAGNOSTICS n = ROW_COUNT;
    RETURN n;
END;
$$;

/**
 * Delete one bounded batch of a workspace's expired events or spans.
 *
 * `p_table` is validated against a fixed list rather than interpolated, because
 * this is `format(%I)` on a caller-supplied name and the only safe version of
 * that is one where the caller cannot supply anything unexpected.
 */
CREATE OR REPLACE FUNCTION retention_purge_trace_rows(
    p_workspace_id UUID,
    p_table        TEXT,
    p_cutoff       TIMESTAMPTZ,
    p_limit        INTEGER DEFAULT 10000
) RETURNS BIGINT
LANGUAGE plpgsql VOLATILE AS $$
DECLARE
    n   BIGINT;
    key TEXT;
BEGIN
    IF p_table NOT IN ('run_events', 'run_spans') THEN
        RAISE EXCEPTION 'retention_purge_trace_rows: unsupported table %', p_table;
    END IF;
    key := CASE p_table WHEN 'run_events' THEN 'id' ELSE 'span_id' END;

    EXECUTE format($f$
        WITH doomed AS (
            SELECT %I AS k, created_at
              FROM %I
             WHERE workspace_id = $1 AND created_at < $2
             LIMIT $3
        )
        DELETE FROM %I t USING doomed d
         WHERE t.%I = d.k AND t.created_at = d.created_at
    $f$, key, p_table, p_table, key)
    USING p_workspace_id, p_cutoff, p_limit;

    GET DIAGNOSTICS n = ROW_COUNT;
    RETURN n;
END;
$$;

COMMENT ON FUNCTION retention_purge_trace_rows(UUID, TEXT, TIMESTAMPTZ, INTEGER) IS
    'Bounded per-workspace row deletion inside a RETAINED partition. This is for '
    'correctness, not storage: measured at V061, a row delete returns no bytes to '
    'the OS until the partition is dropped. See docs/RETENTION.md §3.';
