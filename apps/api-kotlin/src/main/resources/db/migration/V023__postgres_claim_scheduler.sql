-- =============================================================================
-- V023__postgres_claim_scheduler.sql
--
-- Moves the claim decision into Postgres and demotes Redis to a wakeup signal.
--
-- This is a SIMPLIFICATION, not added machinery. `RunLeaseManager.acquire` was
-- already the real mutual-exclusion primitive — Redis Streams was a notification
-- layer that also hoarded messages. Replacing XREADGROUP with SKIP LOCKED
-- removes the PEL, XAUTOCLAIM, idle-timeout tuning, and the second crash-recovery
-- path that could disagree with the lease sweep (09 §3).
--
-- It also unlocks four things Redis Streams structurally cannot do, all of which
-- the UI already promises:
--   priority lanes      ORDER BY priority DESC
--   weighted fairness   ORDER BY fair_vtime — interleaves tenants instead of FIFO
--   queue position      count(*) WHERE fair_vtime < mine
--   class routing       one indexed predicate
--
-- Safe to apply ahead of any code change: every column has a default and nothing
-- reads them until the worker is deployed with WORKER_CLAIM_MODE=postgres.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Claim + ordering columns
-- ---------------------------------------------------------------------------
ALTER TABLE agent_runs
    ADD COLUMN IF NOT EXISTS priority    SMALLINT         NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS fair_vtime  DOUBLE PRECISION NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS claimed_by  TEXT,
    ADD COLUMN IF NOT EXISTS claimed_at  TIMESTAMPTZ;

COMMENT ON COLUMN agent_runs.priority IS
    'Higher wins. 0 = ordinary traffic, 100 = demo/priority lane. Ordered before '
    'fair_vtime, so a priority run preempts the fair queue entirely.';

COMMENT ON COLUMN agent_runs.fair_vtime IS
    'Virtual finish time from weighted fair queueing. A tenant submitting 500 runs '
    'pushes their own clock far forward; a tenant submitting one gets a vtime near '
    'now and is served next. Weighted fairness from a single indexed column.';

COMMENT ON COLUMN agent_runs.claimed_by IS
    'Worker that won the SKIP LOCKED claim. Distinct from run_leases.worker_id: '
    'this records who took it off the queue, the lease records who is executing.';

-- ---------------------------------------------------------------------------
-- 2. The claim index
--
-- Column order matches the claim's ORDER BY exactly (execution_class equality
-- first, then priority DESC, then fair_vtime), so the planner can walk it and
-- stop at LIMIT instead of sorting the whole pending set.
--
-- Partial on the two pending statuses: terminal runs vastly outnumber pending
-- ones, and this index is on the hot path of every claim round trip on every
-- worker. Keeping it small keeps it in cache.
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS agent_runs_claim_idx
    ON agent_runs (execution_class, priority DESC, fair_vtime)
    WHERE status IN ('queued', 'yielded');

-- Reclaiming runs abandoned by a dead worker: 'claimed' but never leased.
CREATE INDEX IF NOT EXISTS agent_runs_claimed_stale_idx
    ON agent_runs (claimed_at)
    WHERE status = 'claimed';

-- ---------------------------------------------------------------------------
-- 3. The virtual clock
--
-- Lives on workspaces rather than workspace_usage_policies because every
-- workspace has a workspaces row, while a policy row is optional — and a tenant
-- with no policy still has to be ordered fairly against everyone else.
-- ---------------------------------------------------------------------------
ALTER TABLE workspaces
    ADD COLUMN IF NOT EXISTS vclock DOUBLE PRECISION NOT NULL DEFAULT 0;

COMMENT ON COLUMN workspaces.vclock IS
    'This workspace''s virtual clock. Advanced by each enqueue; the next run''s '
    'fair_vtime starts from GREATEST(vclock, now_epoch) so an idle tenant is '
    'never punished for a burst it submitted an hour ago.';

