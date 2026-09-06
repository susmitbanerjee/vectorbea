-- =============================================================================
-- V062__shared_workspace_limits.sql
--
-- Closing the eight ways a shared workspace lets somebody route around a limit.
--
-- ── THE SHAPE OF EVERY EXPLOIT HERE ─────────────────────────────────────────
-- A workspace is shareable, so for every limit there are two questions: "whose
-- limit is it" and "who is spending it". S3 answered the first — entitlements
-- resolve from the workspace's billing account. This file answers the second,
-- and adds the bounds that only matter once more than one person is inside.
--
--   1. GUEST-PLAN BLEED     nothing new here; see the audit note below.
--   2. WORKSPACE PROLIFERATION   a per-workspace quota, tighter than the
--                                account's, so N workspaces are not N allowances.
--   3. SEAT EVASION         enforced in S3; V062 adds the pending-invite count.
--   4. GUEST SPEND          usage_records grows an actor, so the ledger that
--                           already bills the account can also cap a member.
--   5. TRIAL RECYCLING      trial state on the account, anchored to a normalised
--                           identity, deliberately imperfect.
--   6. OWNERSHIP TRANSFER   a TRIGGER, so moving a workspace between accounts
--                           opens retention grace however it is moved.
--   7. CONCURRENCY          the P10 activation caps become entitlements.
--   8. API KEYS             workspace-scoped, so they inherit every limit above
--                           by construction rather than by remembering to.
--
-- ── ON (1), WHICH IS THE ONE THAT MATTERS MOST ──────────────────────────────
-- Audited at V062: every enforcement point in `EntitlementGuard`,
-- `RunRoutes`, `AgentRoutes`, `WorkflowRoutes`, `MeRoutes`, `AdmissionControl`,
-- `WorkspaceLimits`, `PayloadStore`, `RunTraceExporter` and
-- `lib/server/entitlements.ts` resolves from a WORKSPACE id. None reads the
-- requester's plan. The two functions that take a user
-- (`requireNewWorkspaceAllowed`, `requireNewMemberAllowed`) use it only to find
-- an account they OWN or to ask "is this person already a seat here" — never to
-- read a plan. `GuestPlanBleedTest` asserts this structurally, so a call site
-- added next year cannot quietly reintroduce it.
-- =============================================================================


