-- ============================================================
-- VectorBea LLM Proxy Audit Logs
-- 2026-08-20
--
-- Tracked migration for vectorbea.audit_logs — the table backing the
-- Settings > Audit tab (app/api/audit/route.ts) and every LLM-proxy
-- write path (app/api/audit/batch, app/api/proxy/audit/batch,
-- lib/server/workspace-limits.ts, lib/server/evaluation-runs.ts, etc).
--
-- This table already exists in deployed environments but was never
-- captured as a migration in this repo, so a fresh/local database
-- built from `supabase/migrations` was missing it — that's what
-- surfaced as "required database migrations are missing" in the
-- Usage & limits and Audit tabs. IF NOT EXISTS makes this a no-op
-- against environments where the table is already present.
-- ============================================================

CREATE TABLE IF NOT EXISTS vectorbea.audit_logs (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id       uuid NOT NULL REFERENCES vectorbea.workspaces(id) ON DELETE CASCADE,
  prompt_version_id  uuid,
  prompt_name        text NOT NULL DEFAULT '',
  version_tag        text NOT NULL DEFAULT '',
  proxy_latency_ms   double precision NOT NULL DEFAULT 0 CHECK (proxy_latency_ms >= 0),
  llm_latency_ms     integer NOT NULL DEFAULT 0 CHECK (llm_latency_ms >= 0),
  token_count        integer NOT NULL DEFAULT 0 CHECK (token_count >= 0),
  metadata           jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS audit_logs_workspace_id_created_at_idx
  ON vectorbea.audit_logs (workspace_id, created_at DESC);
