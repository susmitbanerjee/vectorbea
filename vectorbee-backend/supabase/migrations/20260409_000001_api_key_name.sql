alter table public.api_keys
    add column if not exists key_name text not null default '';

comment on column public.api_keys.key_name is 'Human-readable label for the key (e.g. "production-agent")';
