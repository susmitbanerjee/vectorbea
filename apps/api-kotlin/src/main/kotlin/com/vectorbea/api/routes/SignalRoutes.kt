package com.vectorbea.api.routes

import com.vectorbea.api.api.context
import com.vectorbea.api.api.pathUUID
import com.vectorbea.api.api.requireField
import com.vectorbea.api.errors.ApiError
import com.vectorbea.api.http.Request
import com.vectorbea.api.http.Response
import com.vectorbea.api.http.Router
import com.vectorbea.api.http.mapper
import com.vectorbea.api.queue.WorkflowQueue
import com.vectorbea.api.rate.RateLimitResult
import com.vectorbea.api.rate.RateLimiter
import com.vectorbea.worker.durable.wait.SignalStore
import com.vectorbea.worker.durable.wait.WaitStore
import com.vectorbea.api.queue.JobType
import com.vectorbea.api.queue.WorkflowRunJob
import java.util.UUID
import javax.sql.DataSource

/**
 * Deliver information into a running run.
 *
 * ── THE CASE ────────────────────────────────────────────────────────────────
 * An incident automation run is active and a second alert arrives for the same
 * service. Before this, a run took input at start and never again — so the only
 * options were to start a second run that knows nothing about the first, or to
 * drop the alert.
 *
 * ── THE FOUR OUTCOMES, EACH WITH ITS OWN RESPONSE ───────────────────────────
 *   · The run is PARKED on a matching wait → resolved and resumed now. 202.
 *   · The run is RUNNING → stored; delivered at its next step boundary. 202.
 *   · The run is TERMINAL → rejected. 409, with the status, because "your alert
 *     reached nothing" is information the sender needs and a 202 would hide it.
 *   · The same `dedupeKey` was already accepted → 200 with the original. A
 *     retrying alerting system must not deliver one alert twice.
 */
