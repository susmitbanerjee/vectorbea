-- ─────────────────────────────────────────────────────────────────────────────
-- VectorBea Telemetry Tables
-- Ingest target for the Kotlin sidecar heartbeat + prompt-execution metrics.
-- All tables live in the vectorbea schema alongside the rest of the platform.
-- ─────────────────────────────────────────────────────────────────────────────

begin;

-- ── 1. telemetry_events ───────────────────────────────────────────────────────
-- One row per heartbeat / ingest batch from a proxy sidecar.
-- Carries the context (which host, which workspace, which env) shared by all
-- metric_points in the batch.

create table if not exists vectorbea.telemetry_events (
    id             uuid        primary key default gen_random_uuid(),
    timestamp      timestamptz not null    default now(),
    environment    text        not null    check (environment in ('dev', 'prod')),
    workspace_id   uuid        references vectorbea.workspaces(id) on delete set null,
    proxy_host_id  text        not null,   -- opaque sidecar identifier, e.g. "proxy-us-east-1-a"
    created_at     timestamptz not null    default now()
);

comment on table  vectorbea.telemetry_events                 is 'One row per ingest batch from a Kotlin proxy sidecar.';
comment on column vectorbea.telemetry_events.proxy_host_id   is 'Opaque host identifier sent by the sidecar on every heartbeat.';
comment on column vectorbea.telemetry_events.environment     is 'dev | prod — set by the sidecar via VECTORBEA_ENV.';

create index if not exists idx_telemetry_events_timestamp
    on vectorbea.telemetry_events (timestamp desc);

create index if not exists idx_telemetry_events_environment
    on vectorbea.telemetry_events (environment);

create index if not exists idx_telemetry_events_workspace_id
    on vectorbea.telemetry_events (workspace_id);

create index if not exists idx_telemetry_events_proxy_host_id
    on vectorbea.telemetry_events (proxy_host_id);

-- ── 2. metric_points ─────────────────────────────────────────────────────────
-- Normalised key/value metric pairs linked to a telemetry_event.
-- Keeping metrics separate (rather than JSON columns) lets Postgres use
-- standard B-tree indexes and percentile_disc() natively without unnesting.

create table if not exists vectorbea.metric_points (
    id           uuid          primary key default gen_random_uuid(),
    event_id     uuid          not null references vectorbea.telemetry_events(id) on delete cascade,
    metric_name  text          not null,   -- 'cpu_usage' | 'memory_usage' | 'latency' | 'network_hops'
    metric_value numeric(14,4) not null,
    recorded_at  timestamptz   not null    default now()
);

comment on table  vectorbea.metric_points                is 'Individual named metric samples linked to a telemetry event.';
comment on column vectorbea.metric_points.metric_name    is 'cpu_usage (%), memory_usage (MB), latency (ms), network_hops (count).';
comment on column vectorbea.metric_points.metric_value   is 'Numeric sample — unit depends on metric_name.';

-- Composite covering index: metric_name first so percentile / avg queries
-- that filter by name can range-scan recorded_at within the same leaf pages.
create index if not exists idx_metric_points_name_recorded_at
    on vectorbea.metric_points (metric_name, recorded_at desc);

create index if not exists idx_metric_points_event_id
    on vectorbea.metric_points (event_id);

-- ── 3. prompt_executions ─────────────────────────────────────────────────────
-- One row per individual prompt execution observed by the sidecar.
-- Decoupled from audit_logs because telemetry ingestion is unauthenticated
-- (internal machine-to-machine) and has different retention semantics.

create table if not exists vectorbea.prompt_executions (
    id           uuid          primary key default gen_random_uuid(),
    timestamp    timestamptz   not null    default now(),
    environment  text          not null    check (environment in ('dev', 'prod')),
    workspace_id uuid          references vectorbea.workspaces(id) on delete set null,
    prompt_name  text          not null,
    latency_ms   numeric(10,2) not null    check (latency_ms >= 0),
    tokens_used  integer       not null    default 0 check (tokens_used >= 0),
    created_at   timestamptz   not null    default now()
);

comment on table vectorbea.prompt_executions is
    'Per-execution record ingested from the Kotlin sidecar; backs the Wall of Shame leaderboard.';

create index if not exists idx_prompt_executions_timestamp
    on vectorbea.prompt_executions (timestamp desc);

create index if not exists idx_prompt_executions_environment
    on vectorbea.prompt_executions (environment);

create index if not exists idx_prompt_executions_workspace_id
    on vectorbea.prompt_executions (workspace_id);

create index if not exists idx_prompt_executions_prompt_name
    on vectorbea.prompt_executions (prompt_name);

-- Covering index for the "Wall of Shame" query:
-- GROUP BY prompt_name, workspace_id ORDER BY avg(latency_ms) DESC
create index if not exists idx_prompt_executions_name_latency
    on vectorbea.prompt_executions (prompt_name, latency_ms desc);

-- ── 4. Grants (mirror existing vectorbea schema policy) ──────────────────────

grant all    on table vectorbea.telemetry_events   to service_role;
grant select on table vectorbea.telemetry_events   to authenticated;

grant all    on table vectorbea.metric_points       to service_role;
grant select on table vectorbea.metric_points       to authenticated;

grant all    on table vectorbea.prompt_executions   to service_role;
grant select on table vectorbea.prompt_executions   to authenticated;

-- ── 5. Helper view: hourly host metrics (used by the Technical dashboard) ────
-- Pre-joins telemetry_events → metric_points and buckets into 1-hour slots.
-- The Technical dashboard queries this view with a WHERE on environment +
-- metric_name rather than hitting the raw tables.

create or replace view vectorbea.v_hourly_host_metrics as
select
    date_trunc('hour', te.timestamp)      as hour,
    te.environment,
    te.proxy_host_id,
    mp.metric_name,
    avg(mp.metric_value)                  as avg_value,
    max(mp.metric_value)                  as max_value,
    min(mp.metric_value)                  as min_value,
    count(*)                              as sample_count
from vectorbea.telemetry_events te
join vectorbea.metric_points mp on mp.event_id = te.id
where te.timestamp >= now() - interval '7 days'   -- rolling window
group by 1, 2, 3, 4;

grant select on vectorbea.v_hourly_host_metrics to service_role, authenticated;

-- ── 6. Helper view: latency percentiles (p50 / p95 / p99) ────────────────────

create or replace view vectorbea.v_latency_percentiles as
select
    te.environment,
    percentile_disc(0.50) within group (order by mp.metric_value) as p50_ms,
    percentile_disc(0.95) within group (order by mp.metric_value) as p95_ms,
    percentile_disc(0.99) within group (order by mp.metric_value) as p99_ms,
    avg(mp.metric_value)                                           as avg_ms,
    count(*)                                                       as sample_count
from vectorbea.telemetry_events te
join vectorbea.metric_points mp
     on mp.event_id = te.id and mp.metric_name = 'latency'
where te.timestamp >= now() - interval '24 hours'
group by te.environment;

grant select on vectorbea.v_latency_percentiles to service_role, authenticated;

commit;
