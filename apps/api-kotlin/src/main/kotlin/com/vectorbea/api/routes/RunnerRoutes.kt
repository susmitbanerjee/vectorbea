package com.vectorbea.api.routes

import com.vectorbea.api.errors.ApiError
import com.vectorbea.api.http.Request
import com.vectorbea.api.http.Response
import com.vectorbea.api.http.Router
import com.vectorbea.api.http.mapper
import com.vectorbea.api.repository.AppendEventRequest
import com.vectorbea.api.repository.RunEventRepository
import com.vectorbea.api.runner.RunnerReport
import com.vectorbea.api.runner.RunnerStore
import org.slf4j.LoggerFactory
import java.util.UUID
import javax.sql.DataSource

/**
 * The three verbs a self-hosted runner speaks, and the perimeter it speaks them
 * across.
 *
 * ── THE DIRECTION OF THE CONNECTION IS THE DESIGN ───────────────────────────
 * Every request here is initiated by the customer's network, outbound, over
 * TLS. We never connect to them, we hold no credential for anything inside
 * their perimeter, and their firewall needs no inbound rule. That is not a
 * convenience — it is the shape that passes the procurement review that made
 * them ask for a self-hosted runner in the first place, and any design where we
 * reach in fails that review however well it is secured.
 *
 * ── AND THE REPORT ENDPOINT IS WHERE THE PROMISE IS KEPT ────────────────────
 * `RunnerReport` filters everything a runner sends down to an allow-list of
 * metadata. It runs HERE, at the receiving end, not in the runner — a runner is
 * software the customer deploys and may be an old build, a patched build, or a
 * build configured wrong, and a guarantee that depends on the remote side
 * having redacted correctly is a hope with a version number.
 *
 * ── AUTHENTICATION IS NOT THE ORDINARY MIDDLEWARE ───────────────────────────
 * These routes carry a runner token, not a user session or an API key, and they
 * resolve their own workspace from the token's pool rather than from a request
 * context. Registered on the same router; scoped by the row.
 */
