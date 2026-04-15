create schema if not exists vectorbea;

do $$
begin
  alter type public.plan_tier add value if not exists 'team';
exception
  when undefined_object then
    null;
  when duplicate_object then
    null;
end $$;

grant usage on schema vectorbea to anon, authenticated, service_role;
grant all on all tables in schema vectorbea to anon, authenticated, service_role;
grant all on all sequences in schema vectorbea to anon, authenticated, service_role;
grant all on all routines in schema vectorbea to anon, authenticated, service_role;

alter default privileges in schema vectorbea grant all on tables to anon, authenticated, service_role;
alter default privileges in schema vectorbea grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema vectorbea grant all on routines to anon, authenticated, service_role;

alter table if exists public.organizations set schema vectorbea;
alter table if exists public.users set schema vectorbea;
alter table if exists public.api_keys set schema vectorbea;
alter table if exists public.prompts set schema vectorbea;
alter table if exists public.prompt_versions set schema vectorbea;
alter table if exists public.audit_logs set schema vectorbea;
alter table if exists public.workspaces set schema vectorbea;
alter table if exists public.org_members set schema vectorbea;
alter table if exists public.workspace_members set schema vectorbea;
alter table if exists public.deployment_agents set schema vectorbea;
alter table if exists public.agent_metrics set schema vectorbea;
alter table if exists public.agent_commands set schema vectorbea;

alter table if exists vectorbea.organizations
  add column if not exists plan_tier public.plan_tier not null default 'free',
  add column if not exists max_seats integer not null default 1,
  add column if not exists max_prompts integer not null default 5,
  add column if not exists monthly_audit_limit integer not null default 100;

update vectorbea.organizations
set
  plan_tier = coalesce(plan_tier, 'free'::public.plan_tier),
  max_seats = coalesce(max_seats, 1),
  max_prompts = coalesce(max_prompts, 5),
  monthly_audit_limit = coalesce(monthly_audit_limit, 100);

-- vectorbea.profiles is created as a real table in 20260413_000001_profiles_table.sql

create or replace view vectorbea.audits as
select *
from vectorbea.audit_logs;
