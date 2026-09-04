-- =============================================================================
-- V042__agent_activations.sql
--
-- The ACTIVATION: one agent's participation in one run. It is to a team what a
-- step is to a DAG — the durable unit of work, retry, budget and trace.
--
-- Per docs/AGENT-HARNESS-ARCHITECTURE.md §4. This phase routes the EXISTING
-- single-agent path through it and changes nothing about how that path behaves.
-- Delegation, teams and the new brain actions are later phases; the columns that
-- only they populate (parent_activation_id, child_run_id, role other than the
-- default) are present and unwritten.
--
-- ── WHY THIS IS THE ONLY DDL IN THIS PHASE ──────────────────────────────────
-- `activation_id` already exists on agent_iterations (V040), run_events (V041)
-- and run_spans (V041) — added nullable and unwritten in each case precisely so
-- this migration would not have to ALTER three hot tables. This phase starts
-- writing them.
-- =============================================================================

CREATE TABLE IF NOT EXISTS agent_activations (
    id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    run_id                UUID        NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
    workspace_id          UUID        NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    environment_id        UUID        NOT NULL,
    step_id               TEXT        NOT NULL,
    parent_activation_id  UUID        REFERENCES agent_activations(id),
    root_activation_id    UUID        NOT NULL,
    depth                 INTEGER     NOT NULL DEFAULT 0,
    sequence              INTEGER     NOT NULL,
    agent_id              UUID        NOT NULL,

    -- ── Version pinning (§4.2) ──────────────────────────────────────────────
    -- The resolved agent DEFINITION at first creation, read back on every
    -- resume. Today an agent edited mid-run changes behaviour between the first
    -- tick and the resumed one; pinned, a run finishes as the thing it started
    -- as.
    --
    -- THE PIN COVERS THE DEFINITION, NOT THE GRANT. Instructions, model,
    -- temperature and budgets live here. Granted tool ids deliberately DO NOT:
    -- a revoked tool is a policy decision, and policy is re-read at execution
    -- time and fails closed, exactly as the beta gate is re-read rather than
    -- trusted from enqueue time. Pinning a revoked grant would let a paused run
    -- resume with access somebody deliberately removed.
    agent_version         TEXT,
    agent_snapshot_json   JSONB,

    role                  TEXT        NOT NULL DEFAULT 'specialist',
    status                TEXT        NOT NULL DEFAULT 'pending',

    -- The task this activation was given. Deliberately MINIMAL in this phase —
    -- see the idempotency note below.
    contract_json         JSONB       NOT NULL DEFAULT '{}',
    output_json           JSONB,
    stop_reason           TEXT,
    failure_class         TEXT,

    budget_allocated_json JSONB       NOT NULL DEFAULT '{}',
    budget_consumed_json  JSONB       NOT NULL DEFAULT '{}',

    child_run_id          UUID,

    idempotency_key       TEXT        NOT NULL,
    attempt               INTEGER     NOT NULL DEFAULT 1,

    created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    started_at            TIMESTAMPTZ,
    ended_at              TIMESTAMPTZ,

    -- ── THE LOAD-BEARING CONSTRAINT ─────────────────────────────────────────
    -- What makes a resumed run reattach to the activation it already created
    -- instead of starting a second one. See the derivation note below.
    CONSTRAINT agent_activations_idem_unique UNIQUE (run_id, idempotency_key),

    -- A CHECK, not a Postgres ENUM type, deliberately. `ALTER TYPE … ADD VALUE`
    -- cannot run inside a transaction on older servers, which makes a Flyway
    -- migration that adds a role awkward in exactly the way a migration must not
    -- be. P8 adds no roles; P9's policies might.
    CONSTRAINT agent_activations_role_check CHECK (
        role IN ('supervisor','worker','reviewer','router','specialist')
    ),

    -- §4.1's vocabulary, in full. The non-terminal team states are unreachable
    -- this phase and present so P7 alters no constraint.
    CONSTRAINT agent_activations_status_check CHECK (
        status IN ('pending','running','waiting_for_child','waiting_for_approval',
                   'handed_off','succeeded','failed','cancelled','superseded')
    )
);

CREATE INDEX IF NOT EXISTS idx_agent_activations_run_seq
    ON agent_activations (run_id, sequence);
CREATE INDEX IF NOT EXISTS idx_agent_activations_root
    ON agent_activations (root_activation_id);
CREATE INDEX IF NOT EXISTS idx_agent_activations_live
    ON agent_activations (status)
    WHERE status IN ('running','waiting_for_child','waiting_for_approval');

-- The reattach lookup for a ROOT activation. See the note below on why the
-- natural key and not the idempotency key drives the lookup.
CREATE INDEX IF NOT EXISTS idx_agent_activations_natural
    ON agent_activations (run_id, step_id, agent_id)
    WHERE parent_activation_id IS NULL;

COMMENT ON TABLE agent_activations IS
    'One agent''s participation in one run. Created at runtime, so it cannot live '
    'in the immutable graph_json. Single-agent runs produce exactly one row per '
    '(run, agent step); teams produce a tree.';

COMMENT ON COLUMN agent_activations.idempotency_key IS
    'sha256((parent_activation_id ?: step_id) | agent_id | canonical_json(contract_json)). '
    'Derived, never random, and free of iteration numbers and timestamps so it '
    'survives re-execution. Canonical JSON means sorted keys and normalised '
    'numbers: a re-serialisation that reorders keys would otherwise produce a '
    'different hash and start a second activation for the same work.';

COMMENT ON COLUMN agent_activations.contract_json IS
    'The task this activation was given. DELIBERATELY MINIMAL in P6: just the '
    'resolved taskInstruction. The full resolved input is the least stable thing '
    'in scope — it is rebuilt every tick from the step-output view, and one '
    'upstream node emitting a timestamp or a reordered map changes the hash and '
    'creates a duplicate activation on resume. P8''s TaskContract widens this '
    'safely because a delegated contract is CONSTRUCTED by the delegating agent: '
    'small, explicit, and stable by construction rather than by luck.';

COMMENT ON COLUMN agent_activations.agent_snapshot_json IS
    'The pinned agent definition — instructions, model, temperature, budgets. '
    'NOT the granted tool ids: a grant is policy, re-read at execution time and '
    'failing closed, so revoking a tool takes effect on a paused run.';

COMMENT ON COLUMN agent_activations.role IS
    'Defaulted rather than written at the call site, so P8 can start passing a '
    'real role without editing every P6 caller, and an older worker inserting '
    'without the column still produces a valid row during a rolling deploy.';
