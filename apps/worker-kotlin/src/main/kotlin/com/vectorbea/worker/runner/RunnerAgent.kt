package com.vectorbea.worker.runner

import com.fasterxml.jackson.databind.ObjectMapper
import com.vectorbea.worker.logging.logger
import com.vectorbea.worker.net.OutboundHttp
import java.net.URI
import java.net.http.HttpRequest
import java.net.http.HttpResponse
import java.time.Duration
import java.util.UUID
import java.util.concurrent.atomic.AtomicBoolean

/**
 * The worker, deployed inside the customer's network.
 *
 * ── THE SAME COMPONENT, NOT A SECOND ONE ────────────────────────────────────
 * Everything below the lease is unchanged: the same `RunProcessor`, the same
 * `WorkflowRuntime`, the same executors, the same checkpoint and wait
 * primitives. Invariant 9 applies here as much as anywhere — a self-hosted
 * runner is a policy over the existing engine, and a second execution path
 * would be a second set of bugs that only enterprise customers would find.
 *
 * What changes is exactly one thing: WHERE WORK COMES FROM. A platform worker
 * reads a Redis stream or claims from Postgres. A runner cannot: both need
 * credentials for our datastores, reachable from their network, which is the
 * arrangement the procurement review that asked for a runner already rejected.
 * So it long-polls an HTTPS endpoint instead, outbound, and we hold nothing
 * that can reach in.
 *
 * ── IT NEEDS ITS OWN DATABASE, AND THAT IS THE POINT ────────────────────────
 * The runtime writes checkpoints, events, step outputs and waits to Postgres.
 * A runner's Postgres is THEIRS, inside their network, and that is where every
 * prompt and every tool result stays. What travels back to us is what
 * `RunnerReport` permits: status, timings, counts. Nothing else has anywhere to
 * go, because the reporting endpoint has no column for it.
 *
 * The trade is real and worth stating plainly: their runs are inspectable in
 * full only from inside their network. The Debug tab here shows the shape and
 * says why it cannot show more.
 */
