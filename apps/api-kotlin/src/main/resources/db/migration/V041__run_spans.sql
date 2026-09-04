-- =============================================================================
-- V041__run_spans.sql
--
-- The causal half of the trace: a tree of spans per run, alongside the ordered
-- event log that already exists.
--
-- Per docs/AGENT-TRACE-AND-DEBUGGER.md §2 and §3, with two corrections to the
-- DDL as written there — see below. No UI in this phase; this is the data model
-- and the write path only.
--
-- `run_payloads` is NOT created here. It shipped in V040 with the agent loop
-- reconstruction work, which needed somewhere to put an observation payload
-- first. Spans reference the same store — that two features share it is the
-- entire point of content addressing.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. run_spans
--
-- ── CORRECTION 1: THE PRIMARY KEY MUST INCLUDE created_at ───────────────────
--
-- The design doc specifies `span_id uuid PRIMARY KEY` together with
-- `PARTITION BY RANGE (created_at)`. Postgres rejects that combination: a unique
-- constraint on a partitioned table must include every partition-key column.
--
-- This is not a new discovery. V028 hit it partitioning run_events and used
-- `PRIMARY KEY (id, created_at)`; its comment says so in as many words. The same
-- shape is used here. `span_id` stays the leading column, so a lookup by span_id
-- alone still uses the index.
--
-- ── CORRECTION 2: A DEFAULT PARTITION ───────────────────────────────────────
--
-- Without one, a write arriving when no monthly partition covers now() does not
-- degrade — it errors, and every span in that flush batch is lost. With one, a
-- lapsed maintenance job costs query speed instead of data.
--
-- It must be MONITORED. A default partition that quietly accumulates is how you
-- find out three weeks late that the maintenance job died. The row count is
-- exposed by run_spans_default_partition_rows() below.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS run_spans (
    span_id         UUID        NOT NULL,
    trace_id        UUID        NOT NULL,        -- = run_id of the root run
    run_id          UUID        NOT NULL,
    parent_span_id  UUID,
    workspace_id    UUID        NOT NULL,

    kind            TEXT        NOT NULL,
    name            TEXT        NOT NULL,        -- "researcher", "crm.search"
    status          TEXT        NOT NULL,        -- ok|error|paused|skipped|cancelled|running

    step_id         TEXT,
    activation_id   UUID,                        -- unwritten until P6
    iteration_index INTEGER,
    attempt         INTEGER     NOT NULL DEFAULT 1,

    started_at      TIMESTAMPTZ NOT NULL,
    ended_at        TIMESTAMPTZ,
    duration_ms     INTEGER,
    self_ms         INTEGER,                     -- duration minus time in children

    attributes_json JSONB       NOT NULL DEFAULT '{}',   -- sanitized, small, filterable
    input_ref       TEXT,                        -- → run_payloads.ref
    output_ref      TEXT,                        -- → run_payloads.ref
    error_json      JSONB,                       -- sanitized
    failure_class   TEXT,
    is_root_cause   BOOLEAN     NOT NULL DEFAULT false,

    tokens_in       INTEGER,
    tokens_out      INTEGER,
    cost_cents      NUMERIC(10,4),

    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

    PRIMARY KEY (span_id, created_at)
) PARTITION BY RANGE (created_at);

-- No FOREIGN KEY to agent_runs, deliberately. Spans are observability: a trace
-- must never be able to block or fail the run it describes, and an FK turns a
-- late-arriving span for a deleted run into a write error on the hot path.

CREATE INDEX IF NOT EXISTS idx_run_spans_trace     ON run_spans (trace_id, started_at);
CREATE INDEX IF NOT EXISTS idx_run_spans_tree      ON run_spans (run_id, parent_span_id);
CREATE INDEX IF NOT EXISTS idx_run_spans_failures  ON run_spans (workspace_id, failure_class, created_at DESC)
    WHERE status = 'error';

COMMENT ON TABLE run_spans IS
    'Causal trace tree. parent_span_id + timestamps are sufficient to build it — '
    'spans deliberately have NO global sequence, so writing one never takes the '
    'run-row lock that run_events.sequence requires.';

COMMENT ON COLUMN run_spans.self_ms IS
    'Duration minus time in children. NULL where self-time is meaningless — notably '
    'the root `run` span, whose direct children (tick and wait) tile its whole '
    'timeline, so its self_ms would always be ~0: correct, and useless.';

COMMENT ON COLUMN run_spans.activation_id IS
    'Unwritten until P6. Present now so that phase alters an existing column.';

-- ---------------------------------------------------------------------------
-- 2. Partitions
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION run_spans_ensure_partition(target DATE)
RETURNS TEXT AS $$
DECLARE
    start_at DATE := date_trunc('month', target)::date;
    end_at   DATE := (date_trunc('month', target) + interval '1 month')::date;
    part     TEXT := 'run_spans_' || to_char(start_at, 'YYYY_MM');
