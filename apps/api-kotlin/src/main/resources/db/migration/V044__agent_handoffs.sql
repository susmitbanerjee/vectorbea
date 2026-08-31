-- =============================================================================
-- V044__agent_handoffs.sql
--
-- Delegation edges, and the two grants that make an agent callable the way a
-- tool is callable.
--
-- Per docs/AGENT-HARNESS-ARCHITECTURE.md §5.1. Execution is INLINE in this
-- phase; dispatched child runs are P10, and the columns only they populate
-- (join_group_id, and the RETURN/ESCALATE/BROADCAST kinds) are present and
-- unwritten so that phase alters no constraint.
-- =============================================================================

CREATE TABLE IF NOT EXISTS agent_handoffs (
    id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    run_id              UUID        NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
    workspace_id        UUID        NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,

    -- Null when a team node opens the first activation — there is no delegating
    -- agent in that case, only the graph.
    from_activation_id  UUID        REFERENCES agent_activations(id) ON DELETE SET NULL,
    to_activation_id    UUID        NOT NULL REFERENCES agent_activations(id) ON DELETE CASCADE,

    kind                TEXT        NOT NULL,

    -- ── THE ONLY PLACE THE REASON IS RECORDED ───────────────────────────────
    -- The model's stated reason for the delegation, sanitized at the write
    -- boundary. Nothing else in the system holds it: the contract says WHAT was
    -- asked for, the spans say how long it took, and neither says why the
    -- supervisor thought this was the right worker. It is usually the first
    -- thing a business user asks when a run went sideways.
    reason              TEXT,

    contract_json       JSONB       NOT NULL DEFAULT '{}',

    -- ── WHY THE HASH IS A COLUMN AND NOT COMPUTED AT READ TIME ──────────────
    -- The §9 loop guard counts (from, to, contract_hash) before every
    -- delegation. Computing it on read means canonicalising and hashing every
    -- prior contract in the run on every hop — quadratic in the number of
    -- handoffs, on the hot path of the thing it is meant to bound.
    --
    -- Deliberately EXCLUDES budget, deadline and each contextRef's watermark:
    -- all three change on every hop, so including them makes every repeat hash
    -- differently and the guard inert. See AgentCallExecutor.contractHash.
    contract_hash       TEXT        NOT NULL,

    -- The blackboard watermark visible at the moment of handoff, §7. This is
    -- what makes "what did this agent see when it decided that" answerable.
    context_version     BIGINT      NOT NULL DEFAULT 0,

    -- Shared by one BROADCAST's children. Unwritten until P10.
    join_group_id       UUID,

    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT agent_handoffs_kind_check CHECK (
        kind IN ('DELEGATE','TRANSFER','RETURN','ESCALATE','BROADCAST')
    )
);

-- The loop guard's lookup: how many times has this exact request already been
-- made along this exact edge.
CREATE INDEX IF NOT EXISTS idx_agent_handoffs_loop
    ON agent_handoffs (run_id, from_activation_id, to_activation_id, contract_hash);

-- The constellation view: every edge in a run, in order.
CREATE INDEX IF NOT EXISTS idx_agent_handoffs_run
    ON agent_handoffs (run_id, created_at);
CREATE INDEX IF NOT EXISTS idx_agent_handoffs_to
    ON agent_handoffs (to_activation_id);

COMMENT ON TABLE agent_handoffs IS
    'The delegation edges. One row per handoff, whatever kind. This is what the '
    'debugger''s constellation view draws, and the only place the model''s stated '
    'reason for a delegation is recorded.';

COMMENT ON COLUMN agent_handoffs.contract_hash IS
    'sha256 of the canonical contract, EXCLUDING budget, deadline and each '
    'contextRef watermark — all three change on every hop, so including any of '
    'them would make the repeated-handoff guard hash differently every time and '
    'catch nothing.';

COMMENT ON COLUMN agent_handoffs.reason IS
    'Sanitized at the write boundary, like every other model-authored string that '
    'reaches storage. An agent can put a connection string it read out of an '
    'error message into its own reasoning.';

-- ---------------------------------------------------------------------------
-- The two grants on `agents`
--
-- §2: an agent is a callable, exactly like a tool. Both columns mirror the
-- tool-side column they correspond to, so the two grant checks read the same.
-- ---------------------------------------------------------------------------

-- The team roster. Mirrors `agents.allowed_tool_ids`, which is also TEXT[].
--
-- EMPTY MEANS NO DELEGATION, deliberately, and this is where the analogy to
-- tools stops. `AgentSafetyGuard.validateToolAllowed` treats an empty
-- allowed_tool_ids as "everything is allowed"; an empty roster must not mean
-- "delegate to anyone in the workspace". See the comment at
-- AgentSafetyGuard.validateAgentAllowed.
ALTER TABLE agents ADD COLUMN IF NOT EXISTS can_delegate_to TEXT[] NOT NULL DEFAULT '{}';

-- Mirrors `tools.requires_approval`. Delegation to a gated agent opens the same
-- kind of row, through the same store, decided by the same function.
ALTER TABLE agents ADD COLUMN IF NOT EXISTS requires_approval BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN agents.can_delegate_to IS
    'The team roster: agent ids this agent may DELEGATE or HANDOFF to. Empty '
    'means no delegation — NOT "any agent", which is how the tool grant reads an '
    'empty list. A roster that fails open is an unbounded control-flow edge.';

COMMENT ON COLUMN agents.requires_approval IS
    'Delegating TO this agent opens an approval gate, keyed '
    '<stepId>:agent:<agentId>. Mirrors tools.requires_approval so the two gates '
    'are configured and enforced identically.';
