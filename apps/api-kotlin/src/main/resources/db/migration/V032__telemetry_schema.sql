-- V032 — the telemetry schema, folded in from apps/telemetry (was V100 there).
--
-- WHY IT MOVES RATHER THAN STAYING WHERE IT WAS
-- ---------------------------------------------
-- Two Flyway histories against one database is a trap that springs quietly: each keeps
-- its own `flyway_schema_history` view of "what has been applied", so provisioning a
-- fresh environment depends on running two migrators in an order nothing records, and
-- a table one chain creates is invisible to the other. D32 in TECH-DEBT.md is the same
-- class of bug and it cost real time.
--
-- Renumbered from V100 to V032 to sit in this chain's sequence. Every statement is
-- already IF NOT EXISTS, so applying it to a database where the telemetry service
-- previously ran is a no-op rather than an error - which is what makes the cutover a
-- deploy rather than a migration window.
--
-- The old file is deleted with the service. This is now the only copy.

-- Telemetry schema — analytics, engineering snapshots, revenue (future)
-- All tables include environment column for dev/stage/prod filtering.

-- ── Analytics events ─────────────────────────────────────────────────────────
-- Core business/product/user analytics event store.
-- Raw events retained 180 days; daily rollups retained indefinitely.
-- Note: Partitioning by month is documented for future implementation.
--       Current table is unpartitioned to keep migrations simple.
CREATE TABLE IF NOT EXISTS analytics_events (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    environment         TEXT NOT NULL CHECK (environment IN ('dev', 'stage', 'prod')),
    event_name          TEXT NOT NULL,
    event_category      TEXT NOT NULL,
    event_version       INTEGER NOT NULL DEFAULT 1,
    occurred_at         TIMESTAMPTZ NOT NULL,
    received_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    workspace_id        UUID,
    environment_id      UUID,
    app_user_id         UUID,
    supabase_user_id    UUID,
    session_id          TEXT,
    anonymous_id        TEXT,
    source_service      TEXT NOT NULL,
    source_page         TEXT,
    source_component    TEXT,
    user_agent          TEXT,
    ip_hash             TEXT,
    workflow_id         UUID,
    workflow_version_id UUID,
    run_id              UUID,
    agent_id            UUID,
    tool_id             UUID,
    connection_id       UUID,
    architect_session_id UUID,
    properties_json     JSONB NOT NULL DEFAULT '{}',
    context_json        JSONB NOT NULL DEFAULT '{}',
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ae_env_name_time
    ON analytics_events (environment, event_name, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_ae_env_category_time
    ON analytics_events (environment, event_category, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_ae_workspace_time
    ON analytics_events (workspace_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_ae_user_time
    ON analytics_events (app_user_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_ae_run_id
    ON analytics_events (run_id);

CREATE INDEX IF NOT EXISTS idx_ae_workflow_id
    ON analytics_events (workflow_id);

CREATE INDEX IF NOT EXISTS idx_ae_architect_session
    ON analytics_events (architect_session_id);

CREATE INDEX IF NOT EXISTS idx_ae_properties_feature
    ON analytics_events ((properties_json->>'feature'));

-- ── Analytics daily rollups ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS analytics_daily_rollups (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    environment     TEXT NOT NULL CHECK (environment IN ('dev', 'stage', 'prod')),
    rollup_date     DATE NOT NULL,
    workspace_id    UUID,
    metric_name     TEXT NOT NULL,
    metric_value    NUMERIC NOT NULL DEFAULT 0,
    dimensions_json JSONB NOT NULL DEFAULT '{}',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (environment, rollup_date, workspace_id, metric_name, dimensions_json)
);

CREATE INDEX IF NOT EXISTS idx_adr_env_date
    ON analytics_daily_rollups (environment, rollup_date DESC);

-- ── Engineering service snapshots ────────────────────────────────────────────
-- Lightweight internal health snapshots. Full traces go to Grafana/Prometheus.
CREATE TABLE IF NOT EXISTS engineering_service_snapshots (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    environment         TEXT NOT NULL CHECK (environment IN ('dev', 'stage', 'prod')),
    service_name        TEXT NOT NULL,
    service_instance_id TEXT,
    status              TEXT NOT NULL,
    version             TEXT,
    region              TEXT,
    cpu_percent         NUMERIC,
    memory_mb           NUMERIC,
    active_requests     INTEGER,
    active_tasks        INTEGER,
    queue_depth         INTEGER,
    db_latency_ms       NUMERIC,
    redis_latency_ms    NUMERIC,
    error_rate_5m       NUMERIC,
    p95_latency_ms      NUMERIC,
    p99_latency_ms      NUMERIC,
    captured_at         TIMESTAMPTZ NOT NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ess_env_service_time
    ON engineering_service_snapshots (environment, service_name, captured_at DESC);

CREATE INDEX IF NOT EXISTS idx_ess_env_time
    ON engineering_service_snapshots (environment, captured_at DESC);

-- ── Engineering incidents ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS engineering_incidents (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    environment     TEXT NOT NULL CHECK (environment IN ('dev', 'stage', 'prod')),
    service_name    TEXT,
    severity        TEXT NOT NULL,
    status          TEXT NOT NULL DEFAULT 'open',
    title           TEXT NOT NULL,
    summary         TEXT,
    error_code      TEXT,
    first_seen_at   TIMESTAMPTZ NOT NULL,
    last_seen_at    TIMESTAMPTZ NOT NULL,
    resolved_at     TIMESTAMPTZ,
    metadata_json   JSONB NOT NULL DEFAULT '{}',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ei_env_status
    ON engineering_incidents (environment, status, last_seen_at DESC);

-- ── Revenue telemetry (FUTURE — monetization disabled) ───────────────────────
-- Schema is ready. Tables are inactive until monetization is enabled.
-- Do NOT add Stripe/Razorpay integration here.
-- Revenue dashboard shows "Monetization disabled" until these are populated.
CREATE TABLE IF NOT EXISTS revenue_events (
    id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    environment              TEXT NOT NULL CHECK (environment IN ('dev', 'stage', 'prod')),
    event_name               TEXT NOT NULL,
    occurred_at              TIMESTAMPTZ NOT NULL,
    workspace_id             UUID,
    app_user_id              UUID,
    billing_provider         TEXT,
    provider_customer_id     TEXT,
    provider_subscription_id TEXT,
    provider_invoice_id      TEXT,
    currency                 TEXT,
    amount_cents             BIGINT,
    mrr_delta_cents          BIGINT,
    arr_delta_cents          BIGINT,
    plan_id                  TEXT,
    plan_name                TEXT,
    status                   TEXT,
    properties_json          JSONB NOT NULL DEFAULT '{}',
    created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_re_env_name_time
    ON revenue_events (environment, event_name, occurred_at DESC);

CREATE TABLE IF NOT EXISTS revenue_daily_rollups (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    environment     TEXT NOT NULL CHECK (environment IN ('dev', 'stage', 'prod')),
    rollup_date     DATE NOT NULL,
    metric_name     TEXT NOT NULL,
    metric_value    NUMERIC NOT NULL DEFAULT 0,
    dimensions_json JSONB NOT NULL DEFAULT '{}',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (environment, rollup_date, metric_name, dimensions_json)
);
