-- ─────────────────────────────────────────────────────────────────────────────
-- Move platform entity tables from public → vectorbea schema.
-- Each block is idempotent:
--   • If the table is in public, it is moved with SET SCHEMA (preserves data,
--     indexes, triggers, and intra-group FK constraints).
--   • CREATE TABLE IF NOT EXISTS is then a no-op (table now in vectorbea).
--   • On a fresh install the move block is skipped and CREATE TABLE creates it
--     directly in vectorbea.
-- Run order respects FK dependencies:
--   platform_workflows → platform_runs → platform_run_events
--                      → workflow_graphs
--                      → workflow_versions
--   connections (already vectorbea) → connection_secrets
-- ─────────────────────────────────────────────────────────────────────────────

CREATE SCHEMA IF NOT EXISTS vectorbea;

-- ── 1. platform_workflows ─────────────────────────────────────────────────────
DO $$ BEGIN
  IF to_regclass('public.platform_workflows') IS NOT NULL
     AND to_regclass('vectorbea.platform_workflows') IS NULL THEN
    ALTER TABLE public.platform_workflows SET SCHEMA vectorbea;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS vectorbea.platform_workflows (
  id              uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    uuid         NOT NULL,
  name            text         NOT NULL,
  slug            text         NOT NULL,
  description     text         NOT NULL DEFAULT '',
  status          text         NOT NULL DEFAULT 'draft',
  creation_mode   text         NOT NULL DEFAULT 'native',
  trigger_type    text         NOT NULL DEFAULT 'manual',
  current_version text         NOT NULL DEFAULT 'v1',
  input_schema    jsonb        NOT NULL DEFAULT '{}',
  output_schema   jsonb        NOT NULL DEFAULT '{}',
  retry_policy    jsonb        NOT NULL DEFAULT '{"maxAttempts":2,"backoffType":"exponential","backoffMs":2000}',
  budget_policy   jsonb        NOT NULL DEFAULT '{}',
  approval_policy jsonb        NOT NULL DEFAULT '{"requireApproval":false}',
  total_runs      integer      NOT NULL DEFAULT 0,
  success_rate    numeric(5,2) NOT NULL DEFAULT 0,
  last_run_at     timestamptz,
  last_run_status text,
  created_at      timestamptz  NOT NULL DEFAULT now(),
  updated_at      timestamptz  NOT NULL DEFAULT now(),
  CONSTRAINT platform_workflows_workspace_slug_unique UNIQUE (workspace_id, slug),
  CONSTRAINT platform_workflows_status_check CHECK (status IN ('active','paused','draft','archived'))
);

CREATE INDEX IF NOT EXISTS idx_platform_workflows_workspace ON vectorbea.platform_workflows (workspace_id);
CREATE INDEX IF NOT EXISTS idx_platform_workflows_status   ON vectorbea.platform_workflows (workspace_id, status);
CREATE INDEX IF NOT EXISTS idx_platform_workflows_updated  ON vectorbea.platform_workflows (updated_at DESC);