-- ---------------------------------------------------------------------------
-- 4. Plan weight — the "weighted" in weighted fair queueing
--
-- Higher weight divides the cost increment, so a heavier plan advances its clock
-- more slowly and is served more often. Default 1.0 keeps every existing
-- workspace exactly where it is today.
-- ---------------------------------------------------------------------------
ALTER TABLE workspace_usage_policies
    ADD COLUMN IF NOT EXISTS plan_weight   DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    -- The demo lane. Runtime-configurable, no deploy: flip the flag and the next
    -- trigger for that workspace enters at priority.
    ADD COLUMN IF NOT EXISTS priority_lane BOOLEAN          NOT NULL DEFAULT false,
    -- Slots ordinary traffic cannot consume, so a priority workspace is not
    -- merely first in line but guaranteed capacity under saturation.
    ADD COLUMN IF NOT EXISTS reserved_slots INTEGER         NOT NULL DEFAULT 0;

COMMENT ON COLUMN workspace_usage_policies.plan_weight IS
    'Divides the fair-queueing cost increment. 2.0 = advances its clock half as '
    'fast = served roughly twice as often as a weight-1.0 tenant under contention.';
COMMENT ON COLUMN workspace_usage_policies.priority_lane IS
    'Grants priority=100 at trigger. The demo lane — runtime-configurable so a '
    'workspace can be promoted before a live demo without a deploy.';
COMMENT ON COLUMN workspace_usage_policies.reserved_slots IS
    'Slots held back from ordinary (priority=0) traffic for this workspace.';

-- ---------------------------------------------------------------------------
-- 5. Backfill
--
-- Pending runs get a vtime near now so they are ordered sensibly against
-- anything enqueued after the deploy. Without this every pre-existing run would
-- carry fair_vtime = 0 and monopolise the queue ahead of all new work — the
-- ordering column's default is only safe for rows nobody will ever claim.
-- ---------------------------------------------------------------------------
UPDATE agent_runs
   SET fair_vtime = EXTRACT(EPOCH FROM created_at)
 WHERE status IN ('queued', 'yielded')
   AND fair_vtime = 0;

-- Start each workspace's clock at its latest pending vtime, so the first
-- post-deploy enqueue continues the sequence instead of jumping the queue.
UPDATE workspaces w
   SET vclock = sub.max_vtime
  FROM (
        SELECT workspace_id, MAX(fair_vtime) AS max_vtime
          FROM agent_runs
         WHERE status IN ('queued', 'yielded')
         GROUP BY workspace_id
       ) sub
 WHERE sub.workspace_id = w.id
   AND w.vclock = 0;

-- ---------------------------------------------------------------------------
-- 6. Wakeup notification
--
-- Called from the enqueue transaction, so a worker is woken only after the row
-- is actually visible. A NOTIFY sent before COMMIT would wake a worker that then
-- finds nothing and goes back to sleep — the classic lost-wakeup.
--
-- Postgres holds NOTIFY until commit anyway, but doing it in a trigger makes
-- that guarantee structural rather than something every call site must remember.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION notify_run_queued() RETURNS TRIGGER AS $$
BEGIN
    -- Payload is the execution class, so each class's listener can ignore
    -- wakeups that are not for it rather than waking all four.
    PERFORM pg_notify('run_queued', COALESCE(NEW.execution_class, 'short'));
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS agent_runs_notify_queued ON agent_runs;
CREATE TRIGGER agent_runs_notify_queued
    AFTER INSERT OR UPDATE OF status ON agent_runs
    FOR EACH ROW
    WHEN (NEW.status IN ('queued', 'yielded'))
    EXECUTE FUNCTION notify_run_queued();

COMMENT ON FUNCTION notify_run_queued() IS
    'Wakes claim listeners when work becomes available. Fires inside the enqueue '
    'transaction so the notification cannot outrun the row''s visibility.';
