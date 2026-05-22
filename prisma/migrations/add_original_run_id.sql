-- Migration: add original_run_id to agent_runs
-- Run this in your Neon SQL Editor after deploying.
-- This enables retry chain tracking (run → originalRun → retries[]).

ALTER TABLE agent_runs
  ADD COLUMN IF NOT EXISTS original_run_id TEXT
    REFERENCES agent_runs(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_agent_runs_original_run_id
  ON agent_runs (original_run_id);