-- ═══════════════════════════════════════════════════════════════════════════
-- 1. New entitlement keys
-- ═══════════════════════════════════════════════════════════════════════════
INSERT INTO plan_entitlements (plan_code, key, kind, scope, period, int_value, num_value, note) VALUES
    -- ── (2) The second, tighter bound ───────────────────────────────────────
    -- Account quotas already stop fifty workspaces being fifty allowances: they
    -- share one pool. This stops the opposite failure — one workspace draining
    -- the whole account's month before anybody else gets a run.
    ('free',       'runs_per_month_per_workspace', 'quota', 'workspace', 'month',      500, NULL, 'same as the account pool: free is single-workspace'),
    ('pro',        'runs_per_month_per_workspace', 'quota', 'workspace', 'month',     5000, NULL, NULL),
    ('team',       'runs_per_month_per_workspace', 'quota', 'workspace', 'month',    20000, NULL, NULL),
    ('enterprise', 'runs_per_month_per_workspace', 'quota', 'workspace', 'month',       -1, NULL, 'unlimited'),

    -- ── (4) The default per-member cap ──────────────────────────────────────
    -- TOKENS, not cents, and that is a deliberate choice made against
    -- docs/COST-ATTRIBUTION-FINDINGS.md: the displayed cost figure is wrong by
    -- between 1.8x and 29x depending on the model string, and the SIGN of the
    -- error changes with the model. Capping a guest in a currency that is wrong
    -- by an order of magnitude would cut off the wrong people and let the
    -- expensive ones through. Tokens are counted, not estimated.
    ('free',       'member_tokens_per_month', 'quota', 'workspace', 'month',    250000, NULL, NULL),
    ('pro',        'member_tokens_per_month', 'quota', 'workspace', 'month',  10000000, NULL, NULL),
    ('team',       'member_tokens_per_month', 'quota', 'workspace', 'month',  50000000, NULL, NULL),
    ('enterprise', 'member_tokens_per_month', 'quota', 'workspace', 'month',        -1, NULL, 'unlimited'),

    -- ── (7) P10's activation caps, as plan data ─────────────────────────────
    ('free',       'max_activations_per_workspace', 'limit', 'workspace', NULL,   8, NULL, NULL),
    ('pro',        'max_activations_per_workspace', 'limit', 'workspace', NULL,  32, NULL, NULL),
    ('team',       'max_activations_per_workspace', 'limit', 'workspace', NULL,  96, NULL, NULL),
    ('enterprise', 'max_activations_per_workspace', 'limit', 'workspace', NULL, 256, NULL, NULL),

    -- ── (8) API keys ────────────────────────────────────────────────────────
    ('free',       'max_api_keys', 'limit', 'workspace', NULL,  0, NULL, 'api_access is off on free anyway; 0 makes the refusal name a number'),
    ('pro',        'max_api_keys', 'limit', 'workspace', NULL,  5, NULL, NULL),
    ('team',       'max_api_keys', 'limit', 'workspace', NULL, 25, NULL, NULL),
    ('enterprise', 'max_api_keys', 'limit', 'workspace', NULL, -1, NULL, 'unlimited'),

    -- Requests per minute for a key. The UI's own rate limit is per workspace
    -- and unchanged; this is the same ceiling reached through a different door.
    ('free',       'api_rate_limit_per_minute', 'setting', 'workspace', NULL, NULL,   0, NULL),
    ('pro',        'api_rate_limit_per_minute', 'setting', 'workspace', NULL, NULL,  60, NULL),
    ('team',       'api_rate_limit_per_minute', 'setting', 'workspace', NULL, NULL, 300, NULL),
    ('enterprise', 'api_rate_limit_per_minute', 'setting', 'workspace', NULL, NULL, 1200, NULL),

    -- ── (5) Trial ───────────────────────────────────────────────────────────
    ('free',       'trial_days', 'setting', 'account', NULL, NULL,  0, 'free is not a trial'),
    ('pro',        'trial_days', 'setting', 'account', NULL, NULL, 14, NULL),
    ('team',       'trial_days', 'setting', 'account', NULL, NULL, 14, NULL),
    ('enterprise', 'trial_days', 'setting', 'account', NULL, NULL, 30, NULL)
ON CONFLICT (plan_code, key) DO NOTHING;


-- ═══════════════════════════════════════════════════════════════════════════
-- 2. (4) Attribute a run, and its usage, to the person who started it
--
-- ── WHY THE ATTRIBUTION GOES ON usage_records AND NOT ONLY ON agent_runs ────
-- `usage_records` is already the idempotent ledger: keyed on (run_id, metric),
-- overwritten rather than incremented, replays excluded. A per-member cap is the
-- SAME ledger with a different GROUP BY — which means the member cap inherits
-- every property the billing ledger was built to have, for free. Deriving it by
-- joining `agent_runs` at read time would work until retention deletes the run
-- row, at which point a member's spend would silently fall.
--
-- Nullable, because plenty of runs have no human: a schedule, a webhook, the
-- reconciler. A null actor is charged to the workspace and to nobody's cap,
-- which is correct — an owner's cron job is not a guest's spend.
-- ═══════════════════════════════════════════════════════════════════════════
ALTER TABLE agent_runs
    ADD COLUMN IF NOT EXISTS triggered_by_user_id    UUID,
    ADD COLUMN IF NOT EXISTS triggered_by_api_key_id UUID;

COMMENT ON COLUMN agent_runs.triggered_by_user_id IS
    'The member who started this run, for per-member spend caps and for the '
    'owner''s spend-by-member view. NULL for schedules, webhooks and system work.';

ALTER TABLE usage_records
    ADD COLUMN IF NOT EXISTS actor_user_id UUID;

