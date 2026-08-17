-- V030 — output contracts for agent and LLM nodes (07-AGENT-RELIABILITY §4, Layers 0-1).
--
-- The failure taxonomy in §3 lists eight distinct agent failure modes. Two of them
-- are the largest class in practice and both are addressed here:
--
--   #1 schema violation   — prose instead of JSON, missing field, wrong type.
--                           Constrained decoding makes this IMPOSSIBLE, not rarer.
--   #3 semantic invalidity — well-formed JSON that violates business rules
--                           (`risk_score: 340`). Assertions catch this.
--
-- And #6, context poisoning, is addressed by WHERE validation runs rather than by
-- what it checks: before the checkpoint, so a bad value never becomes durable and
-- can never be inherited downstream.

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. node_contracts — versioned and content-hashed
-- ═══════════════════════════════════════════════════════════════════════════
--
-- WHY VERSIONED RATHER THAN A COLUMN ON THE NODE
-- ----------------------------------------------
-- A contract is the definition of correct for that node, and "was this run correct"
-- must be answerable against the contract that was in force AT THE TIME. Storing it
-- on the node means editing the contract silently rewrites history: yesterday's
-- passing run becomes a failing one, or vice versa, with no record of the change.
--
-- WHY CONTENT-HASHED
-- ------------------
-- The hash is the identity of a contract's *meaning*. Two edits that produce the
-- same JSON are the same contract and share a reliability baseline; an edit that
-- changes one threshold is a different contract and must start a fresh baseline,
-- because the pass rate measured under the old rule says nothing about the new one.
-- Deriving that from content rather than from an edit timestamp means a revert also
-- restores the baseline, which is what a user expects and what a version counter
-- alone cannot express.

CREATE TABLE IF NOT EXISTS node_contracts (
    id                  UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    workspace_id        UUID        NOT NULL,
    workflow_id         UUID        NOT NULL,
    -- Bound to the node, not to a workflow version: a contract survives graph edits
    -- that do not touch the node, which is the common case.
    node_id             TEXT        NOT NULL,

    -- Monotonic per (workflow, node). Human-facing; the hash is the real identity.
    version             INTEGER     NOT NULL DEFAULT 1,
    -- SHA-256 over the canonicalised contract body. Two contracts with the same
    -- hash are the same contract however they were authored.
    content_hash        TEXT        NOT NULL,

    -- ── The contract itself ───────────────────────────────────────────────
    -- JSON Schema for the output. NULL means no structural contract, which also
    -- means constrained decoding cannot be applied.
    schema_json         JSONB,
    -- [{name, expr, severity, message}] — see AssertionEngine.
    assertions_json     JSONB       NOT NULL DEFAULT '[]',
    -- required | optional | none. Declared here, implemented by R03 (Layer 2).
    groundedness        TEXT        NOT NULL DEFAULT 'none',
    -- {commit: 0.8, flag: 0.6, gate: 0.4, fail: 0.2} — declared here, implemented
    -- by R04. Present now so a contract authored today does not need a migration
    -- when confidence routing lands.
    confidence_json     JSONB,

    -- ── Enforcement ───────────────────────────────────────────────────────
    -- Whether the provider path can structurally enforce schema_json. Computed at
    -- publish and stored, so the runtime does not re-derive it per call and the
    -- readiness check can read it directly.
    decoding_enforced   BOOLEAN     NOT NULL DEFAULT false,
    -- Why not, when it is not. Rendered in the publish error.
    decoding_note       TEXT,

    -- ── Provenance ────────────────────────────────────────────────────────
    -- 'user' | 'inferred'. An inferred contract is a DRAFT and is never applied
    -- until a human confirms it — see §7 of the prompt and infer_draft below.
    source              TEXT        NOT NULL DEFAULT 'user',
    -- Drafts are inert: the runtime ignores them entirely.
    status              TEXT        NOT NULL DEFAULT 'active',
    created_by          TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT node_contracts_groundedness_check
        CHECK (groundedness IN ('required', 'optional', 'none')),
    CONSTRAINT node_contracts_source_check
        CHECK (source IN ('user', 'inferred')),
    CONSTRAINT node_contracts_status_check
        CHECK (status IN ('draft', 'active', 'superseded')),
    CONSTRAINT node_contracts_unique_version
        UNIQUE (workflow_id, node_id, version)
);

