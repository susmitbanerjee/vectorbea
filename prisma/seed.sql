-- =============================================================================
-- Vectorbea Agent Scheduler — Seed Data
-- Run this in your database SQL editor AFTER running the migration SQL.
-- Safe to re-run (uses ON CONFLICT DO NOTHING / DO UPDATE).
--
-- Endpoints point to local mock agents (http://localhost:3000/api/mock-agents/*).
-- Change the base URL below if your app runs on a different port or is deployed.
-- =============================================================================

DO $$
DECLARE
  base_url  TEXT := 'http://localhost:3000';   -- ← change for deployed environments

  org_id    TEXT := 'org_acme_vectorbea_seed';
  user_id   TEXT := 'user_seed_owner_vectorbea';

  job1_id   TEXT := 'job_seed_triage_vectorbea';
  job2_id   TEXT := 'job_seed_crm_approval_vectorbea';
  job3_id   TEXT := 'job_seed_payment_fail_vectorbea';
  job4_id   TEXT := 'job_seed_slow_timeout_vectorbea';
BEGIN

-- ── Organization ──────────────────────────────────────────────────────────────
INSERT INTO organizations (id, name, slug, created_at, updated_at)
VALUES (org_id, 'Acme Corp', 'acme-corp', NOW(), NOW())
ON CONFLICT (slug) DO NOTHING;

-- ── Owner user ────────────────────────────────────────────────────────────────
INSERT INTO users (id, organization_id, email, name, role, created_at, updated_at)
VALUES (user_id, org_id, 'seed@vectorbea.com', 'Seed Admin', 'OWNER', NOW(), NOW())
ON CONFLICT (organization_id, email) DO NOTHING;

-- ── Job 1: Daily Support Ticket Triage (success mock) ────────────────────────
INSERT INTO agent_jobs (
  id, organization_id, name, description, status,
  trigger_type, cron_expression, timezone,
  endpoint_url, http_method,
  max_duration_seconds, max_retries, retry_backoff_seconds,
  require_approval_before_run, require_approval_before_external_action,
  created_by_user_id, created_at, updated_at
) VALUES (
  job1_id, org_id,
  'Daily Support Ticket Triage',
  'Scans open support tickets each morning, categorises by urgency, and drafts initial responses. Uses the success mock endpoint.',
  'ACTIVE',
  'CRON', '0 8 * * *', 'America/New_York',
  base_url || '/api/mock-agents/success', 'POST',
  120, 3, 30,
  false, false,
  user_id, NOW(), NOW()
) ON CONFLICT (id) DO UPDATE SET
  endpoint_url = base_url || '/api/mock-agents/success',
  updated_at   = NOW();

INSERT INTO budget_policies (
  id, organization_id, agent_job_id,
  max_tokens_per_run, max_cost_usd_per_run, max_runs_per_day, max_runs_per_month,
  created_at, updated_at
) VALUES (
  'bp_seed_1', org_id, job1_id,
  50000, 0.50, 3, 62,
  NOW(), NOW()
) ON CONFLICT (agent_job_id) DO NOTHING;

-- ── Job 2: CRM Enrichment with Approval (approval mock) ──────────────────────
INSERT INTO agent_jobs (
  id, organization_id, name, description, status,
  trigger_type, cron_expression, timezone,
  endpoint_url, http_method,
  max_duration_seconds, max_retries, retry_backoff_seconds,
  require_approval_before_run, require_approval_before_external_action,
  created_by_user_id, created_at, updated_at
) VALUES (
  job2_id, org_id,
  'CRM Enrichment with Approval',
  'Analyses customer records and proposes CRM updates. Pauses for human approval before writing. Uses the approval mock endpoint.',
  'ACTIVE',
  'MANUAL', NULL, 'UTC',
  base_url || '/api/mock-agents/approval', 'POST',
  300, 2, 60,
  false, true,
  user_id, NOW(), NOW()
) ON CONFLICT (id) DO UPDATE SET
  endpoint_url = base_url || '/api/mock-agents/approval',
  updated_at   = NOW();

INSERT INTO budget_policies (
  id, organization_id, agent_job_id,
  max_tokens_per_run, max_cost_usd_per_run, max_runs_per_day, max_runs_per_month,
  created_at, updated_at
) VALUES (
  'bp_seed_2', org_id, job2_id,
  10000, 0.10, 5, 50,
  NOW(), NOW()
) ON CONFLICT (agent_job_id) DO NOTHING;

-- ── Job 3: Failed Payment Recovery (fail mock) ───────────────────────────────
INSERT INTO agent_jobs (
  id, organization_id, name, description, status,
  trigger_type, cron_expression, timezone,
  endpoint_url, http_method,
  max_duration_seconds, max_retries, retry_backoff_seconds,
  require_approval_before_run, require_approval_before_external_action,
  created_by_user_id, created_at, updated_at
) VALUES (
  job3_id, org_id,
  'Failed Payment Recovery',
  'Triggered manually on payment failure. Demonstrates the FAILED run state, error messages, and the retry flow. Uses the fail mock endpoint.',
  'ACTIVE',
  'MANUAL', NULL, 'UTC',
  base_url || '/api/mock-agents/fail', 'POST',
  60, 3, 30,
  false, false,
  user_id, NOW(), NOW()
) ON CONFLICT (id) DO UPDATE SET
  endpoint_url = base_url || '/api/mock-agents/fail',
  updated_at   = NOW();

INSERT INTO budget_policies (
  id, organization_id, agent_job_id,
  max_tokens_per_run, max_cost_usd_per_run, max_runs_per_day, max_runs_per_month,
  created_at, updated_at
) VALUES (
  'bp_seed_3', org_id, job3_id,
  5000, 0.05, 10, 100,
  NOW(), NOW()
) ON CONFLICT (agent_job_id) DO NOTHING;

-- ── Job 4: Slow Batch Processor (slow / timeout mock) ────────────────────────
INSERT INTO agent_jobs (
  id, organization_id, name, description, status,
  trigger_type, cron_expression, timezone,
  endpoint_url, http_method,
  max_duration_seconds, max_retries, retry_backoff_seconds,
  require_approval_before_run, require_approval_before_external_action,
  created_by_user_id, created_at, updated_at
) VALUES (
  job4_id, org_id,
  'Slow Batch Processor (Timeout Test)',
  'Deliberately slow agent that sleeps 35 s. Set maxDurationSeconds=10 on this job to observe timeout detection. Uses the slow mock endpoint.',
  'ACTIVE',
  'MANUAL', NULL, 'UTC',
  base_url || '/api/mock-agents/slow', 'POST',
  10, 2, 15,
  false, false,
  user_id, NOW(), NOW()
) ON CONFLICT (id) DO UPDATE SET
  endpoint_url = base_url || '/api/mock-agents/slow',
  updated_at   = NOW();

-- ── Audit log entries ─────────────────────────────────────────────────────────
INSERT INTO audit_logs (id, organization_id, actor_user_id, entity_type, entity_id, action, metadata_json, created_at)
VALUES
  ('al_seed_1', org_id, user_id, 'AgentJob', job1_id, 'job.created', '{"name":"Daily Support Ticket Triage","triggerType":"CRON","endpoint":"mock/success"}'::jsonb,  NOW()),
  ('al_seed_2', org_id, user_id, 'AgentJob', job2_id, 'job.created', '{"name":"CRM Enrichment with Approval","triggerType":"MANUAL","endpoint":"mock/approval"}'::jsonb, NOW()),
  ('al_seed_3', org_id, user_id, 'AgentJob', job3_id, 'job.created', '{"name":"Failed Payment Recovery","triggerType":"MANUAL","endpoint":"mock/fail"}'::jsonb,      NOW()),
  ('al_seed_4', org_id, user_id, 'AgentJob', job4_id, 'job.created', '{"name":"Slow Batch Processor","triggerType":"MANUAL","endpoint":"mock/slow"}'::jsonb,           NOW())
ON CONFLICT (id) DO NOTHING;

END $$;
