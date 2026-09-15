-- ═══════════════════════════════════════════════════════════════════════════
-- V069 — CHECKPOINTS HAVE NEVER BEEN WRITTEN
--
-- ── HOW THIS WAS FOUND ────────────────────────────────────────────────────
-- By driving a 200-tick run against a real database instead of reasoning about
-- it. Every `CheckpointStore.save` throws:
--
--     ERROR: column "workspace_id" of relation "run_checkpoints" does not exist
--
-- ── AND WHY NOBODY NOTICED ────────────────────────────────────────────────
-- `run_checkpoints` has TWO definitions:
--
--   · V001, this one, with `workflow_id`, `step_id`, `state_json_sanitized`;
--   · `Database.ensureCheckpointsTable` in the worker, with `workspace_id`,
--     `environment_id`, `node_id`, `snapshot_json` — the shape the writer uses.
--
-- The worker's is `CREATE TABLE IF NOT EXISTS`, so in every environment where
-- Flyway ran first — which is all of them — it is a no-op. The writer targets a
-- table that exists nowhere, and `WorkflowRuntime.writeCheckpoint` wraps the
-- call in `runCatching { } .onFailure { log.warn }`. So the failure has been a
-- warning line, on every checkpoint, of every run, since the feature shipped.
--
-- The consequence is not a missing feature; it is a silent one. A run that
-- yields, parks on an approval or waits for a signal resumes with
-- `loadLatest` finding nothing and REPLAYS FROM THE BEGINNING. Every node
-- re-executes. Only `StepExecutionGuard` and `SideEffectGuard` have stood
-- between that and duplicate side effects in production — which is exactly the
-- window they were written for, doing far more work than anyone intended.
--
-- ── THE FIX IS FORWARD-ONLY ───────────────────────────────────────────────
-- The columns the writer uses are added; the V001 columns no writer populates
-- lose their NOT NULL. Nothing is dropped: old rows (if any environment has
-- them) stay readable, and the shadow DDL in the worker is deleted in the same
-- commit so there is one definition again.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE run_checkpoints
    ADD COLUMN IF NOT EXISTS workspace_id   UUID,
    ADD COLUMN IF NOT EXISTS environment_id UUID,
    ADD COLUMN IF NOT EXISTS node_id        TEXT,
    ADD COLUMN IF NOT EXISTS snapshot_json  JSONB;

-- The writer does not have a workflow id — `RuntimeSnapshot` carries the
-- VERSION, which is what a resume needs, and looking the workflow up would be a
-- second query on the hot path of every committed node. A NOT NULL that the
-- only writer cannot satisfy is a table nobody can insert into.
ALTER TABLE run_checkpoints ALTER COLUMN workflow_id DROP NOT NULL;
ALTER TABLE run_checkpoints ALTER COLUMN workflow_version_id DROP NOT NULL;
ALTER TABLE run_checkpoints ALTER COLUMN step_id DROP NOT NULL;

-- Backfill what can be derived, so a row written before this migration is still
-- loadable rather than being a hole in the middle of a run's history.
UPDATE run_checkpoints
   SET node_id = COALESCE(node_id, step_id),
       snapshot_json = COALESCE(snapshot_json, state_json_sanitized)
 WHERE node_id IS NULL OR snapshot_json IS NULL;

UPDATE run_checkpoints c
   SET workspace_id = r.workspace_id,
       environment_id = r.environment_id
  FROM agent_runs r
 WHERE r.id = c.run_id
   AND c.workspace_id IS NULL;

-- `loadLatest` is `WHERE run_id = ? AND workspace_id = ? ORDER BY sequence DESC
-- LIMIT 1`, on the resume path of every parked run. It has been an index scan
-- over nothing, which is fast for the wrong reason.
CREATE INDEX IF NOT EXISTS run_checkpoints_run_seq_idx
    ON run_checkpoints (run_id, workspace_id, sequence DESC);

COMMENT ON COLUMN run_checkpoints.snapshot_json IS
    'The RuntimeSnapshot a resume restores from: node statuses, selected edges, '
    'completed and pending node ids. Sanitized at the write boundary — it holds '
    'output KEYS, never output values. Superseded state_json_sanitized, which no '
    'writer has populated since the runtime was rewritten.';

COMMENT ON COLUMN run_checkpoints.workspace_id IS
    'Scopes the resume read. Added in V069: the writer had always supplied it '
    'and the table had never had it, so every checkpoint write failed into a '
    'warning and every resume replayed the run from its first node.';