class RunnerAgent(
    private val hubUrl: String,
    private val token: String,
    private val runnerName: String,
    private val version: String?,
    /**
     * Executes a leased run against the LOCAL database, exactly as a platform
     * worker would. Returns what may be reported back.
     */
    private val execute: (LeasedRun) -> Outcome,
    private val httpClient: java.net.http.HttpClient = OutboundHttp.client,
    private val pollIntervalMs: Long = 2_000,
    private val leaseSeconds: Long = 60,
) {

    private val log = logger()
    private val mapper = ObjectMapper()
    private val running = AtomicBoolean(false)
    private var thread: Thread? = null

    /** A run handed to this runner, with everything it needs to execute. */
    data class LeasedRun(
        val runId: UUID,
        val runnerId: UUID,
        val workspaceId: UUID,
        val environmentId: UUID,
        val workflowId: UUID,
        val workflowVersionId: UUID,
        val executionClass: String?,
        val inputJson: String,
    )

    /**
     * What the runner is willing to say about a finished run.
     *
     * ── EVERY FIELD IS A NUMBER OR AN ENUM, AND THAT IS DELIBERATE ──────────
     * There is no `output`, no `error message`, no `summary`. Not because the
     * endpoint would refuse them — it would, and does — but because a type that
     * cannot express a payload cannot accidentally carry one. The redaction is
     * enforced at the receiving end (`RunnerReport`) because a runner may be an
     * old build; this shape is the second wall, on the side we do control.
     */
    data class Outcome(
        val status: String,
        val durationMs: Long?,
        val tokenCount: Int?,
        val estimatedCost: Double?,
        /**
         * A CLASSIFICATION, never a message: `timeout`, `provider_error`,
         * `tool_error`, `validation`, `cancelled`, `ceiling`. The hub turns it
         * into a sentence so a failed run is never a blank panel.
         */
        val failureClassification: String? = null,
    )

    fun start() {
        if (!running.compareAndSet(false, true)) return
        thread = Thread(::loop, "runner-agent").apply { isDaemon = false; start() }
        log.info("[runner] agent started [hub={}, name={}]", redactHost(hubUrl), runnerName)
    }

    fun stop() {
        running.set(false)
        thread?.interrupt()
    }

    private fun loop() {
        while (running.get()) {
            val leased = try {
                lease()
            } catch (e: InterruptedException) {
                Thread.currentThread().interrupt(); return
            } catch (e: Exception) {
                /*
                 * The hub being unreachable is the ordinary condition here, not
                 * an exception: this process is behind a customer's egress proxy
                 * and their network will have bad minutes. Backing off and
                 * retrying is the correct behaviour; exiting would require a
                 * human in a datacentre we cannot see.
                 */
                log.warn("[runner] could not reach the hub: {} — retrying", e.message)
                sleep(pollIntervalMs * 5); continue
            }

            if (leased == null) { sleep(pollIntervalMs); continue }

            val heartbeat = startHeartbeat(leased)
            val outcome = try {
                execute(leased)
            } catch (e: Exception) {
                log.error("[runner] run {} failed locally: {}", leased.runId, e.javaClass.simpleName)
                /*
                 * The message is deliberately not carried. It is in this
                 * runner's own logs, inside the customer's network, which is
                 * where they asked for it to be.
                 */
                Outcome("failed", null, null, null, classify(e))
            } finally {
                heartbeat.interrupt()
            }

            runCatching { report(leased, outcome) }
                .onFailure {
                    /*
                     * The run finished; we just could not say so. The hub's lease
                     * sweep will return it to `queued` and another runner will
                     * take it — which re-executes it. That is at-least-once, and
                     * it is why every side effect goes through `SideEffectGuard`
                     * on this side too.
                     */
                    log.error("[runner] could not report run {}: {} — the hub will reclaim it",
                        leased.runId, it.message)
                }
        }
    }

    /** Extend the lease while a long step runs. A missed one returns the work. */
    private fun startHeartbeat(leased: LeasedRun): Thread =
        Thread({
            while (!Thread.currentThread().isInterrupted) {
                sleep(leaseSeconds * 1000 / 3)
                if (Thread.currentThread().isInterrupted) return@Thread
                val held = runCatching { heartbeat(leased) }.getOrDefault(true)
                if (!held) {
                    /*
                     * Somebody else owns this run now. Logged loudly because the
                     * local execution is still going and will produce a result
                     * nobody wants — the report will be refused by the holder
                     * check, which is the outcome we want, but an operator
                     * should know their runner lost a lease.
                     */
                    log.warn("[runner] lost the lease on run {} — it has been reclaimed",
                        leased.runId)
                    return@Thread
                }
            }
        }, "runner-heartbeat-${leased.runId}").apply { isDaemon = true; start() }

    // ── The protocol ─────────────────────────────────────────────────────────

    private fun lease(): LeasedRun? {
        val body = mapper.writeValueAsString(mapOf(
            "runnerName" to runnerName,
            "version" to version,
            "leaseSeconds" to leaseSeconds,
        ))
        val res = post("/api/runner/lease", body)
        if (res.statusCode() == 204) return null
        if (res.statusCode() !in 200..299) {
            throw IllegalStateException("lease refused: ${res.statusCode()}")
        }
        val node = mapper.readTree(res.body())
        return LeasedRun(
            runId = UUID.fromString(node.get("runId").asText()),
            runnerId = UUID.fromString(node.get("runnerId").asText()),
            workspaceId = UUID.fromString(node.get("workspaceId").asText()),
            environmentId = UUID.fromString(node.get("environmentId").asText()),
            workflowId = UUID.fromString(node.get("workflowId").asText()),
            workflowVersionId = UUID.fromString(node.get("workflowVersionId").asText()),
            executionClass = node.get("executionClass")?.takeIf { !it.isNull }?.asText(),
            inputJson = node.get("inputJson")?.asText() ?: "{}",
        )
    }

    private fun heartbeat(leased: LeasedRun): Boolean {
        val res = post("/api/runner/heartbeat", mapper.writeValueAsString(mapOf(
            "runId" to leased.runId.toString(),
            "runnerId" to leased.runnerId.toString(),
            "leaseSeconds" to leaseSeconds,
        )))
        if (res.statusCode() !in 200..299) return false
        return mapper.readTree(res.body()).get("held")?.asBoolean() ?: false
    }

    private fun report(leased: LeasedRun, outcome: Outcome) {
        val res = post("/api/runner/report", mapper.writeValueAsString(mapOf(
            "runId" to leased.runId.toString(),
            "runnerId" to leased.runnerId.toString(),
            "status" to outcome.status,
            "durationMs" to outcome.durationMs,
            "tokenCount" to outcome.tokenCount,
            "estimatedCost" to outcome.estimatedCost,
            "failureClassification" to outcome.failureClassification,
        )))
        if (res.statusCode() !in 200..299) {
            throw IllegalStateException("report refused: ${res.statusCode()}")
        }
    }

    private fun post(path: String, body: String): HttpResponse<String> {
        val req = HttpRequest.newBuilder(URI.create(hubUrl.trimEnd('/') + path))
            .header("Authorization", "Bearer $token")
            .header("Content-Type", "application/json")
            .timeout(Duration.ofSeconds(30))
            .POST(HttpRequest.BodyPublishers.ofString(body))
            .build()
        return httpClient.send(req, HttpResponse.BodyHandlers.ofString())
    }

    /**
     * A failure, as a word.
     *
     * The exception's message is not sent and is not consulted for anything but
     * this. Sending it would be the leak the whole deployment exists to prevent
     * — an exception message routinely contains the value that caused it.
     */
    private fun classify(e: Throwable): String = when {
        e is java.util.concurrent.TimeoutException -> "timeout"
        e is java.net.SocketTimeoutException -> "timeout"
        e is java.net.ConnectException -> "provider_error"
        e.javaClass.simpleName.contains("Ceiling", ignoreCase = true) -> "ceiling"
        e is java.util.concurrent.CancellationException -> "cancelled"
        e.javaClass.simpleName.contains("Validation", ignoreCase = true) -> "validation"
        e.javaClass.simpleName.contains("Tool", ignoreCase = true) -> "tool_error"
        else -> "error"
    }

    /** The hub's host, for a log line. A URL can carry a token in a query string. */
    private fun redactHost(url: String): String =
        runCatching { URI.create(url).host ?: "hub" }.getOrDefault("hub")

    private fun sleep(ms: Long) = try { Thread.sleep(ms) } catch (_: InterruptedException) {
        Thread.currentThread().interrupt()
    }

    companion object {
        /**
         * Whether this process is a self-hosted runner.
         *
         * Off by default and set by the customer's deployment, per the
         * feature-flag convention: a platform worker that started leasing from
         * an endpoint would be a very confusing outage.
         */
        fun enabled(): Boolean = !System.getenv("VECTORBEA_RUNNER_TOKEN").isNullOrBlank()

        fun fromEnv(execute: (LeasedRun) -> Outcome): RunnerAgent? {
            val token = System.getenv("VECTORBEA_RUNNER_TOKEN")?.takeIf { it.isNotBlank() }
                ?: return null
            val hub = System.getenv("VECTORBEA_HUB_URL")?.takeIf { it.isNotBlank() }
                ?: error("VECTORBEA_RUNNER_TOKEN is set but VECTORBEA_HUB_URL is not. A runner " +
                    "needs to know where to ask for work.")
            return RunnerAgent(
                hubUrl = hub,
                token = token,
                runnerName = System.getenv("VECTORBEA_RUNNER_NAME")
                    ?: java.net.InetAddress.getLocalHost().hostName,
                version = System.getenv("WORKER_VERSION"),
                execute = execute,
                leaseSeconds = System.getenv("VECTORBEA_RUNNER_LEASE_SECONDS")
                    ?.toLongOrNull()?.coerceIn(30, 300) ?: 60,
            )
        }
    }
}
