-- ═══════════════════════════════════════════════════════════════════════════
-- V068 — RUN SINGLETONS, AND PRIORITY THAT MEANS SOMETHING
--
-- Two things an incident-response workload needs that a request-response
-- engine does not.
-- ═══════════════════════════════════════════════════════════════════════════


-- ───────────────────────────────────────────────────────────────────────────
-- 1. ONE LIVE RUN PER KEY
-- ───────────────────────────────────────────────────────────────────────────
--
-- Two alerts for the same service must not start two incident runs. Today
-- nothing stops them: `idempotency_key` deduplicates a RETRY of one request
-- (V066) and is a completely different question — it asks "is this the same
-- request", and this asks "is there already a run working on this thing".
--
-- The difference matters at the boundary. An idempotency key expires after 24
-- hours whether or not the run finished; a dedup key is live for exactly as
-- long as its run is, because the moment the incident closes a NEW alert for
-- the same service should start a new incident.
ALTER TABLE agent_runs
    ADD COLUMN IF NOT EXISTS dedup_key TEXT;

/*
 * ── THE PARTIAL UNIQUE INDEX IS THE ENFORCEMENT ──────────────────────────
 *
 * Not a SELECT-then-INSERT in the ingress. Two alerts for the same service
 * arriving in the same second is the NORMAL case for an alerting system — it
 * is what a flapping check does — and a read-then-write loses that race
 * exactly when it matters most.
 *
 * A partial index over the LIVE statuses gives the property directly: at most
 * one non-terminal run per (workspace, workflow, key). A run reaching a
 * terminal state leaves the index and frees the key, atomically, with no sweep
 * and nothing to forget.
 *
 * The status list is exactly `SignalStore.LIVE_STATUSES`. If they ever disagree,
 * a `join` could be told a run holds the key and then be refused a signal by
 * that same run — an alert silently dropped — so `RunDedupTest` asserts they
 * match rather than trusting a comment.
 *
 * `cancellation_requested` is deliberately NOT here. A run that has been asked
 * to cancel has released its claim on the key: it is ending, and the alert still
 * needs working. Including it would also make `supersede` self-defeating, since
 * that policy cancels the holder and immediately inserts — and would lose the
 * race to the run it had just cancelled, every time.
 */
CREATE UNIQUE INDEX IF NOT EXISTS agent_runs_dedup_live_unique
    ON agent_runs (workspace_id, workflow_id, dedup_key)
    WHERE dedup_key IS NOT NULL
      AND status IN ('queued','claimed','running','yielded','recovering',
                     'waiting_for_approval','waiting_for_event','waiting_for_timer',
                     'waiting_for_child');

-- Finding the live run for a key, which is what a `join` or `supersede` does
-- before it decides anything.
CREATE INDEX IF NOT EXISTS agent_runs_dedup_lookup_idx
    ON agent_runs (workspace_id, workflow_id, dedup_key, created_at DESC)
    WHERE dedup_key IS NOT NULL;

COMMENT ON COLUMN agent_runs.dedup_key IS
    'At most one LIVE run per (workspace, workflow, key), enforced by a partial '
    'unique index rather than by a check in the ingress — two alerts for one '
    'service in the same second is the normal case, and a read-then-write loses '
    'that race exactly when it matters. Distinct from idempotency_key, which '
    'deduplicates a retried REQUEST and expires on a clock.';


-- What a second start does when the key is taken. The customer's choice, per
-- workflow, because only they know whether a second alert is more information
-- about the same incident or a reason to start again.
ALTER TABLE workflows
    ADD COLUMN IF NOT EXISTS dedup_policy TEXT NOT NULL DEFAULT 'reject';

