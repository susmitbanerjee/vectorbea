-- =============================================================================
-- V040__agent_loop_reconstruction.sql
--
-- Makes the agent loop RECONSTRUCTIBLE instead of replayable.
--
-- Today a resumed agent step re-executes from iteration 1: loop state is
-- in-memory, only sanitized memory is recalled, and observations are not
-- restored. The step therefore repeats every LLM call it already made and pays
-- for all of them again. `agent_iterations` holds a summary of each iteration
-- but not enough to rebuild the loop's state from.
--
-- Two parts:
--   1. run_payloads — content-addressed storage, so an observation payload can
--      be referenced rather than inlined into the iteration row.
--   2. agent_iterations gains the fields a rebuild needs: the parsed action, the
--      payload refs, and per-iteration budget DELTAS.
--
-- ── WHAT THIS MIGRATION DELIBERATELY DOES NOT DO ────────────────────────────
--
-- It does not touch UNIQUE (run_id, step_id, iteration_number).
--
-- The reconstruction design wants `attempt` in that key so a deliberate re-run
-- gets a fresh transcript. Adding it means DROPPING the existing constraint, and
-- `ON CONFLICT (run_id, step_id, iteration_number)` in the currently deployed
-- worker (AgentBrainRunner.persistIterationStart) does not degrade when its
-- constraint disappears — it raises
--   "there is no unique or exclusion constraint matching the ON CONFLICT
--    specification"
-- and every iteration write fails. The API and the worker deploy independently,
-- so that window is real. It needs two migrations with a full worker rollout
-- between them, which belongs with the P6 work that introduces activation_id and
-- its own notion of attempt — one change, one decision, not two competing ones.
--
-- `activation_id` is added here, nullable and unwritten, purely so P6 alters a
-- column that already exists rather than adding one to a large table.
--
-- Everything here is additive. An older worker running against this schema keeps
-- working: it writes NULL into the new columns, and reconstruction refuses any
-- row whose `action_json_sanitized` is NULL and falls back to replay.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. run_payloads — content-addressed payload storage
--
-- Per docs/AGENT-TRACE-AND-DEBUGGER.md §3. Shipped here rather than with the
-- trace work because loop reconstruction needs somewhere to put an observation
-- payload NOW, and a payload store that two features share is the point of
-- content addressing.
--
-- INLINE ONLY IN THIS PHASE. `storage` and `object_key` exist so the object tier
-- is a code change rather than a migration, but nothing writes 'object' yet and
-- a value above INLINE_MAX_BYTES is truncated with `truncated = true` instead.
-- That is strictly better than the status quo, which persists no payload at all.
--
-- REDACTION IS NOT OPTIONAL AND NOT DEFERRABLE. Retrofitting redaction onto a
-- store that already holds unredacted rows means auditing history you cannot
-- change. `redactions` records what was masked so a reader sees
-- "[redacted: connection secret]" and not a gap they will file as a bug.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS run_payloads (
    ref             TEXT        PRIMARY KEY,   -- sha256 of the REDACTED content
    workspace_id    UUID        NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    size_bytes      INTEGER     NOT NULL,
    content_type    TEXT        NOT NULL,      -- text/plain | application/json
    storage         TEXT        NOT NULL DEFAULT 'inline',
    inline_value    JSONB,                     -- JSON scalar for text, object for json
    object_key      TEXT,                      -- unused until the object tier lands
    truncated       BOOLEAN     NOT NULL DEFAULT false,
    redactions      JSONB       NOT NULL DEFAULT '[]',
    expires_at      TIMESTAMPTZ NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT run_payloads_storage_check CHECK (storage IN ('inline','object')),
    -- An inline row must carry its value; an object row must carry its key.
    CONSTRAINT run_payloads_backing_check CHECK (
        (storage = 'inline' AND inline_value IS NOT NULL)
     OR (storage = 'object' AND object_key   IS NOT NULL)
    )
);

-- The reaper's index, present before the reaper (P12) so adding it later is not
-- a scan of a large table.
CREATE INDEX IF NOT EXISTS idx_run_payloads_expiry
    ON run_payloads (expires_at);

-- Workspace-scoped reads and any future per-workspace purge.
CREATE INDEX IF NOT EXISTS idx_run_payloads_workspace
    ON run_payloads (workspace_id, created_at DESC);

