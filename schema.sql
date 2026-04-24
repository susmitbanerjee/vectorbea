-- WARNING: This schema is for context only and is not meant to be run.
-- Table order and constraints may not be valid for execution.

CREATE TABLE vectorbea.agent_commands (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  agent_id uuid NOT NULL,
  command_type text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'pending'::text CHECK (status = ANY (ARRAY['pending'::text, 'in_progress'::text, 'completed'::text, 'failed'::text, 'cancelled'::text])),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT agent_commands_pkey PRIMARY KEY (id),
  CONSTRAINT agent_commands_agent_id_fkey FOREIGN KEY (agent_id) REFERENCES vectorbea.deployment_agents(id)
);
CREATE TABLE vectorbea.agent_metrics (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  agent_id uuid NOT NULL,
  cpu_usage_percent numeric NOT NULL DEFAULT 0 CHECK (cpu_usage_percent >= 0::numeric AND cpu_usage_percent <= 100::numeric),
  memory_usage_mb integer NOT NULL DEFAULT 0 CHECK (memory_usage_mb >= 0),
  active_replicas integer NOT NULL DEFAULT 0 CHECK (active_replicas >= 0),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  latency_ms numeric NOT NULL DEFAULT 0 CHECK (latency_ms >= 0::numeric),
  CONSTRAINT agent_metrics_pkey PRIMARY KEY (id),
  CONSTRAINT agent_metrics_agent_id_fkey FOREIGN KEY (agent_id) REFERENCES vectorbea.deployment_agents(id)
);
CREATE TABLE vectorbea.api_keys (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  key_hash text NOT NULL UNIQUE,
  key_last_four text NOT NULL DEFAULT ''::text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  key_name text NOT NULL DEFAULT ''::text,
  workspace_id uuid NOT NULL,
  key_role text NOT NULL DEFAULT 'editor'::text CHECK (key_role = ANY (ARRAY['admin'::text, 'editor'::text, 'viewer'::text])),
  CONSTRAINT api_keys_pkey PRIMARY KEY (id),
  CONSTRAINT api_keys_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES vectorbea.workspaces(id)
);
CREATE TABLE vectorbea.audit_logs (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  prompt_version_id uuid NOT NULL,
  proxy_latency_ms double precision NOT NULL DEFAULT 0 CHECK (proxy_latency_ms >= 0::double precision),
  llm_latency_ms integer NOT NULL DEFAULT 0 CHECK (llm_latency_ms >= 0),
  token_count integer NOT NULL CHECK (token_count >= 0),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  workspace_id uuid NOT NULL,
  prompt_name text NOT NULL DEFAULT ''::text,
  version_tag text NOT NULL DEFAULT ''::text,
  CONSTRAINT audit_logs_pkey PRIMARY KEY (id),
  CONSTRAINT audit_logs_prompt_version_id_fkey FOREIGN KEY (prompt_version_id) REFERENCES vectorbea.prompt_versions(id),
  CONSTRAINT audit_logs_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES vectorbea.workspaces(id)
);
CREATE TABLE vectorbea.deployment_agents (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  name text NOT NULL,
  status text NOT NULL DEFAULT 'offline'::text CHECK (status = ANY (ARRAY['online'::text, 'offline'::text, 'degraded'::text, 'error'::text])),
  last_heartbeat timestamp with time zone,
  api_token text NOT NULL UNIQUE,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT deployment_agents_pkey PRIMARY KEY (id),
  CONSTRAINT deployment_agents_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES vectorbea.workspaces(id)
);
CREATE TABLE vectorbea.org_members (
  user_id uuid NOT NULL,
  organization_id uuid NOT NULL,
  role USER-DEFINED NOT NULL DEFAULT 'member'::org_role,
  granted_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT org_members_pkey PRIMARY KEY (user_id, organization_id),
  CONSTRAINT org_members_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id),
  CONSTRAINT org_members_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES vectorbea.organizations(id)
);
CREATE TABLE vectorbea.organizations (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  name text NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  plan_tier USER-DEFINED NOT NULL DEFAULT 'free'::plan_tier,
  stripe_customer_id text,
  stripe_subscription_id text,
  max_seats integer NOT NULL DEFAULT 1 CHECK (max_seats >= 1),
  max_prompts integer NOT NULL DEFAULT 5,
  monthly_audit_limit integer NOT NULL DEFAULT 100,
  CONSTRAINT organizations_pkey PRIMARY KEY (id)
);
CREATE TABLE vectorbea.profiles (
  id uuid NOT NULL,
  email text NOT NULL UNIQUE,
  full_name text,
  avatar_url text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  current_session_id uuid,
  CONSTRAINT profiles_pkey PRIMARY KEY (id),
  CONSTRAINT profiles_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id)
);
CREATE TABLE vectorbea.prompt_versions (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  prompt_id uuid NOT NULL,
  version_tag text NOT NULL,
  template_text text NOT NULL,
  parameters jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  is_published boolean NOT NULL DEFAULT false,
  CONSTRAINT prompt_versions_pkey PRIMARY KEY (id),
  CONSTRAINT prompt_versions_prompt_id_fkey FOREIGN KEY (prompt_id) REFERENCES vectorbea.prompts(id)
);
CREATE TABLE vectorbea.prompts (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  workspace_id uuid NOT NULL,
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT prompts_pkey PRIMARY KEY (id),
  CONSTRAINT prompts_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES vectorbea.workspaces(id)
);
CREATE TABLE vectorbea.users (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  email text NOT NULL,
  role text NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT users_pkey PRIMARY KEY (id),
  CONSTRAINT users_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES vectorbea.organizations(id)
);
CREATE TABLE vectorbea.workspace_members (
  user_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  role USER-DEFINED NOT NULL DEFAULT 'viewer'::workspace_role,
  granted_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT workspace_members_pkey PRIMARY KEY (user_id, workspace_id),
  CONSTRAINT workspace_members_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id),
  CONSTRAINT workspace_members_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES vectorbea.workspaces(id)
);
CREATE TABLE vectorbea.workspaces (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  name text NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT workspaces_pkey PRIMARY KEY (id),
  CONSTRAINT workspaces_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES vectorbea.organizations(id)
);
-- ─── Golden Traces ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS vectorbea.golden_traces (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid NOT NULL REFERENCES vectorbea.workspaces(id) ON DELETE CASCADE,
  trace_id      text NOT NULL,
  prompt_name   text,
  prompt_version text,
  label         text,
  notes         text,
  created_by    uuid NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, trace_id)
);
CREATE INDEX IF NOT EXISTS golden_traces_workspace_idx ON vectorbea.golden_traces(workspace_id);