class RunnerRoutes(
    private val dataSource: DataSource,
    private val runners: RunnerStore,
    private val events: RunEventRepository,
    private val queue: com.vectorbea.api.queue.WorkflowQueue? = null,
) {

    private val log = LoggerFactory.getLogger(RunnerRoutes::class.java)

    fun register(router: Router) {
        router.post("/api/runner/lease", ::lease)
        router.post("/api/runner/heartbeat", ::heartbeat)
        router.post("/api/runner/events", ::reportEvents)
        router.post("/api/runner/report", ::report)
    }

    /**
     * The bearer token, and the pool it speaks for.
     *
     * Read from `Authorization: Bearer vbr_…`. A runner token in a query string
     * would end up in an access log on both sides of the connection, and this
     * one lives on a machine whose logs we cannot reach to redact.
     */
    private fun authed(req: Request): RunnerStore.Authenticated {
        val header = req.header("authorization")
            ?: throw ApiError.Unauthorized("A runner token is required.")
        val token = header.removePrefix("Bearer ").removePrefix("bearer ").trim()
        return runners.authenticate(token)
    }

    private data class LeaseBody(
        val runnerName: String? = null,
        val version: String? = null,
        val host: String? = null,
        val capabilities: Map<String, Any?> = emptyMap(),
        val leaseSeconds: Long? = null,
    )

    /**
     * "Anything for my pool?"
     *
     * Returns 204 when there is nothing, which is the overwhelmingly common
     * answer and must be cheap: a runner polls this every couple of seconds for
     * the life of the process, and a body full of nothing is bandwidth on
     * somebody else's egress bill.
     */
    private fun lease(req: Request): Response {
        val auth = authed(req)
        val body = if (req.body.isBlank()) LeaseBody() else req.bodyAs<LeaseBody>()

        val runnerId = runners.registerRunner(
            pool = auth.pool,
            runnerName = body.runnerName?.takeIf { it.isNotBlank() } ?: "unnamed-runner",
            version = body.version,
            reportedHost = body.host,
            capabilitiesJson = runCatching { mapper.writeValueAsString(body.capabilities) }
                .getOrDefault("{}"),
        )

        val leaseSeconds = (body.leaseSeconds ?: DEFAULT_LEASE_SECONDS)
            .coerceIn(RunnerStore.MIN_LEASE_SECONDS, RunnerStore.MAX_LEASE_SECONDS)

        val leased = runners.lease(auth.pool, runnerId, leaseSeconds)
            ?: return Response(204, "", emptyMap())

        log.info("[runner] leased run {} to {} in pool {}", leased.runId, runnerId, auth.pool.name)
        return Response.ok(mapOf(
            "runId" to leased.runId.toString(),
            "runnerId" to runnerId.toString(),
            "workspaceId" to leased.workspaceId.toString(),
            "environmentId" to leased.environmentId.toString(),
            "workflowId" to leased.workflowId.toString(),
            "workflowVersionId" to leased.workflowVersionId.toString(),
            "executionClass" to leased.executionClass,
            /*
             * The run's input travels OUT to the runner, which is the one
             * direction that is not a leak: the customer supplied it, and it is
             * going back to their own network. Nothing about it comes back.
             */
            "inputJson" to leased.inputJson,
            "leaseExpiresAt" to leased.expiresAt.toString(),
            "leaseSeconds" to leaseSeconds,
            "payloadPolicy" to auth.pool.payloadPolicy.wire,
        ))
    }

    private data class HeartbeatBody(
        val runId: String? = null,
        val runnerId: String? = null,
        val leaseSeconds: Long? = null,
    )

    /**
     * "Still working on it."
     *
     * A `false` answer means the lease is gone — reclaimed on expiry, or the run
     * was cancelled — and the runner's correct response is to STOP, because
     * another runner in the pool may already have taken the work. Said in the
     * body rather than as a 404, because "your lease expired" is a normal
     * outcome of a slow step and not an error worth alerting on.
     */
    private fun heartbeat(req: Request): Response {
        authed(req)
        val body = req.bodyAs<HeartbeatBody>()
        val runId = uuid(body.runId, "runId")
        val runnerId = uuid(body.runnerId, "runnerId")
        val seconds = (body.leaseSeconds ?: DEFAULT_LEASE_SECONDS)
            .coerceIn(RunnerStore.MIN_LEASE_SECONDS, RunnerStore.MAX_LEASE_SECONDS)

        val held = runners.heartbeat(runId, runnerId, seconds)
        return Response.ok(mapOf(
            "held" to held,
            "message" to if (held) "Lease extended."
            else "This lease is no longer yours — stop work on this run. It was either " +
                "reclaimed after a missed heartbeat, or the run was cancelled.",
        ))
    }

    private data class EventsBody(
        val runId: String? = null,
        val runnerId: String? = null,
        val events: List<Map<String, Any?>> = emptyList(),
    )

    /**
     * Progress, as metadata.
     *
     * ── WHAT ARRIVES HERE, AND WHAT IS LEFT AT THE DOOR ─────────────────────
     * A runner reports the SHAPE of what happened — which node, what status, how
     * long, how many tokens — and `RunnerReport.filterEvent` keeps only the
     * fields on the allow-list. Titles and summaries are dropped even though
     * they look harmless: a summary is generated from the thing it summarises,
     * and "Tool returned 3 rows: alice@example.com, …" is a summary.
     *
     * The run's timeline is therefore thinner than a platform run's, and the UI
     * says so rather than looking incomplete.
     */
    private fun reportEvents(req: Request): Response {
        val auth = authed(req)
        val body = req.bodyAs<EventsBody>()
        val runId = uuid(body.runId, "runId")
        val runnerId = uuid(body.runnerId, "runnerId")
        requireHolder(runId, runnerId)

        if (body.events.size > MAX_EVENTS_PER_REPORT) {
            throw ApiError.ValidationError(
                "At most $MAX_EVENTS_PER_REPORT events per report. Send them in batches; the " +
                    "sequence is preserved by the order they arrive in.")
        }

        val (workspaceId, environmentId) = runScope(runId)
            ?: throw ApiError.NotFound("Run")

        var droppedTotal = 0
        val droppedNames = LinkedHashSet<String>()

        for (raw in body.events) {
            val filtered = RunnerReport.filterEvent(raw, auth.pool.payloadPolicy)
            if (filtered.droppedPayload) {
                droppedTotal += filtered.dropped.size
                droppedNames += filtered.dropped
            }
            val type = (filtered.kept["type"] as? String)?.take(80) ?: continue
            val status = (filtered.kept["status"] as? String)?.take(40) ?: "running"

            runCatching {
                events.append(AppendEventRequest(
                    runId = runId,
                    workspaceId = workspaceId,
                    environmentId = environmentId,
                    type = type,
                    status = status,
                    /* Attributed to the pool, so a reader can tell at a glance
                       that this timeline came from outside and is thin on
                       purpose. */
                    source = "runner:${auth.pool.name}".take(80),
                    /*
                     * The title is OURS, built from the node id — which is the
                     * customer's own label, already in our database as part of
                     * the workflow version. The runner's title is dropped.
                     */
                    title = (filtered.kept["stepId"] as? String)?.let { "Step $it" } ?: type,
                    summary = null,
                ))
            }.onFailure { log.warn("[runner] event append failed for run {}: {}", runId, it.message) }
        }

        if (droppedTotal > 0) {
            /*
             * Names, never values — this line ends up in a search index, a
             * support ticket and a screenshot, and logging what was in the
             * dropped field would reproduce the leak inside the diagnostic for
             * the leak.
             *
             * Worth logging at all because it means a runner is TRYING to send
             * payloads: an old build, or one configured wrong. The guarantee
             * held, and somebody should know it was being relied on rather than
             * enforced.
             */
            log.warn("[runner] dropped {} payload field(s) from pool {} on run {}: {}",
                droppedTotal, auth.pool.name, runId, droppedNames.take(10))
        }

        return Response.ok(mapOf(
            "accepted" to body.events.size,
            "droppedFields" to droppedTotal,
            "policy" to auth.pool.payloadPolicy.wire,
        ))
    }

    private data class ReportBody(
        val runId: String? = null,
        val runnerId: String? = null,
        val status: String? = null,
        /** A classification, never a message — see [RunnerReport.explainWithheldFailure]. */
        val failureClassification: String? = null,
        val durationMs: Long? = null,
        val tokenCount: Int? = null,
        val estimatedCost: Double? = null,
        val error: String? = null,
    )

    /**
     * The run is over.
     *
     * ── A FAILED RUN WITH NOTHING TO SAY IS THE SCREEN TO AVOID ─────────────
     * Under `strict` there is no error message, and the tempting answer is to
     * store nothing. That produces a failed run whose detail panel is empty,
     * which reads as a broken product rather than as a deliberate policy — the
     * exact failure the acceptance criterion names. So the classification the
     * runner sends becomes a sentence saying what happened, why there is no
     * more, and how to change that.
     */
    private fun report(req: Request): Response {
        val auth = authed(req)
        val body = req.bodyAs<ReportBody>()
        val runId = uuid(body.runId, "runId")
        val runnerId = uuid(body.runnerId, "runnerId")
        requireHolder(runId, runnerId)

        val status = body.status?.lowercase()?.trim()
        if (status !in TERMINAL_STATUSES) {
            throw ApiError.ValidationError(
                "`status` must be one of ${TERMINAL_STATUSES.joinToString(", ")}.")
        }

        val filtered = RunnerReport.filterCompletion(
            mapOf(
                "status" to status, "durationMs" to body.durationMs,
                "tokenCount" to body.tokenCount, "estimatedCost" to body.estimatedCost,
                "error" to body.error,
            ),
            auth.pool.payloadPolicy,
        )
        if (filtered.droppedPayload) {
            log.warn("[runner] dropped {} field(s) from a completion report on run {}: {}",
                filtered.dropped.size, runId, filtered.dropped.take(5))
        }

        /*
         * The error text, when the policy permits one; otherwise a sentence
         * explaining the absence. Never nothing.
         */
        val errorJson = if (status == "succeeded") null else {
            val message = (filtered.kept["error"] as? String)
                ?: RunnerReport.explainWithheldFailure(body.failureClassification, auth.pool.name)
            mapper.writeValueAsString(mapOf(
                "reason" to message,
                "classification" to body.failureClassification?.take(60),
                "payloadsWithheld" to (filtered.kept["error"] == null),
                "runnerPool" to auth.pool.name,
            ))
        }

        val updated = dataSource.connection.use { c ->
            c.prepareStatement(
                """UPDATE agent_runs
                      SET status = ?, completed_at = now(), updated_at = now(),
                          duration_ms = COALESCE(?, duration_ms),
                          token_count = COALESCE(?, token_count),
                          estimated_cost = COALESCE(?, estimated_cost),
                          error_json = COALESCE(?::jsonb, error_json),
                          payloads_withheld = TRUE
                    WHERE id = ?
                      AND status NOT IN ('succeeded','failed','cancelled','timed_out',
                                         'ceiling_exceeded','enqueue_failed')"""
            ).use { st ->
                st.setString(1, status)
                if (body.durationMs == null) st.setNull(2, java.sql.Types.BIGINT)
                else st.setLong(2, body.durationMs)
                if (body.tokenCount == null) st.setNull(3, java.sql.Types.INTEGER)
                else st.setInt(3, body.tokenCount)
                if (body.estimatedCost == null) st.setNull(4, java.sql.Types.NUMERIC)
                else st.setBigDecimal(4, java.math.BigDecimal.valueOf(body.estimatedCost))
                st.setString(5, errorJson)
                st.setObject(6, runId)
                st.executeUpdate() > 0
            }
        }

        runners.releaseLease(runId)

        if (!updated) {
            /* Already terminal. A redelivered report, or a run cancelled while
               the runner was finishing. Not an error: the CAS refused it, which
               is the CAS doing its job. */
            return Response.ok(mapOf(
                "accepted" to false,
                "message" to "This run had already reached a terminal state, so the report was " +
                    "ignored. Nothing was overwritten.",
            ))
        }

        log.info("[runner] run {} reported {} by pool {}", runId, status, auth.pool.name)
        return Response.ok(mapOf("accepted" to true, "status" to status))
    }

    // ── Helpers ──────────────────────────────────────────────────────────────

    /**
     * The reporting runner must be the one holding the lease.
     *
     * Without this, any runner in the pool could report on any run — including
     * one that had been reclaimed and given to a different runner, whose result
     * would then be overwritten by a straggler.
     */
    private fun requireHolder(runId: UUID, runnerId: UUID) {
        val holder = runners.holderOf(runId)
            ?: throw ApiError.Conflict(
                "There is no lease on this run. It was reclaimed after a missed heartbeat, or " +
                    "the run has already finished — stop work on it.")
        if (holder != runnerId) throw ApiError.Conflict(
            "This run is leased to a different runner. Stop work on it: another runner in the " +
                "pool took it over after this lease expired.")
    }

    private fun runScope(runId: UUID): Pair<UUID, UUID>? = dataSource.connection.use { c ->
        c.prepareStatement("SELECT workspace_id, environment_id FROM agent_runs WHERE id = ?")
            .use { st ->
                st.setObject(1, runId)
                st.executeQuery().use { rs ->
                    if (!rs.next()) null
                    else rs.getObject(1, UUID::class.java) to rs.getObject(2, UUID::class.java)
                }
            }
    }

    private fun uuid(value: String?, field: String): UUID =
        runCatching { UUID.fromString(value) }.getOrNull()
            ?: throw ApiError.ValidationError("`$field` must be a UUID.")

    private companion object {
        const val DEFAULT_LEASE_SECONDS = 60L
        const val MAX_EVENTS_PER_REPORT = 200

        val TERMINAL_STATUSES = setOf(
            "succeeded", "failed", "cancelled", "timed_out", "ceiling_exceeded",
        )
    }
}
