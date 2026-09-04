-- V028 — partition run_events monthly, with detach-and-drop retention.
--
-- Its own migration, deliberately. §4.6 is right that this table is on the write
-- path for every step and the read path for every run detail view, and will become
-- the largest and hottest. It is also the reason this cannot be folded in with
-- other DDL: converting a populated table to partitioned needs either an ACCESS
-- EXCLUSIVE lock for the whole rewrite, or a create/backfill/swap. Either way it
-- wants its own window and its own rehearsal.
--
-- WHAT THIS MIGRATION DOES
-- ------------------------
-- Creates the partitioned structure and the machinery around it, and — only when
-- the existing table is small enough to move safely — performs the swap. On a
-- large table it stops and leaves the existing table in place, logging what to
-- run. That is the honest behaviour: a migration that silently takes a
-- multi-minute write lock on the hottest table in the system is worse than one
-- that declines and says so.
--
-- ATTACHING THE OLD DATA INSTEAD OF COPYING IT
-- --------------------------------------------
-- The old table becomes the "historical" partition rather than being copied row by
-- row. That is O(1) rather than O(rows): no rewrite, no doubled disk, and the
-- data is queryable throughout. It costs one open-ended partition that retention
-- will not drop, which is the right trade — history predating partitioning is
-- finite and shrinks to nothing as retention advances.

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. Partition management
-- ═══════════════════════════════════════════════════════════════════════════

/**
 * Ensure the partition for a given month exists.
 *
 * Idempotent, so the scheduled call can run as often as it likes. Called ahead of
 * time for next month as well: a write arriving with no partition to land in
 * fails, and "the first insert after midnight on the 1st errors" is a bad way to
 * find out the maintenance job stopped.
 */
CREATE OR REPLACE FUNCTION run_events_ensure_partition(target DATE)
RETURNS TEXT AS $$
DECLARE
    start_at DATE := date_trunc('month', target)::date;
    end_at   DATE := (date_trunc('month', target) + interval '1 month')::date;
    part     TEXT := 'run_events_' || to_char(start_at, 'YYYY_MM');
BEGIN
    IF to_regclass('public.' || part) IS NOT NULL THEN
        RETURN part || ' (exists)';
    END IF;

    EXECUTE format(
        'CREATE TABLE %I PARTITION OF run_events FOR VALUES FROM (%L) TO (%L)',
        part, start_at, end_at);

    -- Indexes are created on the parent and inherit to partitions automatically,
    -- so nothing further is needed here. Stated explicitly because the opposite
    -- assumption produces a partition that silently sequential-scans.
    RETURN part || ' (created)';
END;
$$ LANGUAGE plpgsql;

/**
 * Retention: detach, then drop.
 *
 * Detach first so the drop is not holding a lock the parent's readers are waiting
 * behind — a DROP of an attached partition takes ACCESS EXCLUSIVE on the parent,
 * which stalls every timeline query in flight. Detached, the drop touches nothing
 * anyone is reading.
 *
 * Driven by the LONGEST log_retention_days across workspaces. Per-workspace
 * retention cannot be honoured by a time-partitioned table — a partition holds
 * every workspace's events for that month — so the choice is: keep until the most
 * generous plan allows deletion, or delete someone's data early. Keeping is the
 * only defensible one. Per-workspace enforcement, if it is ever needed for
 * compliance rather than cost, is a row-level delete job and a different design.
 */
CREATE OR REPLACE FUNCTION run_events_drop_expired_partitions()
RETURNS TABLE(dropped TEXT) AS $$
DECLARE
    keep_days  INTEGER;
    cutoff     DATE;
    part       RECORD;
BEGIN
    SELECT COALESCE(MAX(log_retention_days), 30) INTO keep_days
      FROM workspace_usage_policies;

    -- One month of slack beyond the retention window: a partition is only dropped
    -- once its NEWEST row is past retention, never merely its oldest.
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
    'Detach-and-drop retention driven by the longest workspace log_retention_days. '
    'Detach precedes drop so the drop is not holding a lock readers wait behind.';

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. The conversion
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Guarded by size. Below the threshold the swap is quick enough to do inline;
-- above it, this migration declines and prints the procedure, because taking an
-- unbounded write lock on this table during an automated deploy is not a decision
-- a migration should make on an operator's behalf.

