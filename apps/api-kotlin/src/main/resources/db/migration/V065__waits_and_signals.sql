-- =============================================================================
-- V065__waits_and_signals.sql
--
-- One parking primitive, and a way to deliver information into a live run.
--
-- ── TWO REQUIREMENTS, ONE SHAPE ─────────────────────────────────────────────
-- An async tool (a six-minute video render) and a signal (a second alert for the
-- same incident) look like different features and are the same sentence: a run
-- waits for an external event and resumes. So is the approval gate, which has
-- worked that way since V027.
--
-- Building two more parking mechanisms would make five. Invariant 9 — one engine,
-- a new pattern is a policy over the existing primitives — says not to, and the
-- reconciler already says why: it exists because FOUR paths independently got
-- "change durable state, then best-effort enqueue" wrong, and one sweep was
-- cheaper than four that drift.
--
-- ── WHAT IS AUTHORITATIVE, AND WHAT IS NOT ──────────────────────────────────
-- `run_waits` is the parked state: what a run is waiting for, until when, and
-- how it will be woken.
--
-- It is NOT the decision record for an approval. `run_approvals` stays exactly
-- as it is — it is what `ApprovalRoutes` writes, what the Approvals page reads,
-- and what `decideOnApproval` interprets, and rewriting that would put every
-- in-flight approval through a new resume path on the deploy that ships this.
-- An approval gate now writes BOTH: the decision row it always wrote, and a wait
-- row pointing at it. The reconciler sweeps waits for every kind, so there is
-- one parking mechanism and one sweep, and no live approval changes path.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- run_waits
--
-- ── THE KEY IS THE WHOLE DESIGN ─────────────────────────────────────────────
-- `wait_key` is derived from `(run_id, node_id, attempt_group)` by the same
-- SHA-256 the side-effect guard uses (invariant 2), and it is UNIQUE per run.
-- That is what makes every hard case fall out:
--
--   · A step re-executes from iteration 1 on resume. It computes the same key,
--     finds the existing row, and does not open a second wait — the same reason
--     the approval gate is keyed on (runId, nodeId) rather than on an iteration.
--   · A redelivered completion callback carries the same key and resolves the
--     same row. The resolution is a CAS on `status = 'waiting'`, so the second
--     delivery updates zero rows and is acknowledged without resuming twice.
--   · A deliberate re-run bumps `attempt_group`, so it gets a NEW wait and does
--     wait again — which is what the person asking for a re-run means.
--
-- No iteration number, no timestamp, no random id goes into it.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS run_waits (
    id                    UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    workspace_id          UUID        NOT NULL,
    environment_id        UUID        NOT NULL,
    run_id                UUID        NOT NULL REFERENCES agent_runs (id) ON DELETE CASCADE,
    workflow_id           UUID,

    -- The node (or agent step) that parked. Part of the key material.
    node_id               TEXT        NOT NULL,
    attempt_group         INTEGER     NOT NULL DEFAULT 0,

    -- 'approval' | 'async_tool' | 'signal' | 'agent_wait'
    --
    -- The KIND, not the status. `agent_runs.status` says `waiting_for_event` for
    -- everything except approvals (which keep `waiting_for_approval` and their
    -- existing UI treatment); this column says which sort of event.
    kind                  TEXT        NOT NULL,

    -- Derived, durable, unique per run. See the header.
    wait_key              TEXT        NOT NULL,

    -- 'waiting' | 'resolved' | 'timed_out' | 'cancelled'
    status                TEXT        NOT NULL DEFAULT 'waiting',

    -- What is being waited for, in the operator's words. Shown on the timeline.
    label                 TEXT,

    -- For kind='signal' and kind='agent_wait': the signal name that satisfies it.
    -- NULL for a wait that is not woken by a named signal.
    signal_name           TEXT,

    -- The external thing this wait tracks:
    --   approval    → run_approvals.id
    --   async_tool  → the provider's job handle, as returned by submit
    external_ref          TEXT,

    -- ── HOW THE OUTSIDE WORLD REACHES THIS WAIT ────────────────────────────
    -- Unguessable, and DERIVED rather than random: HMAC(server key, wait_key).
    -- Random would be simpler and would break re-execution — the step recomputes
    -- its key on resume, and a token it cannot recompute is a callback URL it has
    -- already given the provider and can no longer recognise.
    callback_token        TEXT,

    -- ── POLLING, THE FALLBACK THAT MAKES CALLBACKS SAFE ────────────────────
    -- A provider that never calls back must not park a run forever. When the
    -- tool declares a poll, these drive it; the reconciler sweeps `poll_next_at`
    -- exactly as the timer scheduler sweeps `fire_at`.
    poll_url              TEXT,
    poll_next_at          TIMESTAMPTZ,
    poll_interval_ms      INTEGER,
    poll_attempts         INTEGER     NOT NULL DEFAULT 0,
    poll_max_attempts     INTEGER,

    -- Which connection authenticates the poll.
    --
    -- A poll is a request to the provider and needs the same credential the
    -- submit used. The sweeper runs long after the step that submitted has gone,
    -- so it cannot inherit anything in memory — it resolves this connection and
    -- applies its auth exactly as the resolver did. An id, never a credential:
    -- the secret stays encrypted on the connection, as it does everywhere else.
    poll_connection_id    UUID,

    -- Absent means wait forever, which nothing may do: the store refuses to
    -- create a wait without one. Nullable only so an operator can lift a
    -- deadline by hand on a wait that is already parked.
    timeout_at            TIMESTAMPTZ,

    -- Sanitized. Never a provider response, never a credential.
    metadata_json         JSONB       NOT NULL DEFAULT '{}',

    -- How it ended, and with what. `resolution_ref` points at the payload store
    -- for anything large; `resolution_json` holds a small, sanitized result.
    resolution            TEXT,
    resolution_json       JSONB,
    resolution_ref        TEXT,
    resolved_at           TIMESTAMPTZ,
    resolved_by           TEXT,

    created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT run_waits_kind_check
        CHECK (kind IN ('approval', 'async_tool', 'signal', 'agent_wait')),
    CONSTRAINT run_waits_status_check
        CHECK (status IN ('waiting', 'resolved', 'timed_out', 'cancelled')),
    CONSTRAINT run_waits_resolution_check
        CHECK (resolution IS NULL OR resolution IN ('completed', 'failed', 'timeout', 'cancelled', 'signal')),

    -- The durable key, enforced. This is what makes a redelivered callback and a
    -- re-executed step land on the same row rather than opening a second wait.
    CONSTRAINT run_waits_key_unique UNIQUE (run_id, wait_key)
);

