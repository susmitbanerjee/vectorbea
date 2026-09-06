-- =============================================================================
-- V060__plans_and_entitlements.sql
--
-- S3: plans and entitlements. No payment provider — S4 connects one to this.
--
-- ── THE GOVERNING RULE ──────────────────────────────────────────────────────
-- ENTITLEMENTS RESOLVE FROM THE WORKSPACE'S BILLING ACCOUNT, NEVER FROM THE
-- REQUESTING USER'S PLAN.
--
-- A Pro member acting inside a Free workspace gets Free limits. That sentence is
-- the whole security model of this file, and it is enforced structurally rather
-- than by convention: `resolve_entitlements()` takes a WORKSPACE id and has no
-- parameter for a user. There is no signature by which a caller could
-- accidentally resolve from the actor. Every enforcement point in both services
-- goes through that one function.
--
-- The exploit it closes: user U is on Pro through account A. Workspace W belongs
-- to account B, which is on Free. U is invited to W as a member. If any check
-- read "U's plan", U could run Pro-sized workloads inside a workspace B pays
-- for — and B's bill, B's retention and B's concurrency would all be governed by
-- a plan B never bought. Sharing a workspace must not move who pays or which
-- plan governs.
--
-- ── PRICING SHAPE: PER-SEAT, ACCOUNT-WIDE ───────────────────────────────────
-- Recorded here because it is a pricing decision, not an engineering one, and
-- every table below has a different shape depending on the answer.
--
--   * The BILLING ACCOUNT subscribes to a plan and buys N seats.
--   * A SEAT is a person, counted ONCE across the account no matter how many of
--     the account's workspaces they belong to. `account_seats_used()` is the
--     definition; it is a COUNT(DISTINCT user_id), and that DISTINCT is the
--     whole per-seat model.
--   * Workspaces are not priced. `max_workspaces` is a plan LIMIT, not a price.
--   * Quotas are ACCOUNT-scoped: one monthly allowance shared by every workspace
--     on the account. The `scope` column exists so a future plan can say
--     otherwise per key, without a schema change.
--
-- ── WHY PLANS ARE DATA ──────────────────────────────────────────────────────
-- "Adding a plan or changing a limit must not require a deploy." So a plan is
-- rows, a limit is a row, and the resolution rule is a SQL function that both
-- services call. The Kotlin cache is invalidated by a version counter that
-- TRIGGERS bump — which means a hand-written UPDATE in psql takes effect within
-- the poll interval, with nobody having to remember to call an invalidation
-- endpoint.
-- =============================================================================


-- ═══════════════════════════════════════════════════════════════════════════
-- 1. plans — the catalogue
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS plans (
    code              TEXT        PRIMARY KEY,
    name              TEXT        NOT NULL,
    description       TEXT,

    -- Price is informational until S4. NULL price_cents means "contact us":
    -- an Enterprise row must not render as "$0".
    price_cents       INTEGER,
    currency          TEXT        NOT NULL DEFAULT 'USD',
    billing_interval  TEXT        NOT NULL DEFAULT 'month'
        CHECK (billing_interval IN ('month','year')),

    -- The recorded pricing decision, as data. A future per-workspace plan can
    -- coexist with the per-seat ones rather than forcing a migration.
    price_model       TEXT        NOT NULL DEFAULT 'per_seat'
        CHECK (price_model IN ('per_seat','per_workspace','custom')),

    -- Every refusal names a limit, a plan and an upgrade path. These two columns
    -- are the third of those three, so the path is data and not a string in a
    -- Kotlin file that nobody edits when packaging changes.
    upgrade_to_code   TEXT        REFERENCES plans(code),
    -- `/settings/billing` and not `/settings/plan`: the Plan & access screen is
    -- `app/(app)/settings/billing/page.tsx`. A refusal whose upgrade path 404s
    -- is worse than one with no path at all, because the reader concludes the
    -- product is broken rather than that they need a bigger plan.
    upgrade_url       TEXT        NOT NULL DEFAULT '/settings/billing',

    is_public         BOOLEAN     NOT NULL DEFAULT true,
    sort_order        INTEGER     NOT NULL DEFAULT 0,
    archived_at       TIMESTAMPTZ,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE plans IS
    'Plan catalogue. Editable at runtime: adding a plan or changing its price is '
    'an INSERT or an UPDATE, never a deploy.';
COMMENT ON COLUMN plans.upgrade_to_code IS
    'The plan a refusal on this plan should point at. NULL on the top plan, '
    'which is why refusal copy must tolerate "no upgrade path, contact us".';


-- ═══════════════════════════════════════════════════════════════════════════
-- 2. plan_entitlements — what a plan grants
--
-- THREE KINDS, BECAUSE THEY ENFORCE AND RESET DIFFERENTLY:
--
--   quota    consumption over a period. Compared against metered usage; resets
--            at the period boundary. Enforced at ADMISSION only — a run already
--            admitted runs to completion.
--   limit    a ceiling at any instant. Compared against a live COUNT. Never
--            resets. Enforced wherever the thing is created or configured.
--   feature  on/off. No counting. Enforced by presence.
--
-- and one that is none of those, named honestly:
--
--   setting  a parameter the runtime reads (scheduling weight, support tier).
--            Not enforced — consumed. Calling it a "limit" would have been a lie
--            that costs somebody an afternoon.
--
-- A value lives in exactly one typed column. Four nullable columns rather than
-- one JSONB because a human edits these by hand in psql — that is the entire
-- point of "no deploy" — and `SET int_value = 50` is harder to get wrong than
-- `SET value = '50'::jsonb`.
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS plan_entitlements (
    plan_code    TEXT        NOT NULL REFERENCES plans(code) ON DELETE CASCADE,
    key          TEXT        NOT NULL,
    kind         TEXT        NOT NULL CHECK (kind IN ('quota','limit','feature','setting')),

    -- 'account'   — one allowance for the whole billing account.
    -- 'workspace' — the number applies to each workspace independently.
    scope        TEXT        NOT NULL DEFAULT 'account'
        CHECK (scope IN ('account','workspace')),

    -- Reset period. Only meaningful for a quota; NULL everywhere else.
    period       TEXT        CHECK (period IN ('day','month','year')),

    int_value    BIGINT,
    bool_value   BOOLEAN,
    num_value    DOUBLE PRECISION,
    text_value   TEXT,

    note         TEXT,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),

    PRIMARY KEY (plan_code, key),

    -- The kind and the populated column must agree, or a resolver reads NULL and
    -- silently treats a limit as unlimited. That failure mode is a free upgrade
    -- for whoever trips it, so it is a constraint and not a convention.
    CONSTRAINT plan_entitlements_value_matches_kind CHECK (
        (kind = 'quota'   AND int_value  IS NOT NULL AND period IS NOT NULL)
     OR (kind = 'limit'   AND int_value  IS NOT NULL)
     OR (kind = 'feature' AND bool_value IS NOT NULL)
     OR (kind = 'setting' AND (num_value IS NOT NULL OR text_value IS NOT NULL))
    )
);