DO $$ BEGIN
    ALTER TABLE workflows
        ADD CONSTRAINT workflows_dedup_policy_check
        CHECK (dedup_policy IN ('reject','join','supersede'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

COMMENT ON COLUMN workflows.dedup_policy IS
    'reject = the caller is told which run already owns the key. join = the new '
    'input is delivered to the live run as a signal, so a second alert becomes '
    'more information rather than a second incident. supersede = the live run is '
    'cancelled and a new one starts, for a trigger where only the latest input '
    'matters. Default `reject`: it is the one that cannot silently do the wrong '
    'thing, because the caller always learns what happened.';


-- The name a signal arrives under when the policy is `join`.
--
-- Configurable because the run has to be LISTENING for it: an incident workflow
-- waiting on `new_alert` gets nothing if we deliver `dedup_join`. Defaulted to
-- something legible so a workflow that has not thought about it still receives
-- the payload and can read it at its next step boundary.
ALTER TABLE workflows
    ADD COLUMN IF NOT EXISTS dedup_join_signal TEXT NOT NULL DEFAULT 'dedup_join';


-- ───────────────────────────────────────────────────────────────────────────
-- 2. PRIORITY THAT A SEV1 CAN USE
-- ───────────────────────────────────────────────────────────────────────────
--
-- ── WHAT WAS THERE, AND WHY IT WAS NOT ENOUGH ─────────────────────────────
-- `agent_runs.priority` existed as a two-valued workspace flag: a workspace
-- either had `priority_lane` (100) or did not (0). The claim already ordered by
-- `priority DESC, fair_vtime`, so the mechanism was real — but nothing below a
-- whole workspace could set it, and an SRE team's Sev1 and their nightly batch
-- job live in the SAME workspace.
--
-- So a run needs its own priority, a workflow needs to be able to declare a
-- default, and the vtime has to be weighted by it — because `priority DESC`
-- alone is a strict lane: a steady trickle of Sev1s would starve batch work
-- completely, and starvation is a worse failure than delay.
ALTER TABLE workflows
    ADD COLUMN IF NOT EXISTS default_priority SMALLINT NOT NULL DEFAULT 0;

DO $$ BEGIN
    ALTER TABLE workflows
        ADD CONSTRAINT workflows_priority_range
        CHECK (default_priority BETWEEN 0 AND 100);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

COMMENT ON COLUMN workflows.default_priority IS
    '0 = batch, 50 = normal, 100 = the priority lane. A trigger may raise a '
    'single run above this — a Sev1 alert into a workflow whose default is 50 — '
    'but never above the workspace plan''s ceiling, so priority cannot be '
    'self-granted.';

/*
 * ── AND THE VTIME WEIGHT, WHICH IS THE HALF THAT PREVENTS STARVATION ─────
 *
 * `priority DESC` is a strict ordering: every priority-100 run is claimed
 * before any priority-0 run, so a service producing one Sev1 a minute stops
 * batch work entirely and nobody notices until a nightly job has not run for a
 * week.
 *
 * Weighting the vtime instead makes priority a DISCOUNT on the fair-queue
 * clock: a Sev1 advances the workspace's clock by a fraction of what a batch
 * run does, so it goes to the front repeatedly and cheaply — but a batch run
 * that has been waiting still eventually has the lowest vtime and is served.
 * Preemption without starvation, which is the actual requirement.
 *
 * Both are kept. `priority DESC` gives an unambiguous answer for the demo lane
 * and for genuine emergencies; the weight is what makes the ordinary spread of
 * priorities behave.
 */
CREATE OR REPLACE FUNCTION run_priority_weight(p_priority SMALLINT)
RETURNS DOUBLE PRECISION AS $$
BEGIN
    /*
     * 1x at priority 0, 8x at priority 100. Chosen so a Sev1 is served ahead of
     * roughly eight queued batch runs from the same workspace rather than ahead
     * of all of them forever — an incident should jump the queue, not own it.
     */
    RETURN 1.0 + (7.0 * GREATEST(LEAST(COALESCE(p_priority, 0), 100), 0) / 100.0);
END;
$$ LANGUAGE plpgsql IMMUTABLE;

COMMENT ON FUNCTION run_priority_weight(SMALLINT) IS
    'Priority as a divisor on the fair-queue clock cost: a high-priority run '
    'advances its workspace''s vclock by less, so it is claimed sooner and more '
    'often without ever fully starving the work behind it.';

-- ───────────────────────────────────────────────────────────────────────────
-- 3. THE EVENT-DRIVEN PATHS NEED TO NAME THE KEY THEMSELVES
-- ───────────────────────────────────────────────────────────────────────────
--
-- A webhook and an event trigger already have a `dedupe_path`, and it is a
-- different question again: it deduplicates the same DELIVERY, so a broker's
-- at-least-once redelivery of one alert does not run twice. Two DIFFERENT
-- alerts for one service carry two different event ids, pass that check, and
-- start two incident runs — which is exactly the case this whole migration is
-- about, and it arrives through these two paths far more often than through the
-- API.
--
-- So both get a second path: the one that names the THING being worked, rather
-- than the message that reported it. `alert.labels.service`, not `alert.id`.
ALTER TABLE workflow_webhooks
    ADD COLUMN IF NOT EXISTS run_dedup_path TEXT,
    ADD COLUMN IF NOT EXISTS run_priority SMALLINT;

COMMENT ON COLUMN workflow_webhooks.run_dedup_path IS
    'A path into the delivery naming the THING being worked — a service, an '
    'environment — so two different alerts about it join or are refused per the '
    'workflow''s dedup_policy. Distinct from dedupe_path, which deduplicates a '
    'redelivery of one message.';

ALTER TABLE event_triggers
    ADD COLUMN IF NOT EXISTS run_dedup_path TEXT,
    ADD COLUMN IF NOT EXISTS run_priority SMALLINT;

COMMENT ON COLUMN event_triggers.run_dedup_path IS
    'A path into the message naming the THING being worked, so two different '
    'messages about it do not start two runs. Distinct from dedupe_path, which '
    'deduplicates a broker redelivery of one message.';

DO $$ BEGIN
    ALTER TABLE workflow_webhooks ADD CONSTRAINT workflow_webhooks_run_priority_range
        CHECK (run_priority IS NULL OR run_priority BETWEEN 0 AND 100);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE event_triggers ADD CONSTRAINT event_triggers_run_priority_range
        CHECK (run_priority IS NULL OR run_priority BETWEEN 0 AND 100);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Nullable rather than defaulted to 0, and the difference matters: NULL means
-- "take the workflow's default", and 0 means "batch, whatever the workflow
-- says". A default of 0 would silently demote every run from a workflow that
-- had declared a priority.