-- The per-member aggregate. Leading equality on workspace and period keeps it to
-- one month of one workspace, which is the only shape this is ever asked in.
CREATE INDEX IF NOT EXISTS usage_records_actor_idx
    ON usage_records (workspace_id, period_start, actor_user_id, metric)
    INCLUDE (quantity);

-- ── Per-member overrides, set by the workspace owner ────────────────────────
--
-- The plan supplies a default for every member; this is how an owner says "the
-- contractor gets 100k tokens and nobody else changes". Per WORKSPACE and not
-- per account, because the person granting it owns a workspace, not the
-- account's whole budget.
CREATE TABLE IF NOT EXISTS workspace_member_budgets (
    workspace_id     UUID        NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    user_id          UUID        NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,

    /* -1 is unlimited within the workspace's own quota — it does not lift the
       workspace or account ceiling, and cannot: those are checked separately and
       first. "Unlimited" here means "not separately capped". */
    tokens_per_month BIGINT      NOT NULL,

    reason           TEXT,
    set_by_user_id   UUID,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),

    PRIMARY KEY (workspace_id, user_id)
);

COMMENT ON TABLE workspace_member_budgets IS
    'Per-member token cap inside one workspace. Overrides the plan default. '
    'Never raises the workspace or account ceiling — those bind first.';

/**
 * What one member has consumed in this workspace, this period.
 *
 * Reads the billing ledger, so it is exactly as idempotent as the invoice: a
 * resumed run counts once, a replay counts zero, and a redelivery changes
 * nothing.
 */
CREATE OR REPLACE FUNCTION member_usage(
    p_workspace_id UUID,
    p_user_id      UUID,
    p_metric       TEXT DEFAULT 'tokens'
) RETURNS NUMERIC
LANGUAGE sql STABLE AS $$
    SELECT COALESCE(SUM(u.quantity), 0)
      FROM usage_records u
      JOIN workspaces w ON w.id = u.workspace_id
         , LATERAL account_current_period(w.billing_account_id) p
     WHERE u.workspace_id = p_workspace_id
       AND u.actor_user_id = p_user_id
       AND u.metric = p_metric
       AND u.period_start >= p.period_start
       AND u.period_start <  p.period_end
$$;

/**
 * The cap in force for one member: their override, else the plan's default.
 *
 * -1 means "not separately capped", and is returned as such rather than as a
 * large number, so the caller can tell "no cap" from "a very big cap" — the
 * refusal message differs.
 */
CREATE OR REPLACE FUNCTION member_token_cap(p_workspace_id UUID, p_user_id UUID)
RETURNS BIGINT
LANGUAGE sql STABLE AS $$
    SELECT COALESCE(
        (SELECT b.tokens_per_month FROM workspace_member_budgets b
          WHERE b.workspace_id = p_workspace_id AND b.user_id = p_user_id),
        (SELECT e.int_value FROM resolve_entitlements(p_workspace_id) e
          WHERE e.key = 'member_tokens_per_month'),
        -1)
$$;

/** Spend by member, for the owner's view. */
CREATE OR REPLACE FUNCTION workspace_spend_by_member(p_workspace_id UUID)
RETURNS TABLE (user_id UUID, email TEXT, tokens NUMERIC, runs NUMERIC, cap BIGINT)
LANGUAGE sql STABLE AS $$
    SELECT m.user_id,
           u.email,
           COALESCE(member_usage(p_workspace_id, m.user_id, 'tokens'), 0),
           COALESCE(member_usage(p_workspace_id, m.user_id, 'runs'), 0),
           member_token_cap(p_workspace_id, m.user_id)
      FROM workspace_members m
      LEFT JOIN app_users u ON u.id = m.user_id
     WHERE m.workspace_id = p_workspace_id AND m.status = 'active'
     ORDER BY 3 DESC
$$;


