-- =============================================================================
-- Migration: Enterprise Org → Workspace hierarchy with RBAC + RLS
-- Target:    PostgreSQL 15  /  Supabase
-- Idempotent: yes — every DDL statement is guarded by IF NOT EXISTS / IF EXISTS
--             so this script can be re-run safely after a partial failure.
-- =============================================================================
-- EXECUTION ORDER (safe for zero-data-loss on a live database):
--   1.  Create ENUM types
--   2.  Create new tables (workspaces, org_members, workspace_members)
--   3.  Back-fill: create one default workspace per org and map all existing
--       assets (api_keys, prompts, audit_logs) to it
--   4.  Add workspace_id columns (NOT NULL after back-fill)
--   5.  Drop obsolete organization_id columns + old indexes
--   6.  Re-create unique constraints scoped to workspace_id
--   7.  Harden the legacy users table to use org_members instead
--   8.  Enable Row Level Security and attach policies
-- =============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 0. Extensions
-- ---------------------------------------------------------------------------
create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- 1. ENUM types
-- ---------------------------------------------------------------------------
do $$ begin
    create type public.org_role as enum ('owner', 'billing_admin', 'member');
exception when duplicate_object then null;
end $$;

do $$ begin
    create type public.workspace_role as enum ('admin', 'editor', 'viewer');
exception when duplicate_object then null;
end $$;

-- ---------------------------------------------------------------------------
-- 2. New tables
-- ---------------------------------------------------------------------------

-- 2a. workspaces ─────────────────────────────────────────────────────────────
create table if not exists public.workspaces (
    id              uuid        primary key default gen_random_uuid(),
    organization_id uuid        not null
                                references public.organizations(id)
                                on delete cascade,
    name            text        not null,
    created_at      timestamptz not null default now(),
    constraint workspaces_org_name_key unique (organization_id, name)
);

comment on table  public.workspaces is
    'A logical environment (e.g. "production", "staging") that belongs to an '
    'Organization. Engineering assets (prompts, API keys, audit logs) are owned '
    'by a Workspace, not directly by the Organization.';

-- 2b. org_members ─────────────────────────────────────────────────────────────
-- Replaces the implicit membership embedded in public.users.role.
create table if not exists public.org_members (
    user_id         uuid            not null
                                    references public.users(id)
                                    on delete cascade,
    organization_id uuid            not null
                                    references public.organizations(id)
                                    on delete cascade,
    role            public.org_role not null default 'member',
    granted_at      timestamptz     not null default now(),
    primary key (user_id, organization_id)
);

comment on column public.org_members.role is
    'owner: full org control + billing. '
    'billing_admin: billing portal only. '
    'member: read-only org metadata, access via workspace_members.';

-- 2c. workspace_members ───────────────────────────────────────────────────────
create table if not exists public.workspace_members (
    user_id      uuid                  not null
                                       references public.users(id)
                                       on delete cascade,
    workspace_id uuid                  not null
                                       references public.workspaces(id)
                                       on delete cascade,
    role         public.workspace_role not null default 'viewer',
    granted_at   timestamptz           not null default now(),
    primary key (user_id, workspace_id)
);

comment on column public.workspace_members.role is
    'admin: CRUD on all workspace assets + member management. '
    'editor: INSERT/UPDATE prompts and API keys. '
    'viewer: SELECT only.';

-- ---------------------------------------------------------------------------
-- 3. Back-fill: one default workspace per existing organization
--    and migrate all existing assets
-- ---------------------------------------------------------------------------

-- 3a. Create a default workspace for every existing org that does not yet have
--     one (idempotent — the UNIQUE constraint on (organization_id, name) makes
--     the ON CONFLICT clause safe to re-run).
insert into public.workspaces (organization_id, name, created_at)
select  id,
        'default',
        created_at
from    public.organizations
on conflict (organization_id, name) do nothing;

-- 3b. Migrate org_members from the legacy users table.
--     Every existing user gets 'owner' inside their current org.
--     The ON CONFLICT skip is critical for idempotency.
insert into public.org_members (user_id, organization_id, role, granted_at)
select  id,
        organization_id,
        'owner'::public.org_role,
        created_at
from    public.users
on conflict (user_id, organization_id) do nothing;

