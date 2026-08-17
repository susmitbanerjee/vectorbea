-- =============================================================================
-- V021__shared_tenant_fairness.sql
--
-- Moves per-tenant admission from in-process JVM state onto shared state.
--
-- TenantConcurrencyLimiter counted active runs in a HashMap, so every limit was
-- enforced once per replica: with maxActiveAgentRunsPerTenant = 1 and three
-- replicas, one workspace could run three concurrent agent runs. That is why
-- scaling out — the fix the architecture review recommends — introduced a
-- fairness bug (§1.3).
--
-- The shared registry already exists. `run_leases` holds one row per actively
-- executing run, with workspace_id and expires_at. It is authoritative,
-- cluster-wide, and self-healing: a worker that dies stops renewing and its
-- leases fall out of the count on their own (§2.2).
--
-- Three changes:
--   1. an index to make the admission count cheap
--   2. per-workspace concurrency limits, so limits become policy rather than
--      global constants
--   3. undo V006's workspace-scoping of `workers`, which has been silently
--      preventing every heartbeat write since it landed
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Admission index
--
-- NOTE ON THE PREDICATE. 09-EXECUTION-ARCHITECTURE-REVISED §2.2 proposes:
--
--     CREATE INDEX run_leases_tenant_active_idx
--       ON run_leases (workspace_id, expires_at) WHERE expires_at > now();
--
-- That statement cannot execute. Postgres requires index predicates to be
-- IMMUTABLE, and now() is STABLE — it errors with "functions in index predicate
-- must be marked IMMUTABLE". V009 hit exactly this and left a comment about it
-- when adding idx_run_leases_expires.
--
-- A plain composite index serves the admission query just as well: the planner
-- seeks on workspace_id and range-scans expires_at, so the leading equality
-- column does the selective work and expired rows are skipped in the same scan.
-- The only thing lost is not indexing already-expired leases, which are deleted
-- by the recovery sweep anyway.
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS run_leases_tenant_active_idx
    ON run_leases (workspace_id, expires_at);

COMMENT ON INDEX run_leases_tenant_active_idx IS
    'Serves per-tenant admission: SELECT count(*) FROM run_leases WHERE '
    'workspace_id = ? AND expires_at > now(). Not partial — now() is STABLE, '
    'not IMMUTABLE, so it cannot appear in an index predicate.';

-- ---------------------------------------------------------------------------
-- 2. Per-workspace concurrency limits
--
-- These were global constants in worker env vars (MAX_ACTIVE_*_RUNS_PER_TENANT),
-- which meant every workspace on the platform shared one policy and changing it
-- for one customer required a redeploy for all of them.
--
-- Defaults reproduce the previous global constants exactly, so applying this
-- migration changes no workspace's behaviour.
-- ---------------------------------------------------------------------------
ALTER TABLE workspace_usage_policies
    ADD COLUMN IF NOT EXISTS max_concurrent_runs        INTEGER NOT NULL DEFAULT 2,
    ADD COLUMN IF NOT EXISTS max_concurrent_agent_runs  INTEGER NOT NULL DEFAULT 1,
    ADD COLUMN IF NOT EXISTS max_concurrent_long_runs   INTEGER NOT NULL DEFAULT 1,
    ADD COLUMN IF NOT EXISTS max_concurrent_short_runs  INTEGER NOT NULL DEFAULT 4;

COMMENT ON COLUMN workspace_usage_policies.max_concurrent_runs IS
    'Platform-wide cap on this workspace''s simultaneously executing runs, '
    'enforced against run_leases across every replica.';
COMMENT ON COLUMN workspace_usage_policies.max_concurrent_agent_runs IS
    'Per-class cap for agent runs — the scarcest pool.';

-- ---------------------------------------------------------------------------
-- 3. `workers` is fleet infrastructure, not a tenant resource
--
-- V006 made workers.workspace_id NOT NULL as part of a workspace-scoping pass.
-- But a worker process is not owned by a workspace: it serves every tenant on
-- the queue, and it has no workspace to name at boot. WorkerHeartbeat's UPSERT
-- omits the column, so since V006 EVERY heartbeat write has failed with a
-- not-null violation, silently — the failure is caught and logged at WARN, and
-- the loop continues.
--
-- That is why §6.5 describes `workers` as "unused telemetry": nothing has been
-- able to write to it. Reverting to nullable is what makes the fleet endpoint
-- possible at all.
-- ---------------------------------------------------------------------------
ALTER TABLE workers ALTER COLUMN workspace_id DROP NOT NULL;
ALTER TABLE workers ALTER COLUMN environment_id DROP NOT NULL;

COMMENT ON COLUMN workers.workspace_id IS
    'NULL for shared fleet workers, which is the normal case. Non-null only for '
    'a dedicated worker pinned to one workspace. V006 briefly made this NOT NULL, '
    'which silently broke every heartbeat write until V021.';

-- Heartbeat freshness is the primary fleet query ("which workers are alive?").
CREATE INDEX IF NOT EXISTS workers_heartbeat_idx
    ON workers (last_heartbeat_at DESC);
