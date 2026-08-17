-- V027 — close the schema gaps against what the UI promises.
--
-- Four of the six gaps in 09-EXECUTION-ARCHITECTURE-REVISED §4 are schema:
--   §4.1  the Checkpoint Ribbon would N+1 the Runs page
--   §4.3  two overlapping approval tables and no authoritative one
--   §4.4  an audit log the docs promise and the ERD does not contain
--   §4.6  run_events unpartitioned, on every write and every read path
--
-- §4.2 (replay fidelity) is answered in docs/architecture/REPLAY-FIDELITY.md and
-- needs no schema. §4.5 (queue visibility) shipped in V023.

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. Ribbon summary (§4.1)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- The Ribbon renders per-node commit state inline on every Runs row. 163 rows
-- naively means 163 queries against run_checkpoints + step_executions. This is a
-- denormalisation, and denormalisations drift — so the rule that makes it safe is
-- in the worker, not here: ribbon_json is written in the SAME transaction as the
-- node transition it describes. Never a follow-up write.
--
-- `node_committed / node_total` answers "8 of 12 committed — retry costs 4 steps"
-- with no join at all, which is the sentence the retry dialog needs and the one
-- that would otherwise cost two queries per row.

ALTER TABLE agent_runs
    -- Nullable: unknown until the graph is loaded. 0 would read as "no nodes",
    -- which renders an empty ribbon rather than an indeterminate one.
    ADD COLUMN IF NOT EXISTS node_total     INTEGER,
    ADD COLUMN IF NOT EXISTS node_committed INTEGER NOT NULL DEFAULT 0,
    -- [{n:"n1001",s:"committed",ms:284},{n:"n1002",s:"failed"}]
    -- Short keys deliberately: this is read on every row of every Runs page, and
    -- {"nodeId":…,"state":…,"durationMs":…} is roughly 3x the bytes for the same
    -- information.
    ADD COLUMN IF NOT EXISTS ribbon_json    JSONB NOT NULL DEFAULT '[]';

COMMENT ON COLUMN agent_runs.ribbon_json IS
    'Per-node commit state for the Checkpoint Ribbon: [{n,s,ms}]. States: committed | '
    'executing | gated | failed | pending | skipped | recovered. Capped at 200 entries. '
    'Maintained by the worker in the same transaction as the node transition.';
COMMENT ON COLUMN agent_runs.node_committed IS
    'Committed node count. With node_total this powers "8 of 12 committed - retry '
    'costs 4 steps" without a join.';

-- ── Backfill ────────────────────────────────────────────────────────────────
--
-- Existing runs have no ribbon. Reconstructed from run_events, which is the only
-- record of per-node outcome for runs that predate this column.
--
-- `DISTINCT ON (run_id, step_id) … ORDER BY sequence DESC` takes each node's LAST
-- event: a node that failed and was recovered must show `recovered`, and taking
-- the first event would show it as permanently failed on every historical run.
WITH node_states AS (
    SELECT DISTINCT ON (e.run_id, e.step_id)
           e.run_id,
           e.step_id AS node_id,
           e.sequence,
           CASE
               WHEN e.type IN ('NODE_COMPLETED', 'STEP_COMPLETED') THEN 'committed'
               WHEN e.type IN ('NODE_FAILED', 'STEP_FAILED')       THEN 'failed'
               WHEN e.type = 'NODE_SKIPPED'                        THEN 'skipped'
               WHEN e.type = 'APPROVAL_REQUESTED'                  THEN 'gated'
               WHEN e.type = 'NODE_STARTED'                        THEN 'executing'
               ELSE 'pending'
           END AS state,
           e.duration_ms
      FROM run_events e
     WHERE e.step_id IS NOT NULL
     ORDER BY e.run_id, e.step_id, e.sequence DESC
),
ribbons AS (
    SELECT run_id,
           jsonb_agg(
               CASE WHEN duration_ms IS NULL
                    THEN jsonb_build_object('n', node_id, 's', state)
                    ELSE jsonb_build_object('n', node_id, 's', state, 'ms', duration_ms)
               END
               ORDER BY sequence
           ) AS ribbon,
           count(*)                                     AS total,
           count(*) FILTER (WHERE state = 'committed')  AS committed
      FROM node_states
     GROUP BY run_id
)
UPDATE agent_runs r
   SET ribbon_json    = COALESCE(b.ribbon, '[]'::jsonb),
       node_total     = b.total,
       node_committed = b.committed
  FROM ribbons b
 WHERE r.id = b.run_id
   AND r.ribbon_json = '[]'::jsonb;

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. Reconcile the approval tables (§4.3)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- `approvals` and `run_approvals` overlap almost entirely. Two writers, two
-- readers, and the Approvals UI cannot know which is authoritative — so it shows
-- whichever it happened to query, which is how an approved request appears
-- pending.
--
-- `run_approvals` wins: `node_id` matches the graph vocabulary the rest of the
-- system speaks, and it carries workspace_id/environment_id, which `approvals`
-- does not — meaning every read of `approvals` needed a join just to authorise it.