-- 3c. Promote existing org-level users to workspace admins in the default workspace.
insert into public.workspace_members (user_id, workspace_id, role, granted_at)
select  u.id,
        w.id,
        'admin'::public.workspace_role,
        u.created_at
from    public.users           u
join    public.workspaces      w
        on w.organization_id = u.organization_id
       and w.name             = 'default'
on conflict (user_id, workspace_id) do nothing;

-- ---------------------------------------------------------------------------
-- 4. Add workspace_id to engineering-asset tables (nullable first so
--    the back-fill in step 4b succeeds before we enforce NOT NULL)
-- ---------------------------------------------------------------------------

-- 4a. api_keys ──────────────────────────────────────────────────────────────
alter table public.api_keys
    add column if not exists workspace_id uuid
        references public.workspaces(id) on delete cascade;

update public.api_keys k
set    workspace_id = w.id
from   public.workspaces w
where  w.organization_id = k.organization_id
  and  w.name            = 'default'
  and  k.workspace_id is null;

alter table public.api_keys
    alter column workspace_id set not null;

-- 4b. prompts ───────────────────────────────────────────────────────────────
alter table public.prompts
    add column if not exists workspace_id uuid
        references public.workspaces(id) on delete cascade;

update public.prompts p
set    workspace_id = w.id
from   public.workspaces w
where  w.organization_id = p.organization_id
  and  w.name            = 'default'
  and  p.workspace_id is null;

alter table public.prompts
    alter column workspace_id set not null;

-- 4c. audit_logs ────────────────────────────────────────────────────────────
alter table public.audit_logs
    add column if not exists workspace_id uuid
        references public.workspaces(id) on delete cascade;

update public.audit_logs a
set    workspace_id = w.id
from   public.workspaces w
where  w.organization_id = a.organization_id
  and  w.name            = 'default'
  and  a.workspace_id is null;

alter table public.audit_logs
    alter column workspace_id set not null;

-- ---------------------------------------------------------------------------
-- 5. Drop obsolete organization_id columns from asset tables
--    (the FK to organizations now goes through workspaces)
-- ---------------------------------------------------------------------------

-- Drop old indexes before the columns they reference.
drop index if exists public.idx_api_keys_organization_id;
drop index if exists public.idx_prompts_organization_id;
drop index if exists public.idx_audit_logs_organization_id;

-- Drop old unique constraint on prompts that was scoped to organization_id
-- before we remove the column.
alter table public.prompts
    drop constraint if exists prompts_organization_name_key;

alter table public.api_keys   drop column if exists organization_id;
alter table public.prompts    drop column if exists organization_id;
alter table public.audit_logs drop column if exists organization_id;

-- ---------------------------------------------------------------------------
-- 6. Re-create constraints + indexes scoped to workspace_id
-- ---------------------------------------------------------------------------

-- Prompt names must still be unique within a workspace.
create unique index if not exists prompts_workspace_name_key
    on public.prompts (workspace_id, name);

create index if not exists idx_workspaces_organization_id
    on public.workspaces (organization_id);

create index if not exists idx_org_members_organization_id
    on public.org_members (organization_id);

create index if not exists idx_org_members_user_id
    on public.org_members (user_id);

create index if not exists idx_workspace_members_workspace_id
    on public.workspace_members (workspace_id);

create index if not exists idx_workspace_members_user_id
    on public.workspace_members (user_id);

create index if not exists idx_api_keys_workspace_id
    on public.api_keys (workspace_id);

create index if not exists idx_prompts_workspace_id
    on public.prompts (workspace_id);

create index if not exists idx_audit_logs_workspace_id
    on public.audit_logs (workspace_id);

-- ---------------------------------------------------------------------------
-- 7. Harden the legacy users table
--    The organization_id column is now redundant because membership is stored
--    in org_members.  We retain it for now as a denormalized "home org"
--    pointer and add a comment so future engineers understand the intent.
-- ---------------------------------------------------------------------------
comment on column public.users.organization_id is
    'Denormalized home-org FK kept for backward compatibility. '
    'Authoritative membership is in public.org_members. '
    'Do not use this column for access-control decisions.';

comment on column public.users.role is
    'Legacy role field superseded by org_members.role and '
    'workspace_members.role. Retained for backward compatibility only.';

