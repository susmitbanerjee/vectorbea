-- V026 — make the event history authoritative enough to replay from.
--
-- The audit (docs/architecture/REPLAY-AUDIT.md) found three independent reasons a
-- run could not be reconstructed: model bodies were never stored, call parameters
-- were never stored, and non-deterministic values were never captured. This adds
-- the two tables that close all three.
--
-- Additive only. Nothing here changes existing behaviour until the worker writes
-- to it.

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. model_calls — one row per provider call, complete
-- ═══════════════════════════════════════════════════════════════════════════
--
-- A separate table rather than more columns on `run_events` for three reasons:
--
--   * The bodies are large and are read rarely. Widening `run_events` — which is
--     scanned for every timeline render — would drag prompt and response text
--     through every one of those queries.
--   * The uniqueness constraint that makes replay deterministic
--     (run, node, attempt, call index) has no meaning for other event types.
--   * "Every model call this workspace made, with its cost" is a question the
--     billing and audit surfaces both want, and it should not require filtering
--     an event stream by a string type.
--
-- Still linked to the event stream by `event_id`, so the timeline stays the
-- single ordered narrative and this is its detail.

CREATE TABLE IF NOT EXISTS model_calls (
    id                  UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    run_id              UUID        NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
    workspace_id        UUID        NOT NULL,
    environment_id      UUID        NOT NULL,
    node_id             TEXT        NOT NULL,
    -- The event this call is the detail of. Nullable because the call is recorded
    -- even if event emission fails — losing the audit row because a *log line*
    -- failed would be the wrong trade.
    event_id            UUID,

    -- ── Identity of the call ──────────────────────────────────────────────
    provider            TEXT        NOT NULL,
    model_id            TEXT        NOT NULL,
    -- The version the provider actually served, read back from the response, not
    -- the alias the user configured. `gpt-4o` is an alias that silently changes
    -- underneath you; `gpt-4o-2024-08-06` is what answered. Without this an audit
    -- cannot say which model made a decision.
    model_version       TEXT,

    -- ── Parameters, so the call is reproducible ───────────────────────────
    temperature         DOUBLE PRECISION,
    top_p               DOUBLE PRECISION,
    seed                BIGINT,
    max_tokens          INTEGER,
    response_format     TEXT,

    -- ── The audit substrate ───────────────────────────────────────────────
    -- SHA-256 of the rendered prompt. Lets "did these two runs send the same
    -- prompt" be answered by an index rather than by diffing megabytes.
    prompt_hash         TEXT,
    -- Bodies inline when small. Secrets are redacted from the request; the prompt
    -- and the response are NEVER redacted — they are the thing being audited, and
    -- a redacted audit trail is not one.
    request_body        JSONB,
    response_body       JSONB,
    -- Set instead of the inline column when the body exceeds the inline ceiling.
    -- Exactly one of (body, key) is populated per direction.
    request_body_key    TEXT,
    response_body_key   TEXT,
    logprobs            JSONB,

    -- ── Outcome ───────────────────────────────────────────────────────────
    finish_reason       TEXT,
    tokens_in           INTEGER,
    tokens_out          INTEGER,
    latency_ms          BIGINT,
    cost_usd            NUMERIC(12, 8),
    -- 0 for the first try. A retry records a NEW row with attempt_number + 1
    -- rather than overwriting: "what did it answer the first time" is exactly the
    -- question an audit asks, and an update would destroy it.
    attempt_number      INTEGER     NOT NULL DEFAULT 0,
    -- Ordinal within (run, node, attempt). An agent node makes several calls per
    -- attempt, and replay has to hand them back in the order they were made.
    call_index          INTEGER     NOT NULL DEFAULT 0,
    -- 'ok' | 'error' | 'throttled'. A failed call is still a recorded call: a
    -- replay must reproduce the failure, not skip it and diverge.
    outcome             TEXT        NOT NULL DEFAULT 'ok',
    error_sanitized     TEXT,

    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT model_calls_outcome_check CHECK (outcome IN ('ok', 'error', 'throttled')),
    -- The constraint that makes replay deterministic. Without it a double-write
    -- would give replay two candidate responses for one call and no way to choose.
    CONSTRAINT model_calls_unique_call UNIQUE (run_id, node_id, attempt_number, call_index)
);

-- Replay's only access pattern: every call for a run, in execution order.
CREATE INDEX IF NOT EXISTS model_calls_replay_idx
    ON model_calls (run_id, node_id, attempt_number, call_index);

-- "What did this workspace spend, and on what" — billing and the cost surfaces.
CREATE INDEX IF NOT EXISTS model_calls_workspace_cost_idx
    ON model_calls (workspace_id, created_at DESC);

