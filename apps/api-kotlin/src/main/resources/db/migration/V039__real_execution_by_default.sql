-- =============================================================================
-- V039__real_execution_by_default.sql
--
-- Going live. `workspace_beta_controls` defaulted every new workspace to
-- simulation_only, which is the right posture for a closed beta and the wrong
-- one for a shipping product: a workspace could build workflows and never run
-- one for real, with no self-service route out — the switch is behind a
-- platform-admin endpoint.
--
-- WHAT THIS DOES NOT DO: it does not re-enable anything an admin turned off.
-- The backfill touches only rows still sitting on the old default with real
-- execution never granted, and skips 'disabled' and 'rejected' workspaces
-- entirely. A workspace someone deliberately stopped stays stopped.
--
-- To keep the beta posture on a deployment, set DEFAULT_EXECUTION_MODE=
-- simulation_only — the API reads it (AppConfig.defaultExecutionMode) and it
-- governs workspaces with no controls row.
-- =============================================================================

ALTER TABLE workspace_beta_controls
    ALTER COLUMN execution_mode         SET DEFAULT 'real_execution_enabled',
    ALTER COLUMN real_execution_enabled SET DEFAULT true;

-- Approved workspaces that were never explicitly disabled or granted.
UPDATE workspace_beta_controls
   SET execution_mode         = 'real_execution_enabled',
       real_execution_enabled = true,
       updated_at             = now()
 WHERE execution_mode         = 'simulation_only'
   AND real_execution_enabled = false
   AND access_status          = 'approved'
   AND disabled_reason IS NULL;

COMMENT ON COLUMN workspace_beta_controls.real_execution_enabled IS
    'Whether workflows in this workspace may call real tools and models. '
    'Defaults true since V039; an explicit false still wins and is how a '
    'workspace is held in simulation.';