-- The runtime's only lookup: the active contract for this node. Partial so the
-- index holds one row per node rather than one per version ever authored.
CREATE UNIQUE INDEX IF NOT EXISTS node_contracts_active_idx
    ON node_contracts (workflow_id, node_id)
    WHERE status = 'active';

-- "Has this contract been seen before" — the baseline-branching question.
CREATE INDEX IF NOT EXISTS node_contracts_hash_idx
    ON node_contracts (content_hash);

CREATE INDEX IF NOT EXISTS node_contracts_workspace_idx
    ON node_contracts (workspace_id, workflow_id);

COMMENT ON TABLE node_contracts IS
    'Versioned output contracts for agent/LLM nodes. Content-hashed so a semantic '
    'change branches the reliability baseline and a revert restores it.';
COMMENT ON COLUMN node_contracts.decoding_enforced IS
    'Whether the provider path can structurally enforce schema_json. False with a '
    'declared schema is a publish-time error, not a runtime surprise.';
COMMENT ON COLUMN node_contracts.status IS
    'draft = inferred, awaiting confirmation, ignored by the runtime. active = in '
    'force. superseded = replaced by a newer version, retained so historical runs '
    'can be judged against the contract that applied to them.';

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. contract_validations — what the contract decided, per node execution
-- ═══════════════════════════════════════════════════════════════════════════
--
-- One row per validated node execution, holding the outcome and every assertion
-- result. Separate from `run_events` because it is queried as *data* — "what is
-- this agent's pass rate", "which assertion fires most" — and an event stream is
-- the wrong shape for an aggregate.
--
-- The contract VERSION is recorded, not just the id: judging a historical run
-- against today's contract is exactly the mistake versioning exists to prevent.

CREATE TABLE IF NOT EXISTS contract_validations (
    id                  UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    run_id              UUID        NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
    workspace_id        UUID        NOT NULL,
    node_id             TEXT        NOT NULL,
    contract_id         UUID,
    contract_version    INTEGER,
    contract_hash       TEXT,

    -- pass | fail | warn | gate — the strongest severity that fired.
    outcome             TEXT        NOT NULL,
    schema_valid        BOOLEAN     NOT NULL DEFAULT true,
    schema_errors_json  JSONB,
    -- [{name, severity, passed, message, actual}] — every assertion, not just the
    -- failures. A user debugging "why did this pass" needs the ones that held.
    assertion_results_json JSONB    NOT NULL DEFAULT '[]',
    -- Milliseconds. Layer 1 is advertised as negligible; this is the evidence.
    duration_ms         BIGINT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT contract_validations_outcome_check
        CHECK (outcome IN ('pass', 'fail', 'warn', 'gate'))
);

CREATE INDEX IF NOT EXISTS contract_validations_run_idx
    ON contract_validations (run_id, node_id);
-- The reliability baseline: pass rate for this contract version over time.
CREATE INDEX IF NOT EXISTS contract_validations_baseline_idx
    ON contract_validations (contract_hash, created_at DESC);

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. Run-level low-confidence flag (the `warn` surface)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- A `warn` assertion commits but marks the run. Denormalised onto agent_runs so
-- the Runs page and Control can filter on it without joining validations.

ALTER TABLE agent_runs
    ADD COLUMN IF NOT EXISTS low_confidence      BOOLEAN NOT NULL DEFAULT false,
    -- Which assertions warned, so the surface can say why rather than just flagging.
    ADD COLUMN IF NOT EXISTS confidence_notes_json JSONB;

COMMENT ON COLUMN agent_runs.low_confidence IS
    'Set when a warn-severity assertion fired. The run committed; Control surfaces '
    'it for review.';