class SignalRoutes(
    private val dataSource: DataSource,
    private val signals: SignalStore,
    private val waits: WaitStore,
    private val queue: WorkflowQueue?,
    private val rateLimiter: RateLimiter?,
) {

    fun register(router: Router) {
        router.post("/api/runs/:id/signals", ::send)
        router.get("/api/runs/:id/signals", ::list)
        router.get("/api/runs/:id/waits", ::listWaits)
    }

    private data class SendBody(
        val name: String?,
        val payload: Map<String, Any?>? = null,
        /** Makes a retried POST the same signal rather than a second one. */
        val dedupeKey: String? = null,
    )

    private fun send(req: Request): Response {
        val ctx = req.context()
        val runId = req.pathUUID("id")
        val body = req.bodyAs<SendBody>()

        val name = requireField(body.name, "name").trim()
        if (name.isEmpty() || name.length > MAX_NAME_LENGTH) {
            throw ApiError.ValidationError(
                "`name` must be between 1 and $MAX_NAME_LENGTH characters. It is how a " +
                    "waiting run recognises this signal."
            )
        }

        val payloadJson = mapper.writeValueAsString(body.payload ?: emptyMap<String, Any?>())
        if (payloadJson.toByteArray().size > MAX_PAYLOAD_BYTES) {
            throw ApiError.ValidationError(
                "The payload is over ${MAX_PAYLOAD_BYTES / 1024} KB. A signal carries the " +
                    "fact that something happened; put the bulk somewhere the run can fetch " +
                    "it and send the reference."
            )
        }

        enforceRateLimit(ctx.workspaceId, runId)

        val environmentId = ctx.environmentId
            ?: environmentOf(runId, ctx.workspaceId)
            ?: throw ApiError.NotFound("Run")

        return when (val result = signals.send(
            runId = runId,
            workspaceId = ctx.workspaceId,
            environmentId = environmentId,
            name = name,
            payloadJson = payloadJson,
            sentByUserId = req.principal?.appUserId,
            sentByApiKeyId = req.apiKeyId,
            source = if (req.apiKeyId != null) "api_key" else "user",
            dedupeKey = body.dedupeKey?.take(200),
        )) {
            is SignalStore.SendResult.RunNotFound -> throw ApiError.NotFound("Run")

            is SignalStore.SendResult.RunTerminal -> throw ApiError.Conflict(
                "This run has already finished (${result.status}), so it cannot receive a " +
                    "signal. Start a new run, or send the signal to one that is still active."
            )

            is SignalStore.SendResult.Duplicate -> Response.ok(
                mapOf(
                    "accepted" to true,
                    "duplicate" to true,
                    "signalId" to result.signal.id.toString(),
                    "sequence" to result.signal.sequence,
                    "message" to "This signal was already accepted under the same dedupeKey. " +
                        "Nothing was delivered twice.",
                )
            )

            is SignalStore.SendResult.Accepted -> {
                val resolvedWaitId = wakeIfParked(runId, ctx.workspaceId, name, result.signal)
                Response.accepted(
                    mapOf(
                        "accepted" to true,
                        "signalId" to result.signal.id.toString(),
                        "sequence" to result.signal.sequence,
                        "resolvedWaitId" to resolvedWaitId?.toString(),
                        "message" to if (resolvedWaitId != null)
                            "The run was waiting for '$name' and is being resumed now."
                        else
                            "Stored. The run will take delivery at its next step boundary.",
                    )
                )
            }
        }
    }

    /**
     * Resolve a matching wait, and wake the run.
     *
     * ── THE CAS DECIDES, NOT THIS CODE ──────────────────────────────────────
     * `waitsForSignal` can return several — a run may hold more than one wait on
     * the same name across branches — and `resolve` is a compare-and-set on
     * `status = 'waiting'`. The first one that wins is the one this signal
     * satisfies; the rest are untouched and keep waiting for their own. Two
     * signals racing to satisfy one wait is the same story from the other side:
     * one wins, one is stored for the step boundary.
     *
     * The signal is marked CONSUMED only when a wait actually resolved. Otherwise
     * it stays pending and is delivered at the next step boundary, which is what
     * the run needs — and is why a signal sent to a running run is never lost.
     */
    private fun wakeIfParked(
        runId: UUID,
        workspaceId: UUID,
        name: String,
        signal: SignalStore.Signal,
    ): UUID? {
        val candidates = runCatching { waits.waitsForSignal(runId, name) }.getOrDefault(emptyList())
        for (wait in candidates) {
            val payload = mapper.writeValueAsString(
                mapOf("signal" to name, "sequence" to signal.sequence,
                      "payload" to runCatching { mapper.readValue(signal.payloadJson, Any::class.java) }
                          .getOrDefault(emptyMap<String, Any>()))
            )
            if (!waits.resolve(
                    wait.id,
                    com.vectorbea.worker.durable.wait.RunWait.Resolution.SIGNAL,
                    payload,
                    "signal:$name",
                )
            ) continue

            signals.consume(listOf(signal.id), wait.id)

            /*
             * Best-effort, and covered. The wait is already durably resolved, so a
             * lost enqueue is exactly the shape `ResumeReconciler`'s
             * `wait_resolved` arm exists for — the same failure the reconciler was
             * built after four other paths got it wrong.
             */
            runCatching {
                queue?.enqueue(resumeJobFor(wait, workspaceId, "signal"))
            }
            return wait.id
        }
        return null
    }

    // ── Reading ──────────────────────────────────────────────────────────────

    private fun list(req: Request): Response {
        val ctx = req.context()
        val runId = req.pathUUID("id")
        environmentOf(runId, ctx.workspaceId) ?: throw ApiError.NotFound("Run")

        val rows = dataSource.let { ds ->
            ds.connection.use { conn ->
                conn.prepareStatement(
                    """SELECT id, sequence, name, payload_json, created_at, consumed_at, source
                         FROM run_signals
                        WHERE run_id = ? AND workspace_id = ?
                        ORDER BY sequence"""
                ).use { st ->
                    st.setObject(1, runId); st.setObject(2, ctx.workspaceId)
                    st.executeQuery().use { rs ->
                        buildList {
                            while (rs.next()) add(
                                mapOf(
                                    "id" to rs.getString("id"),
                                    "sequence" to rs.getInt("sequence"),
                                    "name" to rs.getString("name"),
                                    "payload" to runCatching {
                                        mapper.readValue(rs.getString("payload_json"), Any::class.java)
                                    }.getOrDefault(emptyMap<String, Any>()),
                                    "createdAt" to rs.getTimestamp("created_at").toInstant().toString(),
                                    "consumedAt" to rs.getTimestamp("consumed_at")?.toInstant()?.toString(),
                                    "source" to rs.getString("source"),
                                )
                            )
                        }
                    }
                }
            }
        }
        return Response.ok(mapOf("items" to rows, "total" to rows.size))
    }

    /** What this run is waiting for, and how long is left. Reads the V065 view. */
    private fun listWaits(req: Request): Response {
        val ctx = req.context()
        val runId = req.pathUUID("id")

        val rows = dataSource.connection.use { conn ->
            conn.prepareStatement(
                """SELECT wait_id, kind, label, node_id, signal_name, external_ref,
                          created_at, timeout_at, waiting_ms, expires_in_ms, poll_attempts
                     FROM run_active_waits
                    WHERE run_id = ? AND workspace_id = ?
                    ORDER BY created_at"""
            ).use { st ->
                st.setObject(1, runId); st.setObject(2, ctx.workspaceId)
                st.executeQuery().use { rs ->
                    buildList {
                        while (rs.next()) add(
                            mapOf(
                                "waitId" to rs.getString("wait_id"),
                                "kind" to rs.getString("kind"),
                                "label" to rs.getString("label"),
                                "nodeId" to rs.getString("node_id"),
                                "signalName" to rs.getString("signal_name"),
                                "externalRef" to rs.getString("external_ref"),
                                "createdAt" to rs.getTimestamp("created_at").toInstant().toString(),
                                "timeoutAt" to rs.getTimestamp("timeout_at")?.toInstant()?.toString(),
                                "waitingMs" to rs.getDouble("waiting_ms").toLong(),
                                "expiresInMs" to rs.getObject("expires_in_ms")
                                    ?.let { (it as Number).toLong() },
                                "pollAttempts" to rs.getInt("poll_attempts"),
                            )
                        )
                    }
                }
            }
        }
        return Response.ok(mapOf("items" to rows, "total" to rows.size))
    }

    // ── Helpers ──────────────────────────────────────────────────────────────

    /**
     * Bound the stream.
     *
     * ── AN UNBOUNDED SIGNAL STREAM IS A DENIAL OF SERVICE AGAINST ONE RUN ───
     * Every signal to a parked run resolves a wait and enqueues a resume, and
     * every signal to a running run is read at its next step boundary. A caller
     * in a loop could therefore make one run consume a worker permanently while
     * making no progress — and the run is a tenant's own, so a global limit would
     * not catch it.
     *
     * The limit is therefore PER RUN as well as per workspace: a busy workspace
     * with a hundred runs is fine, and a hundred signals into one run is not.
     */
    private fun enforceRateLimit(workspaceId: UUID, runId: UUID) {
        val limiter = rateLimiter ?: return
        listOf(
            "signal:run:$runId" to PER_RUN_PER_MINUTE,
            "signal:ws:$workspaceId" to PER_WORKSPACE_PER_MINUTE,
        ).forEach { (key, max) ->
            val result = limiter.check(key, max, 60)
            if (result is RateLimitResult.Exceeded) {
                throw ApiError.TooManyRequests(
                    if (key.startsWith("signal:run:"))
                        "This run has received $max signals in the last minute, which is its " +
                            "limit. A run that spends its time taking delivery makes no progress."
                    else
                        "This workspace has sent $max signals in the last minute, which is its limit.",
                    mapOf("retryAfterSeconds" to result.resetsInSeconds, "limit" to max),
                )
            }
        }
    }

    /**
     * The resume job for a run woken by a signal.
     *
     * `executionClass` is READ from the run rather than re-derived: a
     * continuation belongs on the same stream as the run it continues, and
     * defaulting it to the system pool would take a slot that timer resumes and
     * cancellations need to stay unstarvable. `ApprovalRoutes` makes exactly this
     * argument for exactly this reason.
     */
    private fun resumeJobFor(
        wait: com.vectorbea.worker.durable.wait.RunWait,
        workspaceId: UUID,
        reason: String,
    ): WorkflowRunJob {
        val details = runDetails(wait.runId, workspaceId)
        return WorkflowRunJob(
            runId = wait.runId.toString(),
            workspaceId = workspaceId.toString(),
            environmentId = wait.environmentId.toString(),
            workflowId = details.first,
            workflowVersionId = details.second,
            jobType = JobType.RESUME_RUN,
            reason = reason,
            executionClass = com.vectorbea.api.queue.ExecutionClass.fromWire(details.third),
        )
    }

    private fun runDetails(runId: UUID, workspaceId: UUID): Triple<String, String, String?> =
        dataSource.connection.use { conn ->
            conn.prepareStatement(
                "SELECT workflow_id, workflow_version_id, execution_class " +
                    "FROM agent_runs WHERE id = ? AND workspace_id = ?"
            ).use { st ->
                st.setObject(1, runId); st.setObject(2, workspaceId)
                st.executeQuery().use { rs ->
                    if (rs.next()) Triple(
                        rs.getString("workflow_id"),
                        rs.getString("workflow_version_id"),
                        rs.getString("execution_class"),
                    ) else Triple(runId.toString(), runId.toString(), null)
                }
            }
        }

    private fun environmentOf(runId: UUID, workspaceId: UUID): UUID? =
        dataSource.connection.use { conn ->
            conn.prepareStatement(
                "SELECT environment_id FROM agent_runs WHERE id = ? AND workspace_id = ?"
            ).use { st ->
                st.setObject(1, runId); st.setObject(2, workspaceId)
                st.executeQuery().use { rs ->
                    if (rs.next()) UUID.fromString(rs.getString("environment_id")) else null
                }
            }
        }

    private companion object {
        const val MAX_NAME_LENGTH = 200

        /** 64 KB. A signal says something happened; it is not a transport. */
        const val MAX_PAYLOAD_BYTES = 64 * 1024

        val PER_RUN_PER_MINUTE: Long =
            System.getenv("SIGNAL_RATE_PER_RUN_PER_MIN")?.toLongOrNull() ?: 60
        val PER_WORKSPACE_PER_MINUTE: Long =
            System.getenv("SIGNAL_RATE_PER_WORKSPACE_PER_MIN")?.toLongOrNull() ?: 600
    }
}
