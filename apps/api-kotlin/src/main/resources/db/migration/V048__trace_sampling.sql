-- V048 — workspace-configurable trace sampling rate.
--
-- §12.1: "sample successful long runs at a workspace-configurable rate. Never
-- sample a run that had a failed step, an approval or a budget clamp."
--
-- Default 1.0 — keep everything. A retention knob whose default throws data away
-- is a knob that loses somebody's incident evidence before they know it exists.

ALTER TABLE workspace_usage_policies
    ADD COLUMN IF NOT EXISTS trace_sample_rate NUMERIC(4,3) NOT NULL DEFAULT 1.000;

ALTER TABLE workspace_usage_policies
    DROP CONSTRAINT IF EXISTS workspace_usage_policies_trace_sample_rate_range;
ALTER TABLE workspace_usage_policies
    ADD CONSTRAINT workspace_usage_policies_trace_sample_rate_range
    CHECK (trace_sample_rate >= 0 AND trace_sample_rate <= 1);

COMMENT ON COLUMN workspace_usage_policies.trace_sample_rate IS
    'Fraction of ELIGIBLE runs whose spans reach the warm tier. Eligible means: '
    'succeeded, older than the grace window, longer than the long-run threshold, and '
    'with no failed step, no approval and no budget clamp. Everything else is kept '
    'regardless of this value. 1.0 = keep all.';
