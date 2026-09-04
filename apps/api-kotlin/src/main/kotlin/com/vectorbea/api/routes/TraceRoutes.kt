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
        /**
         * Statuses that mean the run is not going to produce more spans.
         *
         * `handed_off` counts: the activation moved elsewhere and THIS run is
         * finished. Anything unrecognised is treated as still running, so a status
         * added later shows `live` rather than claiming a trace is complete when
         * it is not.
         */
        private val TERMINAL_STATUSES = setOf(
            "succeeded", "failed", "cancelled", "timeout",
            "ceiling_exceeded", "continued_as_new", "handed_off",
        )

        /** What the run row says about itself, for the completeness decision. */
        internal data class RunFacts(val status: String, val droppedSpans: Int)

        /**
         * Which of the four states this trace is in, and why.
         *
         * Each one has a different cause and a different thing for the reader to do,
         * which is the whole reason there are four rather than one amber box:
         *
         *   complete    — say nothing. This is the common case and it is not an event.
         *   live        — the run is still going. Neutral: "still running" is not a
         *                 warning, and colouring it amber teaches people that amber
         *                 means nothing.
         *   partial     — spans are genuinely missing. The ONLY state allowed to
         *                 claim that, and it carries the count.
         *   unavailable — the trace could not be read. Distinct from partial, because
         *                 an empty tree rendered as an answer is a wrong answer.
         */
        internal fun completeness(
            facts: RunFacts?,
            droppedSpans: Int,
            spanCount: Int,
        ): Map<String, Any?> {
            fun state(s: String, reason: String?) =
                mapOf("state" to s, "droppedSpans" to droppedSpans, "reason" to reason)

            /* No run row where the guard just proved one exists means the read
               failed, not that the run is empty. */
            if (facts == null) return state("unavailable",
                "The run record could not be read, so we cannot tell whether this trace is complete.")

            val terminal = facts.status in TERMINAL_STATUSES

            /* The CAUSE only. Which views are affected is the client's sentence —
               saying it in both places produced a banner that repeated itself. */
            if (droppedSpans > 0) return state("partial",
                "The writer's buffer was full or a write failed, so $droppedSpans span(s) " +
                "from this run were never recorded. The run itself was unaffected.")

            if (!terminal) return state("live",
                "This run is still going, so more spans are still arriving.")

            if (spanCount == 0) return state("partial",
                "No spans were recorded for this run. It either ran before tracing was enabled " +
                "or its spans have passed their retention window.")

            return state("complete", null)
        }

        /**
         * One row per span id, keeping the most complete.
         *
         * ── THE BUG THIS FIXES ──────────────────────────────────────────────
         * The Debug tab rendered every step of a run TWICE, with durations
         * identical to the millisecond. Two executions could not produce
         * identical durations; these were the same spans returned twice.
         *
         * `run_spans` is partitioned by `created_at` and its primary key is
         * `(span_id, created_at)` — the partition key has to be in the key. So
         * `ON CONFLICT (span_id, created_at) DO NOTHING`, which is what makes a
         * redelivered span idempotent, only dedupes when `created_at` matches
         * EXACTLY.
         *
         * It did not. `WorkflowRuntime` opened the run span with
         * `Instant.ofEpochMilli(dagStartedAtMs)` and closed it with
         * `Instant.ofEpochMilli(startedAtMs)` — two different
         * `System.currentTimeMillis()` calls, milliseconds apart. Two rows, same
         * span id, different `created_at`, no conflict.
         *
         * Both rows have `parent_span_id IS NULL`, so both became roots, and
         * `childrenOf[spanId]` returned the same children for each — every tick,
         * step and call beneath the run was emitted under both. Hence the exact
         * duplicate, durations and all.
         *
         * The writer is fixed too (`RunTracer.closeRunSpan` now derives its
         * `createdAt` from the same instant as the open). This stays because rows
         * written by the old code already exist, and because a reader that
         * duplicates a subtree on a repeated id is fragile regardless of who put
         * the id there twice.
         *
         * "Most complete" is the row that ENDED: an open row and a closed row for
         * the same span are the same span observed twice, and the closed one has
         * the duration.
         */
        internal fun <T> dedupeBySpanId(
            rows: List<T>,
            id: (T) -> UUID,
            ended: (T) -> java.time.Instant?,
        ): List<T> {
            if (rows.size < 2) return rows
            val best = LinkedHashMap<UUID, T>(rows.size)
            for (r in rows) {
                val existing = best[id(r)]
                if (existing == null) { best[id(r)] = r; continue }
                /* Prefer the one with an end time; if both or neither have one,
                   keep the first, so the order the query returned is preserved. */
                if (ended(existing) == null && ended(r) != null) best[id(r)] = r
            }
            return best.values.toList()
        }

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
        router.get("/api/runs/:id/trace/graph",          ::graph)
        router.get("/api/runs/:id/trace/iterations",     ::iterations)
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

        val loaded = loadSpans(runId, wsId)
        val facts = runFacts(runId, wsId)

        if (loaded.isEmpty()) return Response.ok(mapOf(
            "runId" to runId.toString(), "spans" to emptyList<Any>(),
            "truncated" to false, "totalSpans" to 0,
            /* A run with no spans at all is NOT complete. It either predates
               instrumentation or lost everything, and both are `partial` — saying
               "complete" of an empty tree is the page asserting that nothing
               happened. */
            "completeness" to completeness(facts, droppedSpans = facts?.droppedSpans ?: 0, spanCount = 0),
            "traceComplete" to true,
        ))

        /* DEDUPLICATED FIRST. See [dedupeBySpanId] — without this the same span
           id can arrive twice and the whole subtree beneath it is emitted twice. */
        val spans = dedupeBySpanId(loaded)

        val childrenOf = spans.groupBy { it.parentSpanId }
        val byId = spans.associateBy { it.spanId }
        val roots = spans.filter { it.parentSpanId == null || it.parentSpanId !in byId }

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
            /*
             * ── FOUR STATES, BECAUSE THERE ARE FOUR CAUSES ──────────────────
             *
             * This used to be one boolean, `traceComplete`, computed as "no run
             * span is still running". That answers "has the run finished" and
             * NOTHING about whether spans were lost — but the page rendered it as
             * "some were dropped while the writer was under pressure", a cause it
             * had no signal for. On a finished run it fired anyway, because the
             * run span was written twice and the open row never went away.
             *
             * `traceComplete` is kept for one release so an older client does not
             * break, and it now means what its name says.
             */
            "completeness" to completeness(facts, facts?.droppedSpans ?: 0, spans.size),
            "traceComplete" to (spans.none { it.kind == "run" && it.status == "running" }),
        ))
    }

    // ── GET /api/runs/{runId}/trace/iterations ────────────────────────────────

    /**
     * The inspector's data: every activation's iterations, with REFS not content.
     *
     * ── WHY THIS IS ONE CALL AND NOT THE SPAN TREE PLUS THE EVENT FEED ──────
     * The inspector needs four things that live in four places: the parsed action
     * and observation (`agent_iterations`), the model and tool spans beneath each
     * iteration (`run_spans`), the granted budget (`agent_activations`), and
     * whether resume recalled the transcript or replayed it (`run_events`).
     * Joining those in the client would mean paging the event feed and
     * time-matching spans to iterations — which gets the wrong answer on a fast
     * loop that calls the same tool twice.
     *
     * NO PAYLOAD CONTENT crosses this boundary. A 40-iteration activation is 40
     * prompts; inlining them would be a megabyte for a view where the reader
     * opens one. Sizes come through so the collapsed state is honest; the content
     * is a separate, explicit fetch.
     */
    private fun iterations(req: Request): Response {
        val (runId, wsId) = authorizedRun(req)
        val reader = IterationReader(ds)

        val activations = reader.activations(runId, wsId).map { a ->
            mapOf(
                "id" to a.id,
                "stepId" to a.stepId,
                "agentId" to a.agentId,
                "agentName" to a.agentName,
                "status" to a.status,
                "stopReason" to a.stopReason,
                "budgets" to a.budgets.map {
                    mapOf("dimension" to it.dimension, "used" to it.used, "limit" to it.limit)
                },
                "replayedFrom" to a.replayedFrom?.let {
                    mapOf("reason" to it.reason, "detail" to it.detail)
                },
                /* Null when this agent has no successful history to compare against
                   — the Activity view says nothing rather than inventing a normal. */
                "baseline" to a.baseline?.let {
                    mapOf("typicalSteps" to it.typicalSteps, "sampleRuns" to it.sampleRuns)
                },
                "iterations" to a.iterations.map { i ->
                    mapOf(
                        "id" to i.id, "number" to i.number, "status" to i.status,
                        "actionType" to i.actionType,
                        "thought" to i.thought,
                        "observation" to i.observation,
                        "observationSuccess" to i.observationSuccess,
                        "startedAt" to i.startedAt.toString(),
                        "completedAt" to i.completedAt?.toString(),
                        "durationMs" to i.durationMs,
                        "tokensDelta" to i.tokensDelta,
                        "costDeltaCents" to i.costDeltaCents,
                        "actionJson" to i.actionJson,
                        "actionRepaired" to i.actionRepaired,
                        "selectedToolId" to i.selectedToolId,
                        "toolName" to i.toolName,
                        "toolResultCached" to i.toolResultCached,
                        "recalled" to i.recalled,
                        "context" to i.context?.let {
                            mapOf(
                                "truncated" to it.truncated,
                                "droppedSections" to it.droppedSections,
                                "charsUsed" to it.charsUsed,
                                "charBudget" to it.charBudget,
                                "overBudget" to it.overBudget,
                            )
                        },
                        "llmCall" to i.llmCall?.let(::callJson),
                        "toolCall" to i.toolCall?.let(::callJson),
                    )
                },
            )
        }
        return Response.ok(mapOf("runId" to runId.toString(), "activations" to activations))
    }

    private fun callJson(c: IterationReader.CallSpan): Map<String, Any?> = mapOf(
        "spanId" to c.spanId, "name" to c.name, "status" to c.status,
        "durationMs" to c.durationMs,
        "hasInput" to c.hasInput, "hasOutput" to c.hasOutput,
        "inputBytes" to c.inputBytes, "outputBytes" to c.outputBytes,
        "tokensIn" to c.tokensIn, "tokensOut" to c.tokensOut,
    )

    // ── GET /api/runs/{runId}/trace/graph ─────────────────────────────────────

    /**
     * The run as a GRAPH: one entry per workflow node, plus the edges between
     * them, plus how the wall clock was spent.
     *
     * ── WHY THE SERVER RESOLVES THIS AND THE CLIENT DOES NOT ────────────────
     * `graph_json` has two historical shapes — React Flow nested and flat — and
     * `WorkflowGraph.parse` is the only reader that handles both. A second
     * implementation in TypeScript would diverge the first time a third shape
     * appears, and it would diverge silently, on the one screen people open when
     * something has already gone wrong.
     *
     * It also fixes what spans alone cannot express. A span is one EXECUTION;
     * the reader wants the node. A node that never ran has no span at all, and
     * "what did not happen" is the second most common question this tab answers.
     * Edges do not exist in the span table in any form.
     *
     * Everything here is shaped by [TraceGraphBuilder], which is pure and tested
     * without a database.
     */
    private fun graph(req: Request): Response {
        val (runId, wsId) = authorizedRun(req)

        val spans = dedupeBySpanId(loadSpans(runId, wsId))
        val facts = runFacts(runId, wsId)
        val status = facts?.status ?: "unknown"

        val g = TraceGraphBuilder.build(
            graphJson = graphJsonFor(runId, wsId),
            spans = spans.map { it.toBuilderSpan() },
            runStatus = status,
        )

        return Response.ok(mapOf(
            "runId" to runId.toString(),
            "status" to status,
            "completeness" to completeness(facts, facts?.droppedSpans ?: 0, spans.size),
            /* Said out loud rather than inferred from an empty edge list: a
               workflow version that was deleted, or written by a builder older
               than the current schema, still has to produce a readable trace —
               and the reader must know the structure is missing rather than
               believe the run had none. */
            "graphUnavailable" to g.graphUnavailable,
            "runBar" to mapOf(
                "totalMs" to g.runBar.totalMs,
                "segments" to g.runBar.segments.map {
                    mapOf("kind" to it.kind, "ms" to it.ms, "label" to it.label)
                },
            ),
            "nodes" to g.nodes.map { n ->
                mapOf(
                    "id" to n.id, "label" to n.label, "type" to n.type,
                    "status" to n.status, "reached" to n.reached,
                    "attempts" to n.attempts, "totalMs" to n.totalMs,
                    "spanIds" to n.spanIds, "isRootCause" to n.isRootCause,
                    "costCents" to n.costCents,
                    "tokensIn" to n.tokensIn, "tokensOut" to n.tokensOut,
                    "warnings" to n.warnings.map {
                        mapOf("kind" to it.kind, "detail" to it.detail, "count" to it.count)
                    },
                    "summary" to n.summary?.let { sm ->
                        mapOf(
                            "activations" to sm.activations,
                            "members" to sm.members.map {
                                mapOf("name" to it.name, "status" to it.status, "totalMs" to it.totalMs)
                            },
                            "failingMember" to sm.failingMember,
                        )
                    },
                )
            },
            "edges" to g.edges.map {
                mapOf("id" to it.id, "source" to it.source, "target" to it.target,
                      "type" to it.type, "label" to it.label, "condition" to it.condition,
                      "traversed" to it.traversed)
            },
        ))
    }

    /**
     * The workflow version's stored graph, workspace-scoped in the SQL.
     *
     * Joined through `agent_runs` rather than trusting a version id from the
     * request, and the workspace predicate sits on the RUN — the same boundary
     * every other handler here uses. Null when the version is gone, which is a
     * degraded render and never an error.
     */
    private fun graphJsonFor(runId: UUID, wsId: UUID): String? = runCatching {
        ds.connection.use { c ->
            c.prepareStatement(
                """SELECT v.graph_json::text
                     FROM agent_runs r
                     JOIN workflow_versions v ON v.id = r.workflow_version_id
                    WHERE r.id = ? AND r.workspace_id = ?"""
            ).use { st ->
                st.setObject(1, runId); st.setObject(2, wsId)
                st.executeQuery().use { rs -> if (rs.next()) rs.getString(1) else null }
            }
        }
    }.getOrNull()

    // ── GET /api/runs/{runId}/trace/spans/{spanId} ────────────────────────────

    private fun span(req: Request): Response {
        val (runId, wsId) = authorizedRun(req)
        val spanId = req.pathUUID("spanId")

        val row = loadSpans(runId, wsId).firstOrNull { it.spanId == spanId }
            ?: throw ApiError.NotFound("Span")

        /*
         * Payloads resolved HERE and nowhere else — this is the endpoint the tree
         * deliberately does not inline into.
         *
         * ── WHY `content=false` EXISTS ──────────────────────────────────────
         * There are two questions, and only one of them is expensive. "What is
         * there, and can I trust it" needs the size, whether it was truncated and
         * what was redacted — a few hundred bytes. "Show me the prompt" needs
         * 12,000 characters, and the inspector's panels are collapsed by default
         * precisely because the reader usually wants the first.
         *
         * Without the opt-out, selecting an iteration downloads a prompt nobody
         * asked to see, forty times over on a forty-iteration activation.
         *
         * Defaults to TRUE so an existing caller is unaffected.
         */
        val withContent = req.query("content")?.lowercase() != "false"
        return Response.ok(row.toSummary() + mapOf(
            "attributes" to row.attributesJson,
            "errorJson" to row.errorJson,
            "input" to resolvePayload(row.inputRef, wsId, withContent),
            "output" to resolvePayload(row.outputRef, wsId, withContent),
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
    private fun resolvePayload(
        ref: String?, wsId: UUID, withContent: Boolean = true,
    ): Map<String, Any?>? {
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
                            /* Metadata always; CONTENT only when asked for. A
                               collapsed panel can say how big a prompt is and
                               what was redacted from it without moving it. */
                            if (!withContent) put("contentWithheld", true)
                            else if (storage == "inline") put("value", rs.getString("inline_value"))
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

        /** Narrowed to what the graph shaping needs. See [TraceGraphBuilder.Span]. */
        fun toBuilderSpan() = TraceGraphBuilder.Span(
            spanId = spanId.toString(), parentSpanId = parentSpanId?.toString(),
            kind = kind, name = name, status = status, stepId = stepId,
            startedAt = startedAt, durationMs = durationMs,
            attributesJson = attributesJson, isRootCause = isRootCause,
            costCents = costCents, tokensIn = tokensIn, tokensOut = tokensOut,
        )

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

    private fun runFacts(runId: UUID, wsId: UUID): RunFacts? = runCatching {
        ds.connection.use { c ->
            c.prepareStatement(
                "SELECT status, dropped_spans FROM agent_runs WHERE id = ? AND workspace_id = ?"
            ).use { st ->
                st.setObject(1, runId); st.setObject(2, wsId)
                st.executeQuery().use { rs ->
                    if (rs.next()) RunFacts(rs.getString(1) ?: "unknown", rs.getInt(2)) else null
                }
            }
        }
    }.getOrNull()

    private fun toJson(v: Any?): String = com.vectorbea.api.http.mapper.writeValueAsString(v)

    private fun dedupeBySpanId(rows: List<SpanRow>): List<SpanRow> =
        dedupeBySpanId(rows, { it.spanId }, { it.endedAt })
}
