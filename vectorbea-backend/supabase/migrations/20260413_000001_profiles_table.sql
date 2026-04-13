create schema if not exists vectorbea;

drop view if exists vectorbea.profiles;

create table if not exists vectorbea.profiles (
    id uuid primary key,
    email text not null unique,
    full_name text,
    avatar_url text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

alter table vectorbea.profiles
    add column if not exists full_name text,
    add column if not exists avatar_url text,
    add column if not exists created_at timestamptz not null default now(),
    add column if not exists updated_at timestamptz not null default now();

grant all on table vectorbea.profiles to anon, authenticated, service_role;
