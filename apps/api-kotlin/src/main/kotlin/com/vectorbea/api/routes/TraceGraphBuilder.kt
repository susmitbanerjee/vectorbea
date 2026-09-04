package com.vectorbea.api.routes

import com.vectorbea.graph.WorkflowGraph
import java.time.Instant

/**
 * The run, resolved against the workflow it ran — one card per GRAPH NODE.
 *
 * ── WHY THIS IS A SEPARATE FILE FROM TraceRoutes ────────────────────────────
 * Everything here is a pure function of (graph, spans). No datasource, no
 * request, no workspace — the route does the authorising and the loading, then
 * hands the results to this. That is what makes the shaping testable without a
 * database, and the shaping is where every one of the Debug tab's bugs has been.
 *
 * ── WHAT WENT WRONG THAT THIS FIXES ─────────────────────────────────────────
 * The Overview rendered a wrapped grid of same-sized cards labelled by node
 * TYPE, with no edges, each step appearing twice. Four separate mistakes, and
 * three of them have the same root: the client was handed a span array and asked
 * to reconstruct a graph from it.
 *
 *   - A span is one EXECUTION of a node. A node that yields, retries or resumes
 *     after an approval has several. Iterating spans produces one card per
 *     execution, which reads as a workflow that loops.
 *   - Spans carry no edges at all, so the structure — the thing the reader came
 *     to see — was simply absent.
 *   - A node that never ran has no span, so "what did not happen" was invisible.
 *     That is the second most common question this tab is opened to answer.
 *
 * So the SERVER resolves the graph. `graph_json` has two historical shapes and
 * `WorkflowGraph.parse` is the only correct reader of both; a second
 * implementation in TypeScript would diverge the first time a third shape
 * appears, and would diverge silently.
 */
object TraceGraphBuilder {

    // ── Inputs ───────────────────────────────────────────────────────────────

    /**
     * The subset of a span this shaping needs.
     *
     * A local shape rather than TraceRoutes.SpanRow so the pure logic does not
     * depend on the route's private types, and so a test can build one in a line.
     */
    data class Span(
        val spanId: String,
        val parentSpanId: String?,
        val kind: String,
        val name: String,
        val status: String,
        val stepId: String?,
        val startedAt: Instant,
        val durationMs: Int?,
        val attributesJson: String?,
        val isRootCause: Boolean,
        val costCents: Double?,
        val tokensIn: Int?,
        val tokensOut: Int?,
    )

    // ── Outputs ──────────────────────────────────────────────────────────────

    /**
     * One warning, attached to the node it happened on.
     *
     * ── WHY A SUCCESSFUL RUN NEEDS THESE ────────────────────────────────────
     * A run that succeeded after two retries and a truncated context is not the
     * same as a run that succeeded. The first is one provider hiccup away from
     * failing and its agent was reasoning from incomplete information, and today
     * both render as an unbroken row of green. Warnings are what a healthy-looking
     * run has to show for itself.
     *
     * `count` is on the marker rather than repeated as N identical markers: three
     * dots on one node says "look here three times", which is not the message.
     */
    data class Warning(val kind: String, val detail: String, val count: Int = 1)

    data class Node(
        val id: String,
        val label: String,
        val type: String,
        /** ok · error · paused · skipped · running, or "not_reached". */
        val status: String,
        /**
         * False when the run never got here.
         *
         * Rendered dimmed and dashed, NEVER hidden. A run that failed at step two
         * and a run that was never going to reach step four look identical if the
         * page only draws what executed.
         */
        val reached: Boolean,
        val attempts: Int,
        /** Summed across attempts: a node that burned 9s failing then succeeded cost 10s. */
        val totalMs: Int?,
        val spanIds: List<String>,
        val warnings: List<Warning>,
        val isRootCause: Boolean,
        val costCents: Double?,
        val tokensIn: Int?,
        val tokensOut: Int?,
        /** Activation count and failing member, for agent and team nodes only. */
        val summary: Summary?,
    )