-- ═══════════════════════════════════════════════════════════════════════════
-- 3. (2) The per-workspace half of the quota
--
-- `account_usage` answers "what has this ACCOUNT spent". This answers "what has
-- this WORKSPACE spent", against the same ledger and the same period, so the two
-- bounds cannot drift apart or disagree about when the month starts.
-- ═══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION workspace_usage(p_workspace_id UUID)
RETURNS TABLE (metric TEXT, used NUMERIC)
LANGUAGE sql STABLE AS $$
    SELECT u.metric, COALESCE(SUM(u.quantity), 0)
      FROM usage_records u
      JOIN workspaces w ON w.id = u.workspace_id
         , LATERAL account_current_period(w.billing_account_id) p
     WHERE u.workspace_id = p_workspace_id
       AND u.period_start >= p.period_start
       AND u.period_start <  p.period_end
     GROUP BY u.metric
$$;


-- ═══════════════════════════════════════════════════════════════════════════
-- 4. (8) API keys
--
-- ── THEY INHERIT EVERY LIMIT BY CONSTRUCTION ────────────────────────────────
-- A key names a WORKSPACE. Every entitlement check already takes a workspace and
-- has no parameter for a user, so a request authenticated by a key resolves the
-- same plan, the same quota and the same ceilings as the same request from the
-- UI. There is no "API path" that could have been forgotten — the absence of a
-- second code path IS the enforcement.
--
-- ── THE SECRET IS NEVER STORED ──────────────────────────────────────────────
-- `token_hash` is SHA-256 of the presented key. `prefix` is the first 12
-- characters, kept in clear so a key can be identified in a list and in a log
-- without being usable. Losing the key means minting another, which is the
-- correct trade for a credential that can spend money.
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS api_keys (
    id             UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    workspace_id   UUID        NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,

    name           TEXT        NOT NULL,
    /* `vb_live_ab12cd34` — enough to recognise, not enough to use. */
    prefix         TEXT        NOT NULL,
    token_hash     TEXT        NOT NULL,

    /* The member the key acts as. A key's runs are charged to THIS person's
       member cap, which is what stops a guest minting a key to escape their own
       budget — the key inherits the cap rather than bypassing it. */
    acts_as_user_id UUID       REFERENCES app_users(id) ON DELETE SET NULL,

    created_by_user_id UUID,
    last_used_at   TIMESTAMPTZ,
    expires_at     TIMESTAMPTZ,
    revoked_at     TIMESTAMPTZ,
    revoked_by_user_id UUID,

    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT api_keys_hash_unique UNIQUE (token_hash)
);

CREATE INDEX IF NOT EXISTS api_keys_workspace_idx
    ON api_keys (workspace_id) WHERE revoked_at IS NULL;

-- The authentication lookup: one hash, one row, and the partial predicate keeps
-- revoked keys out of the index entirely rather than out of the result.
CREATE INDEX IF NOT EXISTS api_keys_live_hash_idx
    ON api_keys (token_hash) WHERE revoked_at IS NULL;

COMMENT ON TABLE api_keys IS
    'Workspace-scoped API credentials. A key inherits its workspace''s '
    'entitlements because every check resolves from the workspace — there is no '
    'separate API enforcement path to keep in step.';


-- ═══════════════════════════════════════════════════════════════════════════
-- 5. (5) Trial state, on the account, anchored to a normalised identity
--
-- ── THE DECISION, RECORDED BECAUSE IT IS A JUDGEMENT AND NOT A FACT ─────────
-- Perfect duplicate-account prevention is not achievable and over-investing in
-- it annoys real users. So the defence is deliberately ONE cheap layer:
--
--   ANCHOR: the normalised email of the account's first owner. Lower-cased,
--           `+tag` stripped, and dots removed in the local part — which is what
--           gmail-shaped providers already treat as the same mailbox. That
--           catches `me+1@`, `me+2@`, `m.e@` — the overwhelming majority of
--           casual trial recycling, because it is the version that takes no
--           effort.
--
--   EFFECT: a new account whose anchor matches one that has already consumed a
--           trial starts with the trial already consumed. It is NOT blocked from
--           existing. Blocking signup on a heuristic turns a false positive into
--           a lost customer; withholding a second free trial turns it into a
--           support conversation.
--
--   NOT DONE, and each for a reason:
--     · IP or device fingerprinting — breaks offices, VPNs and households, and
--       the people it catches can defeat it in a minute.
--     · Blocking disposable domains — a list that is always stale, and real
--       users at small domains get caught.
--     · Payment-method fingerprinting — the actual answer, and it needs S4.
--       When a card is on file this heuristic should be demoted to a signal.
--
-- The state lives on `billing_accounts`, which is what makes it survive
-- workspace deletion: deleting every workspace on an account leaves the account
-- row, so create-consume-delete-recreate returns to the same account.
-- ═══════════════════════════════════════════════════════════════════════════
ALTER TABLE billing_accounts
    ADD COLUMN IF NOT EXISTS trial_started_at  TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS trial_ends_at     TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS trial_consumed_at TIMESTAMPTZ,
    /* Normalised identity of the first owner. Not unique: two accounts MAY share
       one, and the second simply gets no trial. A unique constraint would block
       legitimate second accounts (an agency, a personal and a work account). */
    ADD COLUMN IF NOT EXISTS identity_anchor   TEXT;

