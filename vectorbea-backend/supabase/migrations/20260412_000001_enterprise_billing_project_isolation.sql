begin;

do $$ begin
    create type public.plan_tier as enum ('free', 'pro', 'enterprise');
exception when duplicate_object then null;
end $$;

alter table public.organizations
    add column if not exists plan_tier public.plan_tier not null default 'free',
    add column if not exists stripe_customer_id text,
    add column if not exists stripe_subscription_id text,
    add column if not exists max_seats integer not null default 1;

alter table public.organizations
    drop constraint if exists organizations_max_seats_check;

alter table public.organizations
    add constraint organizations_max_seats_check
    check (max_seats >= 1);

comment on column public.organizations.plan_tier is
    'Billing tier for the organization: free, pro, or enterprise.';

comment on column public.organizations.max_seats is
    'Maximum number of unique users allowed across all projects in the organization.';

create or replace view public.project_members as
select
    user_id,
    workspace_id as project_id,
    role,
    granted_at
from public.workspace_members;

do $project_rls$
begin
  if not exists (select 1 from pg_namespace where nspname = 'auth') then
    raise notice 'auth schema not found - skipping Supabase RLS policies for project_members';
    return;
  end if;

  execute 'alter table public.prompts enable row level security';
  execute 'alter table public.audit_logs enable row level security';

  execute 'drop policy if exists prompts_select on public.prompts';
  execute 'drop policy if exists prompts_insert_editor on public.prompts';
  execute 'drop policy if exists prompts_update_editor on public.prompts';
  execute 'drop policy if exists prompts_delete_admin on public.prompts';
  execute 'drop policy if exists prompts_project_select on public.prompts';
  execute 'drop policy if exists prompts_project_insert on public.prompts';
  execute 'drop policy if exists prompts_project_update on public.prompts';
  execute 'drop policy if exists prompts_project_delete on public.prompts';

  execute $sql$
    create policy prompts_project_select
      on public.prompts
      for select
      using (
        exists (
          select 1
          from public.project_members pm
          where pm.project_id = prompts.workspace_id
            and pm.user_id = auth.uid()
        )
      )
  $sql$;

  execute $sql$
    create policy prompts_project_insert
      on public.prompts
      for insert
      with check (
        exists (
          select 1
          from public.project_members pm
          where pm.project_id = prompts.workspace_id
            and pm.user_id = auth.uid()
        )
      )
  $sql$;

  execute $sql$
    create policy prompts_project_update
      on public.prompts
      for update
      using (
        exists (
          select 1
          from public.project_members pm
          where pm.project_id = prompts.workspace_id
            and pm.user_id = auth.uid()
        )
      )
      with check (
        exists (
          select 1
          from public.project_members pm
          where pm.project_id = prompts.workspace_id
            and pm.user_id = auth.uid()
        )
      )
  $sql$;

  execute $sql$
    create policy prompts_project_delete
      on public.prompts
      for delete
      using (
        exists (
          select 1
          from public.project_members pm
          where pm.project_id = prompts.workspace_id
            and pm.user_id = auth.uid()
        )
      )
  $sql$;

  execute 'drop policy if exists audit_logs_select on public.audit_logs';
  execute 'drop policy if exists audit_logs_project_select on public.audit_logs';
  execute 'drop policy if exists audit_logs_project_insert on public.audit_logs';
  execute 'drop policy if exists audit_logs_project_update on public.audit_logs';
  execute 'drop policy if exists audit_logs_project_delete on public.audit_logs';

  execute $sql$
    create policy audit_logs_project_select
      on public.audit_logs
      for select
      using (
        exists (
          select 1
          from public.project_members pm
          where pm.project_id = audit_logs.workspace_id
            and pm.user_id = auth.uid()
        )
      )
  $sql$;

  execute $sql$
    create policy audit_logs_project_insert
      on public.audit_logs
      for insert
      with check (
        exists (
          select 1
          from public.project_members pm
          where pm.project_id = audit_logs.workspace_id
            and pm.user_id = auth.uid()
        )
      )
  $sql$;

  execute $sql$
    create policy audit_logs_project_update
      on public.audit_logs
      for update
      using (
        exists (
          select 1
          from public.project_members pm
          where pm.project_id = audit_logs.workspace_id
            and pm.user_id = auth.uid()
        )
      )
      with check (
        exists (
          select 1
          from public.project_members pm
          where pm.project_id = audit_logs.workspace_id
            and pm.user_id = auth.uid()
        )
      )
  $sql$;

  execute $sql$
    create policy audit_logs_project_delete
      on public.audit_logs
      for delete
      using (
        exists (
          select 1
          from public.project_members pm
          where pm.project_id = audit_logs.workspace_id
            and pm.user_id = auth.uid()
        )
      )
  $sql$;

  execute 'grant select on public.project_members to authenticated';
end $project_rls$;

commit;
