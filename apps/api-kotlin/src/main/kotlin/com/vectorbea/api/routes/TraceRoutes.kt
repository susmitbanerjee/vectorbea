package com.vectorbea.api.routes

import com.vectorbea.api.api.context
import com.vectorbea.api.api.pathUUID
import com.vectorbea.api.errors.ApiError
import com.vectorbea.api.http.Request
import com.vectorbea.api.http.Response
import com.vectorbea.api.http.Router
import com.vectorbea.api.repository.RunRepository
import com.vectorbea.observability.failures.FailureClass
import io.lettuce.core.pubsub.RedisPubSubAdapter
import org.slf4j.LoggerFactory
import java.time.Instant
import java.util.UUID
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.TimeUnit
import javax.sql.DataSource

/**
 * The read side of the trace: the span tree, why a run failed, and what made it
 * slow.
 *
 * THREE RULES, ALL ENFORCED HERE RATHER THAN TRUSTED
 * --------------------------------------------------
 * 1. **Workspace-scoped, failing closed.** Every endpoint resolves the run through
 *    [RunRepository.findById] with the caller's workspace FIRST and 404s if it does
 *    not belong to them. No span query runs before that check passes, so a
 *    guessed run id leaks nothing — not even whether it exists.
 * 2. **Depth-limited.** A wide fan-out trace is thousands of spans. The tree comes
 *    back to [DEFAULT_DEPTH] with a `childCount` on every truncated node, so the UI
 *    can show "42 more" and fetch on demand.
 * 3. **Payloads are never inlined.** A tree response that carried prompts would be
 *    measured in megabytes. Spans carry `inputRef`/`outputRef`; the per-span
 *    endpoint resolves them.
 */
