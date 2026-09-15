-- ═══════════════════════════════════════════════════════════════════════════
-- V072 — A WORKER INSIDE THE CUSTOMER'S NETWORK
--
-- ── WHY THE EXISTING WORKER CANNOT SIMPLY BE SHIPPED ──────────────────────
-- It is the same executable and the same code; what it cannot be is deployed
-- the same way. Today a worker gets work by reading a Redis stream or by
-- running `SELECT ... FOR UPDATE SKIP LOCKED` against `agent_runs`. Both need
-- credentials for OUR datastores, reachable from THEIR network.
--
-- That is not a hardening problem. Handing a customer a Postgres role on the
-- multi-tenant control plane fails the procurement review that asked for a
-- self-hosted runner in the first place, and it is the wrong direction of
-- trust: their network should make outbound connections to us, never the
-- reverse, and we should hold nothing that can read their data.
--
-- ── SO THE RUNNER PULLS, AND SENDS BACK ALMOST NOTHING ────────────────────
-- One outbound HTTPS connection, initiated by them:
--
--     POST /api/runner/lease      long-poll: "anything for my pool?"
--     POST /api/runner/heartbeat  "still working on it"
--     POST /api/runner/report     status, timings, counts — and no payloads
--
-- The last line is the whole product. Prompts, tool arguments, tool results and
-- node outputs never leave their perimeter, because the reporting endpoint has
-- nowhere to put them: `run_events` written by a runner carry no payload
-- columns, and the run is flagged so the UI says the payloads are withheld BY
-- POLICY rather than rendering an empty panel that reads as a bug.
-- ═══════════════════════════════════════════════════════════════════════════


-- ───────────────────────────────────────────────────────────────────────────
-- 1. A POOL IS THE UNIT OF PLACEMENT
-- ───────────────────────────────────────────────────────────────────────────
--
-- Not an individual runner. A customer runs three replicas for availability and
-- expects any of them to pick up the work; a workflow is pinned to "the runners
-- in our VPC", never to a hostname that will be replaced on the next deploy.
CREATE TABLE IF NOT EXISTS runner_pools (
    id              UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    workspace_id    UUID        NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
    name            TEXT        NOT NULL,
    slug            TEXT        NOT NULL,

    -- Where the customer says this pool lives. Free text, and deliberately: it
    -- is for the person reading the runs list, and inventing a taxonomy of
    -- clouds and regions we cannot verify would be worse than a label they
    -- wrote themselves.
    location_label  TEXT,

    /*
     * ── THE GUARANTEE, AS A COLUMN ────────────────────────────────────────
     *
     * `strict` (the default) is what a procurement requirement asks for: no
     * prompt, no tool result, no node output, no payload of any kind is
     * accepted from this pool. The report endpoint drops them at the boundary
     * rather than trusting a runner to have redacted correctly — a runner is
     * software the customer deploys and could be an old build.
     *
     * `metadata_plus_errors` additionally accepts SANITIZED error text, which
     * many customers want because a run that failed with no message is nearly
     * impossible to support. It is opt-in and it is a real widening: an error
     * string can carry a fragment of the data that caused it.
     */
    payload_policy  TEXT        NOT NULL DEFAULT 'strict',

    enabled         BOOLEAN     NOT NULL DEFAULT TRUE,
    created_by_user_id UUID,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT runner_pools_payload_policy_check
        CHECK (payload_policy IN ('strict', 'metadata_plus_errors')),
    CONSTRAINT runner_pools_slug_unique UNIQUE (workspace_id, slug)
);

COMMENT ON COLUMN runner_pools.payload_policy IS
    'strict = nothing but metadata crosses the perimeter. metadata_plus_errors '
    'additionally accepts sanitized error text, which makes a failed run '
    'supportable and is a real widening — an error string can carry a fragment '
    'of the data that caused it. Enforced at the RECEIVING end, because a runner '
    'is software the customer deploys and may be an old build.';


-- ───────────────────────────────────────────────────────────────────────────
-- 2. THE RUNNERS THEMSELVES
-- ───────────────────────────────────────────────────────────────────────────
--
-- A row per process, registered on first lease and kept alive by heartbeat. The
-- point of the row is the operator question: "is anything actually running in
-- our VPC, and when did it last check in" — which, when the answer is no, is
-- why their runs are queued and nothing is happening.
CREATE TABLE IF NOT EXISTS runners (
    id              UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    workspace_id    UUID        NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
    pool_id         UUID        NOT NULL REFERENCES runner_pools (id) ON DELETE CASCADE,

    -- The runner's own name for itself. Never trusted for anything but display:
    -- it comes from the customer's network and is not a security boundary.
    runner_name     TEXT        NOT NULL,
    version         TEXT,

    -- What it says it can do. A runner too old for a node type in the graph must
    -- not lease that run, or it fails halfway with a confusing message.
    capabilities    JSONB       NOT NULL DEFAULT '{}'::jsonb,

    first_seen_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_seen_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- Never a public IP we resolve; whatever the runner reports, for support.
    reported_host   TEXT,

    CONSTRAINT runners_identity_unique UNIQUE (pool_id, runner_name)
);

CREATE INDEX IF NOT EXISTS runners_pool_alive_idx
    ON runners (pool_id, last_seen_at DESC);


