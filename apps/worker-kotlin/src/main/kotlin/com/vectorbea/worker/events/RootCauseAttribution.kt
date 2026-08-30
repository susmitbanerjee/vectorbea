package com.vectorbea.worker.events

import com.vectorbea.worker.logging.logger
import java.util.UUID
import javax.sql.DataSource

/**
 * Decides which of a failed run's error spans is the one that actually broke.
 *
 * A failed run has many `error` spans and almost all of them are propagation: the
 * tool failed, so the step failed, so the tick failed, so the run failed. Four red
 * rows, one cause. Showing all of them is how a user is asked to do the triage the
 * system should have done.
 *
 * THE ALGORITHM, AND WHY IT IS "DEEPEST WITH NO ERROR CHILD"
 * ---------------------------------------------------------
 * An error span with an error child did not originate the failure — it inherited
 * it. So walking down through error children and stopping where there are none
 * lands on the span that failed on its own account. Everything above it is the
 * blast radius.
 *
 * COMPUTED ONCE, AT TERMINALISATION
 * ---------------------------------
 * Written to `is_root_cause` when the run reaches a terminal state, not recomputed
 * per page view. A trace is read far more often than it is written, the answer
 * cannot change once the run is over, and the tree walk is O(spans) — doing it per
 * request would put a graph traversal on the read path of every debug page load.
 */
class RootCauseAttribution(private val dataSource: DataSource?) {
    private val log = logger()

    /** One span, reduced to what the walk needs. */
    private data class Node(
        val spanId: UUID,
        val parentSpanId: UUID?,
        val kind: String,
        val name: String,
        val status: String,
        val depth: Int,
    )

    data class Result(
        val rootCauseSpanIds: List<UUID>,
        /** >1 when concurrent siblings failed together under a parallel or a join. */
        val concurrentGroupSize: Int,
    ) {
        val label: String? get() =
            if (concurrentGroupSize > 1) "$concurrentGroupSize concurrent failures" else null
    }

    /**
     * Attribute the failure and persist the flag. Returns null when there is
     * nothing to attribute.
     *
     * Never throws: attribution is observability, and a run that has already
     * finished must not be affected by our inability to explain it.
     */
    fun attribute(runId: UUID): Result? {
        val ds = dataSource ?: return null
        return try {
            val spans = load(ds, runId)
            if (spans.isEmpty()) return null

            val errors = spans.filter { it.status == "error" }
            if (errors.isEmpty()) return null

            val errorIds = errors.map { it.spanId }.toSet()
            val childrenOf = spans.groupBy { it.parentSpanId }

            /*
             * Step 3 of the algorithm, expressed directly: an error span with no
             * error child is a leaf of the FAILURE tree, even when it has healthy
             * children of its own. A tool call that failed after two successful
             * retries is still where the failure originated.
             */
            val failureLeaves = errors.filter { span ->
                childrenOf[span.spanId].orEmpty().none { it.spanId in errorIds }
            }
            if (failureLeaves.isEmpty()) {
                /* Every error span has an error child — only possible if the error
                   spans form a cycle, which the tree cannot contain. Recorded rather
                   than silently returning nothing. */
                log.warn("[root-cause] no failure leaf among {} error span(s) run={}",
                    errors.size, runId)
                return null
            }

            // Step 3: the DEEPEST such span.
            val deepest = failureLeaves.maxOf { it.depth }
            val atDeepest = failureLeaves.filter { it.depth == deepest }

            /*
             * Step 5: siblings that failed together. Two workers failing under one
             * parallel branch is ONE event with two symptoms, not two root causes to
             * be triaged separately — so they are flagged as a group and labelled.
             *
             * Grouped by shared parent rather than by depth alone: two spans at the
             * same depth under different parents are unrelated failures that merely
             * happen to be equally deep.
             */
            val group = atDeepest
                .groupBy { it.parentSpanId }
                .maxByOrNull { it.value.size }
                ?.value
                ?: atDeepest

            persist(ds, runId, group.map { it.spanId })

            log.info("[root-cause] run={} attributed to {} span(s) at depth {} ({})",
                runId, group.size, deepest, group.first().name)

            Result(group.map { it.spanId }, group.size)
        } catch (e: Exception) {
            log.warn("[root-cause] attribution failed run={}: {}", runId, e.message)
            null
        }
    }

    /**
     * Load the run's spans and give each one a depth.
     *
     * Depth is computed here rather than stored: it is derivable from
     * `parent_span_id`, and a stored depth is one more thing that can disagree with
     * the tree it describes.
     */
    private fun load(ds: DataSource, runId: UUID): List<Node> {
        val raw = mutableListOf<Node>()
        ds.connection.use { conn ->
            conn.prepareStatement(
                """SELECT span_id, parent_span_id, kind, name, status
                     FROM run_spans WHERE run_id = ?"""
            ).use { st ->
                st.setObject(1, runId)
                st.executeQuery().use { rs ->
                    while (rs.next()) raw.add(Node(
                        spanId = rs.getObject("span_id", UUID::class.java),
                        parentSpanId = rs.getObject("parent_span_id", UUID::class.java),
                        kind = rs.getString("kind"),
                        name = rs.getString("name"),
                        status = rs.getString("status"),
                        depth = 0,
                    ))
                }
            }
        }
        if (raw.isEmpty()) return emptyList()

        val byId = raw.associateBy { it.spanId }
        /* Iterative, not recursive: a deep handoff chain in P6 could otherwise
           overflow the stack on a pathological trace. Bounded by the span count so a
           malformed parent link cannot loop forever. */
        fun depthOf(n: Node): Int {
            var d = 0
            var cur = n.parentSpanId
            val seen = HashSet<UUID>()
            while (cur != null && d < raw.size && seen.add(cur)) {
                d++
                cur = byId[cur]?.parentSpanId
            }
            return d
        }
        return raw.map { it.copy(depth = depthOf(it)) }
    }

    private fun persist(ds: DataSource, runId: UUID, spanIds: List<UUID>) {
        ds.connection.use { conn ->
            /* Clear first: a re-attribution after a retry must not leave the previous
               attempt's flag standing beside the new one. */
            conn.prepareStatement(
                "UPDATE run_spans SET is_root_cause = false WHERE run_id = ? AND is_root_cause"
            ).use { it.setObject(1, runId); it.executeUpdate() }

            conn.prepareStatement(
                "UPDATE run_spans SET is_root_cause = true WHERE run_id = ? AND span_id = ?"
            ).use { st ->
                spanIds.forEach { id ->
                    st.setObject(1, runId); st.setObject(2, id); st.addBatch()
                }
                st.executeBatch()
            }
        }
    }
}