-- ── 2. platform_agents ────────────────────────────────────────────────────────
DO $$ BEGIN
  IF to_regclass('public.platform_agents') IS NOT NULL
     AND to_regclass('vectorbea.platform_agents') IS NULL THEN
    ALTER TABLE public.platform_agents SET SCHEMA vectorbea;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS vectorbea.platform_agents (
  id                uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id      uuid         NOT NULL,
  name              text         NOT NULL,
  slug              text         NOT NULL,
  description       text         NOT NULL DEFAULT '',
  role              text         NOT NULL DEFAULT '',
  instructions      text         NOT NULL DEFAULT '',
  type              text         NOT NULL DEFAULT 'native_llm_agent',
  model_provider    text         NOT NULL DEFAULT 'openai',
  model_name        text         NOT NULL DEFAULT 'gpt-4.1-mini',
  temperature       numeric(4,2) NOT NULL DEFAULT 0.1,
  max_iterations    integer      NOT NULL DEFAULT 10,
  llm_connection_id uuid,
  allowed_tool_ids  text[]       NOT NULL DEFAULT '{}',
  memory_policy     jsonb        NOT NULL DEFAULT '{"type":"session"}',
  retry_policy      jsonb        NOT NULL DEFAULT '{"maxAttempts":2,"backoffType":"exponential","backoffMs":2000}',
  timeout_policy    jsonb        NOT NULL DEFAULT '{"stepTimeoutMs":60000,"runTimeoutMs":600000}',
  approval_policy   jsonb        NOT NULL DEFAULT '{"requireApproval":false}',
  status            text         NOT NULL DEFAULT 'active',
  total_runs        integer      NOT NULL DEFAULT 0,
  last_used_at      timestamptz,
  created_at        timestamptz  NOT NULL DEFAULT now(),
  updated_at        timestamptz  NOT NULL DEFAULT now(),
  CONSTRAINT platform_agents_workspace_slug_unique UNIQUE (workspace_id, slug),
  CONSTRAINT platform_agents_status_check CHECK (status IN ('active','paused','archived'))
);

CREATE INDEX IF NOT EXISTS idx_platform_agents_workspace ON vectorbea.platform_agents (workspace_id);
CREATE INDEX IF NOT EXISTS idx_platform_agents_status   ON vectorbea.platform_agents (workspace_id, status);

-- ── 3. platform_tools ─────────────────────────────────────────────────────────
DO $$ BEGIN
  IF to_regclass('public.platform_tools') IS NOT NULL
     AND to_regclass('vectorbea.platform_tools') IS NULL THEN
    ALTER TABLE public.platform_tools SET SCHEMA vectorbea;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS vectorbea.platform_tools (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id        uuid        NOT NULL,
  name                text        NOT NULL,
  slug                text        NOT NULL,
  description         text        NOT NULL DEFAULT '',
  type                text        NOT NULL DEFAULT 'http',
  input_schema        jsonb       NOT NULL DEFAULT '{}',
  output_schema       jsonb       NOT NULL DEFAULT '{}',
  risk_level          text        NOT NULL DEFAULT 'read_only',
  timeout_ms          integer     NOT NULL DEFAULT 10000,
  retry_policy        jsonb       NOT NULL DEFAULT '{"maxAttempts":3,"backoffType":"exponential","backoffMs":1000}',
  idempotent          boolean     NOT NULL DEFAULT true,
  connection_id       uuid,
  connection_name     text,
  auth_connection_ref text,
  http_config         jsonb,
  status              text        NOT NULL DEFAULT 'active',
  total_calls         integer     NOT NULL DEFAULT 0,
  last_used_at        timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT platform_tools_workspace_slug_unique UNIQUE (workspace_id, slug),
  CONSTRAINT platform_tools_status_check    CHECK (status IN ('active','paused','archived')),
  CONSTRAINT platform_tools_risk_check      CHECK (risk_level IN ('read_only','low_risk_write','high_risk_write','irreversible'))
);

CREATE INDEX IF NOT EXISTS idx_platform_tools_workspace  ON vectorbea.platform_tools (workspace_id);
CREATE INDEX IF NOT EXISTS idx_platform_tools_connection ON vectorbea.platform_tools (connection_id) WHERE connection_id IS NOT NULL;

