-- Split audit_logs.latency_ms into proxy_latency_ms (sidecar fetch, fractional ms)
-- and llm_latency_ms (model generation time, integer ms) so the dashboard can
-- distinguish cache performance from provider latency.

alter table public.audit_logs
    add column if not exists proxy_latency_ms double precision not null default 0
        check (proxy_latency_ms >= 0),
    add column if not exists llm_latency_ms integer not null default 0
        check (llm_latency_ms >= 0);

-- Backfill from the legacy latency_ms column when it still exists so existing
-- rows keep meaningful data post-migration.
-- Uses dynamic SQL so the statement is only parsed/executed if the column exists.
do $$
begin
    if exists (
        select 1 from information_schema.columns
        where table_schema = 'public'
          and table_name   = 'audit_logs'
          and column_name  = 'latency_ms'
    ) then
        execute 'update public.audit_logs set llm_latency_ms = latency_ms where llm_latency_ms = 0';
    end if;
end;
$$;

alter table public.audit_logs
    drop column if exists latency_ms;
