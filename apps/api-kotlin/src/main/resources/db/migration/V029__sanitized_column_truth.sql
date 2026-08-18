-- V029 - make the schema tell the truth about `_sanitized`, and create the table
-- those comments describe.
--
-- WHY A CREATE TABLE IS IN A COMMENTS MIGRATION
-- ---------------------------------------------
-- `step_outputs` is written by the worker on every node execution and read by
-- replay, contract stats and draft inference - and NO migration in this repository
-- creates it. Like `run_approvals` (see V027), it was introduced out-of-band, so
-- the migration chain alone could never provision a working database.
--
-- Found by running the chain against a genuinely fresh volume, which is the only
-- way this class of bug surfaces: every existing environment already had the table,
-- so nothing failed until a new one was created.
--
-- The definition below matches exactly what `StepOutputStore` writes and what the
-- V030 inference function reads. Created idempotently, so an existing database is
-- untouched. Recorded as D32.

CREATE TABLE IF NOT EXISTS step_outputs (
    id                              UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    run_id                          UUID        NOT NULL,
    workspace_id                    UUID        NOT NULL,
    environment_id                  UUID        NOT NULL,
    node_id                         TEXT        NOT NULL,
    node_type                       TEXT        NOT NULL,
    -- The `_sanitized` suffix is historical and inaccurate; see the comments below.
    raw_output_json_sanitized       JSONB,
    extracted_output_json_sanitized JSONB,
    validated_output_json_sanitized JSONB,
    validation_errors_json          JSONB,
    created_at                      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at                      TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- StepOutputStore upserts on (run_id, node_id); without this the ON CONFLICT
    -- has no arbiter and every re-execution of a node inserts a duplicate row,
    -- which replay would then read non-deterministically.
    CONSTRAINT step_outputs_run_node_key UNIQUE (run_id, node_id)
);

CREATE INDEX IF NOT EXISTS idx_step_outputs_run_id ON step_outputs (run_id);

-- ═══════════════════════════════════════════════════════════════════════════
-- 4. Tell the truth about `_sanitized` (§4.2)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- The investigation in docs/architecture/REPLAY-FIDELITY.md found that these
-- columns are named `_sanitized` and are NOT sanitised: `StepOutputStore.save`
-- writes `toJson(output)` with no redaction, and `RunEventStore` stores whatever
-- the caller passed.
--
-- That is good news for replay - the substrate is lossless, which is why replay is
-- byte-identical - and bad news for anyone who reads the column name and concludes
-- the content is safe to expose. Renaming is the honest fix and touches the worker,
-- the API and three repositories; it is its own change (TECH-DEBT D24). Until then
-- the schema itself says so, so a developer who checks gets the truth.

COMMENT ON COLUMN step_outputs.raw_output_json_sanitized IS
    'MISLEADING NAME: content is NOT sanitised. StepOutputStore writes the node output '
    'verbatim. Safe for replay (lossless); NOT safe to assume redacted. See D24.';
COMMENT ON COLUMN step_outputs.extracted_output_json_sanitized IS
    'MISLEADING NAME: content is NOT sanitised. See D24.';
COMMENT ON COLUMN step_outputs.validated_output_json_sanitized IS
    'MISLEADING NAME: content is NOT sanitised. See D24.';
COMMENT ON COLUMN run_events.output_json_sanitized IS
    'Sanitisation is the CALLER''s responsibility - RunEventStore stores as-is. '
    'Whether any given row is redacted depends on the call site. See D24.';
COMMENT ON COLUMN run_events.input_json_sanitized IS
    'Sanitisation is the CALLER''s responsibility - RunEventStore stores as-is. See D24.';