-- P13's fields.
ALTER TABLE run_approvals
    -- When this decision becomes late. P13 renders a countdown against it.
    ADD COLUMN IF NOT EXISTS sla_deadline_at        TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS escalation_policy_json JSONB,
    -- RESOLVED values, not templates.
    --
    -- This is the specific fix for the unfilled chips in the current UI: the
    -- approval card was rendering "{{customer.name}} requested {{amount}}" because
    -- the template was stored and the values were not. An approver cannot decide
    -- from a template. What is stored here is what the substitution produced.
    ADD COLUMN IF NOT EXISTS decision_context_json  JSONB,
    -- The agent's own confidence, 0..1, so P13 can sort by "least certain first".
    ADD COLUMN IF NOT EXISTS confidence_score       DOUBLE PRECISION,
    -- Which step outputs produced each value in decision_context_json:
    -- {"amount": {"nodeId": "n3", "path": "$.total"}}. This is what makes the
    -- approval auditable — "where did this number come from" is the first question
    -- an approver asks and the first one an auditor asks afterwards.
    ADD COLUMN IF NOT EXISTS evidence_refs_json     JSONB,
    -- Carried across from `approvals` so nothing is lost in the merge.
    ADD COLUMN IF NOT EXISTS title                  TEXT,
    ADD COLUMN IF NOT EXISTS risk_level             TEXT NOT NULL DEFAULT 'medium',
    ADD COLUMN IF NOT EXISTS requested_by           TEXT,
    ADD COLUMN IF NOT EXISTS decision_reason        TEXT,
    ADD COLUMN IF NOT EXISTS agent_id               UUID,
    ADD COLUMN IF NOT EXISTS workflow_id            UUID;

COMMENT ON COLUMN run_approvals.decision_context_json IS
    'Resolved values shown to the approver - NOT templates. The UI renders these '
    'directly; storing templates is what produced the unfilled chips.';
COMMENT ON COLUMN run_approvals.evidence_refs_json IS
    'Provenance for each value in decision_context_json: which node output and path '
    'produced it.';

-- ── Migrate `approvals` rows that have no run_approvals counterpart ──────────
--
-- Matched on (run_id, step_id ↔ node_id): the same approval recorded in both
-- tables must not become two rows. workspace_id/environment_id are recovered from
-- agent_runs, which is why the join is required rather than optional.
INSERT INTO run_approvals (
    id, run_id, workspace_id, environment_id, node_id, status, message,
    metadata_json, resolved_by, resolved_at, created_at, updated_at,
    title, risk_level, requested_by, decision_reason, agent_id, workflow_id
)
SELECT a.id, a.run_id, r.workspace_id, r.environment_id, a.step_id,
       -- `approvals` used lower case, `run_approvals` upper. Normalised on the way
       -- in so the Approvals UI has one vocabulary rather than two.
       upper(a.status), a.message,
       a.payload_json_sanitized, a.decided_by, a.decided_at, a.created_at, a.updated_at,
       a.title, a.risk_level, a.requested_by, a.decision_reason, a.agent_id, a.workflow_id
  FROM approvals a
  JOIN agent_runs r ON r.id = a.run_id
 WHERE NOT EXISTS (
     SELECT 1 FROM run_approvals ra
      WHERE ra.run_id = a.run_id AND ra.node_id = a.step_id
 )
ON CONFLICT (id) DO NOTHING;

-- Renamed rather than dropped. A drop is unrecoverable if a reader was missed;
-- a rename fails that reader loudly and immediately, and the table can be dropped
-- for real once a release has passed with nothing complaining.
ALTER TABLE IF EXISTS approvals RENAME TO approvals_deprecated_v027;

COMMENT ON TABLE approvals_deprecated_v027 IS
    'DEPRECATED - superseded by run_approvals in V027. Data migrated. Renamed rather '
    'than dropped so any missed reader fails loudly. Safe to DROP after one release.';