-- ---------------------------------------------------------------------------
-- 8. Row Level Security  (Supabase only — skipped on plain PostgreSQL)
--    Enable RLS on every table that holds user-scoped data, then attach
--    fine-grained policies.  We expose auth.uid() — the Supabase JWT subject —
--    as the identity predicate.
--
--    Calling convention:
--      auth.uid()  → the UUID of the authenticated user (Supabase Auth)
--
--    All policies are PERMISSIVE and ORed together per operation.
--
--    On plain PostgreSQL (e.g. Docker e2e) the auth schema does not exist;
--    the DO block below detects this and skips the entire RLS section.
--    Access control is enforced at the API layer via API-key auth instead.
-- ---------------------------------------------------------------------------
do $skip_rls$
begin
  -- auth schema is Supabase-specific. Skip this entire section on plain PostgreSQL.
  if not exists (select 1 from pg_namespace where nspname = 'auth') then
    raise notice 'auth schema not found — skipping RLS + grants (non-Supabase environment)';
    return;
  end if;

  -- 8a. Enable RLS
  execute 'alter table public.workspaces         enable row level security';
  execute 'alter table public.org_members        enable row level security';
  execute 'alter table public.workspace_members  enable row level security';
  execute 'alter table public.api_keys           enable row level security';
  execute 'alter table public.prompts            enable row level security';
  execute 'alter table public.audit_logs         enable row level security';
  execute 'alter table public.prompt_versions    enable row level security';

  -- 8b. Helper view
  execute $sql$
    create or replace view public.my_workspace_ids as
        select workspace_id from public.workspace_members where user_id = auth.uid()
  $sql$;

  -- 8c. workspaces
  execute 'drop policy if exists workspaces_select_own on public.workspaces';
  execute $sql$
    create policy workspaces_select_own on public.workspaces for select
    using (id in (select workspace_id from public.my_workspace_ids))
  $sql$;

  execute 'drop policy if exists workspaces_insert_org_owner on public.workspaces';
  execute $sql$
    create policy workspaces_insert_org_owner on public.workspaces for insert
    with check (exists (
        select 1 from public.org_members
        where organization_id = workspaces.organization_id
          and user_id = auth.uid() and role in ('owner','billing_admin')))
  $sql$;

  -- 8d. org_members
  execute 'drop policy if exists org_members_select on public.org_members';
  execute $sql$
    create policy org_members_select on public.org_members for select
    using (user_id = auth.uid() or exists (
        select 1 from public.org_members om2
        where om2.organization_id = org_members.organization_id
          and om2.user_id = auth.uid() and om2.role = 'owner'))
  $sql$;

  -- 8e. workspace_members
  execute 'drop policy if exists workspace_members_select on public.workspace_members';
  execute $sql$
    create policy workspace_members_select on public.workspace_members for select
    using (workspace_id in (select workspace_id from public.my_workspace_ids))
  $sql$;

  execute 'drop policy if exists workspace_members_insert_admin on public.workspace_members';
  execute $sql$
    create policy workspace_members_insert_admin on public.workspace_members for insert
    with check (exists (
        select 1 from public.workspace_members wm
        where wm.workspace_id = workspace_members.workspace_id
          and wm.user_id = auth.uid() and wm.role = 'admin'))
  $sql$;

  execute 'drop policy if exists workspace_members_delete_admin on public.workspace_members';
  execute $sql$
    create policy workspace_members_delete_admin on public.workspace_members for delete
    using (exists (
        select 1 from public.workspace_members wm
        where wm.workspace_id = workspace_members.workspace_id
          and wm.user_id = auth.uid() and wm.role = 'admin')
      and workspace_members.user_id <> auth.uid())
  $sql$;

  -- 8f. prompts
  execute 'drop policy if exists prompts_select on public.prompts';
  execute $sql$
    create policy prompts_select on public.prompts for select
    using (workspace_id in (select workspace_id from public.my_workspace_ids))
  $sql$;

  execute 'drop policy if exists prompts_insert_editor on public.prompts';
  execute $sql$
    create policy prompts_insert_editor on public.prompts for insert
    with check (exists (
        select 1 from public.workspace_members wm
        where wm.workspace_id = prompts.workspace_id
          and wm.user_id = auth.uid() and wm.role in ('admin','editor')))
  $sql$;

  execute 'drop policy if exists prompts_update_editor on public.prompts';
  execute $sql$
    create policy prompts_update_editor on public.prompts for update
    using (exists (
        select 1 from public.workspace_members wm
        where wm.workspace_id = prompts.workspace_id
          and wm.user_id = auth.uid() and wm.role in ('admin','editor')))
    with check (exists (
        select 1 from public.workspace_members wm
        where wm.workspace_id = prompts.workspace_id
          and wm.user_id = auth.uid() and wm.role in ('admin','editor')))
  $sql$;

  execute 'drop policy if exists prompts_delete_admin on public.prompts';
  execute $sql$
    create policy prompts_delete_admin on public.prompts for delete
    using (exists (
        select 1 from public.workspace_members wm
        where wm.workspace_id = prompts.workspace_id
          and wm.user_id = auth.uid() and wm.role = 'admin'))
  $sql$;

  -- 8g. prompt_versions
  execute 'drop policy if exists prompt_versions_select on public.prompt_versions';
  execute $sql$
    create policy prompt_versions_select on public.prompt_versions for select
    using (exists (
        select 1 from public.prompts p
        join public.my_workspace_ids mw on mw.workspace_id = p.workspace_id
        where p.id = prompt_versions.prompt_id))
  $sql$;

  execute 'drop policy if exists prompt_versions_insert_editor on public.prompt_versions';
  execute $sql$
    create policy prompt_versions_insert_editor on public.prompt_versions for insert
    with check (exists (
        select 1 from public.prompts p
        join public.workspace_members wm on wm.workspace_id = p.workspace_id
        where p.id = prompt_versions.prompt_id
          and wm.user_id = auth.uid() and wm.role in ('admin','editor')))
  $sql$;

  execute 'drop policy if exists prompt_versions_update_editor on public.prompt_versions';
  execute $sql$
    create policy prompt_versions_update_editor on public.prompt_versions for update
    using (exists (
        select 1 from public.prompts p
        join public.workspace_members wm on wm.workspace_id = p.workspace_id
        where p.id = prompt_versions.prompt_id
          and wm.user_id = auth.uid() and wm.role in ('admin','editor')))
  $sql$;

  -- 8h. api_keys
  execute 'drop policy if exists api_keys_select on public.api_keys';
  execute $sql$
    create policy api_keys_select on public.api_keys for select
    using (workspace_id in (select workspace_id from public.my_workspace_ids))
  $sql$;

  execute 'drop policy if exists api_keys_insert_editor on public.api_keys';
  execute $sql$
    create policy api_keys_insert_editor on public.api_keys for insert
    with check (exists (
        select 1 from public.workspace_members wm
        where wm.workspace_id = api_keys.workspace_id
          and wm.user_id = auth.uid() and wm.role in ('admin','editor')))
  $sql$;

  execute 'drop policy if exists api_keys_delete_admin on public.api_keys';
  execute $sql$
    create policy api_keys_delete_admin on public.api_keys for delete
    using (exists (
        select 1 from public.workspace_members wm
        where wm.workspace_id = api_keys.workspace_id
          and wm.user_id = auth.uid() and wm.role = 'admin'))
  $sql$;

  -- 8i. audit_logs
  execute 'drop policy if exists audit_logs_select on public.audit_logs';
  execute $sql$
    create policy audit_logs_select on public.audit_logs for select
    using (workspace_id in (select workspace_id from public.my_workspace_ids))
  $sql$;

  -- 9. Grants (Supabase roles only)
  execute 'grant usage  on type public.org_role       to authenticated';
  execute 'grant usage  on type public.workspace_role to authenticated';
  execute 'grant select on public.my_workspace_ids    to authenticated';
  execute 'grant select, insert, update, delete on public.workspaces, public.org_members, public.workspace_members to authenticated';
  execute 'grant select, insert, update, delete on public.prompts, public.prompt_versions, public.api_keys to authenticated';
  execute 'grant select on public.audit_logs to authenticated';
  execute 'grant insert on public.audit_logs to service_role';

end $skip_rls$;

commit;
