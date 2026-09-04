-- V047 — the warm tier: a ledger of exported partitions, and the gate that stops
-- a partition being dropped before it has been exported.
--
-- ── THE ORDERING THIS EXISTS TO ENFORCE ────────────────────────────────────
-- §12.1 tiers traces: hot 7 days in Postgres, warm 90 days as columnar files in
-- object storage, cold beyond that is export-only. Partition rotation already
-- exists (V028, V041, and `PartitionMaintenance`), and it already drops rather
-- than DELETEs.
--
-- What is missing is the ORDER. `run_events_drop_expired_partitions()` decides
-- purely on age. Turn `PARTITION_DROP_ENABLED=true` before the exporter has run
-- and the warm tier is a directory of nothing while the data it was supposed to
-- hold is gone — irreversibly, because a dropped partition is not a soft delete.
--
-- So the drop becomes conditional on a row in this table. That is the whole
-- design: one ledger, written after a successful export, read before a drop.
--
-- ── WHY A LEDGER AND NOT A FLAG ON THE PARTITION ───────────────────────────
-- The partition is dropped. Anything recorded on it goes with it, including the
-- record of where its contents went. The ledger has to outlive the thing it
-- describes, which means a separate table — and it is the only remaining
-- evidence that the rows ever existed, so it keeps the row count and the byte
-- count as well as the key.

CREATE TABLE IF NOT EXISTS run_trace_archives (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- `run_events` or `run_spans`. Not an enum: a third partitioned table is a
    -- line of Kotlin, and an enum would make it a migration.
    source_table   TEXT NOT NULL,
    -- e.g. `run_events_2026_07`. Unique with the table: exporting twice is a
    -- no-op, which is what makes the whole job idempotent.
    partition_name TEXT NOT NULL,

    period_start   DATE NOT NULL,
    period_end     DATE NOT NULL,

    row_count      BIGINT NOT NULL,
    byte_count     BIGINT NOT NULL,

    -- `ndjson.gz` today; `parquet` once the encoder has an approved dependency.
    -- Stored per row rather than assumed, so a bucket holding both formats can
    -- still be read back correctly.
    format         TEXT NOT NULL,
    -- Where it is, in whatever store `ARCHIVE_STORE` names. Opaque here.
    object_key     TEXT NOT NULL,
    -- SHA-256 of the encoded bytes. The only way to know a warm file is intact
    -- once the partition backing it is gone.
    checksum       TEXT NOT NULL,

    -- 'warm' while it is expected to be readable; 'cold' once past the warm
    -- window, where the contract is export-only and no latency is promised.
    tier           TEXT NOT NULL DEFAULT 'warm',

    exported_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- Set when the partition it describes is actually dropped, so "exported" and
    -- "no longer in Postgres" stay distinguishable. They are different questions
    -- during an incident.
    dropped_at     TIMESTAMPTZ,

    CONSTRAINT run_trace_archives_unique UNIQUE (source_table, partition_name)
);

COMMENT ON TABLE run_trace_archives IS
    'One row per exported trace partition. Written after a successful export, read '
    'before a drop: PartitionMaintenance refuses to drop a partition with no row here. '
    'Outlives the partition it describes and is the only record that those rows existed.';

CREATE INDEX IF NOT EXISTS idx_run_trace_archives_tier
    ON run_trace_archives (tier, period_end);

-- Which partitions of [p_table] have NOT been exported.
--
-- Reads the same catalogue the drop function reads, so this is the drop's list
-- minus the archived ones rather than an approximation of it.
CREATE OR REPLACE FUNCTION run_trace_unarchived_partitions(p_table TEXT)
RETURNS TABLE (partition_name TEXT, period_start DATE, period_end DATE)
LANGUAGE sql
STABLE
AS $$
    SELECT c.relname::TEXT,
           to_date(substring(c.relname from '([0-9]{4}_[0-9]{2})$'), 'YYYY_MM'),
           (to_date(substring(c.relname from '([0-9]{4}_[0-9]{2})$'), 'YYYY_MM')
                + interval '1 month')::date
      FROM pg_class c
      JOIN pg_inherits i ON i.inhrelid = c.oid
      JOIN pg_class p    ON p.oid = i.inhparent
     WHERE p.relname = p_table
       AND c.relname ~ ('^' || p_table || '_[0-9]{4}_[0-9]{2}$')
       AND NOT EXISTS (
             SELECT 1 FROM run_trace_archives a
              WHERE a.source_table = p_table
                AND a.partition_name = c.relname)
     ORDER BY 2;
$$;

COMMENT ON FUNCTION run_trace_unarchived_partitions(TEXT) IS
    'Monthly partitions of p_table with no run_trace_archives row. The exporter''s '
    'work queue, and the set PartitionMaintenance must refuse to drop.';

-- Move archives past the warm window to 'cold'.
--
-- Nothing is moved or deleted — the tier is a statement about what is PROMISED.
-- Warm means "expected to be readable"; cold means "export-only, no latency
-- promised". Lifecycle rules in the bucket do the actual moving, and they need a
-- marker in the database to agree with.
CREATE OR REPLACE FUNCTION run_trace_archives_age_tiers(p_warm_days INTEGER DEFAULT 90)
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
    moved INTEGER;
BEGIN
    UPDATE run_trace_archives
       SET tier = 'cold'
     WHERE tier = 'warm'
       AND period_end < (now() - make_interval(days => GREATEST(p_warm_days, 1)))::date;
    GET DIAGNOSTICS moved = ROW_COUNT;
    RETURN moved;
END;
$$;