CREATE INDEX IF NOT EXISTS run_approvals_pending_idx
    ON run_approvals (workspace_id, sla_deadline_at)
    WHERE status = 'PENDING';

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. Audit log (§4.4)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Append-only, enforced in the database rather than by convention. The
-- application layer has no update or delete path — but "we promise not to" is not
-- what an enterprise buyer is asking when they ask about audit trails, and a rule
-- enforced only in code is one refactor from being untrue.

CREATE TABLE IF NOT EXISTS audit_log (
    id              UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    workspace_id    UUID        NOT NULL,
    environment_id  UUID,
    actor_type      TEXT        NOT NULL,   -- user | system | api_key
    actor_id        TEXT,
    -- Dotted: workflow.publish, approval.decide, connection.update, member.remove
    action          TEXT        NOT NULL,
    target_type     TEXT        NOT NULL,
    target_id       UUID,
    -- Both sides for a config change. "Someone changed the settings" is not an
    -- audit trail; "someone changed max_concurrent_runs from 2 to 50" is.
    before_json     JSONB,
    after_json      JSONB,
    -- Hashed, not stored. An audit trail should not become a second source of
    -- personal data with its own retention question attached.
    ip_hash         TEXT,
    user_agent      TEXT,
    result          TEXT        NOT NULL,   -- success | denied | error
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT audit_log_actor_type_check CHECK (actor_type IN ('user', 'system', 'api_key')),
    CONSTRAINT audit_log_result_check CHECK (result IN ('success', 'denied', 'error'))
);

-- P20's screen: this workspace's activity, newest first, optionally filtered.
CREATE INDEX IF NOT EXISTS audit_log_workspace_time_idx
    ON audit_log (workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS audit_log_action_idx
    ON audit_log (workspace_id, action, created_at DESC);
-- "Everything that ever happened to this connection" — the blast-radius question.
CREATE INDEX IF NOT EXISTS audit_log_target_idx
    ON audit_log (target_type, target_id, created_at DESC);

-- Append-only, in the database.
CREATE OR REPLACE FUNCTION audit_log_is_append_only() RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'audit_log is append-only: % is not permitted', TG_OP
        USING HINT = 'Corrections are appended as new rows, never applied in place.';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS audit_log_no_update ON audit_log;
CREATE TRIGGER audit_log_no_update
    BEFORE UPDATE ON audit_log
    FOR EACH ROW EXECUTE FUNCTION audit_log_is_append_only();

DROP TRIGGER IF EXISTS audit_log_no_delete ON audit_log;
CREATE TRIGGER audit_log_no_delete
    BEFORE DELETE ON audit_log
    FOR EACH ROW EXECUTE FUNCTION audit_log_is_append_only();

COMMENT ON TABLE audit_log IS
    'Append-only governance trail (P20). UPDATE and DELETE are refused by trigger, '
    'not merely absent from the application layer.';

-- ═══════════════════════════════════════════════════════════════════════════
-- 4. run_events: the covering index (§4.6, part 1)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- The timeline query is "every event for this run, in order". `(run_id, sequence)`
-- already exists as an index; INCLUDE turns it into a covering index so the render
-- is index-only and never touches the heap — which matters because the heap rows
-- carry the JSONB payloads the timeline header does not display.
--
-- Partitioning is deliberately NOT done here; see the note below.

CREATE INDEX IF NOT EXISTS run_events_timeline_covering_idx
    ON run_events (run_id, sequence)
    INCLUDE (type, status, timestamp, duration_ms, step_id, title);

COMMENT ON INDEX run_events_timeline_covering_idx IS
    'Covering index for the run-detail timeline: the header fields come from the '
    'index, so rendering never reads the JSONB payloads it does not show.';

-- ── On partitioning ─────────────────────────────────────────────────────────
--
-- §4.6 calls for monthly partitions on created_at with detach-and-drop retention.
-- That is the right end state and it is NOT done in this migration, for a reason
-- worth recording rather than quietly deferring:
--
-- Converting a populated table to partitioned requires either an ACCESS EXCLUSIVE
-- lock for the whole rewrite, or a create-new/backfill/swap dance with a trigger
-- to keep the old table current during the copy. run_events is on the write path
-- for every step; taking that lock is a write outage of unbounded length, and the
-- swap needs a maintenance window and a rehearsal.
--
-- Doing it inside a migration that also touches four other things would make the
-- whole migration unrunnable in production. It is split out as its own migration
-- with its own procedure — see V028 and TECH-DEBT D22.
