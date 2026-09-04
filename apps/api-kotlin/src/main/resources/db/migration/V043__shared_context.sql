-- =============================================================================
-- V043__shared_context.sql
--
-- Two things a team needs before it can delegate anything:
--
--   1. run_context_entries — the blackboard. Agent memory is
--      (run_id, agent_id, key): an agent's PRIVATE notes, and correctly so.
--      A team needs a second thing beside it, where findings a peer can read
--      are written.
--
--   2. Workflow-scoped memory, which has been in the schema and unimplemented
--      since V010 (known limit #4). It is the difference between an agent that
--      learns across runs and one that starts cold every time.
--
-- Per docs/AGENT-HARNESS-ARCHITECTURE.md §7.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. run_context_entries — the team blackboard
--
-- ── APPEND-ONLY AND VERSIONED. NEVER UPDATED IN PLACE ──────────────────────
--
-- Three reasons, and each one is load-bearing on its own:
--
--   * Concurrent peers writing the same key do not need a lock. Two workers in
--     a fan-out both recording `findings.pricing` is the normal case, not the
--     exceptional one, and an UPDATE would serialise them behind a row lock on
--     the hot path of every team run.
--
--   * The debugger can answer "what did this agent see when it decided that",
--     by reading at the `context_version` recorded on the handoff. With
--     in-place updates that question is unanswerable: the value it read is
--     gone, overwritten by whatever came next, and the trace shows a decision
--     with no visible cause.
--
--   * A bad write is inspectable rather than lost. Rolling back means writing
--     the previous value forward as a new version, which is itself a record.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS run_context_entries (
    id             BIGSERIAL   PRIMARY KEY,
    run_id         UUID        NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
    workspace_id   UUID        NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    environment_id UUID        NOT NULL,

    -- run: visible to the whole run. team: to one agent_team node.
    -- activation: to one activation and its descendants.
    scope          TEXT        NOT NULL,
    -- The team node id or the activation id. Null only for scope='run'.
    scope_ref      TEXT,

    key            TEXT        NOT NULL,
    -- Sanitized and capped by RunContextStore before it reaches here. Same
    -- contract RunEventStore and SpanWriter take: the write boundary sanitizes,
    -- the store persists what it is given.
    value_json     JSONB       NOT NULL,

    -- Monotonic per (run_id, scope, scope_ref, key). Assigned by the writer as
    -- MAX+1 inside the insert, so two concurrent writers get two versions
    -- rather than one lost update. See uq_run_context_version below.
    version        BIGINT      NOT NULL,

    written_by     UUID        REFERENCES agent_activations(id) ON DELETE SET NULL,
    visibility     TEXT        NOT NULL DEFAULT 'team',

    -- Large values go to run_payloads and the row keeps a ref. A blackboard
    -- entry is read into a PROMPT, so an unbounded one is a context-window
    -- failure waiting to happen, not merely a storage cost.
    payload_ref    TEXT,

    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT run_context_scope_check
        CHECK (scope IN ('run','team','activation')),
    CONSTRAINT run_context_visibility_check
        CHECK (visibility IN ('public','team','private')),
    -- scope='run' has no ref; the other two must name what they are scoped to.
    CONSTRAINT run_context_scope_ref_check
        CHECK ((scope = 'run' AND scope_ref IS NULL) OR (scope <> 'run' AND scope_ref IS NOT NULL)),

    CONSTRAINT run_context_scope_ref_shape
        CHECK (scope_ref IS NULL OR length(scope_ref) BETWEEN 1 AND 200)
);

-- ── WHAT MAKES THE VERSION MONOTONIC UNDER CONCURRENCY ─────────────────────
--
-- The writer computes MAX(version)+1 and inserts. Two writers racing both
-- compute the same number; without a uniqueness rule both land, the key has two
-- rows claiming to be version 4, and "read at version 4" is silently
-- ambiguous. With it, one insert fails and retries onto the next version.
--
-- A UNIQUE INDEX over COALESCE(scope_ref,''), not a table constraint over the
-- raw column. A plain UNIQUE treats NULLs as distinct, so it would enforce
-- nothing at all for scope='run' — where scope_ref is ALWAYS null, which is
-- exactly the blackboard's most contended case.
CREATE UNIQUE INDEX IF NOT EXISTS uq_run_context_version
    ON run_context_entries (run_id, scope, COALESCE(scope_ref, ''), key, version);

-- The read: DISTINCT ON (key) … ORDER BY key, version DESC.
CREATE INDEX IF NOT EXISTS idx_run_context_latest
    ON run_context_entries (run_id, scope, key, version DESC);
-- Scope-filtered reads, which is every read a team activation makes.
CREATE INDEX IF NOT EXISTS idx_run_context_scope
    ON run_context_entries (run_id, scope, scope_ref, key, version DESC);
CREATE INDEX IF NOT EXISTS idx_run_context_writer
    ON run_context_entries (written_by) WHERE written_by IS NOT NULL;

COMMENT ON TABLE run_context_entries IS
    'The team blackboard: findings one agent writes and its peers read. '
    'Append-only and versioned — never updated in place, so concurrent peers '
    'need no lock and the debugger can read what an agent saw at the version it '
    'saw it.';

COMMENT ON COLUMN run_context_entries.version IS
    'Monotonic per (run_id, scope, scope_ref, key). uq_run_context_version is '
    'what makes it monotonic under concurrency: two writers that compute the '
    'same MAX+1 cannot both land. It is a unique INDEX over '
    'COALESCE(scope_ref,'''') rather than a table constraint, because a plain '
    'UNIQUE treats NULLs as distinct and would enforce nothing for scope=''run''.';

COMMENT ON COLUMN run_context_entries.visibility IS
    'public: any activation in the run. team: activations under the same team '
    'node. private: only the writing activation and its descendants. Filtered in '
    'the read query, never after — a value that reaches the process has already '
    'reached a prompt in every code path that matters.';

-- ---------------------------------------------------------------------------
-- 2. Workflow-scoped memory
--
-- `memory_scope` has allowed 'workflow_scoped' since V010 and nothing has ever
-- written it, because the table has no way to ADDRESS a workflow: reads are
-- (run_id, agent_id), and a run-keyed read cannot find anything an earlier run
-- wrote. Three columns fix that.
--
-- ── WHY THE CAP AND THE RETENTION SHIP IN THE SAME MIGRATION ───────────────
-- Memory that outlives its run is an unbounded prompt-growth vector: every run
-- adds entries, every subsequent run reads them, and the prompt grows until the
-- context window fails — slowly, in production, on the workflows that are used
-- most. `expires_at` is the retention half. The count cap is enforced by
-- AgentMemoryStore at write time, because "keep the newest N per (workflow,
-- agent)" is not expressible as a constraint.
-- ---------------------------------------------------------------------------

-- Which workflow this memory belongs to. Null for run-scoped rows, which is
-- every row written before this migration.
ALTER TABLE agent_memory_entries ADD COLUMN IF NOT EXISTS workflow_id UUID;

-- Retention, stamped at write time. Null means "no expiry" — the shape every
-- pre-existing run-scoped row has, and correct for them: they die with their run.
ALTER TABLE agent_memory_entries ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;

-- ── run_id BECOMES NULLABLE, AND THE CASCADE BECOMES SET NULL ──────────────
--
-- Workflow-scoped memory that is deleted when the run that wrote it is deleted
-- is not workflow-scoped memory. The FK was ON DELETE CASCADE, so retention
-- pruning a 30-day-old run would silently take the learning with it — the
-- feature would appear to work and then quietly forget, which is worse than not
-- shipping it.
--
-- SET NULL keeps the provenance while the run exists and drops only the link
-- when it does not. Existing rows are untouched: every writer today supplies a
-- run_id, and dropping NOT NULL cannot break a writer that always writes it.
ALTER TABLE agent_memory_entries ALTER COLUMN run_id DROP NOT NULL;

DO $$
DECLARE
    fk_name TEXT;
BEGIN
    SELECT conname INTO fk_name
      FROM pg_constraint
     WHERE conrelid = 'agent_memory_entries'::regclass
       AND contype = 'f'
       AND confrelid = 'agent_runs'::regclass;
    IF fk_name IS NOT NULL THEN
        EXECUTE format('ALTER TABLE agent_memory_entries DROP CONSTRAINT %I', fk_name);
    END IF;
END $$;

ALTER TABLE agent_memory_entries
    ADD CONSTRAINT agent_memory_entries_run_id_fkey
    FOREIGN KEY (run_id) REFERENCES agent_runs(id) ON DELETE SET NULL;

-- ── ONE ROW PER (workflow, agent, key), NOT ONE PER RUN ────────────────────
--
-- Run-scoped memory is a transcript and appends. Workflow-scoped memory is a
-- fact and must not: without this, an agent that records `customer.timezone` on
-- every run accumulates one row per run forever, and the recall reads all of
-- them. Upsert semantics, enforced here so a buggy writer cannot opt out.
--
-- Partial, so it constrains only the new scope and no existing row can violate it.
CREATE UNIQUE INDEX IF NOT EXISTS uq_agent_memory_workflow_key
    ON agent_memory_entries (workspace_id, workflow_id, agent_id, key)
    WHERE memory_scope = 'workflow_scoped';

-- The recall read: newest first, unexpired, for one (workflow, agent).
CREATE INDEX IF NOT EXISTS idx_agent_memory_workflow
    ON agent_memory_entries (workspace_id, workflow_id, agent_id, created_at DESC)
    WHERE memory_scope = 'workflow_scoped';

-- Retention sweeps. Partial so it stays small — most rows have no expiry.
CREATE INDEX IF NOT EXISTS idx_agent_memory_expiry
    ON agent_memory_entries (expires_at)
    WHERE expires_at IS NOT NULL;

COMMENT ON COLUMN agent_memory_entries.workflow_id IS
    'Set only for memory_scope=''workflow_scoped'', which is how memory is '
    'addressed across runs. Null for run-scoped rows, including every row '
    'written before V043.';

COMMENT ON COLUMN agent_memory_entries.expires_at IS
    'Retention for workflow-scoped memory, stamped at write time. Null means no '
    'expiry, which is what run-scoped rows carry — they die with their run. '
    'Memory that outlives its run without a TTL is an unbounded prompt-growth '
    'vector, so the TTL ships with the feature rather than after it.';

-- Delete expired memory. Bounded per call so a sweep can never take a long lock
-- on a hot table; the caller loops or waits for the next tick. Returns the row
-- count so the caller can tell "nothing to do" from "there is more".
CREATE OR REPLACE FUNCTION agent_memory_prune_expired(batch_size INT DEFAULT 1000)
RETURNS INT AS $$
DECLARE
    deleted INT;
BEGIN
    WITH doomed AS (
        SELECT id FROM agent_memory_entries
         WHERE expires_at IS NOT NULL AND expires_at < now()
         LIMIT batch_size
    )
    DELETE FROM agent_memory_entries m USING doomed d WHERE m.id = d.id;
    GET DIAGNOSTICS deleted = ROW_COUNT;
    RETURN deleted;
END $$ LANGUAGE plpgsql;

COMMENT ON FUNCTION agent_memory_prune_expired(INT) IS
    'Bounded delete of expired memory. Batched so a sweep cannot hold a long '
    'lock on a table the agent loop reads on every iteration.';