COMMENT ON COLUMN plan_entitlements.int_value IS
    '-1 means UNLIMITED. Zero means zero — a plan with max_team_size = 0 cannot '
    'build a team at all, which is different from one with no opinion.';

CREATE INDEX IF NOT EXISTS plan_entitlements_key_idx ON plan_entitlements (key);


-- ═══════════════════════════════════════════════════════════════════════════
-- 3. Seed the catalogue
--
-- ON CONFLICT DO NOTHING throughout. These rows are the STARTING POINT, not the
-- truth: the moment somebody raises a limit in psql, re-running this file must
-- not undo it. Flyway will not re-run it, but the integration harness applies
-- migrations against a persistent volume and would.
--
-- Prices are placeholders for S4 to correct. They are marked as such rather than
-- left NULL, because a plan card that renders "$0" for Pro is worse than one
-- that renders a number somebody has to change.
-- ═══════════════════════════════════════════════════════════════════════════
INSERT INTO plans (code, name, description, price_cents, price_model, upgrade_to_code, sort_order, is_public) VALUES
    ('free',       'Free',       'One workspace, enough to run something real and see the traces.',   0,    'per_seat',   'pro',  10, true),
    ('pro',        'Pro',        'A working individual: delegation, replay, MCP tools, the API.',     4900, 'per_seat',   'team', 20, true),
    ('team',       'Team',       'Teams of agents and teams of people, with priority scheduling.',    9900, 'per_seat',   'enterprise', 30, true),
    ('enterprise', 'Enterprise', 'Custom limits, dedicated support, and a contract.',                 NULL, 'custom',     NULL,   40, true)
ON CONFLICT (code) DO NOTHING;