-- ── 4. platform_runs ──────────────────────────────────────────────────────────
DO $$ BEGIN
  IF to_regclass('public.platform_runs') IS NOT NULL
     AND to_regclass('vectorbea.platform_runs') IS NULL THEN
    ALTER TABLE public.platform_runs SET SCHEMA vectorbea;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS vectorbea.platform_runs (
  id                 uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id       uuid          NOT NULL,
  workflow_id        uuid          REFERENCES vectorbea.platform_workflows(id) ON DELETE SET NULL,
  workflow_name      text          NOT NULL,
  workflow_version   text          NOT NULL DEFAULT 'v1',
  creation_mode      text          NOT NULL DEFAULT 'native',
  status             text          NOT NULL DEFAULT 'queued',
  trigger_type       text          NOT NULL DEFAULT 'manual',
  trigger_source     text          NOT NULL DEFAULT 'manual',
  input_json         jsonb,
  output_json        jsonb,
  error_json         jsonb,
  idempotency_key    text          UNIQUE,
  started_at         timestamptz,
  completed_at       timestamptz,
  duration_ms        integer,
  total_tokens       integer,
  estimated_cost_usd numeric(12,6),
  created_at         timestamptz   NOT NULL DEFAULT now(),
  updated_at         timestamptz   NOT NULL DEFAULT now(),
  CONSTRAINT platform_runs_status_check CHECK (status IN (
    'queued','running','waiting_for_approval','paused','succeeded','failed','cancelled','timed_out'
  ))
);

CREATE INDEX IF NOT EXISTS idx_platform_runs_workspace ON vectorbea.platform_runs (workspace_id);
CREATE INDEX IF NOT EXISTS idx_platform_runs_workflow  ON vectorbea.platform_runs (workflow_id) WHERE workflow_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_platform_runs_status    ON vectorbea.platform_runs (workspace_id, status);
CREATE INDEX IF NOT EXISTS idx_platform_runs_created   ON vectorbea.platform_runs (workspace_id, created_at DESC);

-- ── 5. platform_run_events ────────────────────────────────────────────────────
DO $$ BEGIN
  IF to_regclass('public.platform_run_events') IS NOT NULL
     AND to_regclass('vectorbea.platform_run_events') IS NULL THEN
    ALTER TABLE public.platform_run_events SET SCHEMA vectorbea;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS vectorbea.platform_run_events (
  id                      uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id                  uuid        NOT NULL REFERENCES vectorbea.platform_runs(id) ON DELETE CASCADE,
  workspace_id            uuid        NOT NULL,
  sequence                integer     NOT NULL,
  type                    text        NOT NULL,
  status                  text        NOT NULL DEFAULT 'SUCCEEDED',
  source                  text        NOT NULL,
  timestamp               timestamptz NOT NULL DEFAULT now(),
  duration_ms             integer,
  agent_id                uuid,
  agent_name              text,
  tool_id                 uuid,
  tool_name               text,
  connection_id           uuid,
  model_name              text,
  parent_event_id         uuid,
  title                   text        NOT NULL DEFAULT '',
  summary                 text,
  input_json_sanitized    jsonb,
  output_json_sanitized   jsonb,
  metadata_json_sanitized jsonb,
  error_json_sanitized    jsonb,
  tokens_used             integer,
  estimated_cost_usd      numeric(12,6),
  handoff_to              text,
  artifact_name           text,
  actor_name              text,
  approval_json           jsonb,
  created_at              timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT platform_run_events_run_sequence_unique UNIQUE (run_id, sequence)
);

CREATE INDEX IF NOT EXISTS idx_platform_run_events_run       ON vectorbea.platform_run_events (run_id, sequence ASC);
CREATE INDEX IF NOT EXISTS idx_platform_run_events_workspace ON vectorbea.platform_run_events (workspace_id);
CREATE INDEX IF NOT EXISTS idx_platform_run_events_type      ON vectorbea.platform_run_events (run_id, type);

-- ── 6. workflow_graphs ────────────────────────────────────────────────────────
DO $$ BEGIN
  IF to_regclass('public.workflow_graphs') IS NOT NULL
     AND to_regclass('vectorbea.workflow_graphs') IS NULL THEN
    ALTER TABLE public.workflow_graphs SET SCHEMA vectorbea;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS vectorbea.workflow_graphs (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_id  uuid        NOT NULL REFERENCES vectorbea.platform_workflows(id) ON DELETE CASCADE,
  workspace_id uuid        NOT NULL,
  graph_json   jsonb       NOT NULL DEFAULT '{"nodes":[],"edges":[],"version":"1"}',
  version      text        NOT NULL DEFAULT '1',
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT workflow_graphs_workflow_unique UNIQUE (workflow_id)
);

