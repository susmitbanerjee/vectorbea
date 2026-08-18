-- V031 — confidence scoring, routing, gates and calibration (07-AGENT-RELIABILITY §6).
--
-- §6 is where the defensive layers become a product feature:
--
--   "not that the agent is always right, but that the agent knows when it might be
--    wrong, and asks."
--
-- Everything here exists to make that sentence true and auditable.

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. confidence_scores — the score AND every component
-- ═══════════════════════════════════════════════════════════════════════════
--
-- The prompt is explicit: "Store the score AND every component — a bare number is
-- useless when someone asks 'why 0.62?'"
--
-- That is not a nicety. The score decides whether a human is interrupted, and a
-- reviewer who cannot see why will either rubber-stamp everything or override
-- everything. The breakdown is what makes the routing trustworthy.
--
-- Components are stored as JSONB rather than as columns because the signal set is
-- expected to grow — a critic pass today, an ensemble tomorrow — and adding a
-- signal should not require a migration on a table this hot.

CREATE TABLE IF NOT EXISTS confidence_scores (
    id                  UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    run_id              UUID        NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
    workspace_id        UUID        NOT NULL,
    workflow_id         UUID,
    node_id             TEXT        NOT NULL,

    -- 0..1.
    score               DOUBLE PRECISION NOT NULL,
    -- commit | commit_flagged | gate | fail
    action              TEXT        NOT NULL,
    -- True when schema validity failed. Distinguished from a low score because it
    -- is a structural failure, not a judgement, and the UI says so differently.
    hard_gated          BOOLEAN     NOT NULL DEFAULT false,

    -- [{name, value, weight, contribution, present, description}]
    components_json     JSONB       NOT NULL DEFAULT '[]',
    -- The signal that cost the most confidence. What the gate shows first.
    weakest_signal      TEXT,
    -- The sentence a reviewer reads. Never just a number.
    explanation         TEXT,

    -- Which thresholds were in force, so a historical decision can be understood
    -- after they are retuned. Without this, calibration would compare scores against
    -- a policy that no longer exists.
    thresholds_json     JSONB,

    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT confidence_scores_action_check
        CHECK (action IN ('commit', 'commit_flagged', 'gate', 'fail')),
    CONSTRAINT confidence_scores_range_check
        CHECK (score >= 0 AND score <= 1)
);

CREATE INDEX IF NOT EXISTS confidence_scores_run_idx
    ON confidence_scores (run_id, node_id);
-- Calibration and the per-agent history the gate payload shows.
CREATE INDEX IF NOT EXISTS confidence_scores_node_history_idx
    ON confidence_scores (workflow_id, node_id, created_at DESC);
-- Control's low-confidence feed.
CREATE INDEX IF NOT EXISTS confidence_scores_flagged_idx
    ON confidence_scores (workspace_id, created_at DESC)
    WHERE action IN ('commit_flagged', 'gate');

COMMENT ON TABLE confidence_scores IS
    'Per-node confidence with its full component breakdown. The breakdown is what '
    'makes "why 0.62?" answerable and the routing trustworthy.';

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. Per-node routing and verification config
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Thresholds live on the contract because a contract already IS the per-node
-- reliability policy, and splitting "what correct means" from "how sure we must be"
-- across two tables would let them drift.

ALTER TABLE node_contracts
    -- {commit: 0.90, flag: 0.70, gate: 0.50}. Null uses the plan defaults.
    ADD COLUMN IF NOT EXISTS confidence_thresholds_json JSONB,
    -- Per-agent signal weights. Null uses the defaults in ConfidenceScorer.
    ADD COLUMN IF NOT EXISTS confidence_weights_json    JSONB,
    -- Layer 4, opt-in. N samples; 0 or null disables. The UI shows the cost delta
    -- BEFORE this is set, which is the whole point of making it explicit.
    ADD COLUMN IF NOT EXISTS self_consistency_samples   INTEGER NOT NULL DEFAULT 0,
    -- Layer 4, opt-in. The connection used for the cheap reviewing model.
    ADD COLUMN IF NOT EXISTS critic_connection_id       UUID,
    ADD COLUMN IF NOT EXISTS critic_model               TEXT;

COMMENT ON COLUMN node_contracts.self_consistency_samples IS
    'N samples for self-consistency. 0 disables. At N=3 this is +200% cost, which '
    'the inspector shows before the user enables it.';

-- Plan-level defaults, so a workspace can be stricter across the board.
ALTER TABLE workspace_usage_policies
    ADD COLUMN IF NOT EXISTS confidence_thresholds_json JSONB;

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. Gate payload and reviewer decisions
-- ═══════════════════════════════════════════════════════════════════════════
--
-- run_approvals already carries decision_context_json and evidence_refs_json from
-- V027. What a confidence gate adds is the score, the corrected output when a
-- reviewer edits one, and the four-way action.