-- The entitlement grid. One row per (plan, key). Read it as a table: the four
-- value columns are sparse by design and the CHECK above keeps them honest.
INSERT INTO plan_entitlements (plan_code, key, kind, scope, period, int_value, bool_value, num_value, text_value, note) VALUES
    -- ── QUOTAS — consumption, account-wide, reset monthly ────────────────────
    ('free',       'runs_per_month',          'quota',  'account',  'month',        500, NULL, NULL, NULL, NULL),
    ('pro',        'runs_per_month',          'quota',  'account',  'month',      10000, NULL, NULL, NULL, NULL),
    ('team',       'runs_per_month',          'quota',  'account',  'month',      50000, NULL, NULL, NULL, NULL),
    ('enterprise', 'runs_per_month',          'quota',  'account',  'month',         -1, NULL, NULL, NULL, 'unlimited'),

    ('free',       'agent_minutes_per_month', 'quota',  'account',  'month',         60, NULL, NULL, NULL, NULL),
    ('pro',        'agent_minutes_per_month', 'quota',  'account',  'month',       1500, NULL, NULL, NULL, NULL),
    ('team',       'agent_minutes_per_month', 'quota',  'account',  'month',      10000, NULL, NULL, NULL, NULL),
    ('enterprise', 'agent_minutes_per_month', 'quota',  'account',  'month',         -1, NULL, NULL, NULL, 'unlimited'),

    ('free',       'tokens_per_month',        'quota',  'account',  'month',    1000000, NULL, NULL, NULL, NULL),
    ('pro',        'tokens_per_month',        'quota',  'account',  'month',   50000000, NULL, NULL, NULL, NULL),
    ('team',       'tokens_per_month',        'quota',  'account',  'month',  250000000, NULL, NULL, NULL, NULL),
    ('enterprise', 'tokens_per_month',        'quota',  'account',  'month',         -1, NULL, NULL, NULL, 'unlimited'),

    -- ── LIMITS — a ceiling at any instant ───────────────────────────────────
    ('free',       'max_workspaces',            'limit', 'account',   NULL,     1, NULL, NULL, NULL, NULL),
    ('pro',        'max_workspaces',            'limit', 'account',   NULL,     3, NULL, NULL, NULL, NULL),
    ('team',       'max_workspaces',            'limit', 'account',   NULL,    10, NULL, NULL, NULL, NULL),
    ('enterprise', 'max_workspaces',            'limit', 'account',   NULL,    -1, NULL, NULL, NULL, 'unlimited'),

    -- Seats are billed, so the plan caps what may be BOUGHT and
    -- billing_accounts.seats records what WAS. -1 means "as many as you buy".
    ('free',       'max_seats',                 'limit', 'account',   NULL,     1, NULL, NULL, NULL, 'free is single-seat'),
    ('pro',        'max_seats',                 'limit', 'account',   NULL,     1, NULL, NULL, NULL, 'pro is a single-seat plan; buy Team for more'),
    ('team',       'max_seats',                 'limit', 'account',   NULL,    -1, NULL, NULL, NULL, 'billed per seat'),
    ('enterprise', 'max_seats',                 'limit', 'account',   NULL,    -1, NULL, NULL, NULL, 'billed per seat'),

    ('free',       'max_members_per_workspace', 'limit', 'workspace', NULL,     3, NULL, NULL, NULL, NULL),
    ('pro',        'max_members_per_workspace', 'limit', 'workspace', NULL,     5, NULL, NULL, NULL, NULL),
    ('team',       'max_members_per_workspace', 'limit', 'workspace', NULL,    25, NULL, NULL, NULL, NULL),
    ('enterprise', 'max_members_per_workspace', 'limit', 'workspace', NULL,    -1, NULL, NULL, NULL, 'unlimited'),

    -- 2 on free reproduces today's workspace_usage_policies default exactly, so
    -- applying this migration changes no workspace's concurrency.
    ('free',       'max_concurrent_runs',       'limit', 'workspace', NULL,     2, NULL, NULL, NULL, 'matches the pre-S3 default'),
    ('pro',        'max_concurrent_runs',       'limit', 'workspace', NULL,     5, NULL, NULL, NULL, NULL),
    ('team',       'max_concurrent_runs',       'limit', 'workspace', NULL,    15, NULL, NULL, NULL, NULL),
    ('enterprise', 'max_concurrent_runs',       'limit', 'workspace', NULL,    50, NULL, NULL, NULL, NULL),

    ('free',       'max_agents',                'limit', 'workspace', NULL,     3, NULL, NULL, NULL, NULL),
    ('pro',        'max_agents',                'limit', 'workspace', NULL,    25, NULL, NULL, NULL, NULL),
    ('team',       'max_agents',                'limit', 'workspace', NULL,   100, NULL, NULL, NULL, NULL),
    ('enterprise', 'max_agents',                'limit', 'workspace', NULL,    -1, NULL, NULL, NULL, 'unlimited'),

    -- 0 on free is deliberate and is not the same as the teams feature being
    -- off: it makes the number in the refusal honest ("your plan allows 0").
    ('free',       'max_team_size',             'limit', 'workspace', NULL,     0, NULL, NULL, NULL, NULL),
    ('pro',        'max_team_size',             'limit', 'workspace', NULL,     3, NULL, NULL, NULL, NULL),
    ('team',       'max_team_size',             'limit', 'workspace', NULL,     8, NULL, NULL, NULL, NULL),
    ('enterprise', 'max_team_size',             'limit', 'workspace', NULL,    25, NULL, NULL, NULL, NULL),

    ('free',       'max_delegation_depth',      'limit', 'workspace', NULL,     0, NULL, NULL, NULL, NULL),
    ('pro',        'max_delegation_depth',      'limit', 'workspace', NULL,     1, NULL, NULL, NULL, NULL),
    ('team',       'max_delegation_depth',      'limit', 'workspace', NULL,     3, NULL, NULL, NULL, NULL),
    ('enterprise', 'max_delegation_depth',      'limit', 'workspace', NULL,     5, NULL, NULL, NULL, NULL),

    -- ── RETENTION — a limit, per surface, because they cost different amounts
    -- to keep. Payload bytes dominate; run rows are cheap. One number for all
    -- four would price the cheapest at the rate of the most expensive.
    ('free',       'retention_days_runs',       'limit', 'workspace', NULL,     7, NULL, NULL, NULL, NULL),
    ('pro',        'retention_days_runs',       'limit', 'workspace', NULL,    30, NULL, NULL, NULL, NULL),
    ('team',       'retention_days_runs',       'limit', 'workspace', NULL,    90, NULL, NULL, NULL, NULL),
    ('enterprise', 'retention_days_runs',       'limit', 'workspace', NULL,   365, NULL, NULL, NULL, NULL),

    ('free',       'retention_days_events',     'limit', 'workspace', NULL,     7, NULL, NULL, NULL, NULL),
    ('pro',        'retention_days_events',     'limit', 'workspace', NULL,    30, NULL, NULL, NULL, NULL),
    ('team',       'retention_days_events',     'limit', 'workspace', NULL,    90, NULL, NULL, NULL, NULL),
    ('enterprise', 'retention_days_events',     'limit', 'workspace', NULL,   365, NULL, NULL, NULL, NULL),

    ('free',       'retention_days_traces',     'limit', 'workspace', NULL,     3, NULL, NULL, NULL, NULL),
    ('pro',        'retention_days_traces',     'limit', 'workspace', NULL,    14, NULL, NULL, NULL, NULL),
    ('team',       'retention_days_traces',     'limit', 'workspace', NULL,    45, NULL, NULL, NULL, NULL),
    ('enterprise', 'retention_days_traces',     'limit', 'workspace', NULL,   180, NULL, NULL, NULL, NULL),

    -- 7 on free is not generosity, it is the pre-S3 default: `PayloadStore` reads
    -- this key now, and V015's `log_retention_days` default was 7. Seeding 3 here
    -- would have SHORTENED every existing workspace's payload retention the moment
    -- the migration applied - a silent data loss dressed as packaging. Tightening
    -- it later is one UPDATE, with no deploy, which is the whole point.
    ('free',       'retention_days_payloads',   'limit', 'workspace', NULL,     7, NULL, NULL, NULL, 'matches the pre-S3 default'),
    ('pro',        'retention_days_payloads',   'limit', 'workspace', NULL,    14, NULL, NULL, NULL, NULL),
    ('team',       'retention_days_payloads',   'limit', 'workspace', NULL,    30, NULL, NULL, NULL, NULL),
    ('enterprise', 'retention_days_payloads',   'limit', 'workspace', NULL,    90, NULL, NULL, NULL, NULL),

    -- ── FEATURES — on/off ───────────────────────────────────────────────────
    ('free',       'teams',       'feature', 'workspace', NULL, NULL, false, NULL, NULL, NULL),
    ('pro',        'teams',       'feature', 'workspace', NULL, NULL, false, NULL, NULL, NULL),
    ('team',       'teams',       'feature', 'workspace', NULL, NULL, true,  NULL, NULL, NULL),
    ('enterprise', 'teams',       'feature', 'workspace', NULL, NULL, true,  NULL, NULL, NULL),

    ('free',       'delegation',  'feature', 'workspace', NULL, NULL, false, NULL, NULL, NULL),
    ('pro',        'delegation',  'feature', 'workspace', NULL, NULL, true,  NULL, NULL, NULL),
    ('team',       'delegation',  'feature', 'workspace', NULL, NULL, true,  NULL, NULL, NULL),
    ('enterprise', 'delegation',  'feature', 'workspace', NULL, NULL, true,  NULL, NULL, NULL),

    ('free',       'replay',      'feature', 'workspace', NULL, NULL, false, NULL, NULL, NULL),
    ('pro',        'replay',      'feature', 'workspace', NULL, NULL, true,  NULL, NULL, NULL),
    ('team',       'replay',      'feature', 'workspace', NULL, NULL, true,  NULL, NULL, NULL),
    ('enterprise', 'replay',      'feature', 'workspace', NULL, NULL, true,  NULL, NULL, NULL),

    ('free',       'otel_export', 'feature', 'workspace', NULL, NULL, false, NULL, NULL, NULL),
    ('pro',        'otel_export', 'feature', 'workspace', NULL, NULL, false, NULL, NULL, NULL),
    ('team',       'otel_export', 'feature', 'workspace', NULL, NULL, true,  NULL, NULL, NULL),
    ('enterprise', 'otel_export', 'feature', 'workspace', NULL, NULL, true,  NULL, NULL, NULL),

    ('free',       'mcp_tools',   'feature', 'workspace', NULL, NULL, false, NULL, NULL, NULL),
    ('pro',        'mcp_tools',   'feature', 'workspace', NULL, NULL, true,  NULL, NULL, NULL),
    ('team',       'mcp_tools',   'feature', 'workspace', NULL, NULL, true,  NULL, NULL, NULL),
    ('enterprise', 'mcp_tools',   'feature', 'workspace', NULL, NULL, true,  NULL, NULL, NULL),

    ('free',       'api_access',  'feature', 'workspace', NULL, NULL, false, NULL, NULL, NULL),
    ('pro',        'api_access',  'feature', 'workspace', NULL, NULL, true,  NULL, NULL, NULL),
    ('team',       'api_access',  'feature', 'workspace', NULL, NULL, true,  NULL, NULL, NULL),
    ('enterprise', 'api_access',  'feature', 'workspace', NULL, NULL, true,  NULL, NULL, NULL),

    -- ── SETTINGS — consumed, not enforced ───────────────────────────────────
    -- scheduling_priority is the fair-queue WEIGHT. fair_vtime already divides a
    -- run's cost by it, so a weight-4 tenant advances its virtual clock a
    -- quarter as fast and is served roughly four times as often under
    -- contention. This is a number in an existing mechanism, not a new lane.
    ('free',       'scheduling_priority', 'setting', 'account', NULL, NULL, NULL, 1.0, NULL, NULL),
    ('pro',        'scheduling_priority', 'setting', 'account', NULL, NULL, NULL, 2.0, NULL, NULL),
    ('team',       'scheduling_priority', 'setting', 'account', NULL, NULL, NULL, 4.0, NULL, NULL),
    ('enterprise', 'scheduling_priority', 'setting', 'account', NULL, NULL, NULL, 8.0, NULL, NULL),

    ('free',       'support_tier', 'setting', 'account', NULL, NULL, NULL, NULL, 'community', NULL),
    ('pro',        'support_tier', 'setting', 'account', NULL, NULL, NULL, NULL, 'email',     NULL),
    ('team',       'support_tier', 'setting', 'account', NULL, NULL, NULL, NULL, 'priority',  NULL),
    ('enterprise', 'support_tier', 'setting', 'account', NULL, NULL, NULL, NULL, 'dedicated', NULL)