BEGIN
    IF to_regclass('public.' || part) IS NOT NULL THEN
        RETURN part || ' (exists)';
    END IF;
    EXECUTE format(
        'CREATE TABLE %I PARTITION OF run_spans FOR VALUES FROM (%L) TO (%L)',
        part, start_at, end_at);
    RETURN part || ' (created)';
END;
$$ LANGUAGE plpgsql;

/**
 * Retention: detach, then drop.
 *
 * Detach first so the drop is not holding a lock the parent's readers wait behind.
 * Driven by the longest workspace log_retention_days, with a month of slack, so a
 * partition is dropped only once its NEWEST row is past retention.
 *
 * Mirrors run_events_drop_expired_partitions deliberately: one shape for both
 * tables, so the scheduled job that calls them is one code path.
 */
CREATE OR REPLACE FUNCTION run_spans_drop_expired_partitions()
RETURNS TABLE(dropped TEXT) AS $$
DECLARE
    keep_days INTEGER;
    cutoff    DATE;
    part      RECORD;
BEGIN
    SELECT COALESCE(MAX(log_retention_days), 30) INTO keep_days
      FROM workspace_usage_policies;
    cutoff := (date_trunc('month', now()) - make_interval(days => keep_days) - interval '1 month')::date;

    FOR part IN
        SELECT c.relname
          FROM pg_class c
          JOIN pg_inherits i ON i.inhrelid = c.oid
          JOIN pg_class p ON p.oid = i.inhparent
         WHERE p.relname = 'run_spans'
           AND c.relname ~ '^run_spans_[0-9]{4}_[0-9]{2}$'
           AND to_date(substring(c.relname from 11), 'YYYY_MM') < cutoff
    LOOP
        EXECUTE format('ALTER TABLE run_spans DETACH PARTITION %I', part.relname);
        EXECUTE format('DROP TABLE %I', part.relname);
        dropped := part.relname;
        RETURN NEXT;
    END LOOP;
END;
$$ LANGUAGE plpgsql;

/**
 * Rows sitting in the DEFAULT partition.
 *
 * Should be zero. Anything above it means the maintenance job has not created the
 * month it needed, and the trace is still being captured but into the slow path.
 * A default partition nobody watches is a silent degradation.
 */
CREATE OR REPLACE FUNCTION run_spans_default_partition_rows()
RETURNS BIGINT AS $$
DECLARE n BIGINT;
BEGIN
    IF to_regclass('public.run_spans_default') IS NULL THEN RETURN 0; END IF;
    EXECUTE 'SELECT count(*) FROM run_spans_default' INTO n;
    RETURN n;
END;
$$ LANGUAGE plpgsql;

DO $$
BEGIN
    EXECUTE 'CREATE TABLE IF NOT EXISTS run_spans_default PARTITION OF run_spans DEFAULT';
    PERFORM run_spans_ensure_partition(now()::date);
    PERFORM run_spans_ensure_partition((now() + interval '1 month')::date);
    PERFORM run_spans_ensure_partition((now() + interval '2 months')::date);
END $$;

-- ---------------------------------------------------------------------------
-- 3. run_payload_blobs — the bytes, separate from the metadata row
--
-- run_payloads holds the metadata (ref, size, redactions, expiry); this holds the
-- content for anything too large to inline. Two tables rather than one wide one so
-- the two are INDEPENDENTLY SWAPPABLE: P12 moves this to object storage by
-- replacing one BlobStore implementation, and run_payloads does not change at all.
-- A single table with a bytes column would make "swap the backing store later" a
-- migration rather than a class.
--
-- THIS IS STILL POSTGRES. A row with storage='object' is NOT off the primary
-- database yet — it is in this table. The column records intent and the seam is
-- real, but nobody should read storage='object' and conclude their bytes are in a
-- bucket. P12 makes that true.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS run_payload_blobs (
    key         TEXT        PRIMARY KEY,   -- = run_payloads.ref
    body        TEXT        NOT NULL,      -- UTF-8; redacted before it ever got here
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE run_payload_blobs IS
    'Interim object tier for run_payloads. Postgres-backed until P12 swaps the '
    'BlobStore implementation for real object storage. Keyed by the same sha256 '
    'ref as run_payloads, so the two are joined by content address, not by FK — '
    'which is what lets the bytes move without touching the metadata.';

-- ---------------------------------------------------------------------------
-- 4. run_events gains its place in the tree
--
-- Nullable, no default, no backfill, and NOT a foreign key. An FK into a
-- partitioned table would have to include the partition key, exactly as the PK
-- does — V028 already had to drop an FK for this reason. Events and spans are
-- joined in the reader, not by a constraint.
-- ---------------------------------------------------------------------------
ALTER TABLE run_events
    ADD COLUMN IF NOT EXISTS span_id       UUID,
    ADD COLUMN IF NOT EXISTS activation_id UUID;

COMMENT ON COLUMN run_events.span_id IS
    'Which span this event happened inside, so any log line can be located in the '
    'tree. Plain uuid, not an FK — see the migration notes.';
