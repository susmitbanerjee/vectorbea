-- Repair migration for environments that missed part of the Provider Arena schema.

alter table vectorbea.evaluation_executions
  add column if not exists provider_candidate_id uuid;

create table if not exists vectorbea.provider_candidates (
  id uuid primary key default gen_random_uuid(),
  evaluation_run_id uuid not null references vectorbea.evaluation_runs(id) on delete cascade,
  provider text not null,
  model text not null,
  label text not null,
  temperature numeric(5,3),
  max_tokens integer,
  config jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_provider_candidates_run
  on vectorbea.provider_candidates (evaluation_run_id);

create table if not exists vectorbea.arena_reports (
  id uuid primary key default gen_random_uuid(),
  evaluation_run_id uuid not null references vectorbea.evaluation_runs(id) on delete cascade unique,
  recommended_candidate_id uuid references vectorbea.provider_candidates(id) on delete set null,
  rollout_recommendation text not null default 'needs_review',
  decision_score numeric(6,2),
  risk_score numeric(6,2),
  summary text,
  provider_rankings jsonb not null default '[]'::jsonb,
  dimension_summary jsonb not null default '{}'::jsonb,
  failure_clusters jsonb not null default '[]'::jsonb,
  cost_summary jsonb not null default '{}'::jsonb,
  latency_summary jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint arena_reports_recommendation_check
    check (rollout_recommendation in ('safe_to_rollout', 'rollout_with_caution', 'needs_review', 'do_not_rollout'))
);

create index if not exists idx_arena_reports_run
  on vectorbea.arena_reports (evaluation_run_id);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'fk_evaluation_executions_provider_candidate'
  ) then
    alter table vectorbea.evaluation_executions
      add constraint fk_evaluation_executions_provider_candidate
      foreign key (provider_candidate_id)
      references vectorbea.provider_candidates(id)
      on delete set null;
  end if;
end $$;

alter table vectorbea.provider_candidates enable row level security;
alter table vectorbea.arena_reports enable row level security;

grant all on vectorbea.provider_candidates to service_role;
grant all on vectorbea.arena_reports to service_role;