ON CONFLICT (plan_code, key) DO NOTHING;


-- ═══════════════════════════════════════════════════════════════════════════
-- 4. billing_accounts — the entity that owns workspaces and pays
--
-- A workspace has exactly ONE billing account. Sharing a workspace with a member
-- of another account changes neither which account pays nor which plan governs —
-- structurally, because membership and ownership are different tables and only
-- ownership is on the resolution path.
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS billing_accounts (
    id                       UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    name                     TEXT        NOT NULL,

    plan_code                TEXT        NOT NULL DEFAULT 'free' REFERENCES plans(code),

    -- S4 owns this column. Until then every account is 'active'. 'past_due' and
    -- 'canceled' still resolve entitlements normally: downgrading on a failed
    -- payment is a policy decision for S4, and guessing it here would delete a
    -- customer's concurrency because a card expired.
    plan_status              TEXT        NOT NULL DEFAULT 'active'
        CHECK (plan_status IN ('trialing','active','past_due','canceled')),

    -- Purchased seats. The plan's max_seats caps what MAY be purchased; this is
    -- what WAS. The effective seat cap is the tighter of the two.
    seats                    INTEGER     NOT NULL DEFAULT 1 CHECK (seats >= 1),

    -- The quota window. Defaults to the calendar month; S4 overwrites these from
    -- the provider so the reset boundary matches the invoice.
    -- account_current_period() rolls them forward WITHOUT writing, so a read path
    -- never takes a row lock to learn what month it is.
    current_period_start     TIMESTAMPTZ NOT NULL DEFAULT date_trunc('month', now()),
    current_period_end       TIMESTAMPTZ NOT NULL DEFAULT date_trunc('month', now()) + interval '1 month',

    -- The grace model. A quota breach does not stop a run that is already
    -- admitted; it refuses the NEXT admission. grace_until lets support hand an
    -- account a stay of execution without editing its plan.
    grace_until              TIMESTAMPTZ,

    -- S4 writes these. Present now so S4 is an UPDATE and not a migration.
    external_customer_id     TEXT,
    external_subscription_id TEXT,

    created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS billing_accounts_plan_idx ON billing_accounts (plan_code);
CREATE UNIQUE INDEX IF NOT EXISTS billing_accounts_external_customer_idx
    ON billing_accounts (external_customer_id) WHERE external_customer_id IS NOT NULL;

COMMENT ON TABLE billing_accounts IS
    'The billing entity. Owns workspaces, subscribes to a plan, buys seats. '
    'Entitlements resolve from HERE and never from the requesting user.';


-- ═══════════════════════════════════════════════════════════════════════════
-- 5. account_entitlement_overrides — the per-account deal
--
-- An Enterprise contract, a support grant, a beta allowance. Same shape as a
-- plan entitlement plus an expiry and a reason, because an override with no
-- recorded reason becomes permanent by amnesia.
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS account_entitlement_overrides (
    billing_account_id UUID        NOT NULL REFERENCES billing_accounts(id) ON DELETE CASCADE,
    key                TEXT        NOT NULL,
    kind               TEXT        NOT NULL CHECK (kind IN ('quota','limit','feature','setting')),
    scope              TEXT        NOT NULL DEFAULT 'account'
        CHECK (scope IN ('account','workspace')),
    period             TEXT        CHECK (period IN ('day','month','year')),

    int_value          BIGINT,
    bool_value         BOOLEAN,
    num_value          DOUBLE PRECISION,
    text_value         TEXT,

    reason             TEXT        NOT NULL,
    granted_by_user_id UUID,
    expires_at         TIMESTAMPTZ,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),

    PRIMARY KEY (billing_account_id, key),

    CONSTRAINT account_override_value_matches_kind CHECK (
        (kind = 'quota'   AND int_value  IS NOT NULL AND period IS NOT NULL)
     OR (kind = 'limit'   AND int_value  IS NOT NULL)
     OR (kind = 'feature' AND bool_value IS NOT NULL)
     OR (kind = 'setting' AND (num_value IS NOT NULL OR text_value IS NOT NULL))
    )
);