-- "Did these two runs send the same prompt" without reading the prompts.
CREATE INDEX IF NOT EXISTS model_calls_prompt_hash_idx
    ON model_calls (prompt_hash) WHERE prompt_hash IS NOT NULL;

COMMENT ON TABLE model_calls IS
    'Complete record of every provider call. The substrate replay reads from and '
    'the substrate an audit is answered from. See docs/architecture/REPLAY-AUDIT.md.';
COMMENT ON COLUMN model_calls.model_version IS
    'Resolved version the provider served, read from the response — not the alias '
    'configured on the node.';
COMMENT ON COLUMN model_calls.request_body_key IS
    'Object-storage key when the body exceeded the inline ceiling. Exactly one of '
    'request_body / request_body_key is set.';

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. recorded_values — the determinism journal
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Reproducing model calls is necessary but not sufficient. A workflow that stamps
-- `Instant.now()` into its output produces a different byte string on every
-- execution no matter how perfectly the model is replayed — the audit counted 22
-- such call sites in `worker/runtime/` alone.
--
-- So every non-deterministic value a run observes is journalled as it is produced,
-- and replay reads from the journal instead of the clock. This is the same trick
-- Temporal's workflow sandbox plays, in one table.
--
-- Ordered by `sequence` within a run, so a replay consuming values in execution
-- order gets the same values back even when the same node asks twice.

CREATE TABLE IF NOT EXISTS recorded_values (
    id              UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    run_id          UUID        NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
    workspace_id    UUID        NOT NULL,
    node_id         TEXT,
    -- 'time' | 'uuid' | 'random'
    kind            TEXT        NOT NULL,
    sequence        INTEGER     NOT NULL,
    -- Text rather than a typed column per kind: the journal's job is to hand back
    -- the exact bytes that were produced, and a round trip through a typed column
    -- is a chance to lose a digit of precision.
    value           TEXT        NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT recorded_values_kind_check CHECK (kind IN ('time', 'uuid', 'random')),
    CONSTRAINT recorded_values_unique_seq UNIQUE (run_id, kind, sequence)
);

CREATE INDEX IF NOT EXISTS recorded_values_replay_idx
    ON recorded_values (run_id, kind, sequence);

COMMENT ON TABLE recorded_values IS
    'Journal of non-deterministic values observed during a run (clock, uuid, '
    'random), so replay can reproduce them instead of generating new ones.';

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. Run provenance
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Which of the three operations produced this run, and what it descends from.
-- Without this the Runs list cannot distinguish a replay from a re-run, which is
-- precisely the confusion this whole change exists to remove.

ALTER TABLE agent_runs
    -- 'live' | 'replay' | 'retry' | 'rerun'
    ADD COLUMN IF NOT EXISTS execution_mode_kind TEXT NOT NULL DEFAULT 'live',
    -- The run this one replays or re-runs. Distinct from continued_from_run_id,
    -- which is continue-as-new — a different relationship entirely.
    ADD COLUMN IF NOT EXISTS source_run_id       UUID,
    -- For partial replay: recorded up to and including this node, live after it.
    -- NULL means "replay the whole run".
    ADD COLUMN IF NOT EXISTS replay_until_node   TEXT;

DO $$ BEGIN
    ALTER TABLE agent_runs ADD CONSTRAINT agent_runs_execution_mode_kind_check
        CHECK (execution_mode_kind IN ('live', 'replay', 'retry', 'rerun'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS agent_runs_source_run_idx
    ON agent_runs (source_run_id) WHERE source_run_id IS NOT NULL;

COMMENT ON COLUMN agent_runs.execution_mode_kind IS
    'Which operation produced this run: live | replay | retry | rerun. A replay '
    'costs nothing and calls nothing; a rerun calls everything.';
COMMENT ON COLUMN agent_runs.replay_until_node IS
    'Partial replay boundary. Nodes up to and including this one come from the '
    'recording; nodes after it execute live.';

-- ═══════════════════════════════════════════════════════════════════════════
-- 4. payload_blobs — interim home for oversized bodies
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Object storage (R2) is where these belong: an order of magnitude cheaper per
-- byte, and it keeps prompt text out of database backups and vacuum.
--
-- There is no object-storage client in this service yet, and shipping the
-- recording *without* somewhere to put large bodies would mean silently dropping
-- exactly the calls most worth auditing. So the interface is written for R2 and
-- backed by this table until the client exists (TECH-DEBT D19). Being correct
-- first and cheap second is the right order here.

CREATE TABLE IF NOT EXISTS payload_blobs (
    key         TEXT        NOT NULL PRIMARY KEY,
    body        TEXT        NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE payload_blobs IS
    'Interim store for model-call bodies over the inline ceiling. Destined for R2 '
    '- see BlobStore and TECH-DEBT D19.';
