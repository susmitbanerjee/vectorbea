-- =============================================================
-- RPC: create_tenant_environment
--
-- Atomically provisions a complete tenant environment in a single
-- database transaction:
--
--   1. INSERT vectorbea.organizations
--   2. INSERT vectorbea.org_members     (caller = owner)
--   3. INSERT vectorbea.workspaces      (linked to the new org)
--   4. INSERT vectorbea.workspace_members (caller = admin)
--
-- Because all four writes happen inside one TRANSACTION, any
-- failure (constraint violation, FK error, etc.) automatically
-- rolls back every preceding insert — the database can never be
-- left in a half-created state.
--
-- Returns a JSON object:  { organization_id, workspace_id }
-- =============================================================

create or replace function vectorbea.create_tenant_environment(
    p_user_id       uuid,
    p_org_name      text,
    p_workspace_name text,
    p_plan_tier     text default 'free'
)
returns json
language plpgsql
security definer                  -- runs as DB owner so it can write across tables
set search_path = vectorbea, public  -- explicit search path — prevents injection
as $$
declare
    v_org_id       uuid;
    v_workspace_id uuid;
    v_max_seats    int  := 1;
    v_max_prompts  int  := 5;
    v_audit_limit  int  := 100;
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
    insert into vectorbea.organizations (
        name,
        plan_tier,
        max_seats,
        max_prompts,
        monthly_audit_limit
    )
    values (
        p_org_name,
        p_plan_tier,
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
    -- Any unhandled error is automatically re-raised and the implicit
    -- PL/pgSQL transaction is rolled back in full. We re-raise with
    -- SQLERRM so the caller receives a meaningful error message.
    when others then
        raise exception 'create_tenant_environment failed: %', sqlerrm;
end;
$$;

-- Grant execute only to the service role (called exclusively from the
-- Next.js API layer — never directly from the browser client).
revoke execute on function vectorbea.create_tenant_environment(uuid, text, text, text)
    from public, anon, authenticated;

grant execute on function vectorbea.create_tenant_environment(uuid, text, text, text)
    to service_role;

comment on function vectorbea.create_tenant_environment is
    'Atomically creates an org + org_member + workspace + workspace_member '
    'in one transaction. Returns JSON { organization_id, workspace_id }.';