COMMENT ON TABLE account_entitlement_overrides IS
    'Per-account deviations from the plan. An expired override is invisible to '
    'the resolver rather than deleted, so "what did they have in March" stays '
    'answerable.';


-- ═══════════════════════════════════════════════════════════════════════════
-- 6. workspaces.billing_account_id — exactly one account per workspace
--
-- BACKFILL GROUPS ON owner_user_id. Every workspace one person owns lands on one
-- account, which is the per-seat model's natural starting point. A workspace
-- with NO owner gets an account of its own rather than being pooled with a
-- stranger's: the wrong grouping here is a cross-tenant billing error, and there
-- is no undo for one of those.
-- ═══════════════════════════════════════════════════════════════════════════
ALTER TABLE workspaces
    ADD COLUMN IF NOT EXISTS billing_account_id UUID REFERENCES billing_accounts(id);

DO $$
DECLARE
    r          RECORD;
    acct       UUID;
    acct_name  TEXT;
BEGIN
    -- One account per distinct owner.
    FOR r IN
        SELECT DISTINCT owner_user_id AS oid
          FROM workspaces
         WHERE owner_user_id IS NOT NULL AND billing_account_id IS NULL
    LOOP
        SELECT COALESCE((SELECT email FROM app_users WHERE id = r.oid),
                        'Account ' || left(r.oid::text, 8))
          INTO acct_name;

        INSERT INTO billing_accounts (name, plan_code) VALUES (acct_name, 'free')
        RETURNING id INTO acct;

        UPDATE workspaces
           SET billing_account_id = acct
         WHERE owner_user_id = r.oid AND billing_account_id IS NULL;
    END LOOP;

    -- Ownerless workspaces: one account each, named after the workspace.
    FOR r IN SELECT id AS wid, name AS wname FROM workspaces WHERE billing_account_id IS NULL
    LOOP
        INSERT INTO billing_accounts (name, plan_code) VALUES (r.wname, 'free')
        RETURNING id INTO acct;
        UPDATE workspaces SET billing_account_id = acct WHERE id = r.wid;
    END LOOP;
END $$;

CREATE INDEX IF NOT EXISTS workspaces_billing_account_idx ON workspaces (billing_account_id);

COMMENT ON COLUMN workspaces.billing_account_id IS
    'The account that pays for this workspace and whose plan governs it. '
    'Exactly one. Adding a member from another account does not change it.';

-- ── The invariant, enforced by the database and not by a service ────────────
--
-- The API and the worker deploy independently, so for a window there is an API
-- version that inserts a workspace without knowing this column exists. A NOT
-- NULL alone would make that version fail; a nullable column alone would leave
-- an unbillable workspace whose entitlements resolve to nothing — which, with a
-- fail-closed resolver, means a tenant who cannot run anything.
--
-- A BEFORE INSERT trigger settles both: whoever inserts, the row gets an
-- account. It reuses the owner's existing account when there is one, which is
-- what makes max_workspaces meaningful — a second workspace joins the account it
-- should be counted against instead of minting a fresh Free allowance.
CREATE OR REPLACE FUNCTION assign_billing_account() RETURNS TRIGGER AS $$
DECLARE
    acct      UUID;
    acct_name TEXT;
BEGIN
    IF NEW.billing_account_id IS NOT NULL THEN
        RETURN NEW;
    END IF;

    IF NEW.owner_user_id IS NOT NULL THEN
        SELECT w.billing_account_id INTO acct
          FROM workspaces w
         WHERE w.owner_user_id = NEW.owner_user_id
           AND w.billing_account_id IS NOT NULL
         LIMIT 1;
    END IF;

    IF acct IS NULL THEN
        SELECT COALESCE((SELECT email FROM app_users WHERE id = NEW.owner_user_id), NEW.name)
          INTO acct_name;
        INSERT INTO billing_accounts (name, plan_code) VALUES (acct_name, 'free')
        RETURNING id INTO acct;
    END IF;

    NEW.billing_account_id := acct;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS workspaces_assign_billing_account ON workspaces;
CREATE TRIGGER workspaces_assign_billing_account
    BEFORE INSERT ON workspaces
    FOR EACH ROW EXECUTE FUNCTION assign_billing_account();

-- Safe now: the trigger fills the column before the constraint is checked, so
-- an old API version that omits it still succeeds.
ALTER TABLE workspaces ALTER COLUMN billing_account_id SET NOT NULL;


