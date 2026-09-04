package com.vectorbea.api.routes

import com.vectorbea.api.api.context
import com.vectorbea.api.api.pathUUID
import com.vectorbea.api.http.Request
import com.vectorbea.api.http.Response
import com.vectorbea.api.http.Router
import org.slf4j.LoggerFactory
import java.util.UUID
import javax.sql.DataSource

/**
 * `GET /api/runs/:id/chain` — a continuation chain as ONE logical run.
 *
 * WHY THIS EXISTS
 * ---------------
 * `run_continuations` / `continuation_sequence` implement Temporal's
 * history-truncation pattern: when a run's event history grows past what is
 * practical to carry, it is closed and a fresh run continues from its state. That
 * is a genuinely sophisticated thing to have and almost nobody in the competitive
 * set does.
 *
 * And the Runs page shows it as two unrelated rows.
 *
 * A user who ran one workflow sees two runs, each with a fraction of the duration,
 * a fraction of the tokens, and a fraction of the cost — and no indication they
 * are the same piece of work. The sophistication reads as a bug. This endpoint is
 * the difference between owning the feature and being embarrassed by it.
 *
 * WHAT "ONE LOGICAL RUN" MEANS HERE
 * ---------------------------------
 * - **Duration** is wall-clock across the whole chain: first start to last
 *   completion. NOT the sum of segment durations, which would omit the handover
 *   gaps and under-report what the user actually waited.
 * - **Tokens and cost** ARE summed. Every segment's spend is real spend and the
 *   user is billed for all of it.
 * - **The Ribbon spans the chain**, with an explicit boundary entry between
 *   segments so the reader can see where the handover happened rather than
 *   wondering why node numbering restarts.
 * - **Status** is the LAST segment's status: a chain whose final segment failed
 *   is a failed run, whatever the earlier segments did.
 */
class ContinuationRoutes(private val dataSource: DataSource) {

    private val log = LoggerFactory.getLogger(ContinuationRoutes::class.java)

    fun register(router: Router) {
        router.get("/api/runs/:id/chain") { req -> chain(req) }
    }

    private data class Segment(
        val runId: UUID,
        val sequence: Int,
        val status: String,
        val startedAt: String?,
        val completedAt: String?,
        val durationMs: Long?,
        val tokens: Int,
        val costCents: Int,
        val nodeTotal: Int?,
        val nodeCommitted: Int,
        val ribbon: String,
        val reason: String?,
    )

    private fun chain(req: Request): Response {
        val ctx = req.context()
        val id = req.pathUUID("id")

        return try {
            dataSource.connection.use { conn ->
                val segments = loadChain(conn, id, ctx.workspaceId)
                if (segments.isEmpty()) {
                    return Response(status = 404,
                        body = """{"error":"Run not found"}""",
                        headers = mapOf("Content-Type" to "application/json"))
                }

                val first = segments.first()
                val last = segments.last()

                // Wall clock across the chain, not the sum of segments. The gap
                // between a segment completing and its successor starting is time
                // the user waited, and omitting it under-reports the run.
                val wallClockMs = wallClock(conn, segments)

                Response.ok(mapOf(
                    "logicalRunId" to first.runId.toString(),
                    "requestedRunId" to id.toString(),
                    "segmentCount" to segments.size,
                    "isContinued" to (segments.size > 1),
                    // The last segment's status is the chain's status: a chain whose
                    // final segment failed is a failed run.
                    "status" to last.status,
                    "startedAt" to first.startedAt,
                    "completedAt" to last.completedAt,
                    "totals" to mapOf(
                        "durationMs" to wallClockMs,
                        // Summed: every segment's spend is real and billed.
                        "tokens" to segments.sumOf { it.tokens },
                        "costCents" to segments.sumOf { it.costCents },
                        "nodesCommitted" to segments.sumOf { it.nodeCommitted },
                        "nodesTotal" to segments.sumOf { it.nodeTotal ?: 0 },
                        // Stated so the UI can show "8 of 12 committed across 3
                        // segments" rather than implying one flat graph.
                        "executionSegments" to segments.size,
                    ),
                    "ribbon" to spanningRibbon(segments),
                    "segments" to segments.map { s ->
                        mapOf(
                            "runId" to s.runId.toString(),
                            "sequence" to s.sequence,
                            "status" to s.status,
                            "startedAt" to s.startedAt,
                            "completedAt" to s.completedAt,
                            "durationMs" to s.durationMs,
                            "tokens" to s.tokens,
                            "costCents" to s.costCents,
                            "continuationReason" to s.reason,
                        )
                    },
                ))
            }
        } catch (e: Exception) {
            log.error("[chain] failed for run {}", id, e)
            Response(status = 500,
                body = """{"error":"Could not load the continuation chain"}""",
                headers = mapOf("Content-Type" to "application/json"))
        }
    }

