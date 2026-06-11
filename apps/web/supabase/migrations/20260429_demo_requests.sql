-- Demo requests table
-- Stores inbound /book-demo form submissions for sales follow-up.

create table if not exists vectorbea.demo_requests (
  id              uuid primary key default gen_random_uuid(),
  full_name       text not null,
  work_email      text not null,
  company_name    text not null,
  role            text not null,
  company_size    text not null,
  llm_use_case    text not null,
  main_challenge  text not null,
  preferred_time  text,
  source_page     text default '/book-demo',
  -- status lifecycle: new → contacted → scheduled → closed
  status          text not null default 'new'
                  check (status in ('new','contacted','scheduled','closed')),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- Index for sales queue ordering
create index if not exists demo_requests_status_created_idx
  on vectorbea.demo_requests (status, created_at desc);

-- Index for dedup lookup by email
create index if not exists demo_requests_email_idx
  on vectorbea.demo_requests (work_email);

-- Auto-update updated_at
create or replace function vectorbea.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists demo_requests_updated_at on vectorbea.demo_requests;
create trigger demo_requests_updated_at
  before update on vectorbea.demo_requests
  for each row execute procedure vectorbea.set_updated_at();

-- Row-level security: only service role can read/write (no public access)
alter table vectorbea.demo_requests enable row level security;

-- Service role bypasses RLS automatically; no additional policy needed.
-- To allow an admin dashboard query, add a policy referencing your admin role here.