-- The reconciler's sweep: parked waits whose deadline or poll is due.
CREATE INDEX IF NOT EXISTS run_waits_due_idx
    ON run_waits (timeout_at)
    WHERE status = 'waiting';
CREATE INDEX IF NOT EXISTS run_waits_poll_idx
    ON run_waits (poll_next_at)
    WHERE status = 'waiting' AND poll_next_at IS NOT NULL;

-- "What is this run waiting for" — the timeline, the run header, and the
-- resume path all ask it.
CREATE INDEX IF NOT EXISTS run_waits_run_idx
    ON run_waits (run_id, status);

-- A signal wakes every wait in the workspace whose name matches. Partial,
-- because a resolved wait is never a delivery target and there are far more of
-- those than parked ones.
CREATE INDEX IF NOT EXISTS run_waits_signal_idx
    ON run_waits (run_id, signal_name)
    WHERE status = 'waiting' AND signal_name IS NOT NULL;

-- The callback endpoint's only lookup. Unique so a token identifies one wait.
CREATE UNIQUE INDEX IF NOT EXISTS run_waits_callback_token_idx
    ON run_waits (callback_token)
    WHERE callback_token IS NOT NULL;

COMMENT ON TABLE run_waits IS
    'The one parking primitive: what a run is waiting for, until when, and how it '
    'will be woken. Approvals write one of these AND their own run_approvals row — '
    'the approval decision record is unchanged and still authoritative.';