DO $$
DECLARE
    row_estimate  BIGINT;
    max_inline    CONSTANT BIGINT := 5000000;   -- ~5M rows
    already_part  BOOLEAN;
BEGIN
    SELECT EXISTS (
        SELECT 1 FROM pg_partitioned_table pt
          JOIN pg_class c ON c.oid = pt.partrelid
         WHERE c.relname = 'run_events'
    ) INTO already_part;

    IF already_part THEN
        RAISE NOTICE 'run_events is already partitioned - nothing to do';
        RETURN;
    END IF;

    SELECT COALESCE(reltuples::bigint, 0) INTO row_estimate
      FROM pg_class WHERE relname = 'run_events';

    IF row_estimate > max_inline THEN
        RAISE WARNING
            'run_events has ~% rows - SKIPPING automatic conversion. Converting '
            'inline would hold ACCESS EXCLUSIVE on the hottest table in the system '
            'for the duration. Run the conversion in a maintenance window: rename '
            'the table to run_events_historical, create the partitioned parent, '
            'ATTACH the historical table as an open-ended partition, then call '
            'run_events_ensure_partition() for the current and next month. See '
            'TECH-DEBT D22.', row_estimate;
        RETURN;
    END IF;

    RAISE NOTICE 'Converting run_events (~% rows) to a partitioned table', row_estimate;

    -- The old table becomes the historical partition. O(1), not a row copy.
    ALTER TABLE run_events RENAME TO run_events_historical;

    -- Constraints and indexes follow their table through a rename, so every name
    -- the new parent needs is still taken by the old table. Renamed out of the way
    -- rather than dropped: dropping them would leave the historical partition
    -- unindexed for the rest of its life, and it stays queryable until retention
    -- removes it.
    ALTER TABLE run_events_historical RENAME CONSTRAINT run_events_pkey TO run_events_historical_pkey;

    -- Loop rather than a list: the set of indexes on this table has grown over
    -- eight migrations and hard-coding today's names would break the next time one
    -- is added.
    DECLARE idx RECORD;
    BEGIN
        FOR idx IN
            SELECT c.relname
              FROM pg_class c
              JOIN pg_index i ON i.indexrelid = c.oid
              JOIN pg_class t ON t.oid = i.indrelid
             WHERE t.relname = 'run_events_historical'
               AND c.relname NOT LIKE 'run_events_historical%'
        LOOP
            EXECUTE format('ALTER INDEX %I RENAME TO %I',
                idx.relname, 'hist_' || idx.relname);
        END LOOP;
    END;

    -- EXECUTE, not a bare statement, for everything below that names `run_events`.
    --
    -- PL/pgSQL caches the parsed plan of a static SQL statement against the OID it
    -- resolved at first execution. After the rename above, a bare
    -- `ALTER TABLE run_events ...` still resolves to the OLD table — which is how
    -- "multiple primary keys for run_events_historical" appears from a statement
    -- that plainly says `run_events`. EXECUTE re-parses each time and sees the new
    -- table.
    EXECUTE 'CREATE TABLE run_events (
                LIKE run_events_historical INCLUDING DEFAULTS INCLUDING CONSTRAINTS
             ) PARTITION BY RANGE (created_at)';

    -- The primary key must include the partition key: Postgres cannot enforce
    -- uniqueness across partitions without it. Same for the (run_id, sequence)
    -- uniqueness the event stream depends on — which means that constraint now
    -- guarantees uniqueness *within a month* rather than globally.
    --
    -- That is acceptable here and worth being explicit about: `sequence` is
    -- assigned per run and a single run does not span a month boundary in any
    -- realistic case. A run that did could in principle reuse a sequence number.
    -- The alternative — keeping a global unique index — is not available on a
    -- partitioned table at all.
    EXECUTE 'ALTER TABLE run_events ADD PRIMARY KEY (id, created_at)';

    EXECUTE 'CREATE INDEX run_events_run_seq_idx ON run_events (run_id, sequence)';
    EXECUTE 'CREATE INDEX run_events_run_ts_idx ON run_events (run_id, "timestamp")';
    EXECUTE 'CREATE INDEX run_events_type_idx ON run_events (run_id, type)';
    EXECUTE 'CREATE INDEX run_events_workspace_idx ON run_events (workspace_id)';
    EXECUTE 'CREATE INDEX run_events_timeline_covering_idx
                ON run_events (run_id, sequence)
                INCLUDE (type, status, "timestamp", duration_ms, step_id, title)';

    -- Foreign keys INTO run_events cannot survive partitioning.
    --
    -- Postgres can only accept a foreign key referencing a partitioned table if
    -- the referenced columns carry a unique constraint on the parent — and a
    -- unique constraint on a partitioned table must include the partition key. So
    -- `run_event_logs.run_event_id -> run_events.id` is unsatisfiable once
    -- run_events is partitioned by created_at, whatever we do.
    --
    -- The choices are: add created_at to run_event_logs and make the key
    -- composite, or drop the constraint and keep the column. The composite route
    -- means backfilling every existing log row from its parent event and changing
    -- a table nothing else asked to change; the drop means referential integrity
    -- for run_event_logs moves to the application, where it already effectively
    -- lives — rows are written by the same code path that writes the event.
    --
    -- Dropping, with the index kept so the lookup is unaffected. Recorded as D23
    -- because "we dropped a foreign key" should never be a silent line in a
    -- migration.
    EXECUTE 'ALTER TABLE run_event_logs DROP CONSTRAINT IF EXISTS run_event_logs_run_event_id_fkey';
    EXECUTE 'CREATE INDEX IF NOT EXISTS run_event_logs_event_idx ON run_event_logs (run_event_id)';

    -- The historical table's own primary key must go before it can be attached.
    --
    -- A partition cannot carry a primary key that differs from its parent's, and
    -- the parent's must include the partition key (created_at) — Postgres cannot
    -- enforce uniqueness across partitions otherwise. The historical PK is on
    -- (id) alone, so ATTACH refuses it with "multiple primary keys", naming the
    -- partition rather than the parent, which is a confusing way to learn this.
    --
    -- Dropping the constraint keeps the data and the index: the rows already in
    -- the table are already unique, `id` is a generated uuid so a collision is not
    -- a realistic failure mode, and nothing new lands in this partition because
    -- created_at defaults to now(). The index is retained below for lookups.
    EXECUTE 'ALTER TABLE run_events_historical DROP CONSTRAINT run_events_historical_pkey';
    EXECUTE 'CREATE INDEX IF NOT EXISTS hist_run_events_id_idx ON run_events_historical (id)';

    -- Open-ended lower bound, upper bound at the END of the current month.
    --
    -- Not the start of the current month, which is the obvious choice and is
    -- wrong: rows written earlier today already exist, and ATTACH validates every
    -- row against the bound. Cutting at the start of this month rejects them with
    -- "partition constraint is violated by some row" and the conversion fails.
    --
    -- Ending the historical partition at the next month boundary means today's
    -- data stays where it is and clean monthly partitions begin next month. No row
    -- moves, and the only cost is that the current month is not independently
    -- droppable — which does not matter, because it is far too recent for
    -- retention to touch anyway.
    EXECUTE format(
        'ALTER TABLE run_events ATTACH PARTITION run_events_historical '
        'FOR VALUES FROM (MINVALUE) TO (%L)',
        (date_trunc('month', now()) + interval '1 month')::date);

    PERFORM run_events_ensure_partition((now() + interval '1 month')::date);
    PERFORM run_events_ensure_partition((now() + interval '2 months')::date);

    RAISE NOTICE 'run_events partitioned; historical data attached as run_events_historical';
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. Payload offload above 256KB (§4.6)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Reuses `payload_blobs` from V026 rather than inventing a second offload
-- mechanism. One store, one key format, one thing to migrate when R2 arrives.

ALTER TABLE run_events
    ADD COLUMN IF NOT EXISTS input_payload_key  TEXT,
    ADD COLUMN IF NOT EXISTS output_payload_key TEXT;

COMMENT ON COLUMN run_events.output_payload_key IS
    'payload_blobs key when the output exceeded the 256KB inline ceiling. Exactly '
    'one of output_json_sanitized / output_payload_key is populated.';