-- ═══════════════════════════════════════════════════════════════════════════
-- 7. usage_records — the billing ledger
--
-- ── THE IDEMPOTENCY RULE ────────────────────────────────────────────────────
-- The primary key is (run_id, metric). Not an event id, not a sequence, not a
-- timestamp — the RUN. A run that resumes four times is one run and therefore
-- one row; a redelivered queue message writes the same key; a retry of the
-- terminal transition writes the same key. S4 bills from this table, so a
-- double-counted run is a double CHARGE, and the only defence that survives
-- every one of those paths at once is a key that cannot change between attempts.
--
-- ── AND THE WRITE IS AN OVERWRITE, NEVER AN INCREMENT ───────────────────────
-- Every write stores the ABSOLUTE value of the metric for that run. `runs` is
-- always 1. `tokens` and `agent_minutes` are the run's totals as currently
-- known. So a resume that does more work overwrites with a larger figure and is
-- still exact, and a redelivery that overwrites with the same figure is a no-op.
-- An `UPDATE ... SET quantity = quantity + ?` would double on every redelivery
-- and would be undetectable afterwards.
--
-- ── period_start IS STAMPED ONCE ────────────────────────────────────────────
-- On insert, never on update. A run admitted on the 31st and completed on the
-- 1st belongs to the month it was ADMITTED in — otherwise its `runs` row and its
-- `tokens` row would land in different invoices for the same run, and the two
-- months would each be individually defensible and jointly wrong.
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS usage_records (
    run_id             UUID        NOT NULL,
    metric             TEXT        NOT NULL
        CHECK (metric IN ('runs','agent_minutes','tokens')),

    billing_account_id UUID        NOT NULL REFERENCES billing_accounts(id) ON DELETE CASCADE,
    workspace_id       UUID        NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,

    quantity           NUMERIC(20,4) NOT NULL DEFAULT 0 CHECK (quantity >= 0),

    period_start       TIMESTAMPTZ NOT NULL,
    recorded_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),

    PRIMARY KEY (run_id, metric)
);

-- The aggregate the admission check runs, once per triggered run. Leading
-- equality on the account and the period keeps it to the rows of one month.
CREATE INDEX IF NOT EXISTS usage_records_account_period_idx
    ON usage_records (billing_account_id, period_start, metric)
    INCLUDE (quantity);

CREATE INDEX IF NOT EXISTS usage_records_workspace_idx
    ON usage_records (workspace_id, period_start);

COMMENT ON TABLE usage_records IS
    'What S4 bills from. One row per (run, metric); writes overwrite rather than '
    'increment; replays are never written at all.';