COMMENT ON TABLE run_payloads IS
    'Content-addressed payload store, keyed by sha256 of the REDACTED content. '
    'Shared by agent loop reconstruction and (later) run_spans. Content addressing '
    'means a system prompt identical across 40 iterations is stored once. '
    'Inline-only until the object tier ships; oversized values are truncated and '
    'flagged rather than dropped.';

COMMENT ON COLUMN run_payloads.ref IS
    'sha256 of the content AFTER redaction, so the stored bytes always match the '
    'hash and two payloads differing only in a secret converge to one row.';

COMMENT ON COLUMN run_payloads.redactions IS
    'What was masked and why: [{"pattern":"connection secret","count":2}]. A reader '
    'sees an explicit redaction marker instead of a gap.';

COMMENT ON COLUMN run_payloads.expires_at IS
    'Set from the workspace log_retention_days at write time. No reaper exists yet '
    '(P12); this column is what the reaper will scan.';

-- ---------------------------------------------------------------------------
-- 2. agent_iterations — the fields a rebuild needs
--
-- WHY DELTAS AND NOT SNAPSHOTS. `tokens_used` and `estimated_cost_cents` already
-- on this table are CUMULATIVE totals for the whole loop as of that iteration.
-- They are the right thing for a progress display and useless for rebuilding an
-- intermediate state, because a reconstruction that resumes at iteration 5 needs
-- to know what the budget stood at after 4 — which is the sum of four deltas, not
-- a total that may itself have been written by a since-abandoned attempt. The
-- cumulative columns are kept and still written; these are additional.
-- ---------------------------------------------------------------------------
ALTER TABLE agent_iterations
    -- The parsed action and its arguments: type, toolId, toolInput,
    -- reasoningSummary, failReason. Sanitized and bounded before it is written.
    ADD COLUMN IF NOT EXISTS action_json_sanitized   JSONB,

    -- Whether the observation was a success. Currently only inferable from
    -- `status`, and not reliably: an iteration whose tool failed is recorded
    -- `completed` because the ITERATION completed. The repeated-failure stop
    -- compares observation success, so a rebuild has to restore it exactly.
    ADD COLUMN IF NOT EXISTS observation_success     BOOLEAN,

    -- run_payloads refs. The observation payload is what the model reads on the
    -- next iteration; the tool result is the full untruncated output.
    ADD COLUMN IF NOT EXISTS observation_payload_ref TEXT,
    ADD COLUMN IF NOT EXISTS tool_result_ref         TEXT,

    -- Per-iteration budget deltas. See the note above.
    ADD COLUMN IF NOT EXISTS tokens_delta            INTEGER,
    ADD COLUMN IF NOT EXISTS cost_delta_cents        NUMERIC(10,4),
    ADD COLUMN IF NOT EXISTS tool_calls_delta        INTEGER NOT NULL DEFAULT 0,

    -- The mismatch detector. Reconstruction refuses a version it does not
    -- understand and falls back to replay, rather than guessing at a half-known
    -- shape. Rows written before this migration default to 1 and are rejected on
    -- the NULL action_json_sanitized check instead.
    ADD COLUMN IF NOT EXISTS loop_schema_version     INTEGER NOT NULL DEFAULT 1,

    -- Forward-compatibility for P6. Nullable and unwritten: adding the column now
    -- means P6 does not ALTER a large table under a rollout.
    ADD COLUMN IF NOT EXISTS activation_id           UUID;

COMMENT ON COLUMN agent_iterations.action_json_sanitized IS
    'The parsed AgentAction with its arguments. Presence of this column is what '
    'distinguishes a row that can be reconstructed from one written before V040.';

COMMENT ON COLUMN agent_iterations.tokens_delta IS
    'Tokens consumed BY THIS ITERATION. tokens_used on the same row is the running '
    'total; a rebuild sums deltas because a total may have been written by an '
    'attempt that was later abandoned.';

COMMENT ON COLUMN agent_iterations.activation_id IS
    'Unwritten until P6. Added here so that phase alters an existing column.';

-- Reconstruction reads the whole transcript for one (run, step) in iteration
-- order. The existing idx_agent_iterations_run_step already covers exactly that
-- — (run_id, step_id, iteration_number) — so no new index is needed.
