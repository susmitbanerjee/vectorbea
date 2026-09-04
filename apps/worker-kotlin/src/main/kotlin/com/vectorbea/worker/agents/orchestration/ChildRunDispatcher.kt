package com.vectorbea.worker.agents.orchestration

import com.fasterxml.jackson.module.kotlin.jacksonObjectMapper
import com.vectorbea.worker.logging.logger
import com.vectorbea.worker.queue.WorkflowRunJob
import java.util.UUID
import javax.sql.DataSource

/**
 * An activation that executes as its own run — §11's dispatched placement.
 *
 * ── SAME ROW, SAME LIFECYCLE, DIFFERENT TRANSPORT ───────────────────────────
 * The `agent_activations` row is created by `AgentCallExecutor` exactly as it is
 * for an inline child. This adds a SECOND row, in `agent_runs`, that carries the
 * transport: its own lease, its own status CAS, its own timeout, its own
 * dead-letter path. The activation is not duplicated — `parent_activation_id`
 * points at the one that already exists — so the trace, the budget ledger and the
 * reattach rule all see one activation whichever way it ran.
 *
 * ── FAIR SCHEDULING IS THE PART THAT IS EASY TO GET WRONG ───────────────────
 * A child inherits its parent's `fair_vtime`, which is already at the head of
 * the tenant's queue — that is why the parent is running. Inheriting it
 * unmodified would let a tenant place twenty runs at the head by fanning out,
 * jumping its own other queued work, and the weighted-fair ordering would be
 * defeated from inside by the tenant it is meant to bound. The depth penalty is
 * what closes that: each level down costs virtual time, so a deep tree sinks.
 */
