package com.vectorbea.api.routes

import com.vectorbea.api.api.context
import com.vectorbea.api.api.pathUUID
import com.vectorbea.api.api.requireField
import com.vectorbea.api.errors.ApiError
import com.vectorbea.api.http.Request
import com.vectorbea.api.http.Response
import com.vectorbea.api.http.Router
import com.vectorbea.api.http.mapper
import com.vectorbea.worker.durable.wait.SignalStore
import com.vectorbea.worker.durable.wait.WaitStore
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
    /**
     * The delivery itself — append, resolve, wake, rate-limit.
     *
     * Shared with `RunIngress`, whose `join` deduplication policy performs the
     * same delivery from a completely different entry point. This route is the
     * HTTP shape around it and nothing more.
     */
    private val delivery: com.vectorbea.api.signals.SignalDelivery,
) {

    fun register(router: Router) {
        router.post("/api/runs/:id/signals", ::send)
        router.post("/api/runs/:id/guidance", ::guidance)
        router.get("/api/runs/:id/signals", ::list)
        router.get("/api/runs/:id/waits", ::listWaits)
    }

    private data class GuidanceBody(
        /** What to tell the agent. One or two sentences of correction. */
        val text: String? = null,
        /**
         * Which agent, when a run has several.
         *
         * Omitted, the guidance goes to every agent in the run — the right
         * default for "stop, the database is the primary", and the wrong one for
         * a note meant for one member of a team, which is why it can be named.
         */
        val agent: String? = null,
        /** Makes a retried POST the same guidance rather than a second one. */
        val dedupeKey: String? = null,
    )

    /**
     * Say something to a running agent.
     *
     * ── A SIGNAL, WEARING A NAME PEOPLE WILL FIND ────────────────────
     * Identical in every durable respect to `POST /api/runs/:id/signals` with
     * `{"name": "guidance"}`, and deliberately so: the storage, ordering,
     * deduplication, rate limit and workspace scoping are the signal system's,
     * because a second delivery path for human text would be a second thing to
     * get wrong. What this adds is discoverability — nobody looking for "how do
     * I tell a running agent something" searches for `signals`.
     *
     * The agent takes delivery at its next iteration boundary, not immediately:
     * it may be mid-call to a provider, and interrupting that would abandon
     * tokens already paid for.
     */
    private fun guidance(req: Request): Response {
        val ctx = req.context()
        val runId = req.pathUUID("id")
        val body = req.bodyAs<GuidanceBody>()

        val text = requireField(body.text, "text").trim()
        if (text.isEmpty() || text.length > MAX_GUIDANCE_CHARS) {
            throw ApiError.ValidationError(
                "`text` must be between 1 and $MAX_GUIDANCE_CHARS characters. Guidance is a " +
                    "correction to a running agent, not a document — put anything longer " +
                    "somewhere the agent can fetch it and tell it where."
            )
        }
        if (body.agent != null && (body.agent.isBlank() || body.agent.length > MAX_NAME_LENGTH)) {
            throw ApiError.ValidationError(
                "`agent` names one agent in the run. Leave it out to reach all of them."
            )
        }

        val environmentId = ctx.environmentId
            ?: environmentOf(runId, ctx.workspaceId)
            ?: throw ApiError.NotFound("Run")

        /* `guidance:<agent>` is what the loop matches on its own name; plain
           `guidance` reaches every agent in the run. One convention, read in one
           place — see `AgentBrainRunner.isGuidanceSignal`. */
        val name = if (body.agent != null) "guidance:${body.agent.trim()}" else "guidance"

        val outcome = delivery.deliver(
            runId = runId,
            workspaceId = ctx.workspaceId,
            environmentId = environmentId,
            name = name,
            payloadJson = mapper.writeValueAsString(mapOf("text" to text)),
            sentByUserId = req.principal?.appUserId,
            sentByApiKeyId = req.apiKeyId,
            source = if (req.apiKeyId != null) "api_key" else "user",
            dedupeKey = body.dedupeKey,
        )

        return when (val result = outcome.result) {
            is SignalStore.SendResult.RunNotFound -> throw ApiError.NotFound("Run")

            is SignalStore.SendResult.RunTerminal -> throw ApiError.Conflict(
                "This run has already finished (${result.status}), so there is no agent left " +
                    "to tell. Start a new run with this in its input."
            )

            is SignalStore.SendResult.Duplicate -> Response.ok(mapOf(
                "accepted" to true,
                "duplicate" to true,
                "signalId" to result.signal.id.toString(),
                "message" to "This guidance was already accepted under the same dedupeKey.",
            ))

            is SignalStore.SendResult.Accepted -> Response.accepted(mapOf(
                "accepted" to true,
                "signalId" to result.signal.id.toString(),
                "sequence" to result.signal.sequence,
                "message" to "The agent will read this at its next iteration. It is not " +
                    "interrupted mid-call.",
            ))
        }
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

        val environmentId = ctx.environmentId
            ?: environmentOf(runId, ctx.workspaceId)
            ?: throw ApiError.NotFound("Run")

        val outcome = delivery.deliver(
            runId = runId,
            workspaceId = ctx.workspaceId,
            environmentId = environmentId,
            name = name,
            payloadJson = payloadJson,
            sentByUserId = req.principal?.appUserId,
            sentByApiKeyId = req.apiKeyId,
            source = if (req.apiKeyId != null) "api_key" else "user",
            dedupeKey = body.dedupeKey,
        )

        return when (val result = outcome.result) {
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
                val resolvedWaitId = outcome.resolvedWaitId
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

    // ── Helpers ──────────────────────────────────────────────────────

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

        /** Mirrors `AgentBrainRunner.MAX_GUIDANCE_CHARS`, which caps it again on read. */
        const val MAX_GUIDANCE_CHARS = 2_000

        /** 64 KB. A signal says something happened; it is not a transport. */
        const val MAX_PAYLOAD_BYTES = 64 * 1024

    }
}
