-- Workflow Debugger: per-node debug snapshots captured only during "Debug Run" executions.
-- Normal Run Now executions never write to this table (kept lightweight & separate from logs).

CREATE TABLE IF NOT EXISTS workflow_node_debug_snapshots (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    workflow_run_id         UUID NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
    node_run_id             UUID,
    workflow_id             UUID NOT NULL,
    workspace_id            UUID NOT NULL,
    environment_id          UUID NOT NULL,

    node_id                 TEXT NOT NULL,
    node_type               TEXT NOT NULL,
    node_name               TEXT,
    attempt                 INTEGER NOT NULL DEFAULT 1,
    status                  TEXT NOT NULL, -- pending | running | success | failed | skipped | retried

    input_template_json     TEXT,
    resolved_input_json     TEXT,
    resolved_variables_json TEXT,
    variable_sources_json   TEXT,

    output_json             TEXT,
    parsed_output_json      TEXT,
    schema_validation_json  TEXT,

    error_type              TEXT,
    error_message           TEXT,
    human_failure_reason    TEXT,
    suggested_fix           TEXT,

    model_provider          TEXT,
    model_name              TEXT,
    tokens_input            INTEGER,
    tokens_output           INTEGER,
    cost_estimate           DOUBLE PRECISION,

    started_at              TIMESTAMPTZ,
    finished_at             TIMESTAMPTZ,
    duration_ms             BIGINT,

    created_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_wnds_run        ON workflow_node_debug_snapshots(workflow_run_id);
CREATE INDEX IF NOT EXISTS idx_wnds_run_node   ON workflow_node_debug_snapshots(workflow_run_id, node_id);
CREATE INDEX IF NOT EXISTS idx_wnds_workspace  ON workflow_node_debug_snapshots(workspace_id);
CREATE INDEX IF NOT EXISTS idx_wnds_created_at ON workflow_node_debug_snapshots(created_at);

-- Mark a run as a Debug Run so the worker knows to capture heavy snapshots.
ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS debug_mode BOOLEAN NOT NULL DEFAULT FALSE;