    /**
     * Every segment of the chain the given run belongs to, in order.
     *
     * Walks in BOTH directions from the requested run: a user may open any segment
     * — most often the newest, because that is what the Runs page sorts to the top
     * — and must see the whole chain either way. A forward-only walk would show
     * someone who opened segment 3 a "complete" run missing its first two thirds.
     *
     * The recursive CTE terminates on `run_continuations` being a DAG in practice;
     * the depth cap is belt and braces against a cycle introduced by a bug, since
     * an uncapped recursive CTE against a cycle does not error, it hangs.
     */
    private fun loadChain(conn: java.sql.Connection, runId: UUID, workspaceId: UUID): List<Segment> =
        conn.prepareStatement(CHAIN_SQL).use { stmt ->
            stmt.setObject(1, runId)
            stmt.setObject(2, workspaceId)
            stmt.executeQuery().use { rs ->
                val out = mutableListOf<Segment>()
                while (rs.next()) {
                    out += Segment(
                        runId = UUID.fromString(rs.getString("id")),
                        sequence = rs.getInt("continuation_sequence"),
                        status = rs.getString("status"),
                        startedAt = rs.getTimestamp("started_at")?.toInstant()?.toString(),
                        completedAt = rs.getTimestamp("completed_at")?.toInstant()?.toString(),
                        durationMs = rs.getObject("duration_ms") as? Long,
                        tokens = rs.getInt("tokens_used"),
                        costCents = rs.getInt("cost_cents"),
                        nodeTotal = rs.getObject("node_total") as? Int,
                        nodeCommitted = rs.getInt("node_committed"),
                        ribbon = rs.getString("ribbon_json") ?: "[]",
                        reason = rs.getString("continuation_reason"),
                    )
                }
                out
            }
        }

    /**
     * First start to last completion.
     *
     * Falls back to the sum of segment durations when timestamps are missing —
     * which is the wrong number, but a wrong number is more useful here than a
     * null, and it is only reachable for a chain still in flight.
     */
    private fun wallClock(conn: java.sql.Connection, segments: List<Segment>): Long? {
        val start = segments.firstOrNull { it.startedAt != null }?.startedAt
        val end = segments.lastOrNull { it.completedAt != null }?.completedAt
        if (start == null || end == null) return segments.mapNotNull { it.durationMs }.sum()
        return runCatching {
            java.time.Duration.between(
                java.time.Instant.parse(start), java.time.Instant.parse(end)).toMillis()
        }.getOrElse { segments.mapNotNull { it.durationMs }.sum() }
    }

    /**
     * One ribbon spanning the chain, with a visible boundary between segments.
     *
     * The boundary entry is what stops the Ribbon lying. Without it, segment 2's
     * nodes appear as a continuation of segment 1's numbering and the reader
     * cannot tell why the graph appears to restart — the handover is invisible
     * exactly where it most needs to be visible.
     */
    private fun spanningRibbon(segments: List<Segment>): String = buildString {
        append('[')
        var firstEntry = true
        segments.forEachIndexed { i, seg ->
            if (i > 0) {
                if (!firstEntry) append(',')
                append("""{"n":"__continuation_${seg.sequence}","s":"boundary"""")
                seg.reason?.let { append(""","reason":"${it.replace("\"", "\\\"")}"""") }
                append('}')
                firstEntry = false
            }
            val body = seg.ribbon.trim().removePrefix("[").removeSuffix("]").trim()
            if (body.isNotEmpty()) {
                if (!firstEntry) append(',')
                append(body)
                firstEntry = false
            }
        }
        append(']')
    }

    private companion object {
        /**
         * The whole chain, walked in both directions.
         *
         * `anchor` finds the requested run; `up` follows old_run_id backwards to
         * the chain's origin; `down` follows new_run_id forwards to its end. The
         * union is every segment, ordered by continuation_sequence.
         */
        val CHAIN_SQL = """
            WITH RECURSIVE anchor AS (
                SELECT id, 0 AS depth FROM agent_runs WHERE id = ? AND workspace_id = ?
            ),
            up AS (
                SELECT a.id, 0 AS depth FROM anchor a
                UNION
                SELECT c.old_run_id, u.depth + 1
                  FROM up u JOIN run_continuations c ON c.new_run_id = u.id
                 WHERE u.depth < 100
            ),
            down AS (
                SELECT a.id, 0 AS depth FROM anchor a
                UNION
                SELECT c.new_run_id, d.depth + 1
                  FROM down d JOIN run_continuations c ON c.old_run_id = d.id
                 WHERE d.depth < 100
            ),
            chain AS (
                SELECT id FROM up UNION SELECT id FROM down
            )
            SELECT r.id, r.status, r.started_at, r.completed_at, r.duration_ms,
                   COALESCE(r.tokens_used, 0)   AS tokens_used,
                   COALESCE(r.cost_cents, 0)    AS cost_cents,
                   r.node_total, r.node_committed, r.ribbon_json::text AS ribbon_json,
                   r.continuation_sequence,
                   -- Why THIS segment exists: the reason recorded on the
                   -- continuation that produced it, not the one it produced.
                   (SELECT c.reason FROM run_continuations c WHERE c.new_run_id = r.id LIMIT 1)
                       AS continuation_reason
              FROM agent_runs r
             WHERE r.id IN (SELECT id FROM chain)
             ORDER BY r.continuation_sequence, r.created_at
        """.trimIndent()
    }
}
