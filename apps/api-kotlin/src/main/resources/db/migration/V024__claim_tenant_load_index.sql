-- V024 — index the claim's tenant-load scan.
--
-- The claim runs on every wakeup, on every worker, for every execution class.
-- Its `tenant_load` CTE aggregates the runs a workspace currently occupies, and
-- without an index that is a sequential scan of `agent_runs` — a table that grows
-- forever while the set it is looking for stays tiny (a few rows per active
-- workspace). Exactly the shape a partial index is for.
--
-- Partial on the two in-flight statuses, so the index holds only live work and
-- stays small no matter how much run history accumulates. Unlike V021, the
-- predicate here is over a constant set rather than `now()`, so it is IMMUTABLE
-- and Postgres accepts it.

CREATE INDEX IF NOT EXISTS agent_runs_tenant_load_idx
    ON agent_runs (workspace_id, execution_class, claimed_at)
    WHERE status IN ('claimed', 'running');

COMMENT ON INDEX agent_runs_tenant_load_idx IS
    'Per-tenant in-flight count for the Postgres claim admission check. Partial '
    'on status so it covers only live work; see PostgresClaim.CLAIM_SQL.';