class TraceRoutes(
    private val ds: DataSource,
    private val runRepo: RunRepository,
    private val redis: com.vectorbea.api.redis.RedisProvider? = null,
) {
    private val log = LoggerFactory.getLogger(TraceRoutes::class.java)

    companion object {
        /** Depth returned unless asked otherwise. Deep enough for run→tick→step→call. */
        const val DEFAULT_DEPTH = 3
        const val MAX_DEPTH = 10
        /** Hard ceiling per response, so one pathological trace cannot exhaust a heap. */
        const val MAX_SPANS = 5_000
    }

    fun register(router: Router) {
        router.get("/api/runs/:id/trace",                ::tree)
        router.get("/api/runs/:id/trace/spans/:spanId",  ::span)
        router.get("/api/runs/:id/trace/root-cause",     ::rootCause)
        router.get("/api/runs/:id/trace/critical-path",  ::criticalPath)
        router.sseGet("/api/runs/:id/trace/stream",      ::stream)
    }

    // ── Shared guard ──────────────────────────────────────────────────────────

    /**
     * Resolve the run inside the caller's workspace, or 404.
     *
     * Every handler starts here. A run in another workspace is reported as Not Found
     * rather than Forbidden on purpose: "this exists but is not yours" is itself a
     * disclosure, and a run id is guessable enough to matter.
     */
    private fun authorizedRun(req: Request): Pair<UUID, UUID> {
        val ctx = req.context()
        val runId = req.pathUUID("id")
        runRepo.findById(runId, ctx.workspaceId) ?: throw ApiError.NotFound("Run")
        return runId to ctx.workspaceId
    }

    // ── GET /api/runs/{runId}/trace ───────────────────────────────────────────

    private fun tree(req: Request): Response {
        val (runId, wsId) = authorizedRun(req)
        val depth = (req.query("depth")?.toIntOrNull() ?: DEFAULT_DEPTH).coerceIn(0, MAX_DEPTH)

        val spans = loadSpans(runId, wsId)
        if (spans.isEmpty()) return Response.ok(mapOf(
            "runId" to runId.toString(), "spans" to emptyList<Any>(),
            "truncated" to false, "totalSpans" to 0,
            "traceComplete" to true,
        ))

        val childrenOf = spans.groupBy { it.parentSpanId }
        val roots = spans.filter { it.parentSpanId == null || !spans.any { p -> p.spanId == it.parentSpanId } }

        var emitted = 0
        fun build(node: SpanRow, level: Int): Map<String, Any?> {
            val kids = childrenOf[node.spanId].orEmpty()
            emitted++
            val expand = level < depth && emitted < MAX_SPANS
            return node.toSummary() + mapOf(
                "childCount" to kids.size,
                /* Present but empty is different from absent: the UI needs to know
                   whether it is looking at a leaf or at a node it must fetch. */
                "children" to if (expand) kids.map { build(it, level + 1) } else emptyList(),
                "truncated" to (kids.isNotEmpty() && !expand),
            )
        }

        val tree = roots.map { build(it, 0) }
        return Response.ok(mapOf(
            "runId" to runId.toString(),
            "depth" to depth,
            "totalSpans" to spans.size,
            "returnedSpans" to emitted,
            "truncated" to (emitted < spans.size),
            "spans" to tree,
            /* Trace completeness is SHOWN, not assumed. A run whose spans were
               dropped under buffer pressure, or that predates instrumentation, must
               say so rather than letting a reader believe a gap is the whole story. */
            "traceComplete" to (spans.none { it.kind == "run" && it.status == "running" }),
        ))
    }

    // ── GET /api/runs/{runId}/trace/spans/{spanId} ────────────────────────────

    private fun span(req: Request): Response {
        val (runId, wsId) = authorizedRun(req)
        val spanId = req.pathUUID("spanId")

        val row = loadSpans(runId, wsId).firstOrNull { it.spanId == spanId }
            ?: throw ApiError.NotFound("Span")

        /* Payloads resolved HERE and nowhere else — this is the endpoint the tree
           deliberately does not inline into. */
        return Response.ok(row.toSummary() + mapOf(
            "attributes" to row.attributesJson,
            "errorJson" to row.errorJson,
            "input" to resolvePayload(row.inputRef, wsId),
            "output" to resolvePayload(row.outputRef, wsId),
        ))
    }

    /**
     * A payload reference, resolved to content or to a fetch URL.
     *
     * Inline content comes back directly. Object-stored content comes back as a
     * short-lived signed URL rather than bytes: streaming a 4 MB prompt through the
     * API to render a trace row is a cost paid on every page view for something the
     * reader usually does not open.
     */
    private fun resolvePayload(ref: String?, wsId: UUID): Map<String, Any?>? {
        if (ref == null) return null
        return try {
            ds.connection.use { conn ->
                conn.prepareStatement(
                    """SELECT size_bytes, content_type, storage, truncated, redactions,
                              inline_value::text
                         FROM run_payloads WHERE ref = ? AND workspace_id = ?"""
                ).use { st ->
                    st.setString(1, ref); st.setObject(2, wsId)
                    st.executeQuery().use { rs ->
                        if (!rs.next()) return@use null
                        val storage = rs.getString("storage")
                        buildMap<String, Any?> {
                            put("ref", ref)
                            put("sizeBytes", rs.getInt("size_bytes"))
                            put("contentType", rs.getString("content_type"))
                            put("storage", storage)
                            put("truncated", rs.getBoolean("truncated"))
                            /* What was masked, so a reader sees a redaction rather
                               than a gap they will assume is a bug. */
                            put("redactions", rs.getString("redactions"))
                            if (storage == "inline") put("value", rs.getString("inline_value"))
                            else put("url", signedUrl(ref, wsId))
                        }
                    }
                }
            }
        } catch (e: Exception) {
            log.warn("[trace] payload resolve failed ref={}: {}", ref.take(12), e.message)
            null
        }
    }

    /**
     * A short-lived, workspace-bound URL for object-stored content.
     *
     * HMAC over (ref, workspace, expiry) with the app secret, so the link cannot be
     * edited to reach another workspace's payload and stops working on its own. The
     * ref is a content hash and therefore unguessable, but unguessable is not the
     * same as authorised — an URL that leaked would otherwise work forever.
     */
    private fun signedUrl(ref: String, wsId: UUID): String {
        val expiresAt = Instant.now().plusSeconds(300).epochSecond
        val secret = System.getenv("JWT_SECRET") ?: "dev-unsigned"
        val mac = javax.crypto.Mac.getInstance("HmacSHA256").apply {
            init(javax.crypto.spec.SecretKeySpec(secret.toByteArray(), "HmacSHA256"))
        }
        val sig = mac.doFinal("$ref|$wsId|$expiresAt".toByteArray())
            .joinToString("") { "%02x".format(it) }.take(32)
        return "/api/payloads/$ref?expires=$expiresAt&sig=$sig"
    }

    // ── GET /api/runs/{runId}/trace/root-cause ────────────────────────────────

    private fun rootCause(req: Request): Response {
        val (runId, wsId) = authorizedRun(req)
        val spans = loadSpans(runId, wsId)

        /* Reads the FLAG. Attribution ran once, at terminalisation; recomputing the
           walk here would put a graph traversal on every page load of a page that is
           read far more often than it is written. */
        val causes = spans.filter { it.isRootCause }
        if (causes.isEmpty()) return Response.ok(mapOf(
            "runId" to runId.toString(),
            "rootCause" to null,
            "reason" to if (spans.any { it.status == "error" })
                "attribution has not run for this run yet"
            else "this run did not fail",
        ))

        val primary = causes.first()
        val byId = spans.associateBy { it.spanId }
        val verdict = primary.failureClass?.let { runCatching { FailureClass.valueOf(it) }.getOrNull() }

        return Response.ok(mapOf(
            "runId" to runId.toString(),
            "rootCause" to primary.toSummary(),
            "concurrentGroup" to causes.map { it.spanId.toString() },
            "concurrentLabel" to
                if (causes.size > 1) "${causes.size} concurrent failures" else null,
            "failureClass" to verdict?.name,
            "owner" to verdict?.owner,
            "retry" to verdict?.retry?.humanAnswer,
            "rendersAsError" to (verdict?.rendersAsError ?: true),
            "ancestry" to ancestryOf(primary, byId).map { it.toSummary() },
            "sentence" to causeSentence(primary, byId, verdict),
        ))
    }

    /** Root → … → span, so the panel can show where in the run this happened. */
    private fun ancestryOf(span: SpanRow, byId: Map<UUID, SpanRow>): List<SpanRow> {
        val chain = mutableListOf<SpanRow>()
        var cur: SpanRow? = span
        val seen = HashSet<UUID>()
        while (cur != null && seen.add(cur.spanId)) {
            chain.add(cur)
            cur = cur.parentSpanId?.let { byId[it] }
        }
        return chain.reversed()
    }

    /**
     * One sentence a business user can act on.
     *
     * Follows the worked example in §4 of the debugger doc: name the step, the
     * activation, the iteration and the callable, quote the ACTUAL error, then state
     * the class and who fixes it. Each clause is omitted when its fact is absent
     * rather than rendered as "unknown" — a sentence full of placeholders reads as a
     * broken product, and the parts that ARE known are still worth saying.
     */
    private fun causeSentence(
        span: SpanRow, byId: Map<UUID, SpanRow>, verdict: FailureClass?,
    ): String {
        val chain = ancestryOf(span, byId)
        val step = chain.lastOrNull { it.kind == "step" }
        val activation = chain.lastOrNull { it.kind == "activation" }
        val sb = StringBuilder()

        // What broke, in the user's terms.
        sb.append("Run failed because ")
        when {
            activation != null -> sb.append("the **${activation.name}** agent ")
            step != null       -> sb.append("step **${step.name}** ")
            else               -> sb.append("the run ")
        }
        sb.append("could not complete **${span.name}**.")

        // Where, precisely enough to find it.
        val where = buildList {
            step?.let { add("step `${it.name}`") }
            activation?.let { add("activation `${it.name}` (depth ${chain.indexOf(it)})") }
            span.iterationIndex?.let { add("iteration $it") }
            add("${span.kind.replace('_', ' ')} `${span.name}`")
        }
        sb.append(" ").append(where.joinToString(" → "))

        // The actual error, not a category.
        span.errorText()?.let { sb.append(" returned **").append(it.take(200)).append("**.") }
            ?: sb.append(".")

        // The class and the owner.
        if (verdict != null) {
            sb.append(" Class **${verdict.name}** — ${verdict.summary} ")
            sb.append("${verdict.owner} needs to act. ${verdict.retry.humanAnswer}")
        }
        return sb.toString()
    }

    // ── GET /api/runs/{runId}/trace/critical-path ─────────────────────────────

    /**
     * The chain of spans that determined total run duration.
     *
     * At each level, follow the child that finished LAST — shortening anything else
     * would not have made the run finish sooner. That is what makes this different
     * from "the slowest spans": a 30-second span running in parallel with a
     * 40-second sibling is not on the critical path, and speeding it up buys
     * nothing.
     */
    private fun criticalPath(req: Request): Response {
        val (runId, wsId) = authorizedRun(req)
        val spans = loadSpans(runId, wsId)
        if (spans.isEmpty()) return Response.ok(mapOf(
            "runId" to runId.toString(), "path" to emptyList<Any>(), "totalMs" to 0))

        val childrenOf = spans.groupBy { it.parentSpanId }
        val root = spans.firstOrNull { it.kind == "run" }
            ?: spans.minByOrNull { it.startedAt } ?: return Response.ok(
                mapOf("runId" to runId.toString(), "path" to emptyList<Any>(), "totalMs" to 0))

        val path = mutableListOf<SpanRow>()
        var cur: SpanRow? = root
        val seen = HashSet<UUID>()
        while (cur != null && seen.add(cur.spanId)) {
            path.add(cur)
            cur = childrenOf[cur.spanId].orEmpty()
                .maxByOrNull { it.endedAtOrStart() }
        }

        return Response.ok(mapOf(
            "runId" to runId.toString(),
            "totalMs" to (root.durationMs ?: 0),
            "path" to path.map {
                it.toSummary() + mapOf(
                    /* Self time is what shortening THIS span would actually save;
                       duration includes its children and would double-count. */
                    "selfMs" to it.selfMs,
                    "sharePct" to root.durationMs?.takeIf { d -> d > 0 }
                        ?.let { d -> ((it.selfMs ?: 0) * 100.0 / d) },
                )
            },
        ))
    }

    // ── GET /api/runs/{runId}/trace/stream (SSE) ──────────────────────────────

    /**
     * Live spans, following the run-events stream pattern exactly.
     *
     * Replay durable spans from Postgres first, then subscribe to Redis. A client
     * that connects mid-run therefore sees the whole trace, not just the tail, and a
     * Redis outage degrades to "poll instead" rather than to an empty page.
     */
    private fun stream(req: Request, emitter: Router.SseEmitter) {
        val ctx = req.context()
        val runId = req.pathUUID("id")
        val run = runRepo.findById(runId, ctx.workspaceId) ?: throw ApiError.NotFound("Run")

        // ── Phase 1: durable spans already written ───────────────────────────
        for (s in loadSpans(runId, ctx.workspaceId)) {
            if (!emitter.sendEvent("span", toJson(s.toSummary()))) return
        }

        // ── Phase 2: nothing more is coming ──────────────────────────────────
        if (run.status in setOf("succeeded", "failed", "cancelled", "timed_out")) {
            emitter.sendEvent("trace_complete", """{"status":"${run.status}","final":true}""")
            return
        }

        // ── Phase 3: live ────────────────────────────────────────────────────
        val r = redis
        if (r == null) {
            /* Degraded, and SAID so. A client left waiting on a stream that will
               never produce anything looks identical to a hung run. */
            emitter.sendEvent("stream_unavailable",
                """{"message":"Live tracing requires Redis","fallback":"polling"}""")
            return
        }

        val queue = LinkedBlockingQueue<String>()
        val pubSub = r.newPubSubConnection()
        pubSub.addListener(object : RedisPubSubAdapter<String, String>() {
            override fun message(ch: String, message: String) {
                /* The channel carries run events AND spans; the writer tags spans
                   with "type":"SPAN" so this can take only what it wants. */
                if (message.contains("\"type\":\"SPAN\"")) queue.offer(message)
            }
        })
        pubSub.sync().subscribe("run-events:$runId")

        try {
            var beats = 0
            while (emitter.isConnected()) {
                val msg = queue.poll(20, TimeUnit.SECONDS)
                if (msg == null) {
                    beats++
                    if (!emitter.sendComment("heartbeat t=${Instant.now()}")) break
                    if (beats % 10 == 0) {
                        val fresh = runRepo.findById(runId, ctx.workspaceId)
                        if (fresh?.status in setOf("succeeded", "failed", "cancelled", "timed_out")) {
                            emitter.sendEvent("trace_complete",
                                """{"status":"${fresh?.status}","final":true}""")
                            break
                        }
                    }
                } else if (!emitter.sendEvent("span", msg)) break
            }
        } finally {
            runCatching { pubSub.sync().unsubscribe("run-events:$runId"); pubSub.close() }
        }
    }

    // ── Loading ───────────────────────────────────────────────────────────────

    private data class SpanRow(
        val spanId: UUID, val parentSpanId: UUID?, val kind: String, val name: String,
        val status: String, val stepId: String?, val iterationIndex: Int?,
        val startedAt: Instant, val endedAt: Instant?, val durationMs: Int?, val selfMs: Int?,
        val attributesJson: String?, val errorJson: String?, val failureClass: String?,
        val isRootCause: Boolean, val inputRef: String?, val outputRef: String?,
        val tokensIn: Int?, val tokensOut: Int?, val costCents: Double?,
    ) {
        fun endedAtOrStart(): Instant = endedAt ?: startedAt

        /** Everything except payloads — those are fetched per span, never inlined. */
        fun toSummary(): Map<String, Any?> = mapOf(
            "spanId" to spanId.toString(),
            "parentSpanId" to parentSpanId?.toString(),
            "kind" to kind, "name" to name, "status" to status,
            "stepId" to stepId, "iterationIndex" to iterationIndex,
            "startedAt" to startedAt.toString(), "endedAt" to endedAt?.toString(),
            "durationMs" to durationMs, "selfMs" to selfMs,
            "failureClass" to failureClass, "isRootCause" to isRootCause,
            "hasInput" to (inputRef != null), "hasOutput" to (outputRef != null),
            "tokensIn" to tokensIn, "tokensOut" to tokensOut, "costCents" to costCents,
        )

        /** The human-readable error, dug out of the sanitized error json. */
        fun errorText(): String? = errorJson
            ?.let { Regex("\"reason\"\\s*:\\s*\"([^\"]{1,300})").find(it)?.groupValues?.get(1) }
            ?: errorJson
    }

    /**
     * All spans for a run, workspace-scoped in the SQL itself.
     *
     * The workspace predicate is in the query as well as in [authorizedRun] — the
     * guard already ran, and this is the belt to its braces. A future caller that
     * forgets the guard still cannot read another workspace's spans.
     */
    private fun loadSpans(runId: UUID, wsId: UUID): List<SpanRow> =
        ds.connection.use { conn ->
            conn.prepareStatement(
                """SELECT span_id, parent_span_id, kind, name, status, step_id,
                          iteration_index, started_at, ended_at, duration_ms, self_ms,
                          attributes_json::text, error_json::text, failure_class,
                          is_root_cause, input_ref, output_ref, tokens_in, tokens_out,
                          cost_cents
                     FROM run_spans
                    WHERE run_id = ? AND workspace_id = ?
                    ORDER BY started_at
                    LIMIT $MAX_SPANS"""
            ).use { st ->
                st.setObject(1, runId); st.setObject(2, wsId)
                st.executeQuery().use { rs ->
                    buildList {
                        while (rs.next()) add(SpanRow(
                            spanId = rs.getObject("span_id", UUID::class.java),
                            parentSpanId = rs.getObject("parent_span_id", UUID::class.java),
                            kind = rs.getString("kind"), name = rs.getString("name"),
                            status = rs.getString("status"), stepId = rs.getString("step_id"),
                            iterationIndex = rs.getObject("iteration_index") as? Int,
                            startedAt = rs.getTimestamp("started_at").toInstant(),
                            endedAt = rs.getTimestamp("ended_at")?.toInstant(),
                            durationMs = rs.getObject("duration_ms") as? Int,
                            selfMs = rs.getObject("self_ms") as? Int,
                            attributesJson = rs.getString("attributes_json"),
                            errorJson = rs.getString("error_json"),
                            failureClass = rs.getString("failure_class"),
                            isRootCause = rs.getBoolean("is_root_cause"),
                            inputRef = rs.getString("input_ref"),
                            outputRef = rs.getString("output_ref"),
                            tokensIn = rs.getObject("tokens_in") as? Int,
                            tokensOut = rs.getObject("tokens_out") as? Int,
                            costCents = rs.getBigDecimal("cost_cents")?.toDouble(),
                        ))
                    }
                }
            }
        }

    private fun toJson(v: Any?): String = com.vectorbea.api.http.mapper.writeValueAsString(v)
}