COMMENT ON COLUMN run_waits.wait_key IS
    'SHA-256 over (run_id, node_id, attempt_group), the same derivation as '
    'side_effects.idempotency_key. Durable across re-execution by construction: a '
    'resumed step recomputes it and finds its own wait instead of opening a second.';

COMMENT ON COLUMN run_waits.callback_token IS
    'HMAC(server key, wait_key). Unguessable, and DERIVED so a re-executed step '
    'recomputes the same URL it already handed the provider.';

-- ---------------------------------------------------------------------------
-- run_signals
--
-- ── DURABLE, ORDERED, AND CONSUMED EXACTLY ONCE ─────────────────────────────
-- `sequence` is allocated per run, so two alerts arriving in the same
-- millisecond have an order and the run reads them in it. A timestamp would not:
-- `created_at` ties, and a run that read its signals by time would see two
-- orderings on two reads.
--
-- `consumed_at` rather than a delete, because "what did this run know and when"
-- is the question an incident review asks, and a deleted row cannot answer it.
-- Retention removes them with the run (invariant 10 — a deletion, not a filter).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS run_signals (
    id                UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    workspace_id      UUID        NOT NULL,
    environment_id    UUID        NOT NULL,
    run_id            UUID        NOT NULL REFERENCES agent_runs (id) ON DELETE CASCADE,

    -- Per-run monotonic. Allocated by the insert, from the run's own maximum.
    sequence          INTEGER     NOT NULL,
    name              TEXT        NOT NULL,

    -- The caller's payload. Sanitized at the write boundary (invariant 4) and
    -- size-capped by the route before it ever reaches here.
    payload_json      JSONB       NOT NULL DEFAULT '{}',

    -- Who sent it. A user id, or an api key id — never a bare string from the
    -- caller, so "who told this run about the second alert" has one answer.
    sent_by_user_id   UUID,
    sent_by_api_key_id UUID,
    source            TEXT        NOT NULL DEFAULT 'api',

    -- Optional caller-supplied idempotency. A retried POST with the same key is
    -- the same signal, not a second one — an alerting system that retries on a
    -- timeout would otherwise deliver the same alert twice.
    dedupe_key        TEXT,

    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- Set when the run has actually taken delivery. The wait it resolved, if any.
    consumed_at       TIMESTAMPTZ,
    consumed_wait_id  UUID REFERENCES run_waits (id) ON DELETE SET NULL,

    CONSTRAINT run_signals_sequence_unique UNIQUE (run_id, sequence)
);

CREATE UNIQUE INDEX IF NOT EXISTS run_signals_dedupe_idx
    ON run_signals (run_id, dedupe_key)
    WHERE dedupe_key IS NOT NULL;

-- The step-boundary read: "is there anything new for this run".
CREATE INDEX IF NOT EXISTS run_signals_pending_idx
    ON run_signals (run_id, sequence)
    WHERE consumed_at IS NULL;

CREATE INDEX IF NOT EXISTS run_signals_workspace_idx
    ON run_signals (workspace_id, created_at DESC);

COMMENT ON TABLE run_signals IS
    'Information delivered into a run after it started. Durable and ordered by a '
    'per-run sequence; consumed at the run''s next step boundary, or immediately '
    'if it is parked on a matching wait.';