    /** What an agent or team node did, in one line, without expanding it. */
    data class Summary(
        val activations: Int,
        val members: List<Member>,
        val failingMember: String?,
    )

    /**
     * One activation, for the inline expansion.
     *
     * Status and duration travel with the name because a list of names answers
     * nothing: the questions on an expanded team node are which member broke and
     * which one took the time, and both need a number the reader can compare.
     */
    data class Member(val name: String, val status: String, val totalMs: Int?)

    data class Edge(
        val id: String,
        val source: String,
        val target: String,
        val type: String,
        val label: String?,
        val condition: String?,
        /**
         * Whether the run went this way — TRUE, FALSE, or null for "cannot tell".
         *
         * ── WHY THIS IS TRI-STATE AND NOT A BOOLEAN ─────────────────────────
         * The honest answer is not always available. Traversal is DERIVED from
         * which endpoints have spans, because the persisted selected-edge state is
         * not currently queryable (`CheckpointStore` writes fail — its INSERT names
         * four columns that do not exist, so nothing has ever been stored).
         *
         * Derivation is exact when the target has exactly one reached inbound
         * source: that edge carried the run and its siblings did not, which is the
         * branch case this view exists to show. When a reached node has SEVERAL
         * reached inbound sources, spans cannot say which one delivered control,
         * and this returns null rather than guessing. Null renders as an ordinary
         * edge — present, unhighlighted, claiming nothing.
         *
         * Rule 5: never state a condition the data cannot support.
         */
        val traversed: Boolean?,
    )

    /**
     * How the run spent its wall clock, in four segments that sum to it.
     *
     * ── THE SINGLE MOST COMMON MISREADING OF AN AGENT RUN ───────────────────
     * "This run took 4 minutes" is heard as "the product was working for 4
     * minutes". Usually it was working for 68 seconds and parked for 2m38s
     * waiting for a human to click approve. Those are opposite problems — one is
     * an engineering issue and the other is a process issue — and the run header
     * gave them the same number.
     *
     * So parked time is its own segment, proportional and labelled, and a run
     * that was mostly waiting looks mostly waiting.
     */
    data class Segment(val kind: String, val ms: Long, val label: String)

    data class RunBar(val totalMs: Long, val segments: List<Segment>)

    data class Graph(
        val nodes: List<Node>,
        val edges: List<Edge>,
        val runBar: RunBar,
        /** True when the workflow version had no readable graph. See [build]. */
        val graphUnavailable: Boolean,
    )

    // ── Shaping ──────────────────────────────────────────────────────────────

    private val TERMINAL_OK = setOf("ok")

    /**
     * Statuses that mean this execution never happened.
     *
     * `cancelled` counts as not-reached only when EVERY attempt was cancelled: a
     * node that ran and was cancelled on a later pass did happen, and dimming it
     * would erase work the reader is looking for.
     */
    private val NEVER_RAN = setOf("skipped", "cancelled")

    /**
     * Resolve the workflow graph against what the run actually did.
     *
     * `graphJson` null or unparseable is NOT an error: runs outlive the workflow
     * versions that made them, and a version deleted or written by an older
     * builder must still produce a readable trace. The node list then falls back
     * to the nodes the SPANS mention, edges are empty, and `graphUnavailable`
     * says so — degraded, honest, and still useful, rather than a 500 on a page
     * whose whole job is explaining failures.
     */
    fun build(graphJson: String?, spans: List<Span>, runStatus: String): Graph {
        val graph = graphJson?.let { runCatching { WorkflowGraph.parse(it) }.getOrNull() }

        val stepSpans = spans.filter { it.kind == "step" }
        val byNode: Map<String, List<Span>> = stepSpans
            .filter { it.stepId != null }
            .groupBy { it.stepId!! }
            .mapValues { (_, v) -> v.sortedBy { it.startedAt } }

        val nodes = if (graph != null) {
            graph.nodes.map { n -> shapeNode(n.id, n.label, n.type, byNode[n.id].orEmpty(), spans) }
        } else {
            /* No graph: recover what we can from the spans themselves. Order by
               first execution, which is the only order available. */
            byNode.entries
                .sortedBy { it.value.first().startedAt }
                .map { (id, attempts) ->
                    shapeNode(id, attempts.last().name, "unknown", attempts, spans)
                }
        }

        val reached = nodes.filter { it.reached }.map { it.id }.toSet()

        val edges = graph?.edges.orEmpty().map { e ->
            Edge(
                id = e.id, source = e.source, target = e.target,
                type = e.edgeType.value, label = e.label, condition = e.condition,
                traversed = traversalOf(e.source, e.target, reached, graph),
            )
        }

        return Graph(
            nodes = nodes,
            edges = edges,
            runBar = runBar(spans, runStatus),
            graphUnavailable = graph == null,
        )
    }

