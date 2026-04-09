alter table public.prompt_versions
add column if not exists is_published boolean not null default false;