ALTER TABLE run_approvals
    ADD COLUMN IF NOT EXISTS confidence_score_id UUID REFERENCES confidence_scores(id),
    -- approve | approve_with_correction | reject | send_back
    ADD COLUMN IF NOT EXISTS decision_action     TEXT,
    -- The output as the reviewer corrected it. This is what flows downstream, and
    -- it is deliberately stored separately from the original: the agent's answer and
    -- the human's answer are both evidence, and overwriting the first destroys the
    -- comparison that makes this an eval case.
    ADD COLUMN IF NOT EXISTS corrected_output_json JSONB,
    -- The output as the agent produced it, frozen at gate time.
    ADD COLUMN IF NOT EXISTS original_output_json  JSONB;

DO $$ BEGIN
    ALTER TABLE run_approvals ADD CONSTRAINT run_approvals_decision_action_check
        CHECK (decision_action IS NULL OR decision_action IN
               ('approve', 'approve_with_correction', 'reject', 'send_back'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

COMMENT ON COLUMN run_approvals.corrected_output_json IS
    'Reviewer-corrected output. Flows downstream in place of the agent output, and '
    'is captured as an eval case - a human-verified correct answer for a case the '
    'agent got wrong is the most valuable training signal available.';

-- ═══════════════════════════════════════════════════════════════════════════
-- 4. Corrections as eval cases
-- ═══════════════════════════════════════════════════════════════════════════
--
-- "Capture these corrections; they are ideal eval cases."
--
-- A separate table rather than a view over run_approvals, because an eval case
-- outlives the run that produced it: runs are subject to retention, and an eval
-- suite that silently shrinks when logs expire is worse than none.

CREATE TABLE IF NOT EXISTS eval_cases (
    id              UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    workspace_id    UUID        NOT NULL,
    workflow_id     UUID        NOT NULL,
    node_id         TEXT        NOT NULL,

    -- The node input, so the case can be replayed against a new prompt or model.
    input_json      JSONB       NOT NULL,
    -- What the agent said.
    agent_output_json JSONB,
    -- What a human said was correct. The expected value for the eval.
    expected_output_json JSONB  NOT NULL,

    -- correction | hard_negative | regression
    source          TEXT        NOT NULL DEFAULT 'correction',
    -- The confidence the agent had when it got this wrong. Directly useful: a
    -- correction on a 0.95-confidence output is a calibration failure, not just a
    -- wrong answer.
    confidence_at_capture DOUBLE PRECISION,
    source_run_id   UUID,
    captured_by     TEXT,
    note            TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT eval_cases_source_check
        CHECK (source IN ('correction', 'hard_negative', 'regression'))
);

CREATE INDEX IF NOT EXISTS eval_cases_node_idx
    ON eval_cases (workflow_id, node_id, created_at DESC);

COMMENT ON TABLE eval_cases IS
    'Human-verified correct answers, mostly captured from approve-with-correction. '
    'Kept separate from run_approvals so a case outlives the run retention window.';

-- ═══════════════════════════════════════════════════════════════════════════
-- 5. Calibration — does confidence predict correctness?
-- ═══════════════════════════════════════════════════════════════════════════
--
-- "If 0.6-confidence outputs are approved 95% of the time, the threshold is too low
--  and you are wasting reviewer attention."
--
-- A view rather than a table: it is derived entirely from decisions already
-- recorded, and materialising it would create a second thing to keep in sync with
-- the first for no gain at this volume.
--
-- Bucketed by decile so a recommendation has enough samples to mean something. A
-- per-score calibration curve looks precise and is noise.

CREATE OR REPLACE VIEW confidence_calibration AS
SELECT
    c.workflow_id,
    c.node_id,
    -- 0.6 -> "0.6-0.7"
    width_bucket(c.score, 0, 1, 10) AS score_decile,
    round((width_bucket(c.score, 0, 1, 10) - 1) * 0.1, 1) AS band_low,
    round(width_bucket(c.score, 0, 1, 10) * 0.1, 1)       AS band_high,
    count(*)                                               AS gated_count,
    count(*) FILTER (WHERE a.decision_action = 'approve')  AS approved_clean,
    count(*) FILTER (WHERE a.decision_action = 'approve_with_correction') AS approved_corrected,
    count(*) FILTER (WHERE a.decision_action IN ('reject', 'send_back'))  AS rejected,
    -- The number that matters. High approval in a low band means the threshold is
    -- too low and reviewers are being interrupted for nothing.
    round(
        (count(*) FILTER (WHERE a.decision_action = 'approve'))::numeric
        / NULLIF(count(*), 0), 3
    ) AS clean_approval_rate
  FROM confidence_scores c
  JOIN run_approvals a ON a.confidence_score_id = c.id
 WHERE a.decision_action IS NOT NULL
 GROUP BY c.workflow_id, c.node_id, width_bucket(c.score, 0, 1, 10);

COMMENT ON VIEW confidence_calibration IS
    'Score band vs human verdict, per node. A high clean-approval rate in a low band '
    'means the gate threshold is too low and reviewer attention is being wasted.';