    /**
     * Did the run take this edge?
     *
     * Exact when the target has one reached inbound source — the branch case.
     * Null when several reached sources could have delivered control, because
     * spans do not record which one did.
     */
    private fun traversalOf(
        source: String, target: String, reached: Set<String>, graph: WorkflowGraph?,
    ): Boolean? {
        if (source !in reached) return false           // the source never ran
        if (target !in reached) return false           // this way was not taken
        val g = graph ?: return null
        val reachedInbound = g.inboundSources(target).count { it in reached }
        return if (reachedInbound == 1) true else null
    }

    /**
     * One node, with every execution of it folded in.
     *
     * Grouped on `stepId`, which IS the graph node's id and is already on the
     * wire. Repeats become an attempt count on one card rather than N cards.
     */
    private fun shapeNode(
        id: String, rawLabel: String, type: String,
        attempts: List<Span>, allSpans: List<Span>,
    ): Node {
        if (attempts.isEmpty()) {
            return Node(
                id = id, label = labelFor(rawLabel, id, type, emptyList()),
                type = type, status = "not_reached", reached = false,
                attempts = 0, totalMs = null, spanIds = emptyList(),
                warnings = emptyList(), isRootCause = false,
                costCents = null, tokensIn = null, tokensOut = null, summary = null,
            )
        }

        val last = attempts.last()
        val neverRan = attempts.all { it.status in NEVER_RAN }
        val spanIds = attempts.map { it.spanId }.toSet()

        /* Descendants of every attempt, so an activation under attempt 2 counts
           towards the node even though attempt 1 never reached the agent. */
        val descendants = descendantsOf(spanIds, allSpans)

        val durations = attempts.mapNotNull { it.durationMs }
        return Node(
            id = id,
            label = labelFor(rawLabel, id, type, descendants),
            type = type,
            status = if (neverRan) "not_reached" else last.status,
            reached = !neverRan,
            attempts = attempts.size,
            totalMs = if (durations.isEmpty()) null else durations.sum(),
            spanIds = attempts.map { it.spanId },
            warnings = warningsFor(attempts, descendants),
            isRootCause = attempts.any { it.isRootCause } || descendants.any { it.isRootCause },
            costCents = (attempts + descendants).mapNotNull { it.costCents }
                .takeIf { it.isNotEmpty() }?.sum(),
            tokensIn = (attempts + descendants).mapNotNull { it.tokensIn }
                .takeIf { it.isNotEmpty() }?.sum(),
            tokensOut = (attempts + descendants).mapNotNull { it.tokensOut }
                .takeIf { it.isNotEmpty() }?.sum(),
            summary = summaryFor(descendants),
        )
    }

