-- =============================================================
-- Fix: create_tenant_environment — cast text → plan_tier enum
--
-- The `organizations.plan_tier` column is typed as the custom
-- enum `plan_tier`.  The function parameter `p_plan_tier` is
-- declared as `text`.  Postgres does NOT implicitly coerce
-- text → a user-defined enum, so every call threw:
--
--   column "plan_tier" is of type plan_tier but expression
--   is of type text
--
-- Fix: cast `p_plan_tier` to `public.plan_tier` at every
-- INSERT site inside the function body.
-- The enum was created in and remains in the `public` schema
-- (migration 20260412_000004 does `alter type public.plan_tier add value`
-- which confirms it was never moved to `vectorbea`).
-- =============================================================

create or replace function vectorbea.create_tenant_environment(
    p_user_id        uuid,
    p_org_name       text,
    p_workspace_name text,
    p_plan_tier      text default 'free'
)
returns json
language plpgsql
security definer
set search_path = vectorbea, public
as $$
declare
    v_org_id       uuid;
    v_workspace_id uuid;
    v_max_seats    int := 1;
    v_max_prompts  int := 5;
    v_audit_limit  int := 100;
begin
    -- ── Resolve plan limits ────────────────────────────────────────────────
    if p_plan_tier = 'team' then
        v_max_seats   := 10;
        v_max_prompts := 50;
        v_audit_limit := 10000;
    elsif p_plan_tier = 'pro' then
        v_max_seats   := 25;
        v_max_prompts := 200;
        v_audit_limit := 100000;
    elsif p_plan_tier = 'enterprise' then
        v_max_seats   := 1000;
        v_max_prompts := 10000;
        v_audit_limit := 10000000;
    end if;

    -- ── 1. Create the organization ─────────────────────────────────────────
    -- Cast p_plan_tier explicitly to the plan_tier enum type.
    -- Postgres will not coerce text → custom enum implicitly.
    insert into vectorbea.organizations (
        name,
        plan_tier,
        max_seats,
        max_prompts,
        monthly_audit_limit
    )
    values (
        p_org_name,
        p_plan_tier::public.plan_tier,      -- ← enum lives in public schema, not vectorbea
        v_max_seats,
        v_max_prompts,
        v_audit_limit
    )
    returning id into v_org_id;

    -- ── 2. Add caller as org owner ─────────────────────────────────────────
    insert into vectorbea.org_members (
        organization_id,
        user_id,
        role
    )
    values (
        v_org_id,
        p_user_id,
        'owner'
    );

    -- ── 3. Create the default workspace ────────────────────────────────────
    insert into vectorbea.workspaces (
        organization_id,
        name
    )
    values (
        v_org_id,
        p_workspace_name
    )
    returning id into v_workspace_id;

    -- ── 4. Add caller as workspace admin ───────────────────────────────────
    insert into vectorbea.workspace_members (
        workspace_id,
        user_id,
        role
    )
    values (
        v_workspace_id,
        p_user_id,
        'admin'
    );

    -- ── Return both IDs to the caller ──────────────────────────────────────
    return json_build_object(
        'organization_id', v_org_id,
        'workspace_id',    v_workspace_id
    );

exception
    when others then
        raise exception 'create_tenant_environment failed: %', sqlerrm;
end;
$$;

-- Re-assert grants (idempotent — safe to repeat).
revoke execute on function vectorbea.create_tenant_environment(uuid, text, text, text)
    from public, anon, authenticated;

grant execute on function vectorbea.create_tenant_environment(uuid, text, text, text)
    to service_role;
