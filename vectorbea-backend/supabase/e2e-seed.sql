-- =============================================================================
-- E2E test seed — runs LAST (08) after all migration SQL files.
--
-- Purpose:
--   1. Create the schema_migrations table and mark all migrations as applied
--      so the backend's SchemaMigrator does not re-run them on startup.
--   2. Seed one org, one workspace, and one admin API key.
--
-- Raw API key:  vb_e2e_test_key_local
-- Set VECTORBEA_API_KEY=vb_e2e_test_key_local before running docker compose.
-- =============================================================================

-- 1. Tell SchemaMigrator that all migrations are already applied.
--    This table is normally created by the Kotlin app on first boot; we create
--    it here so the app sees all migrations recorded and skips re-running them.
create table if not exists public.schema_migrations (
    filename   text        primary key,
    applied_at timestamptz not null default now()
);

insert into public.schema_migrations (filename) values
    ('20260405_000001_mvp_schema.sql'),
    ('20260405_000002_prompt_publish_status.sql'),
    ('20260408_000001_audit_split_latency.sql'),
    ('20260408_000002_api_key_last_four.sql'),
    ('20260409_000001_api_key_name.sql'),
    ('20260409_000002_enterprise_hierarchy_rbac.sql'),
    ('20260409_000003_api_key_role.sql')
on conflict (filename) do nothing;

-- 2. Org + workspace (fixed UUIDs so curl examples are reproducible)
insert into public.organizations (id, name)
values ('00000000-0000-0000-0000-000000000001', 'E2E Test Org')
on conflict (id) do nothing;

insert into public.workspaces (id, organization_id, name)
values ('00000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000001', 'default')
on conflict do nothing;

-- 3. Admin API key — raw value: vb_e2e_test_key_local
insert into public.api_keys (workspace_id, key_hash, key_last_four, key_name, key_role)
values (
    '00000000-0000-0000-0000-000000000002',
    encode(digest('vb_e2e_test_key_local', 'sha256'), 'hex'),
    'ocal',
    'e2e-admin-key',
    'admin'
)
on conflict (key_hash) do nothing;
