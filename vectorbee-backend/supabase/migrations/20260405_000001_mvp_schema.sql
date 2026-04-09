create extension if not exists pgcrypto;

create table if not exists public.organizations (
    id uuid primary key default gen_random_uuid(),
    name text not null,
    created_at timestamptz not null default now()
);

create table if not exists public.users (
    id uuid primary key default gen_random_uuid(),
    organization_id uuid not null references public.organizations(id) on delete cascade,
    email text not null,
    role text not null,
    created_at timestamptz not null default now(),
    constraint users_organization_email_key unique (organization_id, email)
);

create table if not exists public.api_keys (
    id uuid primary key default gen_random_uuid(),
    organization_id uuid not null references public.organizations(id) on delete cascade,
    key_hash text not null,
    key_last_four text not null default '',
    created_at timestamptz not null default now(),
    constraint api_keys_key_hash_key unique (key_hash)
);

create table if not exists public.prompts (
    id uuid primary key default gen_random_uuid(),
    organization_id uuid not null references public.organizations(id) on delete cascade,
    name text not null,
    description text,
    created_at timestamptz not null default now(),
    constraint prompts_organization_name_key unique (organization_id, name)
);

create table if not exists public.prompt_versions (
    id uuid primary key default gen_random_uuid(),
    prompt_id uuid not null references public.prompts(id) on delete cascade,
    version_tag text not null,
    template_text text not null,
    parameters jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now(),
    constraint prompt_versions_prompt_id_version_tag_key unique (prompt_id, version_tag)
);

create table if not exists public.audit_logs (
    id uuid primary key default gen_random_uuid(),
    organization_id uuid not null references public.organizations(id) on delete cascade,
    prompt_version_id uuid not null references public.prompt_versions(id) on delete cascade,
    proxy_latency_ms double precision not null default 0 check (proxy_latency_ms >= 0),
    llm_latency_ms integer not null default 0 check (llm_latency_ms >= 0),
    token_count integer not null check (token_count >= 0),
    metadata jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now()
);

create index if not exists idx_api_keys_key_hash
    on public.api_keys (key_hash);

create index if not exists idx_prompts_name
    on public.prompts (name);

create index if not exists idx_audit_logs_created_at
    on public.audit_logs (created_at desc);

create index if not exists idx_users_organization_id
    on public.users (organization_id);

create index if not exists idx_api_keys_organization_id
    on public.api_keys (organization_id);

create index if not exists idx_prompts_organization_id
    on public.prompts (organization_id);

create index if not exists idx_prompt_versions_prompt_id
    on public.prompt_versions (prompt_id);

create index if not exists idx_audit_logs_organization_id
    on public.audit_logs (organization_id);

create index if not exists idx_audit_logs_prompt_version_id
    on public.audit_logs (prompt_version_id);
