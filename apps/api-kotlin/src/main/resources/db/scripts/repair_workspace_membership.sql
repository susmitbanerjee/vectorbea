-- =============================================================================
-- repair_workspace_membership.sql
--
-- Run this ONCE in Neon SQL Editor to fix the current state:
--   1. Create your app_user row (maps Supabase identity → Neon)
--   2. Attach that user as owner of every existing workspace
--
-- HOW TO GET YOUR SUPABASE USER ID:
--   Supabase Dashboard → Authentication → Users → click your email → copy "User UID"
--   It looks like: a1b2c3d4-e5f6-7890-abcd-ef1234567890
--
-- HOW TO RUN:
--   Neon Console → SQL Editor → paste this file → replace the two placeholders → Run
-- =============================================================================

DO $$
DECLARE
    v_supabase_user_id  TEXT := 'PASTE_YOUR_SUPABASE_USER_UID_HERE';  -- ← replace
    v_email             TEXT := 'PASTE_YOUR_EMAIL_HERE';               -- ← replace
    v_full_name         TEXT := 'Your Name';                           -- ← optional
    v_app_user_id       UUID;
    v_ws_count          INT;
BEGIN
    -- ── Validate inputs ───────────────────────────────────────────────────────
    IF v_supabase_user_id = 'PASTE_YOUR_SUPABASE_USER_UID_HERE' THEN
        RAISE EXCEPTION 'Replace v_supabase_user_id with your actual Supabase User UID';
    END IF;
    IF v_email = 'PASTE_YOUR_EMAIL_HERE' THEN
        RAISE EXCEPTION 'Replace v_email with your actual email address';
    END IF;

    -- ── Step 1: Create / update app_users row ─────────────────────────────────
    INSERT INTO app_users (supabase_user_id, email, full_name, status)
    VALUES (v_supabase_user_id, v_email, v_full_name, 'active')
    ON CONFLICT (supabase_user_id) DO UPDATE
        SET email      = EXCLUDED.email,
            full_name  = COALESCE(EXCLUDED.full_name, app_users.full_name),
            updated_at = now()
    RETURNING id INTO v_app_user_id;

    RAISE NOTICE 'app_user row: id=%', v_app_user_id;

    -- ── Step 2: Attach user as owner of every existing workspace ──────────────
    INSERT INTO workspace_members (workspace_id, user_id, role, status)
    SELECT w.id, v_app_user_id, 'owner', 'active'
    FROM workspaces w
    ON CONFLICT (workspace_id, user_id) DO UPDATE
        SET role   = 'owner',
            status = 'active';

    GET DIAGNOSTICS v_ws_count = ROW_COUNT;
    RAISE NOTICE 'Attached to % workspace(s) as owner', v_ws_count;

    -- ── Step 3: Verify ────────────────────────────────────────────────────────
    RAISE NOTICE '=== Verification ===';
    RAISE NOTICE 'app_users rows: %', (SELECT COUNT(*) FROM app_users);
    RAISE NOTICE 'workspace_members rows: %', (SELECT COUNT(*) FROM workspace_members);

END $$;

-- ── View result ───────────────────────────────────────────────────────────────
SELECT
    u.supabase_user_id,
    u.email,
    w.name  AS workspace_name,
    w.id    AS workspace_id,
    wm.role,
    wm.status
FROM workspace_members wm
JOIN app_users   u ON u.id  = wm.user_id
JOIN workspaces  w ON w.id  = wm.workspace_id
ORDER BY w.name;