-- ---------------------------------------------------------------------------
-- Waiting time is already excluded from the wall-clock budget.
--
-- `agent_runs.active_ms` accumulates only while a tick executes (see
-- RunCeilings: "ACTIVE TIME, NOT WALL TIME"), and a wait ends the tick. So a run
-- parked six minutes on a video render costs nothing, for the same reason one
-- parked three days on an approval already costs nothing — no new column, and
-- no new rule to keep in step with the old one.
--
-- What is added is the ability to REPORT it, which the timeline needs to draw a
-- labelled wait span rather than an unexplained gap between two ticks.
-- ---------------------------------------------------------------------------
ALTER TABLE agent_runs
    ADD COLUMN IF NOT EXISTS waiting_ms BIGINT NOT NULL DEFAULT 0;

COMMENT ON COLUMN agent_runs.waiting_ms IS
    'Total time parked on a wait. Reported, never charged: active_ms is the '
    'budget and it does not tick while parked. The timeline draws this as a '
    'labelled wait span instead of an unexplained gap between ticks.';

-- ---------------------------------------------------------------------------
-- The reconciler's three new reasons.
--
-- ── THIS CONSTRAINT IS NOT OPTIONAL BOOKKEEPING ────────────────────────────
-- V045 constrained `run_resume_attempts.reason` to the four reasons that
-- existed then. The reconciler records an attempt BEFORE it enqueues — that
-- order is deliberate, and is the opposite of the bug the reconciler exists for
-- — so a reason the constraint rejects makes the INSERT fail, which fails the
-- whole sweep, which recovers NOTHING.
--
-- Found by `WaitReconciliationTest`: the sweep correctly identified fifteen
-- stranded runs and then threw on the first insert, so every arm silently
-- recovered zero. A comment claiming this column was free text would have
-- shipped it.
--
-- Dropped and recreated rather than widened in place: Postgres has no ALTER
-- CONSTRAINT for a CHECK, and this table is small enough that the rewrite is
-- free.
-- ---------------------------------------------------------------------------
ALTER TABLE run_resume_attempts
    DROP CONSTRAINT IF EXISTS run_resume_reason_check;

ALTER TABLE run_resume_attempts
    ADD CONSTRAINT run_resume_reason_check CHECK (
        reason IN (
            -- V045's four.
            'approval_resolved', 'children_terminal', 'recovering_stranded', 'timer_fired',
            -- The wait primitive's three. See `ResumeReconciler.Reason`.
            'wait_resolved', 'wait_expired', 'signal_pending'
        )
    );

COMMENT ON COLUMN run_resume_attempts.reason IS
    'Why the reconciler swept this run: approval_resolved | children_terminal | '
    'recovering_stranded | timer_fired | wait_resolved | wait_expired | '
    'signal_pending. Constrained, because the attempt row is written BEFORE the '
    'enqueue — an unlisted reason fails the insert and therefore the whole sweep.';

-- ---------------------------------------------------------------------------
-- What a run is waiting for, as a view.
--
-- A view because three consumers ask it — the run header, the timeline, and the
-- reconciler's diagnostics — and because reconstructing "the oldest unresolved
-- wait, with how long is left" in three places is three chances to disagree
-- about which wait is the interesting one when a run holds several.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW run_active_waits AS
    SELECT w.run_id,
           w.workspace_id,
           w.id            AS wait_id,
           w.kind,
           w.label,
           w.node_id,
           w.signal_name,
           w.external_ref,
           w.created_at,
           w.timeout_at,
           w.poll_next_at,
           w.poll_attempts,
           EXTRACT(EPOCH FROM (now() - w.created_at)) * 1000 AS waiting_ms,
           CASE WHEN w.timeout_at IS NULL THEN NULL
                ELSE EXTRACT(EPOCH FROM (w.timeout_at - now())) * 1000
           END                                               AS expires_in_ms
      FROM run_waits w
     WHERE w.status = 'waiting';

COMMENT ON VIEW run_active_waits IS
    'Every wait a run is currently parked on, with how long it has waited and how '
    'long is left. One definition, because the run header, the timeline and the '
    'reconciler would otherwise each decide for themselves which wait matters.';
