-- Final idempotent repair migration.
-- Ensures all vectorbea schema tables have the columns expected by the UI.
-- Safe to run multiple times on any partial state.

-- prompts: workspace_id, updated_at, no organization_id
alter table vectorbea.prompts
    add column if not exists workspace_id uuid references vectorbea.workspaces(id) on delete cascade,
    add column if not exists updated_at   timestamptz not null default now(),
    add column if not exists description  text;

alter table vectorbea.prompts
    drop column if exists organization_id;

create index if not exists idx_prompts_workspace_id on vectorbea.prompts (workspace_id);

-- updated_at trigger for prompts
create or replace function vectorbea.set_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;

drop trigger if exists prompts_set_updated_at on vectorbea.prompts;
create trigger prompts_set_updated_at
    before update on vectorbea.prompts
    for each row execute function vectorbea.set_updated_at();

-- audit_logs: workspace_id, prompt_name, version_tag, no organization_id
alter table vectorbea.audit_logs
    add column if not exists workspace_id     uuid references vectorbea.workspaces(id) on delete cascade,
    add column if not exists prompt_name      text not null default '',
    add column if not exists version_tag      text not null default '',
    add column if not exists proxy_latency_ms int,
    add column if not exists llm_latency_ms   int,
    add column if not exists token_count      int;

alter table vectorbea.audit_logs
    drop column if exists organization_id;

create index if not exists idx_audit_logs_workspace_id on vectorbea.audit_logs (workspace_id);
create index if not exists idx_audit_logs_created_at   on vectorbea.audit_logs (created_at);

-- api_keys: workspace_id, key_last_four, key_name, key_role
alter table vectorbea.api_keys
    add column if not exists workspace_id  uuid references vectorbea.workspaces(id) on delete cascade,
    add column if not exists key_last_four text not null default '',
    add column if not exists key_name      text not null default '',
    add column if not exists key_role      text not null default 'read';

create index if not exists idx_api_keys_workspace_id on vectorbea.api_keys (workspace_id);

-- org_members / workspace_members: FK → auth.users
alter table vectorbea.org_members
    drop constraint if exists org_members_user_id_fkey;
alter table vectorbea.org_members
    add constraint org_members_user_id_fkey
    foreign key (user_id) references auth.users (id) on delete cascade;

alter table vectorbea.workspace_members
    drop constraint if exists workspace_members_user_id_fkey;
alter table vectorbea.workspace_members
    add constraint workspace_members_user_id_fkey
    foreign key (user_id) references auth.users (id) on delete cascade;

-- profiles: ensure correct FK and updated_at column
alter table vectorbea.profiles
    add column if not exists updated_at timestamptz not null default now();

-- deployment_agents: ensure table exists for dashboard active agent count
create table if not exists vectorbea.deployment_agents (
    id           uuid        primary key default gen_random_uuid(),
    workspace_id uuid        references vectorbea.workspaces(id) on delete cascade,
    name         text        not null,
    status       text        not null default 'active',
    created_at   timestamptz not null default now()
);

create index if not exists idx_deployment_agents_workspace_id
    on vectorbea.deployment_agents (workspace_id);

grant all    on table vectorbea.deployment_agents to service_role;
grant select on table vectorbea.deployment_agents to authenticated;
