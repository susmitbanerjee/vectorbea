-- =============================================================================
-- V020__execution_class.sql
--
-- Types the run queue. Until now a stream message carried {runId, jobType} and
-- nothing about execution class, so a worker had to XREADGROUP first and probe
-- Postgres afterwards to learn what it had taken. If the batch turned out to be
-- agent-heavy and the agent pool was full, those messages sat in that worker's
-- PEL where no other worker could reach them — head-of-line blocking relocated
-- from the thread pool into the stream itself.
--
-- Classifying before the enqueue removes the problem by construction: each pool
-- consumes only its own stream, so a worker can never hold a message it is not
-- able to run.
--
-- Safe to apply ahead of any code change:
--   * both columns have defaults, so existing INSERTs keep working;
--   * nothing reads the columns until the API and worker are deployed;
--   * rollback is a DROP COLUMN (see docs/architecture/TYPED-QUEUE-MIGRATION.md).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- agent_runs.execution_class
--
-- 'short' is the safe default: it is the smallest claim we can make about an
-- unknown workflow, and a misfiled short run costs throughput, never isolation.
-- ---------------------------------------------------------------------------
ALTER TABLE agent_runs
    ADD COLUMN IF NOT EXISTS execution_class TEXT NOT NULL DEFAULT 'short';

-- Partial index: the scheduler only ever asks "what is waiting, by class?", and
-- terminal runs vastly outnumber pending ones. Restricting to the pending
-- statuses keeps this index small enough to stay in cache as agent_runs grows.
CREATE INDEX IF NOT EXISTS agent_runs_class_status_idx
    ON agent_runs (execution_class, status)
    WHERE status IN ('queued', 'yielded');

-- ---------------------------------------------------------------------------
-- workflow_versions.execution_class
--
-- A version's graph is immutable, so its classification is immutable too. This
-- is a permanent memo, not a cache with a TTL: computed once, on the first
-- trigger of that version, and read by every later trigger — including from a
-- cold API instance that has no in-process cache yet.
--
-- NULL means "not yet classified", which is distinct from 'short'.
-- ---------------------------------------------------------------------------
ALTER TABLE workflow_versions
    ADD COLUMN IF NOT EXISTS execution_class TEXT;

COMMENT ON COLUMN workflow_versions.execution_class IS
    'Execution class derived from graph_json. Immutable per version — computed '
    'once at first trigger and reused. NULL = not yet classified.';

COMMENT ON COLUMN agent_runs.execution_class IS
    'Which typed stream and worker pool this run belongs to: short | long | '
    'agent | system. Materialised at trigger so the worker never has to probe.';

-- ---------------------------------------------------------------------------
-- Backfill
--
-- Only runs that are still pending matter: a terminal run is never re-enqueued,
-- so its class is decoration. Bounding the UPDATE to pending rows keeps this
-- migration fast on a large agent_runs table and avoids a full-table rewrite.
--
-- The heuristic below is deliberately cruder than the API classifier — it exists
-- so in-flight work lands in a sensible pool during the deploy, not to be
-- authoritative. Anything it cannot judge stays 'short', which is the value the
-- column already defaults to.
-- ---------------------------------------------------------------------------
UPDATE agent_runs ar
   SET execution_class = CASE
           WHEN wv.graph_json::text ~* '"type"\s*:\s*"(llm|agent)"' THEN 'agent'
           WHEN wv.graph_json::text ~* '"type"\s*:\s*"(http|http_tool|db_query|db_read|db_write|tool)"' THEN 'long'
           ELSE 'short'
       END
  FROM workflow_versions wv
 WHERE wv.id = ar.workflow_version_id
   AND ar.status IN ('queued', 'yielded')
   AND ar.execution_class = 'short';

-- Memoise the same judgement on the version rows so the first post-deploy
-- trigger of an existing workflow does not have to re-parse graph_json.
UPDATE workflow_versions
   SET execution_class = CASE
           WHEN graph_json::text ~* '"type"\s*:\s*"(llm|agent)"' THEN 'agent'
           WHEN graph_json::text ~* '"type"\s*:\s*"(http|http_tool|db_query|db_read|db_write|tool)"' THEN 'long'
           ELSE 'short'
       END
 WHERE execution_class IS NULL;