CREATE INDEX IF NOT EXISTS billing_accounts_identity_anchor_idx
    ON billing_accounts (identity_anchor) WHERE identity_anchor IS NOT NULL;

COMMENT ON COLUMN billing_accounts.identity_anchor IS
    'Normalised email of the first owner: lower-cased, +tag stripped, dots '
    'removed from the local part. Deliberately one cheap layer — see V062 §5 for '
    'what is NOT done and why.';

/**
 * Normalise an email to its identity anchor.
 *
 * IMMUTABLE so it can be used in an index or a generated column later. The dot
 * removal applies to the local part only: `first.last@example.com` and
 * `firstlast@example.com` are the same mailbox at gmail-shaped providers and
 * different ones elsewhere — treating them as the same anchor is a deliberate
 * false-positive, and its only cost is a second account not getting a second
 * free trial.
 */
CREATE OR REPLACE FUNCTION normalise_identity(p_email TEXT)
RETURNS TEXT
LANGUAGE sql IMMUTABLE AS $$
    SELECT CASE
        WHEN p_email IS NULL OR position('@' in p_email) = 0 THEN NULL
        ELSE replace(
                 split_part(regexp_replace(lower(trim(p_email)), '\+[^@]*', ''), '@', 1),
                 '.', '')
             || '@' ||
             split_part(lower(trim(p_email)), '@', 2)
    END
$$;

/**
 * Has this identity already used a trial, on ANY account?
 *
 * Excludes the account being asked about, so re-checking an account that is
 * itself mid-trial does not report itself as a duplicate.
 */
CREATE OR REPLACE FUNCTION trial_already_consumed(p_anchor TEXT, p_except_account UUID DEFAULT NULL)
RETURNS BOOLEAN
LANGUAGE sql STABLE AS $$
    SELECT EXISTS (
        SELECT 1 FROM billing_accounts b
         WHERE b.identity_anchor = p_anchor
           AND b.trial_consumed_at IS NOT NULL
           AND (p_except_account IS NULL OR b.id <> p_except_account)
    )
$$;

-- Backfill the anchor for accounts that already exist.
UPDATE billing_accounts b
   SET identity_anchor = normalise_identity(u.email)
  FROM workspaces w
  JOIN app_users u ON u.id = w.owner_user_id
 WHERE w.billing_account_id = b.id
   AND b.identity_anchor IS NULL
   AND u.email IS NOT NULL;


