-- ═══════════════════════════════════════════════════════════════════════════
-- V066 — INGRESS: how work gets into Vectorbea
--
-- Five ways to start a run — API, webhook, schedule, event, MCP — and one
-- admission path behind all of them. The tables here are what the four
-- non-API paths need that the API path already had.
--
-- ── THE GOVERNING SHAPE ───────────────────────────────────────────────────
-- Every ingress produces the same thing: a row in `agent_runs` with a
-- `trigger_type` and nothing else different. That is deliberate and it is
-- testable — a run started by webhook and the same run started by API differ
-- in one column. Anything that made webhook runs structurally different would
-- give the trace two shapes and every downstream reader two cases.
-- ═══════════════════════════════════════════════════════════════════════════


-- ───────────────────────────────────────────────────────────────────────────
-- 1. IDEMPOTENT RUN CREATION
-- ───────────────────────────────────────────────────────────────────────────
--
-- ── WHY A CLAIM TABLE AND NOT A COLUMN ────────────────────────────────────
-- `agent_runs.idempotency_key` already exists with a NON-unique index, and the
-- check in front of it was a Redis GET followed by a SETEX. Two problems, both
-- of which start a second run for money:
--
--   1. GET-then-SET is not atomic. Two concurrent POSTs with the same key both
--      miss and both create a run. This is the normal shape of a client retry
--      on a timeout — the first request is still in flight, which is exactly
--      when the second arrives.
--   2. Redis is optional in this deployment. With it unavailable the check
--      silently did nothing, so the guarantee evaporated precisely during the
--      incident that made the client retry.
--
-- A unique index on `agent_runs` cannot fix it either, because the claim has to
-- happen BEFORE the run row exists — quota, admission and placement all run
-- first and any of them can refuse. So the claim is its own row, inserted with
-- ON CONFLICT DO NOTHING: the winner proceeds, the loser reads back the run id.
--
-- ── AND WHY THE FINGERPRINT ───────────────────────────────────────────────
-- Reusing a key with a DIFFERENT body is a client bug, and returning the first
-- run for it silently is the worst possible answer — the caller believes the
-- second request happened. The fingerprint makes it a 409 that says so.
CREATE TABLE IF NOT EXISTS run_idempotency_keys (
    workspace_id   UUID        NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    idempotency_key TEXT       NOT NULL,

    -- Null between the claim and the run row's creation, which is a window of
    -- milliseconds that a concurrent caller can land in. It reads null as
    -- "in flight, come back" rather than as "no run".
    run_id         UUID,

    -- SHA-256 over (workflow, environment, input). Not the raw body: that is
    -- caller data, it is large, and it would put a copy of every run's input in
    -- a second table with its own retention question.
    request_fingerprint TEXT   NOT NULL,

    -- Which door it came in by, so a support question about a duplicate can be
    -- answered without joining to the run.
    trigger_type   TEXT        NOT NULL DEFAULT 'api',

    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- Swept, not read-filtered. A key past its window is DELETED (invariant 10);
    -- 24h matches what the Redis TTL promised so no client's expectation moves.
    expires_at     TIMESTAMPTZ NOT NULL DEFAULT now() + interval '24 hours',

    CONSTRAINT run_idempotency_pkey PRIMARY KEY (workspace_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS run_idempotency_expiry_idx
    ON run_idempotency_keys (expires_at);

COMMENT ON TABLE run_idempotency_keys IS
    'Claims on a run-creation idempotency key. Inserted BEFORE the run exists, '
    'because quota and admission run first and either can refuse — a key '
    'recorded after the fact leaves the retry window open for the whole '
    'admission sequence, which is where the retry actually lands.';


-- ───────────────────────────────────────────────────────────────────────────
-- 2. WEBHOOK TRIGGERS
-- ───────────────────────────────────────────────────────────────────────────
--
-- A per-workflow endpoint at /api/hooks/:token. Unauthenticated in the JWT
-- sense — a webhook sender has no session — so the token IS the address and the
-- signature IS the authentication, which is why both are handled carefully:
-- the token is unguessable and never logged, and an endpoint with a configured
-- scheme REFUSES an unsigned delivery rather than accepting it "for now".
CREATE TABLE IF NOT EXISTS workflow_webhooks (
    id             UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    workspace_id   UUID        NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    environment_id UUID        NOT NULL REFERENCES environments(id) ON DELETE CASCADE,
    workflow_id    UUID        NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,

    name           TEXT        NOT NULL DEFAULT 'Webhook',

    -- The public address. Random, not derived: a webhook URL is pasted into a
    -- third party's console and cannot be rotated by re-deriving it, so unlike
    -- every other key in this system it is generated once and stored.
    token          TEXT        NOT NULL,

    -- github | stripe | slack | shopify | svix | hmac_sha256 | none
    -- `none` is a deliberate, recorded choice and shows as a warning in the UI.
    -- It is not the default, because the default has to be the safe one.
    signature_scheme TEXT      NOT NULL DEFAULT 'hmac_sha256',

    -- Encrypted via SecretService, like every other credential. Never inline.
    signing_secret_ref TEXT,

    -- Where the signature lives, when the scheme does not fix it.
    signature_header TEXT,
    timestamp_header TEXT,
    -- Replay window in seconds. A signature with no freshness bound is a
    -- password that anybody who ever saw one delivery can reuse forever.
    tolerance_seconds INT      NOT NULL DEFAULT 300,

    -- JSONPath-ish mapping from the delivery to run inputs:
    --   {"orderId": "$.data.object.id", "amount": "$.data.object.amount"}
    -- Empty object means "pass the whole body through as `body`", which is what
    -- somebody wiring their first webhook wants before they know the shape.
    input_mapping  JSONB       NOT NULL DEFAULT '{}'::jsonb,

    -- Only deliveries matching this fire a run. A GitHub hook sends every event
    -- on the repository; without a filter a workflow meant for `pull_request`
    -- runs on every push, comment and star.
    event_type_path TEXT,
    event_types    TEXT[]      NOT NULL DEFAULT '{}',

    -- Dedup across redeliveries. GitHub sends X-GitHub-Delivery, Stripe sends
    -- the event id in the body. Both redeliver on a timeout.
    dedupe_header  TEXT,
    dedupe_path    TEXT,

    enabled        BOOLEAN     NOT NULL DEFAULT TRUE,
    created_by_user_id UUID,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT workflow_webhooks_token_unique UNIQUE (token),
    CONSTRAINT workflow_webhooks_scheme_check CHECK (
        signature_scheme IN ('none','hmac_sha256','github','stripe','slack','shopify','svix'))
);

CREATE INDEX IF NOT EXISTS workflow_webhooks_workflow_idx
    ON workflow_webhooks (workflow_id);
CREATE INDEX IF NOT EXISTS workflow_webhooks_workspace_idx
    ON workflow_webhooks (workspace_id, created_at DESC);


-- Every delivery, accepted or not.
--
-- ── THIS IS THE DEBUGGING SURFACE, AND IT IS THE POINT ────────────────────
-- "The webhook does not work" is the single most common integration question,
-- and it has four completely different causes: the sender never called, the
-- signature failed, the filter excluded it, or the mapping produced nothing.
-- Without a delivery log all four look identical from the outside — no run.
-- Storing the rejected ones is therefore more valuable than storing the
-- accepted ones, which is why verification failures are recorded rather than
-- dropped at the door.
CREATE TABLE IF NOT EXISTS webhook_deliveries (
    id             UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    webhook_id     UUID        NOT NULL REFERENCES workflow_webhooks(id) ON DELETE CASCADE,
    workspace_id   UUID        NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,

    received_at    TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- accepted | rejected_signature | rejected_stale | filtered | duplicate
    -- | rejected_disabled | rejected_mapping | rejected_quota | error
    outcome        TEXT        NOT NULL,
    -- Written for a person, in the words of the copy rules: what happened and
    -- what to do about it.
    detail         TEXT,

    -- Sanitized at the write boundary (invariant 4): the signature header and
    -- anything that looks like a credential are removed before this is stored,
    -- because a delivery log is read in a support session on a shared screen.
    headers_json   JSONB       NOT NULL DEFAULT '{}'::jsonb,
    -- Capped. A delivery log is not a payload store; oversized bodies are
    -- truncated with a marker rather than dropped, so the shape is still legible.
    body_text      TEXT,
    body_bytes     INT         NOT NULL DEFAULT 0,

    dedupe_key     TEXT,
    event_type     TEXT,

    run_id         UUID,
    -- Set when this delivery was created by replaying an earlier one, so a
    -- replay is never mistaken for the sender calling twice.
    replay_of_id   UUID        REFERENCES webhook_deliveries(id) ON DELETE SET NULL,
    replayed_by_user_id UUID,

    CONSTRAINT webhook_deliveries_outcome_check CHECK (outcome IN (
        'accepted','rejected_signature','rejected_stale','filtered','duplicate',
        'rejected_disabled','rejected_mapping','rejected_quota','error'))
);

CREATE INDEX IF NOT EXISTS webhook_deliveries_hook_idx
    ON webhook_deliveries (webhook_id, received_at DESC);
CREATE INDEX IF NOT EXISTS webhook_deliveries_workspace_idx
    ON webhook_deliveries (workspace_id, received_at DESC);
-- Dedup, and only over real deliveries: a replay of a delivery deliberately
-- reuses its dedupe key, and must not be refused as a duplicate of itself.
CREATE UNIQUE INDEX IF NOT EXISTS webhook_deliveries_dedupe_unique
    ON webhook_deliveries (webhook_id, dedupe_key)
    WHERE dedupe_key IS NOT NULL AND replay_of_id IS NULL;


-- ───────────────────────────────────────────────────────────────────────────
-- 3. SCHEDULES: INTERVAL, AND WHAT HAPPENS AFTER DOWNTIME
-- ───────────────────────────────────────────────────────────────────────────
--
-- Cron, timezone and the overlap policy already exist. Two things did not.
--
-- ── INTERVAL ──────────────────────────────────────────────────────────────
-- "Every 90 seconds" is not expressible in cron, and the workaround — a
-- one-minute cron that exits early — bills a run to discover it should not run.
--
-- ── CATCH-UP ──────────────────────────────────────────────────────────────
-- `misfire_policy` HAS EXISTED SINCE V001 AND NOTHING HAS EVER READ IT. The
-- column is on the table, it defaults to 'fire_once', and `Schedule` has no
-- field for it — so a deployment could set it, see it in the database, and
-- watch it change nothing. This migration does not add a second column beside
-- it; it gives the existing one a vocabulary and the scheduler learns to obey.
--
-- The default stays 'fire_once' because that is what the scheduler already
-- does: after an outage it advances to the next occurrence after `now` and
-- fires once. So no existing schedule changes meaning on deploy, which is the
-- whole reason not to introduce a new column with a different default.
--
--   skip         forget the missed window. Right for a health check, where a
--                run for 03:15 executed at 09:00 is answering a stale question.
--   fire_once    run once immediately, then resume the cadence. The default.
--   backfill     run every missed occurrence, oldest first, capped. Right for a
--                per-period export where each period is a distinct job and a
--                skipped hour is a hole in somebody's data.
ALTER TABLE schedules
    ADD COLUMN IF NOT EXISTS interval_seconds INT;

-- How many missed occurrences a backfill may fire in one recovery. Without a
-- cap, a schedule that ran every minute through a two-day outage wakes up and
-- enqueues 2880 runs at once — a self-inflicted denial of service at the exact
-- moment the platform is coming back up.
ALTER TABLE schedules
    ADD COLUMN IF NOT EXISTS catchup_max_runs INT NOT NULL DEFAULT 10;

-- The occurrence this schedule has fired up to, which is not the same fact as
-- `last_fire_at`. That one is wall-clock: during a backfill the scheduler fires
-- the 03:00 occurrence at 09:00, and it is the OCCURRENCE that says what is
-- still owed. Nullable, and read as "no history" — a schedule created before
-- this migration backfills nothing on its first tick, which is correct: nobody
-- asked it to.
ALTER TABLE schedules
    ADD COLUMN IF NOT EXISTS last_occurrence_at TIMESTAMPTZ;

-- Existing rows first, then the constraint. A row written before the vocabulary
-- existed could hold anything, and a CHECK that fails to apply leaves the
-- column unconstrained while looking constrained in the migration.
UPDATE schedules SET misfire_policy = 'fire_once'
 WHERE misfire_policy IS NULL OR misfire_policy NOT IN ('skip','fire_once','backfill');

DO $$ BEGIN
    ALTER TABLE schedules
        ADD CONSTRAINT schedules_misfire_check
        CHECK (misfire_policy IN ('skip','fire_once','backfill'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Exactly one cadence. A row with both a cron and an interval has two answers
-- to "when next", and the scheduler would pick one arbitrarily. An interval
-- schedule stores an empty cron rather than null, because the column is NOT
-- NULL from V001 and widening it would rewrite the table for no gain.
DO $$ BEGIN
    ALTER TABLE schedules
        ADD CONSTRAINT schedules_one_cadence
        CHECK (interval_seconds IS NULL OR cron_expression = '');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE schedules
        ADD CONSTRAINT schedules_interval_range
        CHECK (interval_seconds IS NULL OR interval_seconds BETWEEN 10 AND 2592000);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

COMMENT ON COLUMN schedules.misfire_policy IS
    'What a schedule owes after downtime: skip | fire_once | backfill. Not '
    'inferable — a health check must forget the missed window and an hourly '
    'export must not, and only the person who wrote the workflow knows which. '
    'Present since V001 and inert until V066.';


-- ───────────────────────────────────────────────────────────────────────────
-- 4. EVENT TRIGGERS
-- ───────────────────────────────────────────────────────────────────────────
--
-- Consume from a broker the customer already runs. The semantics that matter
-- are at-least-once delivery plus a dedup key, which together give
-- effectively-once run creation: the broker may hand us the same message twice
-- and the second one finds the key taken.
CREATE TABLE IF NOT EXISTS event_triggers (
    id             UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    workspace_id   UUID        NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    environment_id UUID        NOT NULL REFERENCES environments(id) ON DELETE CASCADE,
    workflow_id    UUID        NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,

    name           TEXT        NOT NULL,
    -- kafka | sqs | pubsub
    broker         TEXT        NOT NULL,

    -- Broker credentials live on a connection like every other credential, so
    -- the same rotation, the same encryption, the same audit.
    connection_id  UUID        REFERENCES connections(id) ON DELETE RESTRICT,

    -- Kafka: topic (+ consumer group). SQS: queue URL. Pub/Sub: subscription.
    source         TEXT        NOT NULL,
    consumer_group TEXT,

    -- Same mapping vocabulary as a webhook, because it is the same problem and
    -- two spellings of it would be two things to learn and two to debug.
    input_mapping  JSONB       NOT NULL DEFAULT '{}'::jsonb,
    filter_path    TEXT,
    filter_values  TEXT[]      NOT NULL DEFAULT '{}',

    -- Where the message's own id lives. Falls back to the broker's id when
    -- absent — but a business key is better: a broker id changes on a
    -- redelivery through a DLQ, and the same order should not be processed
    -- twice because it took a different route.
    dedupe_path    TEXT,

    -- Bounds one trigger's share of the platform. A topic with a backlog of a
    -- million messages must not turn into a million runs before any other
    -- tenant is served.
    max_in_flight  INT         NOT NULL DEFAULT 10,
    batch_size     INT         NOT NULL DEFAULT 10,

    enabled        BOOLEAN     NOT NULL DEFAULT TRUE,
    -- Set when the consumer gives up on it: bad credentials, missing topic. The
    -- alternative is a loop that fails forever in a log nobody reads.
    disabled_reason TEXT,
    last_error     TEXT,
    last_message_at TIMESTAMPTZ,
    messages_consumed BIGINT   NOT NULL DEFAULT 0,

    created_by_user_id UUID,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT event_triggers_broker_check CHECK (broker IN ('kafka','sqs','pubsub')),
    CONSTRAINT event_triggers_batch_check CHECK (batch_size BETWEEN 1 AND 100),
    CONSTRAINT event_triggers_inflight_check CHECK (max_in_flight BETWEEN 1 AND 1000)
);

CREATE INDEX IF NOT EXISTS event_triggers_enabled_idx
    ON event_triggers (enabled) WHERE enabled;
CREATE INDEX IF NOT EXISTS event_triggers_workspace_idx
    ON event_triggers (workspace_id, created_at DESC);


-- The dedup ledger, and the reason at-least-once is survivable.
CREATE TABLE IF NOT EXISTS event_trigger_deliveries (
    id             UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    trigger_id     UUID        NOT NULL REFERENCES event_triggers(id) ON DELETE CASCADE,
    workspace_id   UUID        NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,

    dedupe_key     TEXT        NOT NULL,
    received_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- accepted | filtered | duplicate | rejected_mapping | rejected_quota | error
    outcome        TEXT        NOT NULL,
    detail         TEXT,
    run_id         UUID,
    body_text      TEXT,

    CONSTRAINT event_trigger_deliveries_outcome_check CHECK (outcome IN (
        'accepted','filtered','duplicate','rejected_mapping','rejected_quota','error'))
);

-- The whole mechanism, in one constraint.
CREATE UNIQUE INDEX IF NOT EXISTS event_trigger_deliveries_dedupe_unique
    ON event_trigger_deliveries (trigger_id, dedupe_key);
CREATE INDEX IF NOT EXISTS event_trigger_deliveries_recent_idx
    ON event_trigger_deliveries (trigger_id, received_at DESC);


-- ───────────────────────────────────────────────────────────────────────────
-- 5. API KEYS: PER-KEY LIMITS AND ROTATION
-- ───────────────────────────────────────────────────────────────────────────
--
-- The rate limit was per WORKSPACE, which means one runaway integration
-- consumed the budget of every other key in the workspace — including the one
-- an operator was using to investigate it.
ALTER TABLE api_keys
    ADD COLUMN IF NOT EXISTS rate_limit_per_minute INT;

-- Rotation is two keys alive at once, briefly. Anything else is an outage: the
-- old key has to keep working while the new one is deployed, and the overlap
-- has to END or rotation is just "make another key".
ALTER TABLE api_keys
    ADD COLUMN IF NOT EXISTS rotated_from_id UUID REFERENCES api_keys(id) ON DELETE SET NULL;
ALTER TABLE api_keys
    ADD COLUMN IF NOT EXISTS rotation_grace_until TIMESTAMPTZ;

-- What this key may do. Empty means everything the acting member may do, which
-- is the existing behaviour, so no key changes meaning on deploy.
ALTER TABLE api_keys
    ADD COLUMN IF NOT EXISTS scopes TEXT[] NOT NULL DEFAULT '{}';

COMMENT ON COLUMN api_keys.rotation_grace_until IS
    'When the rotated-from key stops working. Rotation without an overlap is an '
    'outage and rotation without an end is not rotation.';


-- ───────────────────────────────────────────────────────────────────────────
-- 6. THE TRIGGER ATTRIBUTE
-- ───────────────────────────────────────────────────────────────────────────
--
-- `agent_runs.trigger_type` already exists. The acceptance criterion is that a
-- run started five different ways is indistinguishable EXCEPT for this column,
-- so the column has to be able to say all five, and the reference to what
-- produced it has to be recoverable.
ALTER TABLE agent_runs
    ADD COLUMN IF NOT EXISTS trigger_ref UUID;

COMMENT ON COLUMN agent_runs.trigger_ref IS
    'The webhook, schedule or event trigger that started this run. Null for an '
    'API or MCP call, where the principal is the answer instead. Deliberately '
    'untyped: it is a breadcrumb for a support question, not a foreign key, and '
    'a FK here would make deleting a webhook delete history.';

CREATE INDEX IF NOT EXISTS agent_runs_trigger_ref_idx
    ON agent_runs (trigger_ref, created_at DESC) WHERE trigger_ref IS NOT NULL;
