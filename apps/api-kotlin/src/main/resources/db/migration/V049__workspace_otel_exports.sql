-- V049 — per-workspace OTLP trace export. AGENT-TRACE-AND-DEBUGGER §9.
--
-- ── WHY PER-WORKSPACE AND NOT ONE PROCESS-WIDE ENDPOINT ────────────────────
-- The whole point of §9 is that a customer's traces reach the observability
-- stack THEY already pay for. One `OTEL_EXPORTER_OTLP_ENDPOINT` for the process
-- sends every tenant's spans to ours, which is the opposite of the feature and
-- is also a cross-tenant data leak: a span carries a workspace id, a run id,
-- agent names and step names.
--
-- So the endpoint is a property of the workspace, resolved per export, and a
-- workspace with no row here exports nothing.
--
-- Note this is SEPARATE from `Tracing.init`'s process-level OTEL_* variables,
-- which instrument the worker itself (queue polls, HTTP handlers) for OUR
-- observability. Two different audiences, two different destinations; merging
-- them would put our infrastructure spans in a customer's Tempo.

CREATE TABLE IF NOT EXISTS workspace_otel_exports (
    workspace_id UUID PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,

    -- Off by default even once a row exists, so configuring an endpoint and
    -- turning it on are two separate, separately-auditable actions.
    enabled      BOOLEAN NOT NULL DEFAULT false,

    -- OTLP receiver base URL, e.g. http://localhost:4318 for a local Jaeger or
    -- Tempo. The signal path (/v1/traces) is appended by the exporter.
    endpoint     TEXT NOT NULL,

    -- 'http/protobuf' only, today. Column exists so adding grpc is a value and
    -- not a migration; the exporter rejects anything it does not implement
    -- rather than silently falling back, because a silent fallback to a
    -- different wire format is a support ticket nobody can diagnose.
    protocol     TEXT NOT NULL DEFAULT 'http/protobuf',

    -- Auth headers, as a JSON object of name -> value, held as a SECRET REF and
    -- resolved through SecretService — never as plaintext here.
    --
    -- This is a bearer token for a customer's observability vendor. Storing it
    -- beside the endpoint in cleartext would put a live credential in every
    -- backup, every replica and every `SELECT *` a support engineer runs. The
    -- repo already has one place that handles this correctly; this uses it.
    headers_secret_ref TEXT,

    -- What the customer's stack will call this service. Theirs to choose: it
    -- shows up in their service map next to their own services.
    service_name TEXT NOT NULL DEFAULT 'vectorbea-agents',

    -- Extra OTel resource attributes as a JSON object, merged under the ones
    -- the exporter sets. Never overrides service.name.
    resource_attributes_json JSONB NOT NULL DEFAULT '{}'::jsonb,

    timeout_ms   INTEGER NOT NULL DEFAULT 10000,

    -- Last successful export, for the settings screen to show something more
    -- useful than a checkbox. Null means "configured, never delivered".
    last_export_at    TIMESTAMPTZ,
    last_error        TEXT,
    last_error_at     TIMESTAMPTZ,

    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT workspace_otel_exports_protocol
        CHECK (protocol IN ('http/protobuf')),
    CONSTRAINT workspace_otel_exports_timeout
        CHECK (timeout_ms BETWEEN 100 AND 60000)
);

COMMENT ON TABLE workspace_otel_exports IS
    'Per-workspace OTLP destination for exported run traces. A workspace with no row, '
    'or with enabled = false, exports nothing. Distinct from the process-level OTEL_* '
    'configuration, which instruments the worker itself for our own observability.';

COMMENT ON COLUMN workspace_otel_exports.headers_secret_ref IS
    'SecretService ref (aes256gcm:... or a connection_secrets key) resolving to a JSON '
    'object of HTTP header name -> value. NEVER store the token itself here.';

-- Only enabled rows are ever read, and there will be few of them.
CREATE INDEX IF NOT EXISTS idx_workspace_otel_exports_enabled
    ON workspace_otel_exports (workspace_id)
    WHERE enabled;