    /**
     * The node's name, in the order a reader can actually use.
     *
     * label → agent name → "Type · id8". NEVER a bare type: "Agent" tells nobody
     * WHICH agent, and an unnamed agent node is the common case because the
     * builder auto-creates them.
     *
     * The worker's generated fallback is `type + ":" + id.take(8)`, detected
     * exactly rather than sniffed with a regex, so a real label that happens to
     * contain a colon cannot be mistaken for one.
     */
    fun labelFor(rawLabel: String, nodeId: String, type: String, descendants: List<Span>): String {
        val short = nodeId.take(8)
        val generated = rawLabel.isBlank() || rawLabel.endsWith(":$short")
        if (!generated) return rawLabel

        descendants.firstOrNull { it.kind == "activation" }?.name?.takeIf { it.isNotBlank() }
            ?.let { return it }

        return "${TYPE_LABEL[type] ?: type.replaceFirstChar(Char::uppercase)} · $short"
    }

    private val TYPE_LABEL = mapOf(
        "agent" to "Agent", "agent_team" to "Team", "llm" to "Model",
        "http" to "HTTP", "tool" to "Tool", "branch" to "Branch",
        "approval" to "Approval", "transform" to "Transform",
        "trigger" to "Trigger", "end" to "End", "join" to "Join",
        "parallel" to "Parallel", "db_query" to "Database read",
        "db_write" to "Database write", "unknown" to "Step",
    )

    /**
     * Everything recorded beneath these spans, at any depth.
     *
     * Iterative rather than recursive: a pathological trace should degrade into a
     * slow response, never a stack overflow on the API.
     */
    private fun descendantsOf(rootIds: Set<String>, all: List<Span>): List<Span> {
        val childrenOf = all.filter { it.parentSpanId != null }.groupBy { it.parentSpanId!! }
        val out = ArrayList<Span>()
        val queue = ArrayDeque(rootIds)
        val seen = HashSet(rootIds)
        while (queue.isNotEmpty()) {
            childrenOf[queue.removeFirst()].orEmpty().forEach {
                if (seen.add(it.spanId)) { out += it; queue.addLast(it.spanId) }
            }
        }
        return out
    }

    /**
     * What a healthy-looking node still has to answer for.
     *
     * Retries, truncated context and clamped budgets all leave a run GREEN. They
     * are the difference between "this worked" and "this worked this time".
     */
    private fun warningsFor(attempts: List<Span>, descendants: List<Span>): List<Warning> {
        val out = ArrayList<Warning>()

        /* A retry is an attempt after the first. Counted from the spans rather
           than from an `attempt` attribute so a resume after an approval — which
           re-executes without incrementing that attribute — is still visible. */
        val retries = attempts.size - 1
        if (retries > 0) {
            val recovered = attempts.last().status in TERMINAL_OK &&
                attempts.dropLast(1).any { it.status == "error" }
            out += Warning(
                kind = "retry",
                detail = if (recovered) "Failed and was retried, then succeeded"
                         else "Ran $retries extra time${if (retries == 1) "" else "s"}",
                count = retries,
            )
        }

        val here = attempts + descendants
        if (here.any { flagIsTrue(it.attributesJson, "context_truncated") }) {
            out += Warning("context_truncated",
                "The prompt did not fit, so older context was dropped before the model saw it")
        }
        if (here.any { flagIsTrue(it.attributesJson, "budget_clamped") }) {
            out += Warning("budget_clamped",
                "The requested budget exceeded what was left, so it was reduced")
        }
        if (here.any { it.kind == "approval" }) {
            out += Warning("approval", "This step waited for a human decision")
        }
        return out
    }

    /**
     * A boolean attribute, read without a JSON parser.
     *
     * The attribute blob is written by the worker under a fixed allowlist
     * (`OtelSpanMapper.EXPORTABLE_ATTRIBUTES`), so the shapes are known and small.
     * A full parse per span on a 5,000-span trace is real work for one boolean,
     * and a malformed blob must not take the page down — a warning we cannot read
     * is a missing marker, never a 500.
     */
    private fun flagIsTrue(json: String?, key: String): Boolean {
        val j = json ?: return false
        val i = j.indexOf("\"$key\"")
        if (i < 0) return false
        val colon = j.indexOf(':', i + key.length + 2)
        if (colon < 0) return false
        return j.regionMatches(colon + 1, "true", 0, 4, ignoreCase = true) ||
            j.drop(colon + 1).trimStart().startsWith("true", ignoreCase = true)
    }