class ChildRunDispatcher(
    private val dataSource: DataSource,
    /** Puts the child on `runs.agent.child`. */
    private val enqueue: (WorkflowRunJob) -> Unit,
) {
    private val log = logger()
    private val mapper = jacksonObjectMapper()

    /** Why a dispatch was refused. Never an exception: the caller falls back to inline. */
    sealed class Result {
        data class Dispatched(val childRunId: UUID) : Result()
        /**
         * Refused, and the caller should run it INLINE instead.
         *
         * A cap being reached is not a failure — it is the platform saying "not
         * all at once". Falling back to inline keeps the work moving at the cost
         * of parallelism, which is the trade the caps exist to make.
         */
        data class Capped(val reason: String) : Result()
        data class Failed(val reason: String) : Result()
    }

    /** The caps, from the workspace's policy row. */
    data class Caps(val perRun: Int, val perWorkspace: Int, val vtimePenalty: Double) {
        companion object {
            val DEFAULT = Caps(perRun = 8, perWorkspace = 32, vtimePenalty = 1.0)
        }
    }

    /**
     * Create the child run and enqueue it.
     *
     * Postgres row FIRST, enqueue second — the same durability contract every
     * other enqueue in this system keeps, and for the same reason: a row with no
     * message is recoverable (the reconciler and the claim path both find it), a
     * message with no row is not.
     */
    fun dispatch(
        parentRunId: UUID,
        workspaceId: UUID,
        environmentId: UUID,
        workflowId: UUID,
        workflowVersionId: UUID,
        activationId: UUID,
        depth: Int,
        inputJson: String,
    ): Result {
        val caps = capsFor(workspaceId)

        countActive(parentRunId, workspaceId).let { (perRun, perWorkspace) ->
            if (perRun >= caps.perRun) return Result.Capped(
                "this run already has $perRun children in flight (limit ${caps.perRun})")
            if (perWorkspace >= caps.perWorkspace) return Result.Capped(
                "this workspace already has $perWorkspace children in flight " +
                "(limit ${caps.perWorkspace})")
        }

        val childRunId = UUID.randomUUID()
        return try {
            dataSource.connection.use { conn ->
                conn.prepareStatement(
                    """INSERT INTO agent_runs
                         (id, workspace_id, environment_id, workflow_id, workflow_version_id,
                          status, trigger_type, input_json, execution_class,
                          parent_run_id, parent_activation_id, priority, fair_vtime)
                       SELECT ?,?,?,?,?, 'queued', 'agent_child', ?::jsonb, 'agent.child',
                              ?,?, p.priority,
                              /*
                               * ── THE PENALTY, COMPUTED FROM THE PARENT'S ROW ──
                               *
                               * Read in the same statement that inserts, so the
                               * parent's vtime cannot move between a read and a
                               * write and give two siblings different bases.
                               *
                               * Multiplied by DEPTH, not added once: a chain three
                               * deep should sink further than one child, or a
                               * tenant could still jump the queue by nesting
                               * rather than by fanning out.
                               */
                              p.fair_vtime + (? * GREATEST(?, 1))
                         FROM agent_runs p
                        WHERE p.id = ?"""
                ).use { st ->
                    st.setObject(1, childRunId); st.setObject(2, workspaceId)
                    st.setObject(3, environmentId); st.setObject(4, workflowId)
                    st.setObject(5, workflowVersionId)
                    st.setString(6, inputJson)
                    st.setObject(7, parentRunId); st.setObject(8, activationId)
                    st.setDouble(9, caps.vtimePenalty); st.setInt(10, depth)
                    st.setObject(11, parentRunId)
                    if (st.executeUpdate() == 0) {
                        return Result.Failed("the parent run row is gone, so no child was created")
                    }
                }
            }

            enqueue(WorkflowRunJob(
                streamMessageId = "",
                jobType = WorkflowRunJob.JobType.START_RUN,
                runId = childRunId,
                workflowId = workflowId,
                triggeredBy = "agent-child:$parentRunId",
                inputJson = inputJson,
                retryCount = 0,
                nodeId = null,
                checkpointId = null,
                workspaceId = workspaceId,
            ))

            log.info("[child] dispatched runId={} parent={} activation={} depth={}",
                childRunId, parentRunId, activationId, depth)
            Result.Dispatched(childRunId)
        } catch (e: Exception) {
            /*
             * The row may exist with no message. That is the RECOVERABLE half of
             * the contract: it sits `queued` on the child lane, and the claim path
             * picks up queued rows without needing a message at all. Reporting the
             * failure lets the caller fall back to inline for THIS activation
             * rather than parking the parent on a child that may never start.
             */
            log.error("[child] dispatch failed parent={} activation={}: {}",
                parentRunId, activationId, e.message)
            Result.Failed(e.message?.take(300) ?: "unknown error")
        }
    }

    /**
     * A child reached a terminal state — wake the parent.
     *
     * ── EXACTLY ONCE, AND ONLY ON THE LAST ONE ──────────────────────────────
     * The resume is enqueued only when NO non-terminal sibling remains, so a
     * five-child fan-out wakes its parent once rather than five times. The check
     * and the decision are one statement, so two children terminating
     * concurrently cannot both see themselves as the last.
     *
     * And it is best-effort by construction, which is precisely why
     * [com.vectorbea.worker.durable.ResumeReconciler] exists: this is the fourth
     * instance of "change durable state, then enqueue", and the reconciler is
     * what makes a dropped message survivable rather than terminal.
     */
    fun onChildTerminal(childRunId: UUID): UUID? {
        val parent = parentOf(childRunId) ?: return null
        val remaining = countLiveChildren(parent.runId)
        if (remaining > 0) {
            log.debug("[child] {} terminal; parent {} still waiting on {}",
                childRunId, parent.runId, remaining)
            return null
        }
        return try {
            enqueue(WorkflowRunJob(
                streamMessageId = "",
                jobType = WorkflowRunJob.JobType.RESUME_RUN,
                runId = parent.runId,
                workflowId = parent.workflowId,
                triggeredBy = "agent-child-complete:$childRunId",
                inputJson = "{}",
                retryCount = 0,
                nodeId = null,
                checkpointId = null,
                workspaceId = parent.workspaceId,
            ))
            log.info("[child] last child {} terminal — resumed parent {}", childRunId, parent.runId)
            parent.runId
        } catch (e: Exception) {
            /* Swallowed on purpose, and safely: the parent is `waiting_for_child`
               with every child terminal, which is exactly what the reconciler's
               `children_terminal` arm looks for. */
            log.error("[child] parent resume enqueue failed parent={} — the reconciler will " +
                "recover it: {}", parent.runId, e.message)
            null
        }
    }

    // ── Reads ────────────────────────────────────────────────────────────────

    private data class Parent(val runId: UUID, val workspaceId: UUID, val workflowId: UUID)

    private fun parentOf(childRunId: UUID): Parent? = runCatching {
        dataSource.connection.use { conn ->
            conn.prepareStatement(
                """SELECT p.id, p.workspace_id, p.workflow_id
                     FROM agent_runs c JOIN agent_runs p ON p.id = c.parent_run_id
                    WHERE c.id = ?"""
            ).use { st ->
                st.setObject(1, childRunId)
                st.executeQuery().use { rs ->
                    if (!rs.next()) null else Parent(
                        rs.getObject(1, UUID::class.java),
                        rs.getObject(2, UUID::class.java),
                        rs.getObject(3, UUID::class.java))
                }
            }
        }
    }.getOrNull()

    private fun countLiveChildren(parentRunId: UUID): Int = runCatching {
        dataSource.connection.use { conn ->
            conn.prepareStatement(
                """SELECT count(*) FROM agent_runs
                    WHERE parent_run_id = ?
                      AND status NOT IN ('succeeded','failed','cancelled')"""
            ).use { st ->
                st.setObject(1, parentRunId)
                st.executeQuery().use { rs -> rs.next(); rs.getInt(1) }
            }
        }
    }.getOrElse {
        /* Fail SAFE, not closed: report a live child so the parent is not woken
           on a bad read. The reconciler sweeps the parent anyway once every child
           really is terminal, so a missed wake costs one sweep interval while a
           spurious one costs a parent resumed mid-fan-out. */
        1
    }

    private fun countActive(parentRunId: UUID, workspaceId: UUID): Pair<Int, Int> = runCatching {
        dataSource.connection.use { conn ->
            conn.prepareStatement(
                """SELECT
                     count(*) FILTER (WHERE parent_run_id = ?) AS per_run,
                     count(*)                                   AS per_workspace
                     FROM agent_runs
                    WHERE workspace_id = ?
                      AND parent_run_id IS NOT NULL
                      AND status NOT IN ('succeeded','failed','cancelled')"""
            ).use { st ->
                st.setObject(1, parentRunId); st.setObject(2, workspaceId)
                st.executeQuery().use { rs -> rs.next(); rs.getInt(1) to rs.getInt(2) }
            }
        }
    }.getOrElse {
        /* A cap that cannot be read is a cap that is enforced. The fallback is
           inline execution, which is slower and completely safe. */
        Int.MAX_VALUE to Int.MAX_VALUE
    }

    /** Per-workspace caps and penalty, defaulting to the platform's. */
    fun capsFor(workspaceId: UUID): Caps = runCatching {
        dataSource.connection.use { conn ->
            conn.prepareStatement(
                """SELECT max_activations_per_run, max_activations_per_workspace,
                          child_vtime_penalty
                     FROM workspace_usage_policies WHERE workspace_id = ?"""
            ).use { st ->
                st.setObject(1, workspaceId)
                st.executeQuery().use { rs ->
                    if (!rs.next()) Caps.DEFAULT
                    else Caps(rs.getInt(1), rs.getInt(2), rs.getDouble(3))
                }
            }
        }
    }.getOrDefault(Caps.DEFAULT)
}
