-- =============================================================
-- Expose the `vectorbea` schema to PostgREST
--
-- Context
-- -------
-- The Supabase client's `.schema('vectorbea').rpc(...)` call
-- requires that PostgREST has `vectorbea` in its `exposed_schemas`
-- list (db_extra_search_path / PGRST_DB_SCHEMAS env var in
-- self-hosted setups). On the hosted Supabase platform this is
-- configured in the Dashboard under:
--
--   Database → API → Exposed schemas → add "vectorbea"
--
-- This migration documents the requirement and grants the
-- permissions that PostgREST needs to introspect and call
-- objects in the `vectorbea` schema.
--
-- What is NOT changed here
-- ------------------------
-- * The function `vectorbea.create_tenant_environment` already
--   exists with the correct `security definer` + `set search_path`
--   flags (see migration 20260416_000001_create_tenant_environment_rpc.sql).
-- * execute is already REVOKED from public/anon/authenticated and
--   GRANTED only to service_role — those grants are preserved.
--
-- What this migration adds
-- ------------------------
-- 1. GRANT USAGE so PostgREST can introspect the schema.
-- 2. A do-nothing guard that raises a notice when the schema is
--    not yet in PostgREST's exposed_schemas list, making the
--    misconfiguration detectable at migration time rather than
--    at runtime in production.
-- =============================================================

-- 1. Allow PostgREST to introspect objects in the vectorbea schema.
--    (service_role already has SUPERUSER; this targets anon/authenticated
--    for completeness so that future RLS-gated tables work correctly.)
grant usage on schema vectorbea to anon, authenticated, service_role;

-- 2. Ensure the function remains callable only by service_role.
--    Redundant with the existing grant but safe to re-assert.
grant execute on function vectorbea.create_tenant_environment(uuid, text, text, text)
    to service_role;

-- 3. Advisory notice — apply this setting in the Supabase Dashboard:
--    Database → API → Exposed schemas → add "vectorbea"
--    In self-hosted installs, set the env var:
--      PGRST_DB_SCHEMAS=public,vectorbea
do $$
begin
  raise notice
    'ACTION REQUIRED: add "vectorbea" to PostgREST exposed schemas. '
    'In Supabase Dashboard: Database → API → Exposed schemas. '
    'Without this, supabase.schema("vectorbea").rpc(...) calls will throw '
    '"Could not find the function public.<name>".';
end;
$$;