-- ═══════════════════════════════════════════════════════════════════════════
-- 4. Draft inference from historical outputs (§7)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Existing agents have no contract. Rather than leaving users to author one from
-- scratch, infer a draft from what the node has actually produced.
--
-- NEVER auto-applied. The function writes `status='draft'`, which the runtime
-- ignores completely. A schema inferred from 20 historical outputs is a hypothesis
-- about intent, and applying a hypothesis as an enforcement rule would fail runs
-- for violating a contract nobody wrote.
--
-- In SQL rather than Kotlin because the input is entirely rows: pushing the
-- aggregation to where the data lives avoids streaming every historical output to
-- the API to count key frequencies.

CREATE OR REPLACE FUNCTION infer_draft_contract(
    p_workspace_id UUID,
    p_workflow_id  UUID,
    p_node_id      TEXT,
    p_sample_limit INTEGER DEFAULT 50
) RETURNS JSONB AS $$
DECLARE
    samples   JSONB;
    n_samples INTEGER;
    props     JSONB := '{}'::jsonb;
    required  JSONB := '[]'::jsonb;
    k         RECORD;
BEGIN
    -- Most recent N outputs for this node, successful runs only. A failed run's
    -- output is not evidence of the intended shape.
    SELECT jsonb_agg(o.raw_output_json_sanitized), count(*)
      INTO samples, n_samples
      FROM (
          SELECT so.raw_output_json_sanitized
            FROM step_outputs so
            JOIN agent_runs r ON r.id = so.run_id
           WHERE so.workspace_id = p_workspace_id
             AND r.workflow_id = p_workflow_id
             AND so.node_id = p_node_id
             AND r.status = 'succeeded'
             AND so.raw_output_json_sanitized IS NOT NULL
             AND jsonb_typeof(so.raw_output_json_sanitized) = 'object'
           ORDER BY so.created_at DESC
           LIMIT p_sample_limit
      ) o;

    IF n_samples IS NULL OR n_samples < 3 THEN
        -- Three is the floor for inferring anything. Below it, "every key is
        -- required" is an artefact of the sample rather than a property of the node.
        RETURN jsonb_build_object(
            'inferred', false,
            'reason', format('Only %s usable historical output(s); at least 3 are needed to infer a shape.',
                             COALESCE(n_samples, 0)));
    END IF;

    -- Key frequency and observed types across the sample.
    FOR k IN
        SELECT key,
               count(*) AS seen,
               -- A key that is sometimes a string and sometimes a number gets no
               -- type: guessing one would produce a schema that fails half the
               -- historical outputs it was inferred from.
               CASE WHEN count(DISTINCT jsonb_typeof(value)) = 1
                    THEN min(jsonb_typeof(value)) END AS jtype
          FROM jsonb_array_elements(samples) s,
               LATERAL jsonb_each(s) AS e(key, value)
         GROUP BY key
    LOOP
        props := props || jsonb_build_object(
            k.key,
            CASE
                WHEN k.jtype IS NULL THEN jsonb_build_object('description', 'mixed types observed')
                WHEN k.jtype = 'number' THEN jsonb_build_object('type', 'number')
                WHEN k.jtype = 'string' THEN jsonb_build_object('type', 'string')
                WHEN k.jtype = 'boolean' THEN jsonb_build_object('type', 'boolean')
                WHEN k.jtype = 'array' THEN jsonb_build_object('type', 'array')
                WHEN k.jtype = 'object' THEN jsonb_build_object('type', 'object')
                ELSE jsonb_build_object('type', 'string')
            END
        );

        -- Required only if present in EVERY sample. A key seen 19 times in 20 is
        -- optional, and marking it required would fail the twentieth case.
        IF k.seen = n_samples THEN
            required := required || to_jsonb(k.key);
        END IF;
    END LOOP;

    RETURN jsonb_build_object(
        'inferred', true,
        'sampleCount', n_samples,
        'schema', jsonb_build_object(
            'type', 'object',
            'properties', props,
            'required', required,
            'additionalProperties', false
        ),
        'note', format('Inferred from %s historical outputs. Review before applying - '
                       'this describes what the node HAS produced, not necessarily what '
                       'it SHOULD produce.', n_samples)
    );
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION infer_draft_contract IS
    'Infer a DRAFT schema from a node''s historical outputs. Never auto-applied: the '
    'result describes what the node has produced, not what it should produce.';
