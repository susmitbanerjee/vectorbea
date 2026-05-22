-- =============================================================================
-- Vectorbea Agent Scheduler — Seed Data
-- Run this in Supabase SQL Editor AFTER running the migration SQL.
-- =============================================================================

DO $$
DECLARE
  org_id   TEXT := 'org_acme_vectorbea_seed';
  user_id  TEXT := 'user_seed_owner_vectorbea';
  job1_id  TEXT := 'job_seed_triage_vectorbea';
  job2_id  TEXT := 'job_seed_health_vectorbea';
  job3_id  TEXT := 'job_seed_payment_vectorbea';
BEGIN

-- ── Organization ──────────────────────────────────────────────────────────────
INSERT INTO organizations (id, name, slug, created_at, updated_at)
VALUES (org_id, 'Acme Corp', 'acme-corp', NOW(), NOW())
ON CONFLICT (slug) DO NOTHING;

-- ── Owner user ────────────────────────────────────────────────────────────────
INSERT INTO users (id, organization_id, email, name, role, created_at, updated_at)
VALUES (user_id, org_id, 'seed@vectorbea.com', 'Seed Admin', 'OWNER', NOW(), NOW())
ON CONFLICT (organization_id, email) DO NOTHING;

-- ── Agent Job 1: Daily Support Triage ────────────────────────────────────────
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
  'Scans open support tickets each morning, categorises by urgency, and drafts initial responses.',
  'ACTIVE',
  'CRON', '0 8 * * *', 'America/New_York',
  'https://hooks.example.com/agents/triage', 'POST',
  600, 3, 60, false, true,
  user_id, NOW(), NOW()
) ON CONFLICT (id) DO NOTHING;

INSERT INTO budget_policies (
  id, organization_id, agent_job_id,
  max_tokens_per_run, max_cost_usd_per_run, max_runs_per_day, max_runs_per_month,
  created_at, updated_at
) VALUES (
  'bp_seed_1', org_id, job1_id,
  200000, 2.00, 1, 31,
  NOW(), NOW()
) ON CONFLICT (agent_job_id) DO NOTHING;

-- ── Agent Job 2: Weekly Account Health ───────────────────────────────────────
INSERT INTO agent_jobs (
  id, organization_id, name, description, status,
  trigger_type, cron_expression, timezone,
  endpoint_url, http_method,
  max_duration_seconds, max_retries, retry_backoff_seconds,
  require_approval_before_run, require_approval_before_external_action,
  created_by_user_id, created_at, updated_at
) VALUES (
  job2_id, org_id,
  'Weekly Account Health Report',
  'Analyses account usage trends every Monday morning and emails a health summary to the CS team.',
  'ACTIVE',
  'CRON', '0 9 * * 1', 'UTC',
  'https://hooks.example.com/agents/account-health', 'POST',
  1200, 2, 120, false, false,
  user_id, NOW(), NOW()
) ON CONFLICT (id) DO NOTHING;

INSERT INTO budget_policies (
  id, organization_id, agent_job_id,
  max_tokens_per_run, max_cost_usd_per_run, max_runs_per_day, max_runs_per_month,
  created_at, updated_at
) VALUES (
  'bp_seed_2', org_id, job2_id,
  500000, 5.00, 1, 5,
  NOW(), NOW()
) ON CONFLICT (agent_job_id) DO NOTHING;

-- ── Agent Job 3: Failed Payment Recovery ─────────────────────────────────────
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
  'Triggered manually when a payment fails. Drafts a personalised recovery email and updates CRM notes. Requires approval before sending.',
  'ACTIVE',
  'MANUAL', NULL, 'UTC',
  'https://hooks.example.com/agents/payment-recovery', 'POST',
  300, 1, 30, false, true,
  user_id, NOW(), NOW()
) ON CONFLICT (id) DO NOTHING;

-- ── Audit log entries for seed jobs ──────────────────────────────────────────
INSERT INTO audit_logs (id, organization_id, actor_user_id, entity_type, entity_id, action, metadata_json, created_at)
VALUES
  ('al_seed_1', org_id, user_id, 'AgentJob', job1_id, 'job.created', '{"name":"Daily Support Ticket Triage","triggerType":"CRON"}'::jsonb, NOW()),
  ('al_seed_2', org_id, user_id, 'AgentJob', job2_id, 'job.created', '{"name":"Weekly Account Health Report","triggerType":"CRON"}'::jsonb, NOW()),
  ('al_seed_3', org_id, user_id, 'AgentJob', job3_id, 'job.created', '{"name":"Failed Payment Recovery","triggerType":"MANUAL"}'::jsonb, NOW())
ON CONFLICT (id) DO NOTHING;

END $$;
