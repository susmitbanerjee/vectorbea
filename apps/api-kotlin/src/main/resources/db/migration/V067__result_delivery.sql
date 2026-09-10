-- ═══════════════════════════════════════════════════════════════════════════
-- V067 — RESULT DELIVERY: getting the answer to where it needs to go
--
-- An agent that cannot deliver its result has done nothing. Three shapes, and
-- conflating them is the mistake this schema exists to prevent:
--
--   1. AWAITING CALLER   already solved. Sync and stream modes hand the result
--                        back on the call (V066, docs/INGRESS.md §4). There is
--                        NO row here for it, deliberately — modelling a blocked
--                        caller as a "destination" would give it a retry policy,
--                        a dead-letter queue and a redelivery button for a
--                        connection that closed the moment it got its answer.
--   2. CALLBACK          we call their endpoint after the run finishes.
--   3. DESTINATION       we push the result somewhere: object storage, Slack,
--                        a database write-back, a queue.
--
-- ── DESTINATIONS ARE TOOLS, NOT A SUBSYSTEM ───────────────────────────────
-- A destination row points at a `tools` row. That is the whole design: a Slack
-- destination is the Slack HTTP tool, with the connection, the credential, the
-- approval policy, the audit trail and the result contract it already has. A
-- parallel "destinations" implementation would need its own version of every
-- one of those, and would get the credential handling wrong first.
--
-- What is genuinely new — and is why these tables exist at all — is that
-- delivery happens AFTER the run is terminal. It cannot use the run's retry,
-- because the run is over; it cannot fail the run, because the run succeeded;
-- and it must not be invisible, because a run that produced the right answer
-- and failed to deliver it is not a success from the customer's side.
-- ═══════════════════════════════════════════════════════════════════════════


