-- =============================================================================
-- VectorBee — Local Development Seed
-- =============================================================================
-- Run this AFTER all migrations have been applied. It inserts the minimum
-- data needed to use VectorBee locally without any manual setup:
--
--   • One organization and one workspace with deterministic UUIDs that
--     match the AuthService.LOCAL_BYPASS_AUTH constants.
--   • One admin user for the organization.
--   • One API key whose raw value is `dev_local_123`.
--     The Python SDK, proxy, and UI all use this key out of the box.
--
-- All inserts are idempotent (ON CONFLICT DO NOTHING) so re-running the
-- seed is safe.
--
-- Local API key  →  dev_local_123
-- Environment    →  ENVIRONMENT=local  (default when unset)
-- =============================================================================

-- ---------------------------------------------------------------------------
-- UUIDs — kept in sync with AuthService companion object constants
-- ---------------------------------------------------------------------------
-- Organization : 00000000-0000-0000-0001-000000000001
-- Workspace    : 00000000-0000-0000-0001-000000000002
-- User         : 00000000-0000-0000-0001-000000000003
-- ---------------------------------------------------------------------------

-- 1. Organization
insert into public.organizations (id, name)
values ('00000000-0000-0000-0001-000000000001', 'Local Dev Org')
on conflict (id) do nothing;

-- 2. Workspace (child of the org above)
insert into public.workspaces (id, organization_id, name)
values (
    '00000000-0000-0000-0001-000000000002',
    '00000000-0000-0000-0001-000000000001',
    'local-workspace'
)
on conflict do nothing;

-- 3. Dummy user (org member with owner role)
--    Adjust email if you want it to match your local Supabase Auth user.
insert into public.users (id, organization_id, email, role)
values (
    '00000000-0000-0000-0001-000000000003',
    '00000000-0000-0000-0001-000000000001',
    'dev@local.test',
    'owner'
)
on conflict do nothing;

-- 4. Admin API key  →  raw value: dev_local_123
--    SHA-256("dev_local_123") is computed by PostgreSQL at seed time so we
--    don't need to hard-code a hex string here.
insert into public.api_keys (
    workspace_id,
    key_hash,
    key_last_four,
    key_name,
    key_role
)
values (
    '00000000-0000-0000-0001-000000000002',
    encode(digest('dev_local_123', 'sha256'), 'hex'),
    '0123',                -- last four chars of the raw key (visual only)
    'local-dev-key',
    'admin'
)
on conflict (key_hash) do nothing;

-- ---------------------------------------------------------------------------
-- Optional: seed a sample prompt so the UI isn't completely empty on first boot
-- ---------------------------------------------------------------------------
do $$
declare
    v_prompt_id uuid;
begin
    insert into public.prompts (workspace_id, name, description)
    values (
        '00000000-0000-0000-0001-000000000002',
        'hello-world',
        'A simple greeting prompt — feel free to delete or edit this.'
    )
    on conflict do nothing
    returning id into v_prompt_id;

    if v_prompt_id is not null then
        insert into public.prompt_versions (
            prompt_id, version_tag, template_text, parameters, is_published
        )
        values (
            v_prompt_id,
            'v1.0.0',
            'Hello, {{name}}! Welcome to VectorBee.',
            '{"name": {"type": "string", "description": "The user''s name"}}'::jsonb,
            true
        )
        on conflict do nothing;
    end if;
end $$;
