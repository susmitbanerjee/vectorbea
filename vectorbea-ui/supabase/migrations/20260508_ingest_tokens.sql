-- ingest_tokens
-- Workspace-scoped tokens for SDK, sidecar, and proxy trace ingestion.
-- Raw token is never stored. Only a SHA-256 hex digest is persisted.

CREATE TABLE IF NOT EXISTS vectorbea.ingest_tokens (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid        NOT NULL REFERENCES vectorbea.workspaces(id) ON DELETE CASCADE,
  name          text        NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
  token_hash    text        NOT NULL,
  token_prefix  text        NOT NULL,
  last_four     text        NOT NULL CHECK (char_length(last_four) = 4),
  scopes        text[]      NOT NULL DEFAULT ARRAY['traces:write'],
  environment   text        CHECK (environment IN ('development', 'staging', 'production', 'test')),
  created_by    uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_used_at  timestamptz,
  expires_at    timestamptz,
  revoked_at    timestamptz,
  revoked_by    uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  metadata      jsonb       NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS ingest_tokens_workspace_id_idx
  ON vectorbea.ingest_tokens (workspace_id);

CREATE INDEX IF NOT EXISTS ingest_tokens_token_prefix_idx
  ON vectorbea.ingest_tokens (token_prefix)
  WHERE revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS ingest_tokens_expires_at_idx
  ON vectorbea.ingest_tokens (expires_at)
  WHERE expires_at IS NOT NULL AND revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS ingest_tokens_revoked_at_idx
  ON vectorbea.ingest_tokens (revoked_at)
  WHERE revoked_at IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS ingest_tokens_workspace_name_active_uq
  ON vectorbea.ingest_tokens (workspace_id, name)
  WHERE revoked_at IS NULL;

ALTER TABLE vectorbea.ingest_tokens ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'vectorbea'
      AND tablename = 'ingest_tokens'
      AND policyname = 'workspace_members_can_read_ingest_tokens'
  ) THEN
    CREATE POLICY "workspace_members_can_read_ingest_tokens"
      ON vectorbea.ingest_tokens
      FOR SELECT
      TO authenticated
      USING (
        workspace_id IN (
          SELECT workspace_id
          FROM vectorbea.workspace_members
          WHERE user_id = auth.uid()
        )
      );
  END IF;
END $$;

GRANT ALL ON vectorbea.ingest_tokens TO service_role;