-- ───────────────────────────────────────────────────────────────────────────
-- 1. WHERE RESULTS GO
-- ───────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS delivery_targets (
    id             UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    workspace_id   UUID        NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    environment_id UUID        NOT NULL REFERENCES environments(id) ON DELETE CASCADE,
    -- Null means "every workflow in this environment". A workspace that wants
    -- one archival destination should not have to attach it forty times.
    workflow_id    UUID        REFERENCES workflows(id) ON DELETE CASCADE,

    name           TEXT        NOT NULL,
    -- callback | destination
    kind           TEXT        NOT NULL,

    -- ── kind = 'callback' ────────────────────────────────────────────────
    callback_url   TEXT,
    -- Encrypted through SecretService like every other credential. Used to sign
    -- the request so the receiver can prove it came from us — see §4.
    signing_secret_ref TEXT,
    -- Extra headers the receiver needs (a tenant id, an API version). NEVER a
    -- credential: a header map is returned by the list endpoint and rendered in
    -- a form, so anything secret goes in `signing_secret_ref`.
    headers_json   JSONB       NOT NULL DEFAULT '{}'::jsonb,

    -- ── kind = 'destination' ─────────────────────────────────────────────
    -- The tool that does the pushing. Granting, credentials, approval policy
    -- and the result contract all come from the tool, unchanged.
    tool_id        UUID        REFERENCES tools(id) ON DELETE RESTRICT,
    connection_id  UUID        REFERENCES connections(id) ON DELETE RESTRICT,
    -- How the run's output maps onto the tool's inputs. Same vocabulary as a
    -- webhook's `input_mapping`, on purpose — one thing to learn.
    input_mapping  JSONB       NOT NULL DEFAULT '{}'::jsonb,

    -- ── When it fires ────────────────────────────────────────────────────
    -- Which terminal statuses deliver. A failure notification to Slack is a
    -- destination too, so this is not always 'succeeded'.
    on_statuses    TEXT[]      NOT NULL DEFAULT ARRAY['succeeded','completed'],

    -- ── Payload shape ────────────────────────────────────────────────────
    -- full | url | auto
    --
    -- `auto` is the default and the only sensible one: deliver the payload
    -- inline, and switch to a signed URL when it is over the target's limit.
    -- Forcing `full` at a destination with a size cap turns a large result into
    -- a permanent delivery failure; forcing `url` makes every small result an
    -- extra round trip for the receiver.
    payload_mode   TEXT        NOT NULL DEFAULT 'auto',
    -- Above this, `auto` switches to a signed URL. Defaults to 256 KB, which is
    -- under every common receiver's body limit.
    max_payload_bytes INT      NOT NULL DEFAULT 262144,

    -- ── Streaming ────────────────────────────────────────────────────────
    -- Deliver as the run goes rather than only at the end. A six-hour pipeline
    -- that emits nothing until it finishes is indistinguishable from one that
    -- is stuck, and the customer cannot start work on the first half.
    stream_partials BOOLEAN    NOT NULL DEFAULT FALSE,
    -- Which node ids emit a partial. Empty with streaming on means every
    -- checkpoint, which is a lot for a wide graph — the UI should push people
    -- to name the ones that matter.
    stream_nodes   TEXT[]      NOT NULL DEFAULT '{}',

    -- ── Retry policy ─────────────────────────────────────────────────────
    max_attempts   INT         NOT NULL DEFAULT 8,
    timeout_ms     INT         NOT NULL DEFAULT 30000,

    enabled        BOOLEAN     NOT NULL DEFAULT TRUE,
    created_by_user_id UUID,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT delivery_targets_kind_check CHECK (kind IN ('callback','destination')),
    CONSTRAINT delivery_targets_payload_mode_check
        CHECK (payload_mode IN ('full','url','auto')),
    CONSTRAINT delivery_targets_attempts_check CHECK (max_attempts BETWEEN 1 AND 20),
    CONSTRAINT delivery_targets_timeout_check CHECK (timeout_ms BETWEEN 1000 AND 120000),
    -- A row that cannot deliver anything is a row that produces a failed
    -- delivery for every run, forever, and a customer who cannot see why.
    CONSTRAINT delivery_targets_has_destination CHECK (
        (kind = 'callback'    AND callback_url IS NOT NULL) OR
        (kind = 'destination' AND tool_id IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS delivery_targets_workflow_idx
    ON delivery_targets (workflow_id) WHERE enabled;
CREATE INDEX IF NOT EXISTS delivery_targets_environment_idx
    ON delivery_targets (environment_id) WHERE enabled AND workflow_id IS NULL;
CREATE INDEX IF NOT EXISTS delivery_targets_workspace_idx
    ON delivery_targets (workspace_id, created_at DESC);


-- ───────────────────────────────────────────────────────────────────────────
-- 2. ONE DELIVERY, AND ITS WHOLE LIFE
-- ───────────────────────────────────────────────────────────────────────────
--
-- ── THIS TABLE IS ALSO THE DEAD-LETTER QUEUE ──────────────────────────────
-- `status = 'dead'` is the DLQ, and the row is redeliverable in place. A
-- separate dead-letter table would duplicate the target, the payload, the
-- attempt count and the error chain, and redelivery would need a join to put
-- them back together — which is a join somebody eventually gets wrong, and the
-- symptom is a redelivery that sends the wrong payload to the right endpoint.
--
-- `dead_letters` (V022) stays what it is: poison QUEUE messages that crashed a
-- worker. "Their endpoint returned 500" is not that, and the operator workflow
-- is different: one is "this payload is malformed", the other is "their service
-- was down and I want to try again now".
CREATE TABLE IF NOT EXISTS run_deliveries (
    id             UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    workspace_id   UUID        NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    environment_id UUID        NOT NULL,
    run_id         UUID        NOT NULL,
    target_id      UUID        NOT NULL REFERENCES delivery_targets(id) ON DELETE CASCADE,

    -- ── THE IDEMPOTENCY KEY THE RECEIVER DEDUPES ON ──────────────────────
    -- Derived from (run, target, sequence), so it is IDENTICAL on every retry
    -- and on every operator-triggered redelivery. That is the acceptance
    -- criterion: a receiver that stores the key it has seen can refuse the
    -- second copy, and a redelivery six hours later still carries the key it
    -- was born with. A generated-per-attempt key would make every retry look
    -- like a new event, which is the failure mode the header exists to prevent.
    idempotency_key TEXT       NOT NULL,

    -- Zero for the terminal delivery. 1..n for streamed partials, in order, so
    -- a receiver can tell "the third chunk" from "the final result".
    sequence       INT         NOT NULL DEFAULT 0,
    -- True for a partial. The payload carries it too, but having it as a column
    -- means "show me runs whose FINAL delivery failed" is one predicate.
    is_partial     BOOLEAN     NOT NULL DEFAULT FALSE,

    -- pending | delivering | delivered | retrying | dead | cancelled | skipped
    status         TEXT        NOT NULL DEFAULT 'pending',

    attempts       INT         NOT NULL DEFAULT 0,
    max_attempts   INT         NOT NULL DEFAULT 8,
    -- Claimed and scheduled by the dispatcher. The backoff lives here rather
    -- than in a sleeping thread, so a restart does not reset every timer.
    next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- The claim, so two dispatchers cannot deliver the same row at once.
    claimed_at     TIMESTAMPTZ,
    claimed_by     TEXT,

    -- Which shape actually went out. Requirement 5: SAY which was used, because
    -- a receiver that got a URL where it expected a body needs to know it was a
    -- size decision and not a bug.
    payload_mode_used TEXT,
    payload_bytes  INT,
    -- Set when the payload went as a link. Expires; see §3.
    payload_url    TEXT,

    -- Every error, in order. One error says what failed last; the chain says
    -- whether it is deterministic — a 400 eight times is their contract, eight
    -- different 5xx is their outage.
    error_chain_json JSONB     NOT NULL DEFAULT '[]'::jsonb,
    last_error     TEXT,

    -- ── STREAMED PARTIALS CARRY THEIR OWN CONTENT ───────────────────────
    -- A partial is emitted mid-run, when `agent_runs.output_json` is still null
    -- — so unlike the terminal delivery it cannot read the run's output at
    -- delivery time and has to carry what it is delivering. Null for the
    -- terminal one, which reads the run.
    partial_output_json JSONB,
    -- Which node produced it, so a receiver assembling a six-hour pipeline knows
    -- what part of it just arrived.
    partial_node_id TEXT,

    first_attempt_at TIMESTAMPTZ,
    delivered_at   TIMESTAMPTZ,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT run_deliveries_status_check CHECK (status IN (
        'pending','delivering','delivered','retrying','dead','cancelled','skipped')),
    CONSTRAINT run_deliveries_mode_check CHECK (
        payload_mode_used IS NULL OR payload_mode_used IN ('full','url')),
    -- One delivery per (run, target, sequence). The enqueue is idempotent by
    -- construction: `onTerminalTransition` runs once per terminal transition,
    -- but a redelivered queue message that somehow reached it twice must not
    -- produce two callbacks.
    CONSTRAINT run_deliveries_unique UNIQUE (run_id, target_id, sequence)
);

-- The dispatcher's claim query, in one index.
CREATE INDEX IF NOT EXISTS run_deliveries_due_idx
    ON run_deliveries (next_attempt_at)
    WHERE status IN ('pending','retrying');
CREATE INDEX IF NOT EXISTS run_deliveries_run_idx
    ON run_deliveries (run_id, sequence);
-- The DLQ view: what an operator opens.
CREATE INDEX IF NOT EXISTS run_deliveries_dead_idx
    ON run_deliveries (workspace_id, updated_at DESC)
    WHERE status = 'dead';
-- Recovering a delivery whose dispatcher died mid-attempt.
CREATE INDEX IF NOT EXISTS run_deliveries_stuck_idx
    ON run_deliveries (claimed_at) WHERE status = 'delivering';

COMMENT ON COLUMN run_deliveries.idempotency_key IS
    'Derived from (run, target, sequence) and therefore identical on every '
    'retry and every operator redelivery. A receiver deduping on it sees one '
    'event however many times we send it.';


-- ───────────────────────────────────────────────────────────────────────────
-- 3. EVERY ATTEMPT, NOT JUST THE LAST
-- ───────────────────────────────────────────────────────────────────────────
--
-- The delivery row carries the current state; this carries the history. They
-- are separate because the questions are: "is this delivered" is a column read
-- on a hot path, and "why did it take six tries" is a rare, detailed read.
CREATE TABLE IF NOT EXISTS delivery_attempts (
    id             UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    delivery_id    UUID        NOT NULL REFERENCES run_deliveries(id) ON DELETE CASCADE,
    workspace_id   UUID        NOT NULL,
    attempt        INT         NOT NULL,

    started_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    duration_ms    INT,
    -- delivered | failed | timeout | refused
    outcome        TEXT        NOT NULL,
    http_status    INT,
    -- Truncated hard. A receiver that returns its whole HTML error page must
    -- not put it in our database once per attempt per delivery.
    response_snippet TEXT,
    error          TEXT,
    -- Whoever asked for this attempt: 'dispatcher' or a user id for a manual
    -- redelivery, so the history distinguishes "it retried" from "somebody
    -- pressed the button".
    triggered_by   TEXT        NOT NULL DEFAULT 'dispatcher',

    CONSTRAINT delivery_attempts_outcome_check
        CHECK (outcome IN ('delivered','failed','timeout','refused'))
);

CREATE INDEX IF NOT EXISTS delivery_attempts_delivery_idx
    ON delivery_attempts (delivery_id, attempt);


-- ───────────────────────────────────────────────────────────────────────────
-- 4. SIGNED PAYLOAD LINKS, FOR RESULTS TOO BIG TO SEND
-- ───────────────────────────────────────────────────────────────────────────
--
-- A link, not a public URL: the token is an HMAC over (delivery, run), so it
-- is unguessable, it names exactly one payload, and it expires. A receiver that
-- keeps the link cannot use it to read anything else, and cannot use it at all
-- next week.
--
-- Deliberately NOT reusing the payload ref as a URL path. A content-addressed
-- ref is shared between payloads that happen to be identical, so a link to one
-- would be a link to every run that produced the same output.
CREATE TABLE IF NOT EXISTS delivery_payload_links (
    token          TEXT        NOT NULL PRIMARY KEY,
    delivery_id    UUID        NOT NULL REFERENCES run_deliveries(id) ON DELETE CASCADE,
    workspace_id   UUID        NOT NULL,
    run_id         UUID        NOT NULL,
    -- The bytes, or a ref into the payload store when they are very large.
    content_json   JSONB,
    payload_ref    TEXT,
    content_bytes  INT         NOT NULL DEFAULT 0,

    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- Long enough for a receiver to fetch on their own schedule; short enough
    -- that a link in somebody's logs is not a permanent read grant.
    expires_at     TIMESTAMPTZ NOT NULL DEFAULT now() + interval '7 days',
    -- Read counters, because "did they ever fetch it" is the question asked
    -- when a customer says the result never arrived.
    fetch_count    INT         NOT NULL DEFAULT 0,
    last_fetched_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS delivery_payload_links_expiry_idx
    ON delivery_payload_links (expires_at);
CREATE INDEX IF NOT EXISTS delivery_payload_links_delivery_idx
    ON delivery_payload_links (delivery_id);


-- ───────────────────────────────────────────────────────────────────────────
-- 5. DELIVERY STATUS IS PART OF THE RUN
-- ───────────────────────────────────────────────────────────────────────────
--
-- ── THE ACCEPTANCE CRITERION, AS A COLUMN ─────────────────────────────────
-- "A run whose delivery failed is visibly distinct from one that succeeded."
-- That has to be answerable without a join, because it is asked by the runs
-- LIST — and a list that needs a per-row aggregate to colour a badge is a list
-- that will not do it.
--
-- NOT folded into `status`. A run that produced the right answer and could not
-- deliver it did not fail: its output is correct, its cost was real, and
-- retrying the RUN would re-execute every side effect. It is a successful run
-- with an undelivered result, and the two facts need two columns to stay
-- distinguishable.
ALTER TABLE agent_runs
    ADD COLUMN IF NOT EXISTS delivery_status TEXT NOT NULL DEFAULT 'none';

DO $$ BEGIN
    ALTER TABLE agent_runs
        ADD CONSTRAINT agent_runs_delivery_status_check
        CHECK (delivery_status IN ('none','pending','delivered','partial','failed'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

COMMENT ON COLUMN agent_runs.delivery_status IS
    'none = nothing configured. pending = queued or retrying. delivered = every '
    'delivery landed. partial = some landed, some did not. failed = every '
    'delivery is dead. Deliberately separate from `status`: a run that produced '
    'the right answer and could not deliver it is not a failed run, and retrying '
    'the RUN would re-execute every side effect.';

-- Finding them: "show me runs that succeeded but did not deliver".
CREATE INDEX IF NOT EXISTS agent_runs_undelivered_idx
    ON agent_runs (workspace_id, updated_at DESC)
    WHERE delivery_status IN ('failed','partial');


-- ───────────────────────────────────────────────────────────────────────────
-- 6. THE ROLL-UP, IN ONE PLACE
-- ───────────────────────────────────────────────────────────────────────────
--
-- A function rather than five copies of the same CASE expression in Kotlin.
-- The dispatcher, the redelivery route, the cancel path and the reconciler all
-- have to update this, and five spellings of "partial" is how a run ends up
-- showing green in the list and red on its own page.
CREATE OR REPLACE FUNCTION refresh_run_delivery_status(p_run_id UUID)
RETURNS TEXT AS $$
DECLARE
    v_total   INT;
    v_done    INT;
    v_dead    INT;
    v_status  TEXT;
BEGIN
    SELECT count(*),
           count(*) FILTER (WHERE status = 'delivered'),
           count(*) FILTER (WHERE status = 'dead')
      INTO v_total, v_done, v_dead
      FROM run_deliveries
     WHERE run_id = p_run_id AND status <> 'cancelled' AND status <> 'skipped';

    v_status := CASE
        WHEN v_total = 0            THEN 'none'
        WHEN v_done  = v_total      THEN 'delivered'
        WHEN v_dead  = v_total      THEN 'failed'
        -- Anything dead alongside anything not is PARTIAL, including while
        -- others are still retrying. A run with one dead delivery is already
        -- not fully delivered, and calling it `pending` until the last retry
        -- gives up would hide the failure for the length of the backoff.
        WHEN v_dead  > 0            THEN 'partial'
        ELSE 'pending'
    END;

    UPDATE agent_runs SET delivery_status = v_status WHERE id = p_run_id;
    RETURN v_status;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION refresh_run_delivery_status(UUID) IS
    'Rolls every delivery for a run up into agent_runs.delivery_status. One '
    'definition, because the dispatcher, the redelivery route and the cancel '
    'path all have to update it and five spellings of "partial" is how a run '
    'shows green in the list and red on its own page.';
