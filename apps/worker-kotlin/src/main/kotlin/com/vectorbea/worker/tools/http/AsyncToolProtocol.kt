package com.vectorbea.worker.tools.http

import com.fasterxml.jackson.databind.JsonNode
import com.fasterxml.jackson.databind.ObjectMapper
import com.vectorbea.worker.durable.wait.RunWait
import com.vectorbea.worker.durable.wait.WaitKind
import com.vectorbea.worker.durable.wait.WaitStore
import com.vectorbea.worker.logging.logger
import com.vectorbea.worker.tools.httpspec.HttpToolSpec
import java.util.UUID

/**
 * The half of an async tool call that is not an HTTP request.
 *
 * ── SUBMIT, PARK, RESUME ────────────────────────────────────────────────────
 * The resolver still sends one ordinary request — the submit — through the same
 * assembler, auth, transport and retry as any other call. Everything specific to
 * "this takes six minutes" is here:
 *
 *   1. Before submitting, look for THIS STEP'S wait. On a resume it already
 *      exists, and if it is resolved the answer is read out of it and the
 *      provider is never contacted again. That check is first, and it is what
 *      makes a six-minute job survive a worker restart without being submitted
 *      twice.
 *   2. Open the wait BEFORE submitting, so the callback URL exists to be sent.
 *   3. Submit. Extract the handle. Attach it to the wait.
 *   4. Park.
 *
 * ── WHY THE WAIT IS OPENED BEFORE THE SUBMIT ────────────────────────────────
 * The callback URL has to be in the submit request, and the URL contains the
 * wait's token. Opening afterwards would mean either a second request to tell
 * the provider where to call, or a random token minted after the fact that a
 * re-executed step could not recompute.
 *
 * It also fails in the right direction. A wait opened for a submit that then
 * fails is a parked run with a deadline — recoverable, visible, and it times out
 * with a legible reason. A submit that succeeded with no wait to attach it to is
 * a six-minute job nobody is waiting for and nobody knows about.
 */
internal object AsyncToolProtocol {

    private val log = logger()
    private val mapper = ObjectMapper()

    /** What the protocol decided before the resolver sends anything. */
    sealed interface Precheck {
        /** No wait yet, or one still waiting with no handle. Submit. */
        data class Submit(val wait: RunWait, val callbackUrl: String?) : Precheck

        /**
         * The wait resolved while the run was parked. The answer is here; do NOT
         * contact the provider. This is the resume path, and it is why a
         * six-minute render survives a restart without being re-submitted.
         */
        data class AlreadyResolved(val wait: RunWait) : Precheck

        /** Submitted already and still waiting. Park again without re-submitting. */
        data class StillWaiting(val wait: RunWait) : Precheck

        data class Unavailable(val why: String) : Precheck
    }

    /**
     * Find or open this step's wait, and decide what the resolver should do.
     *
     * [attemptGroup] and [nodeId] are the key material — never an iteration
     * number, never a timestamp (invariant 2). That is what makes step 1 above
     * work: the re-executed step computes the same key and finds its own wait.
     */
    fun precheck(
        spec: HttpToolSpec,
        async: HttpToolSpec.AsyncSpec,
        waits: WaitStore,
        workspaceId: UUID,
        environmentId: UUID,
        runId: UUID,
        workflowId: UUID?,
        nodeId: String,
        attemptGroup: Int,
        toolLabel: String,
        callbackBaseUrl: String?,
    ): Precheck {
        val key = RunWait.keyFor(runId, nodeId, attemptGroup)

        waits.findByKey(runId, key)?.let { existing ->
            return when {
                !existing.isWaiting -> Precheck.AlreadyResolved(existing)
                /* Waiting AND already carrying a handle: the submit went through
                   on a previous tick and the provider is working. Parking again
                   without re-submitting is the whole point — this is the branch
                   that stops a redelivered message starting a second render. */
                existing.externalRef != null -> Precheck.StillWaiting(existing)
                else -> Precheck.Submit(existing, callbackUrlFor(existing, callbackBaseUrl))
            }
        }

        return try {
            val opened = waits.open(
                WaitStore.OpenRequest(
                    workspaceId = workspaceId,
                    environmentId = environmentId,
                    runId = runId,
                    workflowId = workflowId,
                    nodeId = nodeId,
                    attemptGroup = attemptGroup,
                    kind = WaitKind.ASYNC_TOOL,
                    label = toolLabel,
                    /* The poll URL is templated with the handle, which does not
                       exist yet — it is filled in by `attachHandle` after submit.
                       The INTERVAL is set now so the sweeper picks the wait up
                       even if the submit response never yields a handle. */
                    pollIntervalMs = async.poll?.intervalMs?.toInt(),
                    pollMaxAttempts = async.poll?.maxAttempts,
                    timeoutMs = async.timeoutMs,
                    withCallback = async.callback != null,
                    metadata = buildMap {
                        put("tool", toolLabel)
                        put("protocol", "async")
                        /*
                         * ── THE CALLBACK ROUTE READS ITS RULES FROM HERE ────
                         * `POST /api/tool-callbacks/:token` is in the API, has no
                         * access to the tool's spec, and cannot look one up: the
                         * wait is all it has. Without these fields it fell back to
                         * "any delivery is a completion", so a provider's progress
                         * ping — `{"status":"processing","percent":40}` — resolved
                         * the wait and resumed the run with a half-finished render
                         * presented as the answer. A `{"status":"failed"}` was
                         * recorded as a success by the same route.
                         *
                         * Carried at OPEN time rather than looked up later,
                         * because the spec can be re-versioned while a six-minute
                         * job is in flight and the delivery must be read by the
                         * rules the submit was made under.
                         */
                        async.callback?.let { cb ->
                            put("callback", buildMap {
                                cb.statusPath?.let { put("statusPath", it) }
                                put("completedValues", cb.completedValues)
                                put("failedValues", cb.failedValues)
                                cb.resultPath?.let { put("resultPath", it) }
                                cb.errorPath?.let { put("errorPath", it) }
                            })
                        }
                    },
                )
            )
            Precheck.Submit(opened.wait, callbackUrlFor(opened.wait, callbackBaseUrl))
        } catch (e: Exception) {
            log.error("[async-tool] could not open wait [run={}, node={}]: {}", runId, nodeId, e.message)
            Precheck.Unavailable(e.message?.take(200) ?: e.javaClass.simpleName)
        }
    }