CREATE INDEX IF NOT EXISTS idx_workflow_graphs_workflow ON vectorbea.workflow_graphs (workflow_id);

-- ── 7. workflow_versions ──────────────────────────────────────────────────────
DO $$ BEGIN
  IF to_regclass('public.workflow_versions') IS NOT NULL
     AND to_regclass('vectorbea.workflow_versions') IS NULL THEN
    ALTER TABLE public.workflow_versions SET SCHEMA vectorbea;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS vectorbea.workflow_versions (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_id  uuid        NOT NULL REFERENCES vectorbea.platform_workflows(id) ON DELETE CASCADE,
  workspace_id uuid        NOT NULL,
  version      text        NOT NULL,
  graph_json   jsonb       NOT NULL DEFAULT '{"nodes":[],"edges":[],"version":"1"}',
  created_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT workflow_versions_workflow_version_unique UNIQUE (workflow_id, version)
);

CREATE INDEX IF NOT EXISTS idx_workflow_versions_workflow ON vectorbea.workflow_versions (workflow_id);

-- ── 8. connection_secrets ─────────────────────────────────────────────────────
-- FK references vectorbea.connections (already in vectorbea schema).
DO $$ BEGIN
  IF to_regclass('public.connection_secrets') IS NOT NULL
     AND to_regclass('vectorbea.connection_secrets') IS NULL THEN
    ALTER TABLE public.connection_secrets SET SCHEMA vectorbea;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS vectorbea.connection_secrets (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid        NOT NULL,
  connection_id uuid        NOT NULL REFERENCES vectorbea.connections(id) ON DELETE CASCADE,
  secret_ref    text        NOT NULL UNIQUE,
  ciphertext    text        NOT NULL,
  key_version   integer     NOT NULL DEFAULT 1,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT connection_secrets_connection_unique UNIQUE (connection_id)
);

CREATE INDEX IF NOT EXISTS idx_connection_secrets_workspace  ON vectorbea.connection_secrets (workspace_id);
CREATE INDEX IF NOT EXISTS idx_connection_secrets_secret_ref ON vectorbea.connection_secrets (secret_ref);

-- ── Auto-update triggers (vectorbea schema) ───────────────────────────────────

CREATE OR REPLACE FUNCTION vectorbea.update_platform_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_platform_workflows_updated_at'
                 AND tgrelid = 'vectorbea.platform_workflows'::regclass) THEN
    CREATE TRIGGER trg_platform_workflows_updated_at
      BEFORE UPDATE ON vectorbea.platform_workflows
      FOR EACH ROW EXECUTE FUNCTION vectorbea.update_platform_updated_at();
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_platform_agents_updated_at'
                 AND tgrelid = 'vectorbea.platform_agents'::regclass) THEN
    CREATE TRIGGER trg_platform_agents_updated_at
      BEFORE UPDATE ON vectorbea.platform_agents
      FOR EACH ROW EXECUTE FUNCTION vectorbea.update_platform_updated_at();
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_platform_tools_updated_at'
                 AND tgrelid = 'vectorbea.platform_tools'::regclass) THEN
    CREATE TRIGGER trg_platform_tools_updated_at
      BEFORE UPDATE ON vectorbea.platform_tools
      FOR EACH ROW EXECUTE FUNCTION vectorbea.update_platform_updated_at();
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_platform_runs_updated_at'
                 AND tgrelid = 'vectorbea.platform_runs'::regclass) THEN
    CREATE TRIGGER trg_platform_runs_updated_at
      BEFORE UPDATE ON vectorbea.platform_runs
      FOR EACH ROW EXECUTE FUNCTION vectorbea.update_platform_updated_at();
  END IF;
END $$;