-- ───────────────────────────────────────────────────────────────────────────
-- 3. THE TOKEN A RUNNER AUTHENTICATES WITH
-- ───────────────────────────────────────────────────────────────────────────
--
-- Separate from `api_keys` on purpose, and the separation is the security
-- property. An API key can start runs, read results, manage connections and
-- read every payload in the workspace. A runner needs exactly three verbs
-- against one pool, and if the token leaks out of the customer's network the
-- blast radius must be "someone can lease our queued runs", not "someone can
-- read everything we have ever run".
--
-- Sharing the api_keys table would have meant expressing that as a scope, and a
-- scope is a filter somebody can forget to apply. A different table cannot be
-- forgotten.
CREATE TABLE IF NOT EXISTS runner_tokens (
    id              UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    workspace_id    UUID        NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
    pool_id         UUID        NOT NULL REFERENCES runner_pools (id) ON DELETE CASCADE,

    name            TEXT        NOT NULL,
    /* `vbr_ab12cd34` — enough to recognise in a support conversation, not
       enough to use. Mirrors the shape `api_keys` uses. */
    prefix          TEXT        NOT NULL,
    token_hash      TEXT        NOT NULL,

    created_by_user_id UUID,
    last_used_at    TIMESTAMPTZ,
    expires_at      TIMESTAMPTZ,
    revoked_at      TIMESTAMPTZ,
    revoked_by_user_id UUID,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT runner_tokens_hash_unique UNIQUE (token_hash)
);

CREATE INDEX IF NOT EXISTS runner_tokens_pool_idx ON runner_tokens (pool_id)
    WHERE revoked_at IS NULL;


-- ───────────────────────────────────────────────────────────────────────────
-- 4. WHICH RUNS GO WHERE
-- ───────────────────────────────────────────────────────────────────────────
--
-- Declared on the WORKFLOW, because "this workflow touches customer data and
-- must execute inside our network" is a property of the work, not of the run
-- that happens to be executing it. A trigger cannot move a run out of the
-- customer's network by asking nicely.
ALTER TABLE workflows
    ADD COLUMN IF NOT EXISTS runner_pool_id UUID REFERENCES runner_pools (id) ON DELETE SET NULL;

COMMENT ON COLUMN workflows.runner_pool_id IS
    'NULL = the platform''s own workers, which is every workflow until a '
    'customer says otherwise. Set = only runners in this pool may execute it, '
    'and the platform''s workers will not claim it — see the claim predicate.';

-- Stamped onto the run at ingress, so a change to the workflow does not
-- retroactively move a run that is already queued, and so the claim has one
-- column to read rather than a join.
ALTER TABLE agent_runs
    ADD COLUMN IF NOT EXISTS runner_pool_id UUID,
    ADD COLUMN IF NOT EXISTS runner_id UUID,
    /*
     * ── WHY THIS IS ON THE RUN AND NOT DERIVED ────────────────────────────
     * The Debug tab has to be able to say "the payloads for this run are
     * withheld by policy" without knowing anything about pools, and it has to
     * keep saying it years later when the pool has been deleted. A derived
     * answer would become "no payloads, reason unknown", which is exactly the
     * broken-looking screen this column exists to prevent.
     */
    ADD COLUMN IF NOT EXISTS payloads_withheld BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN agent_runs.payloads_withheld IS
    'True when this run executed on a self-hosted runner and its payloads never '
    'left the customer''s network. Read by the Debug tab so it can say so, '
    'rather than rendering an empty panel that reads as a bug. Stays true after '
    'the pool is deleted, which is why it is stored rather than derived.';

CREATE INDEX IF NOT EXISTS agent_runs_runner_pool_idx
    ON agent_runs (runner_pool_id, status)
    WHERE runner_pool_id IS NOT NULL;

-- The platform's own claim must skip these. Without a matching partial index
-- the added `runner_pool_id IS NULL` predicate turns the hot claim query into a
-- scan over every run pinned to a customer's network.
CREATE INDEX IF NOT EXISTS agent_runs_platform_claimable_idx
    ON agent_runs (execution_class, priority DESC, fair_vtime)
    WHERE runner_pool_id IS NULL AND status = 'queued';


-- ───────────────────────────────────────────────────────────────────────────
-- 5. THE LEASE
-- ───────────────────────────────────────────────────────────────────────────
--
-- A runner's lease is not the worker lease. The existing one assumes a process
-- that can be observed, restarted and reasoned about by us. This one is held by
-- software on somebody else's machine, behind a NAT, which may vanish without a
-- packet — so it is short, heartbeat-extended, and reclaimed by a sweep on
-- expiry. The customer's network going down must return the run to the queue,
-- not strand it.
CREATE TABLE IF NOT EXISTS runner_leases (
    run_id          UUID        NOT NULL PRIMARY KEY REFERENCES agent_runs (id) ON DELETE CASCADE,
    workspace_id    UUID        NOT NULL,
    pool_id         UUID        NOT NULL REFERENCES runner_pools (id) ON DELETE CASCADE,
    runner_id       UUID        NOT NULL REFERENCES runners (id) ON DELETE CASCADE,

    leased_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at      TIMESTAMPTZ NOT NULL,
    -- Every heartbeat, so "when did we last hear from the machine holding this"
    -- is answerable without reading a log on a host we cannot reach.
    last_heartbeat_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    heartbeats      INT         NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS runner_leases_expiry_idx ON runner_leases (expires_at);
