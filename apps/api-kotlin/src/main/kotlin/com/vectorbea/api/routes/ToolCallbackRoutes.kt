package com.vectorbea.api.routes

import com.fasterxml.jackson.databind.JsonNode
import com.vectorbea.api.errors.ApiError
import com.vectorbea.api.http.Request
import com.vectorbea.api.http.Response
import com.vectorbea.api.http.Router
import com.vectorbea.api.http.mapper
import com.vectorbea.api.queue.WorkflowQueue
import com.vectorbea.api.rate.RateLimitResult
import com.vectorbea.api.rate.RateLimiter
import com.vectorbea.worker.durable.wait.RunWait
import com.vectorbea.worker.durable.wait.WaitStore
import com.vectorbea.api.queue.JobType
import com.vectorbea.api.queue.WorkflowRunJob
import org.slf4j.LoggerFactory
import javax.sql.DataSource

/**
 * Where a provider says it has finished.
 *
 * ── THE TOKEN IS THE AUTHENTICATION, AND IT HAS TO BE ───────────────────────
 * The caller is a video-generation service, or a batch system, or somebody
 * else's workflow engine. It has no session, no API key, and no workspace — and
 * it never will. So the URL carries an unguessable token that names exactly one
 * wait, and the wait carries the workspace that scopes everything after.
 *
 * The token is `HMAC(server key, wait_key)`, so it is:
 *   · unguessable without the server key;
 *   · RECOMPUTABLE, which a random token would not be — the step that submitted
 *     re-executes on resume and has to recognise the URL it already gave out;
 *   · addressed to one wait, so a leaked token compromises one job's completion
 *     and nothing else.
 *
 * This route is deliberately outside the authenticated router. It must be.
 *
 * ── AND A DUPLICATE DELIVERY IS NOT AN ERROR ────────────────────────────────
 * Webhook senders retry. `WaitStore.resolve` is a compare-and-set on
 * `status = 'waiting'`, so the second delivery updates zero rows — and this
 * answers 200 anyway, saying it was already resolved. Answering 4xx would make a
 * well-behaved sender retry harder and eventually alert somebody about a
 * completion that was received perfectly.
 */