-- ═══════════════════════════════════════════════════════════════════════════
-- 8. Cache invalidation — a version counter the database maintains
--
-- The resolver caches. "Changing a limit in the database takes effect without a
-- deploy" therefore needs an invalidation signal, and the signal has to fire for
-- a change made in psql by a person who has never heard of the cache. So it is a
-- statement-level trigger on the four tables that can change an answer.
--
-- One global counter rather than one per account: a bump flushes every cached
-- workspace, which is a handful of extra resolves for a change that happens a
-- few times a day. Per-account invalidation would be more precise and would
-- require every writer to know which account it had just affected — a rule that
-- has to be re-applied at each call site is a rule that gets missed at one.
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS entitlement_catalog_version (
    only_row   BOOLEAN     PRIMARY KEY DEFAULT true CHECK (only_row),
    version    BIGINT      NOT NULL DEFAULT 1,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO entitlement_catalog_version (only_row) VALUES (true) ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION bump_entitlement_catalog_version() RETURNS TRIGGER AS $$
BEGIN
    UPDATE entitlement_catalog_version SET version = version + 1, updated_at = now();
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS plans_bump_version ON plans;
CREATE TRIGGER plans_bump_version
    AFTER INSERT OR UPDATE OR DELETE ON plans
    FOR EACH STATEMENT EXECUTE FUNCTION bump_entitlement_catalog_version();

DROP TRIGGER IF EXISTS plan_entitlements_bump_version ON plan_entitlements;
CREATE TRIGGER plan_entitlements_bump_version
    AFTER INSERT OR UPDATE OR DELETE ON plan_entitlements
    FOR EACH STATEMENT EXECUTE FUNCTION bump_entitlement_catalog_version();

DROP TRIGGER IF EXISTS account_overrides_bump_version ON account_entitlement_overrides;
CREATE TRIGGER account_overrides_bump_version
    AFTER INSERT OR UPDATE OR DELETE ON account_entitlement_overrides
    FOR EACH STATEMENT EXECUTE FUNCTION bump_entitlement_catalog_version();

-- billing_accounts is included because changing plan_code or seats changes an
-- answer just as surely as editing the plan does.
DROP TRIGGER IF EXISTS billing_accounts_bump_version ON billing_accounts;
CREATE TRIGGER billing_accounts_bump_version
    AFTER INSERT OR UPDATE OR DELETE ON billing_accounts
    FOR EACH STATEMENT EXECUTE FUNCTION bump_entitlement_catalog_version();


-- ═══════════════════════════════════════════════════════════════════════════
-- 9. The resolution functions
--
-- These are THE definition. The Kotlin resolver and the Next.js settings routes
-- both call them; neither reimplements the merge. Two implementations of
-- "which plan governs this workspace" is how the governing rule gets broken in
-- one language and not the other, and the broken one is the one nobody tests.
-- ═══════════════════════════════════════════════════════════════════════════

-- NOTE ON A FUNCTION THAT IS NOT HERE. An `account_for_workspace(workspace)`
-- helper was written and then removed: every caller already joins
-- `billing_accounts` for the plan in the same query, so it had no call site.
-- `MigrationFunctionCallersTest` is what caught it, and it is right to — an
-- uncalled function in a migration reads as a supported entry point and is not
-- one. The join is `workspaces.billing_account_id`, and it is one line.

-- The current quota window, rolled forward from the stored anchor without
-- writing it back. Rolling forward in a read means a period boundary needs no
-- cron job and no lock: the first request after midnight on the 1st sees the new
-- window because the arithmetic says so, not because a job ran.
CREATE OR REPLACE FUNCTION account_current_period(p_account_id UUID)
RETURNS TABLE (period_start TIMESTAMPTZ, period_end TIMESTAMPTZ)
LANGUAGE plpgsql STABLE AS $$
DECLARE
    s    TIMESTAMPTZ;
    e    TIMESTAMPTZ;
    span INTERVAL;
    hops INTEGER := 0;
BEGIN
    SELECT current_period_start, current_period_end INTO s, e
      FROM billing_accounts WHERE id = p_account_id;

    IF s IS NULL THEN
        s := date_trunc('month', now());
        e := s + interval '1 month';
    END IF;

    span := e - s;
    IF span <= interval '0' THEN
        span := interval '1 month';
        e := s + span;
    END IF;

    -- Bounded: an account abandoned for a century still terminates, and a bug
    -- that makes `span` tiny cannot spin here forever.
    WHILE now() >= e AND hops < 5000 LOOP
        s := e;
        e := e + span;
        hops := hops + 1;
    END LOOP;

    period_start := s;
    period_end   := e;
    RETURN NEXT;
END;
$$;

-- ── The one that matters ────────────────────────────────────────────────────
-- Takes a WORKSPACE. Has no parameter for a user, and therefore no way to
-- resolve from the actor. Plan rows are the base; a live account override
-- replaces one by key. A FULL OUTER JOIN rather than a LEFT one, so an override
-- may introduce a key the plan does not define — which is how an Enterprise deal
-- grants something no plan sells.
CREATE OR REPLACE FUNCTION resolve_entitlements(p_workspace_id UUID)
RETURNS TABLE (
    key        TEXT,
    kind       TEXT,
    scope      TEXT,
    period     TEXT,
    int_value  BIGINT,
    bool_value BOOLEAN,
    num_value  DOUBLE PRECISION,
    text_value TEXT,
    source     TEXT
)
LANGUAGE sql STABLE AS $$
    WITH acct AS (
        SELECT b.id, b.plan_code
          FROM workspaces w
          JOIN billing_accounts b ON b.id = w.billing_account_id
         WHERE w.id = p_workspace_id
    ),
    base AS (
        SELECT pe.* FROM plan_entitlements pe JOIN acct a ON a.plan_code = pe.plan_code
    ),
    ovr AS (
        SELECT o.* FROM account_entitlement_overrides o JOIN acct a ON a.id = o.billing_account_id
         WHERE o.expires_at IS NULL OR o.expires_at > now()
    )
    SELECT
        COALESCE(o.key,   b.key)                          AS key,
        COALESCE(o.kind,  b.kind)                         AS kind,
        COALESCE(o.scope, b.scope)                        AS scope,
        COALESCE(o.period, b.period)                      AS period,
        CASE WHEN o.key IS NOT NULL THEN o.int_value  ELSE b.int_value  END AS int_value,
        CASE WHEN o.key IS NOT NULL THEN o.bool_value ELSE b.bool_value END AS bool_value,
        CASE WHEN o.key IS NOT NULL THEN o.num_value  ELSE b.num_value  END AS num_value,
        CASE WHEN o.key IS NOT NULL THEN o.text_value ELSE b.text_value END AS text_value,
        CASE WHEN o.key IS NOT NULL THEN 'override' ELSE 'plan' END          AS source
      FROM base b
      FULL OUTER JOIN ovr o ON o.key = b.key
$$;

COMMENT ON FUNCTION resolve_entitlements(UUID) IS
    'THE definition of effective entitlements. Takes a workspace and has no '
    'parameter for a user, which is what makes "a Pro member in a Free '
    'workspace gets Free limits" a property of the signature rather than a rule '
    'somebody has to remember.';

-- Seats used: one person, counted once, no matter how many of the account's
-- workspaces they belong to. The DISTINCT is the per-seat pricing model.
CREATE OR REPLACE FUNCTION account_seats_used(p_account_id UUID)
RETURNS INTEGER
LANGUAGE sql STABLE AS $$
    SELECT COALESCE(COUNT(DISTINCT m.user_id), 0)::INTEGER
      FROM workspace_members m
      JOIN workspaces w ON w.id = m.workspace_id
     WHERE w.billing_account_id = p_account_id
       AND m.status = 'active'
$$;

-- Consumption in the current period, by metric.
CREATE OR REPLACE FUNCTION account_usage(p_account_id UUID)
RETURNS TABLE (metric TEXT, used NUMERIC)
LANGUAGE sql STABLE AS $$
    SELECT u.metric, COALESCE(SUM(u.quantity), 0)
      FROM usage_records u, account_current_period(p_account_id) p
     WHERE u.billing_account_id = p_account_id
       AND u.period_start >= p.period_start
       AND u.period_start <  p.period_end
     GROUP BY u.metric
$$;

-- ── The meter ───────────────────────────────────────────────────────────────
-- Both services call THIS rather than writing usage_records themselves, so the
-- replay exclusion and the overwrite semantics cannot be forgotten in one of
-- them. Returns false when nothing was written, and says nothing about why —
-- callers treat metering as best-effort, because a ledger write must never be
-- the reason a run fails.
CREATE OR REPLACE FUNCTION meter_run_usage(
    p_run_id   UUID,
    p_metric   TEXT,
    p_quantity NUMERIC
) RETURNS BOOLEAN
LANGUAGE plpgsql VOLATILE AS $$
DECLARE
    v_workspace UUID;
    v_account   UUID;
    v_kind      TEXT;
    v_period    TIMESTAMPTZ;
BEGIN
    SELECT r.workspace_id, COALESCE(r.execution_mode_kind, 'live')
      INTO v_workspace, v_kind
      FROM agent_runs r WHERE r.id = p_run_id;

    IF v_workspace IS NULL THEN
        RETURN false;
    END IF;

    -- A replay is a debugging tool, not production traffic. It consumed no new
    -- provider calls worth billing and it must never move a customer's invoice —
    -- the same rule the dashboards already apply, enforced here so the ledger
    -- cannot disagree with them.
    IF v_kind = 'replay' THEN
        RETURN false;
    END IF;

    SELECT billing_account_id INTO v_account FROM workspaces WHERE id = v_workspace;
    IF v_account IS NULL THEN
        RETURN false;
    END IF;

    SELECT p.period_start INTO v_period FROM account_current_period(v_account) p;

    INSERT INTO usage_records (run_id, metric, billing_account_id, workspace_id, quantity, period_start)
    VALUES (p_run_id, p_metric, v_account, v_workspace, GREATEST(p_quantity, 0), v_period)
    ON CONFLICT (run_id, metric) DO UPDATE
        SET quantity   = GREATEST(EXCLUDED.quantity, 0),
            updated_at = now();
    -- period_start is deliberately absent from the SET list. See §7.

    RETURN true;
END;
$$;

-- Backfill for a meter write that was lost (a crash between the run insert and
-- the ledger write). Idempotent by the same primary key, so it is safe to run on
-- a schedule or by hand after an incident.
CREATE OR REPLACE FUNCTION reconcile_run_usage(p_since TIMESTAMPTZ)
RETURNS INTEGER
LANGUAGE plpgsql VOLATILE AS $$
DECLARE
    n INTEGER := 0;
    r RECORD;
BEGIN
    FOR r IN
        SELECT ar.id
          FROM agent_runs ar
          LEFT JOIN usage_records u ON u.run_id = ar.id AND u.metric = 'runs'
         WHERE ar.created_at >= p_since
           AND COALESCE(ar.execution_mode_kind, 'live') <> 'replay'
           AND u.run_id IS NULL
    LOOP
        IF meter_run_usage(r.id, 'runs', 1) THEN
            n := n + 1;
        END IF;
    END LOOP;
    RETURN n;
END;
$$;

-- ── Two readers for surfaces that cannot take a Kotlin dependency ───────────
--
-- The fair queue advances a workspace's virtual clock by cost/weight in ONE
-- statement, and the worker's payload store reads a retention window from a
-- connection it already holds. Neither can call the Kotlin resolver, and neither
-- should grow its own idea of what a plan means — so each gets a function.

CREATE OR REPLACE FUNCTION workspace_scheduling_weight(p_workspace_id UUID)
RETURNS DOUBLE PRECISION
LANGUAGE sql STABLE AS $$
    SELECT GREATEST(COALESCE(
        (SELECT e.num_value FROM resolve_entitlements(p_workspace_id) e
          WHERE e.key = 'scheduling_priority'),
        -- Pre-S3 fallback. workspace_usage_policies.plan_weight was the manual
        -- version of this column and some workspaces still carry a tuned value.
        (SELECT MAX(plan_weight) FROM workspace_usage_policies WHERE workspace_id = p_workspace_id),
        1.0
    ), 0.01)
$$;

-- p_surface is one of runs | events | traces | payloads.
CREATE OR REPLACE FUNCTION workspace_retention_days(p_workspace_id UUID, p_surface TEXT)
RETURNS INTEGER
LANGUAGE sql STABLE AS $$
    SELECT COALESCE(
        (SELECT e.int_value::INTEGER FROM resolve_entitlements(p_workspace_id) e
          WHERE e.key = 'retention_days_' || p_surface AND e.int_value >= 0),
        (SELECT MAX(log_retention_days) FROM workspace_usage_policies WHERE workspace_id = p_workspace_id),
        7
    )
$$;


-- ═══════════════════════════════════════════════════════════════════════════
-- 10. Carry existing per-workspace tuning forward as overrides
--
-- Some workspaces have had their limits raised by hand in
-- workspace_usage_policies. From here on the ENTITLEMENT governs, so without
-- this step applying the migration would silently downgrade exactly the tenants
-- somebody had gone out of their way to accommodate.
--
-- Taken as a MAX across the account's workspaces and written as an override with
-- a reason, which is now where a deviation belongs.
-- ═══════════════════════════════════════════════════════════════════════════
INSERT INTO account_entitlement_overrides (billing_account_id, key, kind, scope, int_value, reason)
SELECT w.billing_account_id, 'max_concurrent_runs', 'limit', 'workspace',
       MAX(p.max_concurrent_runs), 'carried forward from workspace_usage_policies at V060'
  FROM workspaces w
  JOIN workspace_usage_policies p ON p.workspace_id = w.id
 GROUP BY w.billing_account_id
HAVING MAX(p.max_concurrent_runs) > 2
ON CONFLICT (billing_account_id, key) DO NOTHING;

INSERT INTO account_entitlement_overrides (billing_account_id, key, kind, scope, int_value, reason)
SELECT w.billing_account_id, 'max_members_per_workspace', 'limit', 'workspace',
       MAX(p.max_team_members), 'carried forward from workspace_usage_policies at V060'
  FROM workspaces w
  JOIN workspace_usage_policies p ON p.workspace_id = w.id
 GROUP BY w.billing_account_id
HAVING MAX(p.max_team_members) > 3
ON CONFLICT (billing_account_id, key) DO NOTHING;

INSERT INTO account_entitlement_overrides (billing_account_id, key, kind, scope, int_value, reason)
SELECT w.billing_account_id, 'retention_days_events', 'limit', 'workspace',
       MAX(p.log_retention_days), 'carried forward from workspace_usage_policies at V060'
  FROM workspaces w
  JOIN workspace_usage_policies p ON p.workspace_id = w.id
 GROUP BY w.billing_account_id
HAVING MAX(p.log_retention_days) > 7
ON CONFLICT (billing_account_id, key) DO NOTHING;

COMMENT ON COLUMN workspace_usage_policies.max_concurrent_runs IS
    'PRE-S3. Superseded by the max_concurrent_runs entitlement, which resolves '
    'from the workspace''s billing account. Still read as a fallback when no '
    'entitlement exists. New deviations belong in account_entitlement_overrides.';


-- A limit as a plain integer, for the two hot paths that must read one inside a
-- statement they cannot split: admission control and the worker's claim.
--
-- Unlimited (-1) becomes INT_MAX rather than NULL, because these callers compare
-- with `>=` and a NULL would silently make every comparison false — which reads
-- as "unlimited" for exactly as long as nobody checks, and as "no limit was ever
-- enforced" afterwards.
--
-- p_default is passed by the caller rather than hard-coded so the pre-S3
-- `workspace_usage_policies` value can still be the fallback for a workspace
-- whose plan says nothing about the key.
CREATE OR REPLACE FUNCTION workspace_limit(
    p_workspace_id UUID,
    p_key          TEXT,
    p_default      INTEGER
) RETURNS INTEGER
LANGUAGE sql STABLE AS $$
    SELECT COALESCE(
        (SELECT CASE WHEN e.int_value < 0 THEN 2147483647 ELSE e.int_value::INTEGER END
           FROM resolve_entitlements(p_workspace_id) e
          WHERE e.key = p_key AND e.kind IN ('limit','quota')),
        p_default)
$$;

-- Whether a workspace's plan includes a feature. Fails CLOSED: a key with no row
-- is false, so a feature added to the code ahead of its seed row is off rather
-- than granted to everybody.
CREATE OR REPLACE FUNCTION workspace_has_feature(p_workspace_id UUID, p_key TEXT)
RETURNS BOOLEAN
LANGUAGE sql STABLE AS $$
    SELECT COALESCE(
        (SELECT e.bool_value FROM resolve_entitlements(p_workspace_id) e
          WHERE e.key = p_key AND e.kind = 'feature'),
        false)
$$;