    /**
     * The URL a provider calls back on.
     *
     * Null when no token was minted — which happens only when the process has no
     * callback secret configured. The resolver then falls back to polling, and
     * refuses the call outright if the tool declared no poll: publishing a
     * guessable callback URL would be worse than failing loudly.
     */
    fun callbackUrlFor(wait: RunWait, baseUrl: String?): String? {
        val token = wait.callbackToken ?: return null
        val base = baseUrl?.trimEnd('/') ?: return null
        return "$base/api/tool-callbacks/$token"
    }

    /** Pull the provider's job handle out of the submit response. */
    fun handleFrom(body: JsonNode, async: HttpToolSpec.AsyncSpec): String? =
        ResponseExtractor.atPath(body, async.handlePath)
            ?.let { if (it.isTextual) it.asText() else it.toString() }
            ?.takeIf { it.isNotBlank() && it != "null" }

    /** What a poll or a callback body says happened. */
    enum class Verdict { COMPLETED, FAILED, STILL_WORKING }

    /**
     * Read a status out of a body.
     *
     * ── AN UNRECOGNISED STATUS IS "STILL WORKING", NOT "FAILED" ─────────────
     * Providers invent states — `queued`, `processing`, `starting`, `uploading`.
     * Treating an unknown one as a failure would fail a render that is going
     * perfectly well, on its first poll, and would do it for every provider whose
     * vocabulary we have not enumerated. Treating it as still-working costs at
     * most one wait's timeout, which is bounded and legible.
     */
    fun verdictOf(
        body: JsonNode,
        statusPath: String?,
        completed: List<String>,
        failed: List<String>,
    ): Verdict {
        if (statusPath == null) return Verdict.COMPLETED
        val raw = ResponseExtractor.atPath(body, statusPath) ?: return Verdict.STILL_WORKING
        val value = (if (raw.isTextual) raw.asText() else raw.toString()).lowercase().trim()
        return when {
            completed.any { it.equals(value, ignoreCase = true) } -> Verdict.COMPLETED
            failed.any { it.equals(value, ignoreCase = true) } -> Verdict.FAILED
            /* A boolean `done: true` is the other common shape. */
            raw.isBoolean && raw.asBoolean() -> Verdict.COMPLETED
            else -> Verdict.STILL_WORKING
        }
    }

    /**
     * The result the run resumes with, taken out of a resolved wait.
     *
     * ── A FAILED JOB IS A FAILED NODE, NOT A FAILED WAIT ────────────────────
     * `resolution = FAILED` means the provider finished and said no. The wait did
     * its job perfectly. So the node fails with the provider's own message and
     * `retryable = false` — a render the provider rejected will be rejected again
     * — while `TIMEOUT` is retryable, because "nobody answered in time" can go
     * differently on a second attempt.
     */
    fun resultFrom(wait: RunWait): AsyncResult {
        val payload = runCatching { mapper.readTree(wait.resolutionJson ?: "{}") }
            .getOrDefault(mapper.createObjectNode())

        return when (wait.resolution) {
            RunWait.Resolution.COMPLETED, RunWait.Resolution.SIGNAL -> AsyncResult.Completed(payload)

            RunWait.Resolution.FAILED -> AsyncResult.Failed(
                message = payload.path("error").asText("")
                    .ifBlank { payload.path("message").asText("") }
                    .ifBlank { "The provider reported that the job failed." },
                retryable = false,
            )

            RunWait.Resolution.TIMEOUT -> AsyncResult.Failed(
                message = "This tool started work and nothing reported back within its " +
                    "time limit" +
                    (wait.externalRef?.let { " (job $it)" } ?: "") +
                    ". The job may still be running at the provider — check there before " +
                    "retrying, or raise the tool's async timeout.",
                /* Retryable: a provider that was slow once may not be slow twice,
                   and unlike a rejection this outcome carries no information about
                   whether the work can succeed. The message says to check first,
                   because a retry may duplicate a job that did finish. */
                retryable = true,
            )

            RunWait.Resolution.CANCELLED -> AsyncResult.Failed(
                message = "The run was cancelled while this tool was still working.",
                retryable = false,
            )

            null -> AsyncResult.Failed(
                message = "This tool's wait ended without recording an outcome.",
                retryable = true,
            )
        }
    }

    sealed interface AsyncResult {
        data class Completed(val payload: JsonNode) : AsyncResult
        data class Failed(val message: String, val retryable: Boolean) : AsyncResult
    }

    /**
     * Where a completion's result lives in the body the provider sent.
     *
     * Null [resultPath] means the whole body, which is right for a provider that
     * posts the finished object and wrong for one that wraps it — hence the
     * declared path.
     */
    fun payloadAt(body: JsonNode, resultPath: String?): JsonNode =
        if (resultPath == null) body else ResponseExtractor.atPath(body, resultPath) ?: body
}
