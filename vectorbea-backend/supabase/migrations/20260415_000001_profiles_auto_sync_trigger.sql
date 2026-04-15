-- Auto-sync new auth.users rows to vectorbea.profiles via a Postgres trigger.
-- This guarantees a profile row exists even if the application-level upsert
-- in /auth/callback fails or is skipped.

create schema if not exists vectorbea;

-- Ensure the profiles table exists with the expected shape.
create table if not exists vectorbea.profiles (
    id         uuid        primary key references auth.users (id) on delete cascade,
    email      text        not null,
    full_name  text,
    avatar_url text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

-- Add the FK if it was missing from the original migration.
do $$
begin
  if not exists (
    select 1
    from information_schema.table_constraints
    where constraint_name = 'profiles_id_fkey'
      and table_schema    = 'vectorbea'
      and table_name      = 'profiles'
  ) then
    alter table vectorbea.profiles
      add constraint profiles_id_fkey
      foreign key (id) references auth.users (id) on delete cascade;
  end if;
end
$$;

-- Create or replace the trigger function.
-- Extracts identity metadata that GitHub and Google OAuth providers supply
-- in raw_user_meta_data.
create or replace function vectorbea.handle_new_user()
returns trigger
language plpgsql
security definer          -- runs as the DB owner so it can write to vectorbea schema
set search_path = ''      -- prevent search_path injection
as $$
begin
  insert into vectorbea.profiles (id, email, full_name, avatar_url)
  values (
    new.id,
    coalesce(new.email, ''),
    coalesce(
      new.raw_user_meta_data ->> 'full_name',
      new.raw_user_meta_data ->> 'name',
      new.raw_user_meta_data ->> 'user_name',
      null
    ),
    coalesce(
      new.raw_user_meta_data ->> 'avatar_url',
      new.raw_user_meta_data ->> 'picture',
      null
    )
  )
  on conflict (id) do update set
    email      = excluded.email,
    full_name  = coalesce(excluded.full_name,  vectorbea.profiles.full_name),
    avatar_url = coalesce(excluded.avatar_url, vectorbea.profiles.avatar_url),
    updated_at = now();

  return new;
end;
$$;

-- Wire the trigger to fire after every new signup in auth.users.
drop trigger if exists on_auth_user_created on auth.users;

create trigger on_auth_user_created
  after insert on auth.users
  for each row
  execute function vectorbea.handle_new_user();

-- Ensure the service role and authenticated users can read profiles.
grant usage  on schema vectorbea to anon, authenticated, service_role;
grant all    on table  vectorbea.profiles to service_role;
grant select on table  vectorbea.profiles to authenticated;