-- ═══════════════════════════════════════════════════════════════════════════
-- 6. (6) Ownership transfer cannot silently move data under a shorter window
--
-- ── WHY THIS IS A TRIGGER AND NOT A CHECK IN THE TRANSFER ROUTE ─────────────
-- The route is the obvious place, and it is not sufficient. `billing_account_id`
-- is an ordinary column: a support script, a future bulk-reassignment, a
-- migration, or a second transfer endpoint written next year can all move it,
-- and every one of those would move Pro data under Free retention with no grace
-- and no warning. The next sweep would then delete it, correctly and
-- irreversibly, according to a policy the customer never agreed to.
--
-- So the guarantee is attached to the COLUMN. However the workspace moves,
-- retention grace opens for every entity before the sweeper can act — because
-- the sweeper reads `workspace_retention_state`, and this writes it.
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS workspace_transfers (
    id                 UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    workspace_id       UUID        NOT NULL,
    from_account_id    UUID,
    to_account_id      UUID        NOT NULL,
    from_plan          TEXT,
    to_plan            TEXT,
    /* True when the destination's window is shorter on at least one entity. */
    is_downgrade       BOOLEAN     NOT NULL DEFAULT false,
    transferred_by_user_id UUID,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS workspace_transfers_workspace_idx
    ON workspace_transfers (workspace_id, created_at DESC);

CREATE OR REPLACE FUNCTION on_workspace_account_change() RETURNS TRIGGER AS $$
DECLARE
    ent         TEXT;
    grace_days  INTEGER;
    downgrade   BOOLEAN := false;
    old_plan    TEXT;
    new_plan    TEXT;
BEGIN
    IF NEW.billing_account_id IS NOT DISTINCT FROM OLD.billing_account_id THEN
        RETURN NEW;
    END IF;

    SELECT plan_code INTO old_plan FROM billing_accounts WHERE id = OLD.billing_account_id;
    SELECT plan_code INTO new_plan FROM billing_accounts WHERE id = NEW.billing_account_id;

    SELECT COALESCE((SELECT num_value::int FROM plan_entitlements
                      WHERE plan_code = new_plan AND key = 'retention_grace_days'), 30)
      INTO grace_days;

    /* Observe the policy under the NEW account for every entity. A window that
       shrank opens grace carrying the old one forward; a window that grew takes
       effect at once. That is exactly the downgrade path S2 already built, which
       is the point — a transfer is a plan change that happens to arrive by a
       different route, and it must not have a second implementation. */
    FOREACH ent IN ARRAY ARRAY['runs','events','traces','payloads','archives'] LOOP
        IF retention_observe_policy(NEW.id, ent, grace_days) THEN
            downgrade := true;
        END IF;
    END LOOP;

    INSERT INTO workspace_transfers
        (workspace_id, from_account_id, to_account_id, from_plan, to_plan, is_downgrade)
    VALUES (NEW.id, OLD.billing_account_id, NEW.billing_account_id, old_plan, new_plan, downgrade);

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS workspaces_account_change ON workspaces;
/* AFTER, not BEFORE: `retention_observe_policy` reads the workspace's account
   through `resolve_entitlements`, so the new value has to be visible. A BEFORE
   trigger would resolve the OLD plan and open grace against the wrong window. */
CREATE TRIGGER workspaces_account_change
    AFTER UPDATE OF billing_account_id ON workspaces
    FOR EACH ROW EXECUTE FUNCTION on_workspace_account_change();

COMMENT ON FUNCTION on_workspace_account_change IS
    'Opens retention grace whenever a workspace changes billing account, however '
    'it is changed. Attached to the column rather than to a route because a '
    'support script moving one would otherwise put Pro data under Free retention '
    'with no warning, and the next sweep would delete it correctly.';


-- ═══════════════════════════════════════════════════════════════════════════
-- 7. (3) Pending invitations count toward seats
--
-- An account at its seat cap could otherwise send unlimited invitations that all
-- fail on acceptance — the refusal reaching the invitee, who cannot act on it,
-- rather than the admin, who can. `lib/server/entitlements.ts` counts these; the
-- index is what keeps that count cheap.
-- ═══════════════════════════════════════════════════════════════════════════
CREATE INDEX IF NOT EXISTS workspace_invitations_pending_idx
    ON workspace_invitations (workspace_id)
    WHERE accepted_at IS NULL AND revoked_at IS NULL;


-- ═══════════════════════════════════════════════════════════════════════════
-- 8. The meter learns who the actor was
--
-- Replaces V060's `meter_run_usage` to stamp `actor_user_id` from the run. That
-- one column is what makes a per-member cap possible at all: without it, the
-- ledger knows what a workspace consumed and not who consumed it, and a guest
-- burning the host's tokens is indistinguishable from the host doing it.
--
-- Copied from the run rather than passed in by the caller, deliberately. The
-- worker meters tokens at the terminal transition, by which time the request
-- that started the run is long gone — a parameter would be null there and the
-- attribution would silently apply only to the API's own `runs` row.
--
-- Everything else about the function is unchanged, and that matters: the
-- (run_id, metric) key, the overwrite-never-increment rule and the replay
-- exclusion are what make the ledger billable, and this must not disturb them.
-- ═══════════════════════════════════════════════════════════════════════════
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
    v_actor     UUID;
    v_period    TIMESTAMPTZ;
BEGIN
    SELECT r.workspace_id, COALESCE(r.execution_mode_kind, 'live'), r.triggered_by_user_id
      INTO v_workspace, v_kind, v_actor
      FROM agent_runs r WHERE r.id = p_run_id;

    IF v_workspace IS NULL THEN
        RETURN false;
    END IF;

    -- A replay is a debugging tool, not production traffic. Unchanged from V060.
    IF v_kind = 'replay' THEN
        RETURN false;
    END IF;

    SELECT billing_account_id INTO v_account FROM workspaces WHERE id = v_workspace;
    IF v_account IS NULL THEN
        RETURN false;
    END IF;

    SELECT p.period_start INTO v_period FROM account_current_period(v_account) p;

    INSERT INTO usage_records
        (run_id, metric, billing_account_id, workspace_id, quantity, period_start, actor_user_id)
    VALUES (p_run_id, p_metric, v_account, v_workspace, GREATEST(p_quantity, 0), v_period, v_actor)
    ON CONFLICT (run_id, metric) DO UPDATE
        SET quantity      = GREATEST(EXCLUDED.quantity, 0),
            -- COALESCE, not overwrite: `RunRoutes` attributes the run before it
            -- meters, so the first write already carries the actor. But a
            -- reconcile sweep or a worker write for a run whose attribution
            -- failed would carry NULL, and letting that erase a recorded actor
            -- would quietly move a guest's spend back onto nobody's cap.
            -- period_start is still never updated.
            actor_user_id = COALESCE(EXCLUDED.actor_user_id, usage_records.actor_user_id),
            updated_at    = now();

    RETURN true;
END;
$$;


-- ═══════════════════════════════════════════════════════════════════════════
-- 9. Account creation stamps the identity anchor, and settles the trial
--
-- Replaces V060's `assign_billing_account` so a NEW account records who it
-- belongs to and, when that identity has already used a trial elsewhere, starts
-- with the trial already spent.
--
-- ── WHY HERE AND NOT IN A SIGNUP ROUTE ──────────────────────────────────────
-- Same argument as the transfer trigger. Accounts are minted by this trigger
-- whenever a workspace is inserted without one — which includes an API version
-- that predates V060, a support script, a test fixture and any future signup
-- path. A check in one signup route would cover one of those.
--
-- ── AND IT WITHHOLDS, IT DOES NOT BLOCK ─────────────────────────────────────
-- A matching anchor sets `trial_consumed_at`; it does not refuse the insert.
-- Blocking a signup on a heuristic turns a false positive into a lost customer.
-- Withholding a second free trial turns it into a support conversation, which is
-- the trade this defence is sized for.
-- ═══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION assign_billing_account() RETURNS TRIGGER AS $$
DECLARE
    acct      UUID;
    acct_name TEXT;
    owner_mail TEXT;
    anchor    TEXT;
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
        SELECT email INTO owner_mail FROM app_users WHERE id = NEW.owner_user_id;
        anchor := normalise_identity(owner_mail);
        SELECT COALESCE(owner_mail, NEW.name) INTO acct_name;

        INSERT INTO billing_accounts (name, plan_code, identity_anchor, trial_consumed_at)
        VALUES (
            acct_name, 'free', anchor,
            /* Already used a trial under this identity? Then this account does
               not get another. NULL anchor (no email on file) means no evidence
               either way, and no evidence must never mean "guilty". */
            CASE WHEN anchor IS NOT NULL AND trial_already_consumed(anchor)
                 THEN now() ELSE NULL END
        )
        RETURNING id INTO acct;
    END IF;

    NEW.billing_account_id := acct;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
