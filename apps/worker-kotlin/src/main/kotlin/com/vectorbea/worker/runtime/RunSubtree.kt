package com.vectorbea.worker.runtime

import com.vectorbea.worker.logging.logger
import java.util.UUID
import javax.sql.DataSource

/**
 * Walking a delegation tree downwards.
 *
 * ── WHY THIS IS ITS OWN CLASS ───────────────────────────────────────────────
 * `parent_run_id` points UP. Every question the runtime asked of it before was
 * "who is my parent" — a single hop, answered by a column read. Cancellation is
 * the first question that goes the other way, and it goes all the way down.
 *
 * Separated from [RunProcessor] because that class needs a Redis heartbeat, a
 * workflow runtime and a lease manager to exist at all, and none of them have
 * anything to do with a tree walk. Cancellation paths are the least tested part
 * of any runtime — this one hid a capacity leak — and a walk that can only be
 * exercised by standing up the whole worker is a walk that will not be
 * exercised.
 */
class RunSubtree(private val dataSource: DataSource) {

    private val log = logger()

    /**
     * Cancel every live descendant of [rootRunId], breadth-first.
     *
     * ── EACH CHILD GOES THROUGH THE NORMAL TERMINAL PATH ────────────────────
     * [terminate] is the caller's own terminal transition, not an UPDATE written
     * here. One statement over the subtree would be shorter and would leak
     * everything that transition does: the child's waits would stay open (the
     * sweeper polling a provider for a job nobody will collect), its budget
     * reservation would never settle back, its own children would survive it,
     * and its deliveries would never be queued.
     *
     * It is also what makes this safe to call twice. The caller's transition is
     * a compare-and-set that refuses a run which is already terminal, so a
     * redelivered cancellation cancels each descendant exactly once.
     *
     * Depth-bounded: a cycle in `parent_run_id` is something the schema cannot
     * express and a bug could still write, and without the bound it would be an
     * infinite loop holding a connection rather than an error somebody can see.
     *
     * @param terminate takes a child id, returns true if it won the transition.
     * @return how many descendants were cancelled.
     */
    fun cancelDescendants(
        rootRunId: UUID,
        terminate: (UUID) -> Boolean,
    ): Int {
        var cancelled = 0
        var frontier = listOf(rootRunId)
        var depth = 0

        while (frontier.isNotEmpty() && depth < MAX_DEPTH) {
            val children = liveChildrenOf(frontier)
            if (children.isEmpty()) break

            for (childId in children) {
                if (terminate(childId)) {
                    cancelled++
                    log.info("[subtree] cancelled delegated child [child={}, root={}]",
                        childId, rootRunId)
                }
            }
            frontier = children
            depth++
        }

        if (depth >= MAX_DEPTH) {
            log.error("[subtree] cancellation stopped at depth {} for run {} — the delegation " +
                "tree is deeper than the limit, or `parent_run_id` has a cycle",
                MAX_DEPTH, rootRunId)
        }
        return cancelled
    }

    /**
     * Children of any of [parents] that have not already finished.
     *
     * An explicit terminal list rather than `status = 'running'`: a child parked
     * on an approval, waiting on a timer or yielded between ticks is very much
     * still live, still holding its reservations, and still the thing this is
     * here to stop.
     */
    fun liveChildrenOf(parents: List<UUID>): List<UUID> = runCatching {
        dataSource.connection.use { conn ->
            conn.prepareStatement(
                """SELECT id FROM agent_runs
                    WHERE parent_run_id = ANY (?)
                      AND status NOT IN ('succeeded','failed','cancelled','timed_out',
                                         'ceiling_exceeded','enqueue_failed')"""
            ).use { st ->
                st.setArray(1, conn.createArrayOf("uuid", parents.toTypedArray()))
                st.executeQuery().use { rs ->
                    buildList { while (rs.next()) add(rs.getObject("id", UUID::class.java)) }
                }
            }
        }
    }.getOrElse {
        /*
         * Never throws. A cancellation that cannot read the tree must still
         * cancel the run itself — losing the parent as well as the children is
         * strictly worse than losing only the children, and the log line is what
         * tells an operator which runs to go and look at.
         */
        log.error("[subtree] could not read children for cancellation: {}", it.message)
        emptyList()
    }

    companion object {
        /**
         * How deep a cancellation will walk.
         *
         * Far past any real delegation tree — the team depth limit is single
         * digits — so this only ever fires on a cycle in `parent_run_id`.
         */
        const val MAX_DEPTH = 32
    }
}