-- ─── Baseline Datasets ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS vectorbea.baseline_datasets (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid NOT NULL REFERENCES vectorbea.workspaces(id) ON DELETE CASCADE,
  name          text NOT NULL,
  description   text,
  source_type   text NOT NULL DEFAULT 'trace_set',
  trace_ids     uuid[] NOT NULL DEFAULT '{}',
  prompt_name   text,
  created_by    uuid NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS baseline_datasets_workspace_idx ON vectorbea.baseline_datasets(workspace_id);

-- ─── Regression Schedules ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS vectorbea.regression_schedules (
  id                              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id                    uuid NOT NULL REFERENCES vectorbea.workspaces(id) ON DELETE CASCADE,
  name                            text NOT NULL,
  baseline_dataset_id             uuid NOT NULL REFERENCES vectorbea.baseline_datasets(id) ON DELETE CASCADE,
  baseline_dataset_name           text,
  candidate_prompt_version_strategy text NOT NULL DEFAULT 'latest_published',
  candidate_prompt_version_id     uuid,
  prompt_name                     text,
  cron_expression                 text,
  enabled                         boolean NOT NULL DEFAULT true,
  status                          text NOT NULL DEFAULT 'idle',
  last_run_at                     timestamptz,
  last_run_evaluation_run_id      uuid,
  last_run_recommendation         text,
  next_run_at                     timestamptz,
  created_by                      uuid NOT NULL,
  created_at                      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS regression_schedules_workspace_idx ON vectorbea.regression_schedules(workspace_id);