    /** Activation count and the member that broke, for agent and team nodes. */
    private fun summaryFor(descendants: List<Span>): Summary? {
        val activations = descendants.filter { it.kind == "activation" }
        if (activations.isEmpty()) return null

        /* One row per MEMBER, not per activation: a supervisor that was activated
           three times is one member who ran three times, and three identical rows
           would read as three agents. Durations sum for the same reason node
           attempts do. */
        val byMember = activations.groupBy { it.name }
        return Summary(
            activations = activations.size,
            members = byMember.map { (name, runs) ->
                Member(
                    name = name,
                    /* An error anywhere is the member's outcome: a member that
                       failed and was retried is still the one that failed. */
                    status = runs.firstOrNull { it.status == "error" }?.status
                        ?: runs.last().status,
                    totalMs = runs.mapNotNull { it.durationMs }.takeIf { it.isNotEmpty() }?.sum(),
                )
            },
            failingMember = activations.firstOrNull { it.status == "error" }?.name,
        )
    }

    // ── The run bar ──────────────────────────────────────────────────────────

    private val PARKED_REASONS = setOf("approval", "timer", "throttle")

    private val WAIT_LABEL = mapOf(
        "queue" to "Waiting for a worker",
        "approval" to "Waiting for approval",
        "timer" to "Waiting for a timer",
        "throttle" to "Waiting out a rate limit",
    )

    /**
     * Wall clock split into queued / working / parked / failed.
     *
     * Built from `wait` spans, which the worker writes from durable timestamps at
     * the start of the next tick — the worker is not running during the gap, so
     * this is the only record of it. Everything not accounted for by a wait is
     * work.
     *
     * `failed` is carved out of working: the time spent in the step that broke.
     * It is a subset shown separately because "3 of your 4 minutes went into the
     * step that failed" is the sentence a reader wants and the header never said.
     */
    fun runBar(spans: List<Span>, runStatus: String): RunBar {
        val run = spans.firstOrNull { it.kind == "run" }
        val totalMs = run?.durationMs?.toLong()
            ?: spans.mapNotNull { it.durationMs }.maxOrNull()?.toLong()
            ?: 0L
        if (totalMs <= 0) return RunBar(0, emptyList())

        val waits = spans.filter { it.kind == "wait" }
        fun waitMs(pred: (String) -> Boolean) = waits
            .filter { pred(it.name.removePrefix("wait:")) }
            .sumOf { (it.durationMs ?: 0).toLong() }

        val queued = waitMs { it == "queue" }
        val parked = waitMs { it in PARKED_REASONS }

        /* The failing step's own time, capped so rounding or an overlapping child
           can never push the segments past the bar. */
        val failedStep = spans.firstOrNull { it.kind == "step" && it.status == "error" }
        val failed = if (runStatus == "failed" || failedStep != null)
            (failedStep?.durationMs ?: 0).toLong() else 0L

        val working = (totalMs - queued - parked - failed).coerceAtLeast(0)

        val segments = buildList {
            if (queued > 0) add(Segment("queued", queued, WAIT_LABEL["queue"]!!))
            if (working > 0) add(Segment("working", working, "Working"))
            if (parked > 0) {
                /* Named by the reason when there is only one, because "parked" is
                   not actionable and "waiting for approval" is. */
                val reasons = waits.map { it.name.removePrefix("wait:") }
                    .filter { it in PARKED_REASONS }.distinct()
                add(Segment("parked", parked,
                    if (reasons.size == 1) WAIT_LABEL[reasons[0]] ?: "Parked" else "Parked"))
            }
            if (failed > 0) add(Segment("failed", failed, "In the step that failed"))
        }
        return RunBar(totalMs, segments)
    }
}