class ToolCallbackRoutes(
    private val dataSource: DataSource,
    private val waits: WaitStore,
    private val queue: WorkflowQueue?,
    private val rateLimiter: RateLimiter?,
) {
    private val log = LoggerFactory.getLogger(ToolCallbackRoutes::class.java)

    fun register(router: Router) {
        router.post("/api/tool-callbacks/:token", ::receive)
    }

    private fun receive(req: Request): Response {
        val token = req.pathParam("token")
        if (token.length !in MIN_TOKEN_LENGTH..MAX_TOKEN_LENGTH) {
            /* Not a 404 with detail: a wrong-length token is not a near miss, and
               saying so would confirm the shape to somebody probing. */
            throw ApiError.NotFound("Callback")
        }

        /*
         * Rate-limited by TOKEN, before the lookup.
         *
         * The endpoint is unauthenticated, so the limit is what stops it being a
         * way to probe for valid tokens and a way to hammer the database. Keyed on
         * the token rather than the IP because a provider legitimately calls from
         * many addresses, and because a limit per token is exactly the bound that
         * matters: one job completes once.
         */
        rateLimiter?.check("callback:$token", MAX_PER_TOKEN_PER_MINUTE, 60)?.let { result ->
            if (result is RateLimitResult.Exceeded) {
                throw ApiError.TooManyRequests(
                    "Too many callbacks for this job.",
                    mapOf("retryAfterSeconds" to result.resetsInSeconds),
                )
            }
        }

        val wait = waits.findByCallbackToken(token)
            ?: throw ApiError.NotFound("Callback")

        val body: JsonNode = runCatching { mapper.readTree(req.body.ifBlank { "{}" }) }
            .getOrElse { throw ApiError.ValidationError("The callback body is not valid JSON.") }

        if (!wait.isWaiting) {
            /*
             * Already resolved, timed out, or the run was cancelled underneath it.
             * 200, not 409: the sender did nothing wrong, and a well-behaved one
             * would retry a 4xx until it alerted somebody about a completion that
             * was received correctly the first time.
             */
            log.info("[callback] duplicate or late delivery [wait={}, status={}, run={}]",
                wait.id, wait.status.wire, wait.runId)
            return Response.ok(
                mapOf(
                    "accepted" to true,
                    "duplicate" to true,
                    "status" to wait.status.wire,
                    "message" to "This job's completion was already recorded (${wait.status.wire}). " +
                        "Nothing was applied twice.",
                )
            )
        }

        val rules = callbackRulesOf(wait)
        val verdict = verdictOf(body, rules)

        val resolution = when (verdict) {
            Verdict.COMPLETED -> RunWait.Resolution.COMPLETED
            Verdict.FAILED -> RunWait.Resolution.FAILED
            Verdict.STILL_WORKING ->
                /*
                 * A progress ping, not a completion. Providers send these, and
                 * treating one as a completion would resume the run with a partial
                 * result — worse than ignoring it, because it looks like success.
                 */
                return Response.ok(
                    mapOf(
                        "accepted" to true,
                        "resolved" to false,
                        "message" to "Recorded as progress. The run stays parked until a " +
                            "terminal status arrives or the wait times out.",
                    )
                )
        }

        val payload = if (verdict == Verdict.COMPLETED) {
            mapper.writeValueAsString(
                rules.resultPath?.let { atPath(body, it) } ?: body
            )
        } else {
            val message = rules.errorPath?.let { atPath(body, it)?.asText() }
                ?: body.path("error").asText("").ifBlank { "The provider reported a failure." }
            mapper.writeValueAsString(mapOf("error" to message.take(2_000)))
        }

        if (!waits.resolve(wait.id, resolution, payload, "callback")) {
            /* Lost a race with a poll or a concurrent redelivery. Same answer as
               the already-resolved branch above, for the same reason. */
            return Response.ok(
                mapOf("accepted" to true, "duplicate" to true,
                      "message" to "This job's completion was already recorded.")
            )
        }

        val waitedMs = java.time.Duration.between(wait.createdAt, java.time.Instant.now()).toMillis()
        waits.recordWaitedTime(wait.runId, waitedMs)
        writeEvent(wait, verdict, waitedMs)

        /*
         * Best-effort, and covered. The wait is durably resolved, so a lost
         * enqueue is what `ResumeReconciler`'s `wait_resolved` arm exists for —
         * the same durable-state-then-best-effort-enqueue shape the reconciler was
         * written after four other paths got wrong.
         */
        runCatching {
            queue?.enqueue(resumeJobFor(wait, "callback"))
        }.onFailure {
            log.error("[callback] resume enqueue failed run={} — the reconciler will backstop: {}",
                wait.runId, it.message)
        }

        log.info("[callback] resolved wait={} run={} verdict={} after={}ms",
            wait.id, wait.runId, verdict, waitedMs)

        return Response.ok(
            mapOf(
                "accepted" to true,
                "resolved" to true,
                "outcome" to resolution.wire,
                "message" to "Recorded. The run is being resumed.",
            )
        )
    }

    // ── Reading the provider's verdict ───────────────────────────────────────

    private enum class Verdict { COMPLETED, FAILED, STILL_WORKING }

    private data class Rules(
        val statusPath: String?,
        val completedValues: List<String>,
        val failedValues: List<String>,
        val resultPath: String?,
        val errorPath: String?,
    )

    /**
     * The rules for reading this provider's callback, stored on the wait.
     *
     * Defaults matter here: a provider that posts a bare result object with no
     * status field is common, and `statusPath = null` means "any delivery is a
     * completion" — which is right for exactly that shape, and is why the field
     * is nullable rather than defaulted to `"status"`.
     */
    private fun callbackRulesOf(wait: RunWait): Rules {
        val meta = runCatching {
            dataSource.connection.use { conn ->
                conn.prepareStatement("SELECT metadata_json FROM run_waits WHERE id = ?")
                    .use { st ->
                        st.setObject(1, wait.id)
                        st.executeQuery().use { rs ->
                            mapper.readTree(if (rs.next()) rs.getString(1) else "{}")
                        }
                    }
            }
        }.getOrNull()

        val cb = meta?.get("callback")
        return Rules(
            statusPath = cb?.get("statusPath")?.asText()?.takeIf { it.isNotBlank() },
            completedValues = cb?.get("completedValues")?.map { it.asText().lowercase() }
                ?.takeIf { it.isNotEmpty() }
                ?: listOf("succeeded", "completed", "success", "done", "finished"),
            failedValues = cb?.get("failedValues")?.map { it.asText().lowercase() }
                ?.takeIf { it.isNotEmpty() }
                ?: listOf("failed", "error", "cancelled", "canceled"),
            resultPath = cb?.get("resultPath")?.asText()?.takeIf { it.isNotBlank() },
            errorPath = cb?.get("errorPath")?.asText()?.takeIf { it.isNotBlank() },
        )
    }

    private fun verdictOf(body: JsonNode, rules: Rules): Verdict {
        val path = rules.statusPath ?: return Verdict.COMPLETED
        val raw = atPath(body, path) ?: return Verdict.STILL_WORKING
        val value = (if (raw.isTextual) raw.asText() else raw.toString()).lowercase().trim()
        return when {
            rules.completedValues.any { it == value } -> Verdict.COMPLETED
            rules.failedValues.any { it == value } -> Verdict.FAILED
            raw.isBoolean && raw.asBoolean() -> Verdict.COMPLETED
            /* An unrecognised status is progress, not failure. Providers invent
               states — `processing`, `uploading`, `queued` — and failing on one
               would fail a job that is going perfectly well. */
            else -> Verdict.STILL_WORKING
        }
    }

    private fun atPath(root: JsonNode?, path: String): JsonNode? {
        var cur = root ?: return null
        for (segment in path.removePrefix("$.").removePrefix("$").split('.')) {
            if (segment.isEmpty()) continue
            cur = cur.get(segment) ?: return null
        }
        return cur.takeUnless { it.isNull }
    }

    /**
     * The resume job for a run woken by a callback.
     *
     * Reads the run's own execution class rather than deriving one: a
     * continuation belongs on the stream the run is already on, and defaulting to
     * the system pool would take a slot that timer resumes and cancellations need.
     */
    private fun resumeJobFor(wait: RunWait, reason: String): WorkflowRunJob {
        val details = dataSource.connection.use { conn ->
            conn.prepareStatement(
                "SELECT workflow_id, workflow_version_id, execution_class " +
                    "FROM agent_runs WHERE id = ?"
            ).use { st ->
                st.setObject(1, wait.runId)
                st.executeQuery().use { rs ->
                    if (rs.next()) Triple(
                        rs.getString("workflow_id"),
                        rs.getString("workflow_version_id"),
                        rs.getString("execution_class"),
                    ) else Triple(wait.runId.toString(), wait.runId.toString(), null)
                }
            }
        }
        return WorkflowRunJob(
            runId = wait.runId.toString(),
            workspaceId = wait.workspaceId.toString(),
            environmentId = wait.environmentId.toString(),
            workflowId = details.first,
            workflowVersionId = details.second,
            jobType = JobType.RESUME_RUN,
            reason = reason,
            executionClass = com.vectorbea.api.queue.ExecutionClass.fromWire(details.third),
        )
    }

    private fun writeEvent(wait: RunWait, verdict: Verdict, waitedMs: Long) = runCatching {
        dataSource.connection.use { conn ->
            conn.prepareStatement(
                """INSERT INTO run_events
                     (run_id, workspace_id, environment_id, type, status, source,
                      title, summary, step_id, duration_ms)
                   VALUES (?,?,?,?,?,?,?,?,?,?)"""
            ).use { st ->
                st.setObject(1, wait.runId)
                st.setObject(2, wait.workspaceId)
                st.setObject(3, wait.environmentId)
                st.setString(4, "RUN_WAIT_RESOLVED")
                st.setString(5, if (verdict == Verdict.COMPLETED) "success" else "failed")
                st.setString(6, "callback")
                st.setString(7, "Provider reported completion")
                st.setString(8, "The provider called back after ${waitedMs / 1000}s" +
                    (wait.externalRef?.let { " (job $it)" } ?: "") + ".")
                st.setString(9, wait.nodeId)
                st.setLong(10, waitedMs)
                st.executeUpdate()
            }
        }
    }.onFailure {
        /* The resolution is already durable and the run is being resumed. A
           missing timeline row is a degraded trace, never a lost completion —
           invariant 7, and the reason this is not allowed to throw. */
        log.warn("[callback] could not write event for run {}: {}", wait.runId, it.message)
    }

    private companion object {
        /** `cb_` plus 48 hex characters. Anything else is not one of ours. */
        const val MIN_TOKEN_LENGTH = 20
        const val MAX_TOKEN_LENGTH = 128

        val MAX_PER_TOKEN_PER_MINUTE: Long =
            System.getenv("CALLBACK_RATE_PER_TOKEN_PER_MIN")?.toLongOrNull() ?: 60
    }
}
