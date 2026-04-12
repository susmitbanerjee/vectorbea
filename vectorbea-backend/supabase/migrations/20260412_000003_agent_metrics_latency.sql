begin;

alter table public.agent_metrics
    add column if not exists latency_ms numeric(10,2) not null default 0;

alter table public.agent_metrics
    drop constraint if exists agent_metrics_latency_ms_check;

alter table public.agent_metrics
    add constraint agent_metrics_latency_ms_check
    check (latency_ms >= 0);

comment on column public.agent_metrics.latency_ms is
    'Observed end-to-end agent heartbeat latency in milliseconds for live dashboard telemetry.';

commit;
