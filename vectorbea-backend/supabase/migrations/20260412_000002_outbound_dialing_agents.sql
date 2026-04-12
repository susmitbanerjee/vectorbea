begin;

create table if not exists public.deployment_agents (
    id uuid primary key default gen_random_uuid(),
    workspace_id uuid not null
        references public.workspaces(id)
        on delete cascade,
    name text not null,
    status text not null default 'offline',
    last_heartbeat timestamptz,
    api_token text not null unique,
    created_at timestamptz not null default now(),
    constraint deployment_agents_status_check
        check (status in ('online', 'offline', 'degraded', 'error'))
);

create index if not exists idx_deployment_agents_workspace_id
    on public.deployment_agents (workspace_id);

create unique index if not exists idx_deployment_agents_api_token
    on public.deployment_agents (api_token);

comment on table public.deployment_agents is
    'Registered on-prem or self-hosted sidecar agents that heartbeat into the VectorBea control plane.';

comment on column public.deployment_agents.api_token is
    'Bearer token presented by the deployment agent when posting heartbeat state to the control plane.';

create table if not exists public.agent_metrics (
    id uuid primary key default gen_random_uuid(),
    agent_id uuid not null
        references public.deployment_agents(id)
        on delete cascade,
    cpu_usage_percent numeric(5,2) not null default 0,
    memory_usage_mb integer not null default 0,
    active_replicas integer not null default 0,
    created_at timestamptz not null default now(),
    constraint agent_metrics_cpu_usage_check
        check (cpu_usage_percent >= 0 and cpu_usage_percent <= 100),
    constraint agent_metrics_memory_usage_check
        check (memory_usage_mb >= 0),
    constraint agent_metrics_active_replicas_check
        check (active_replicas >= 0)
);

create index if not exists idx_agent_metrics_agent_id_created_at
    on public.agent_metrics (agent_id, created_at desc);

comment on table public.agent_metrics is
    'Time-series metrics pushed by on-prem deployment agents for dashboards and fleet health.';

create table if not exists public.agent_commands (
    id uuid primary key default gen_random_uuid(),
    agent_id uuid not null
        references public.deployment_agents(id)
        on delete cascade,
    command_type text not null,
    payload jsonb not null default '{}'::jsonb,
    status text not null default 'pending',
    created_at timestamptz not null default now(),
    constraint agent_commands_status_check
        check (status in ('pending', 'in_progress', 'completed', 'failed', 'cancelled'))
);

create index if not exists idx_agent_commands_agent_id_status_created_at
    on public.agent_commands (agent_id, status, created_at desc);

comment on table public.agent_commands is
    'Queued commands issued from the UI and polled by deployment agents during heartbeat.';

do $agent_rls$
begin
  if not exists (select 1 from pg_namespace where nspname = 'auth') then
    raise notice 'auth schema not found - skipping RLS policies for outbound dialing agent tables';
    return;
  end if;

  execute 'alter table public.deployment_agents enable row level security';
  execute 'alter table public.agent_metrics enable row level security';
  execute 'alter table public.agent_commands enable row level security';

  execute 'drop policy if exists deployment_agents_workspace_select on public.deployment_agents';
  execute 'drop policy if exists deployment_agents_workspace_mutate on public.deployment_agents';
  execute 'drop policy if exists agent_metrics_workspace_select on public.agent_metrics';
  execute 'drop policy if exists agent_metrics_workspace_mutate on public.agent_metrics';
  execute 'drop policy if exists agent_commands_workspace_select on public.agent_commands';
  execute 'drop policy if exists agent_commands_workspace_mutate on public.agent_commands';

  execute $sql$
    create policy deployment_agents_workspace_select
      on public.deployment_agents
      for select
      using (
        exists (
          select 1
          from public.project_members pm
          where pm.project_id = deployment_agents.workspace_id
            and pm.user_id = auth.uid()
        )
      )
  $sql$;

  execute $sql$
    create policy deployment_agents_workspace_mutate
      on public.deployment_agents
      for all
      using (
        exists (
          select 1
          from public.project_members pm
          where pm.project_id = deployment_agents.workspace_id
            and pm.user_id = auth.uid()
            and pm.role in ('admin', 'editor')
        )
      )
      with check (
        exists (
          select 1
          from public.project_members pm
          where pm.project_id = deployment_agents.workspace_id
            and pm.user_id = auth.uid()
            and pm.role in ('admin', 'editor')
        )
      )
  $sql$;

  execute $sql$
    create policy agent_metrics_workspace_select
      on public.agent_metrics
      for select
      using (
        exists (
          select 1
          from public.deployment_agents da
          join public.project_members pm
            on pm.project_id = da.workspace_id
          where da.id = agent_metrics.agent_id
            and pm.user_id = auth.uid()
        )
      )
  $sql$;

  execute $sql$
    create policy agent_metrics_workspace_mutate
      on public.agent_metrics
      for all
      using (
        exists (
          select 1
          from public.deployment_agents da
          join public.project_members pm
            on pm.project_id = da.workspace_id
          where da.id = agent_metrics.agent_id
            and pm.user_id = auth.uid()
            and pm.role in ('admin', 'editor')
        )
      )
      with check (
        exists (
          select 1
          from public.deployment_agents da
          join public.project_members pm
            on pm.project_id = da.workspace_id
          where da.id = agent_metrics.agent_id
            and pm.user_id = auth.uid()
            and pm.role in ('admin', 'editor')
        )
      )
  $sql$;

  execute $sql$
    create policy agent_commands_workspace_select
      on public.agent_commands
      for select
      using (
        exists (
          select 1
          from public.deployment_agents da
          join public.project_members pm
            on pm.project_id = da.workspace_id
          where da.id = agent_commands.agent_id
            and pm.user_id = auth.uid()
        )
      )
  $sql$;

  execute $sql$
    create policy agent_commands_workspace_mutate
      on public.agent_commands
      for all
      using (
        exists (
          select 1
          from public.deployment_agents da
          join public.project_members pm
            on pm.project_id = da.workspace_id
          where da.id = agent_commands.agent_id
            and pm.user_id = auth.uid()
            and pm.role in ('admin', 'editor')
        )
      )
      with check (
        exists (
          select 1
          from public.deployment_agents da
          join public.project_members pm
            on pm.project_id = da.workspace_id
          where da.id = agent_commands.agent_id
            and pm.user_id = auth.uid()
            and pm.role in ('admin', 'editor')
        )
      )
  $sql$;

  execute 'grant select, insert, update, delete on public.deployment_agents to authenticated';
  execute 'grant select, insert, update, delete on public.agent_metrics to authenticated';
  execute 'grant select, insert, update, delete on public.agent_commands to authenticated';
end $agent_rls$;

commit;
