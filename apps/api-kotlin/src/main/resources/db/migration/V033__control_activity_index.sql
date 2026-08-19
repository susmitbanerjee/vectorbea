-- Control reads the newest events across all runs in a workspace. The existing
-- indexes begin with run_id or workspace_id alone and therefore still require a
-- sort of the workspace's full event history for every refresh.
CREATE INDEX IF NOT EXISTS idx_run_events_workspace_timestamp
    ON run_events (workspace_id, timestamp DESC);
