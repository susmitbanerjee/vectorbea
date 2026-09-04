package com.vectorbea.api.routes

import com.vectorbea.api.routes.TraceGraphBuilder.Span
import org.junit.jupiter.api.Test
import java.time.Instant
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * The run map, as a graph rather than as a list of executions.
 *
 * ── WHAT SHIPPED, AND WHY EACH PIECE WAS WRONG ──────────────────────────────
 * A wrapped grid of same-sized cards labelled by node type, no edges, every step
 * rendered twice. Three of those four have one cause: the client was handed a
 * span array and asked to reconstruct a graph from it.
 *
 *   - A span is one EXECUTION. A node that yields, retries, or resumes after an
 *     approval has several, so iterating spans produced duplicate cards.
 *   - Spans carry no edges, so the structure was simply absent.
 *   - A node that never ran has no span, so what did NOT happen was invisible.
 *
 * These tests pin the shaping, which is where every one of those bugs lived.
 */
class TraceGraphBuilderTest {

    private val t0 = Instant.parse("2026-08-31T10:00:00Z")
    private var seq = 0

    private fun span(
        kind: String, name: String = kind, status: String = "ok",
        stepId: String? = null, ms: Int? = 100, atMs: Long = 0,
        parent: String? = null, spanId: String? = null,
        attrs: String? = null, rootCause: Boolean = false,
        cost: Double? = null, tokIn: Int? = null, tokOut: Int? = null,
    ) = Span(
        spanId = spanId ?: "s${seq++}", parentSpanId = parent, kind = kind, name = name,
        status = status, stepId = stepId, startedAt = t0.plusMillis(atMs),
        durationMs = ms, attributesJson = attrs, isRootCause = rootCause,
        costCents = cost, tokensIn = tokIn, tokensOut = tokOut,
    )

    /** A flat graph_json, the shape the builder writes today. */
    private fun graphJson(
        nodes: List<Triple<String, String, String>>,   // id, type, label
        edges: List<Triple<String, String, String>>,   // id, source, target
        edgeTypes: Map<String, String> = emptyMap(),
    ): String {
        val n = nodes.joinToString(",") { (id, type, label) ->
            """{"id":"$id","type":"$type","label":"$label"}"""
        }
        val e = edges.joinToString(",") { (id, s, tg) ->
            """{"id":"$id","source":"$s","target":"$tg","type":"${edgeTypes[id] ?: "default"}"}"""
        }
        return """{"nodes":[$n],"edges":[$e]}"""
    }

    // ── ACCEPTANCE: the duplicated screenshot renders four nodes ─────────────

    /**
     * The exact run from the bug report: "Manual 13ms, Agent 1m05s, Agent 1.7s,
     * End 1ms", rendered twice.
     *
     * Two causes stacked. The run span was written twice (open and close used
     * different `created_at`, and the partitioned PK is `(span_id, created_at)`),
     * which duplicated the whole subtree; and the agent node yielded, so it had
     * two step spans of its own. Eight cards for four nodes.
     *
     * Grouping on `stepId` — the graph node's own id — collapses both at once,
     * and the graph supplies the four nodes whether or not they have spans.
     */
    @Test
    fun `the run that rendered every step twice produces four nodes`() {
        val json = graphJson(
            nodes = listOf(
                Triple("n-manual", "transform", "Manual"),
                Triple("n-agent-1", "agent", "Agent"),
                Triple("n-agent-2", "agent", "Agent"),
                Triple("n-end", "end", "End"),
            ),
            edges = listOf(
                Triple("e1", "n-manual", "n-agent-1"),
                Triple("e2", "n-agent-1", "n-agent-2"),
                Triple("e3", "n-agent-2", "n-end"),
            ),
        )

        /* Every step span present TWICE (the duplicated run subtree), and the
           first agent additionally yielded, so it has a third execution. */
        val spans = buildList {
            add(span("run", ms = 66_800, spanId = "run-1"))
            add(span("tick", ms = 66_800, parent = "run-1", spanId = "tick-1"))
            listOf("n-manual" to 13, "n-agent-1" to 65_000, "n-agent-2" to 1_700, "n-end" to 1)
                .forEach { (id, ms) ->
                    add(span("step", name = id, stepId = id, ms = ms, parent = "tick-1"))
                    add(span("step", name = id, stepId = id, ms = ms, parent = "tick-1"))
                }
            add(span("step", name = "n-agent-1", stepId = "n-agent-1", ms = 5_000, parent = "tick-1"))
        }

        val g = TraceGraphBuilder.build(json, spans, "succeeded")

        assertEquals(4, g.nodes.size, "one card per GRAPH NODE: ${g.nodes.map { it.label }}")
        assertEquals(listOf("Manual", "Agent", "Agent", "End"), g.nodes.map { it.label })
        assertEquals(3, g.edges.size, "the edges the grid never drew at all")

        /* The duplicates became attempts on one node, and the time is SUMMED:
           a node that ran twice cost the run both runs. */
        val agent1 = g.nodes.single { it.id == "n-agent-1" }
        assertEquals(3, agent1.attempts, "two duplicate rows plus the yield resume")
        assertEquals(135_000, agent1.totalMs)
    }

    // ── ACCEPTANCE: what did not run is present, not hidden ──────────────────

    /**
     * The unselected branch is VISIBLE.
     *
     * A run that failed at step two and a run that was never going to reach step
     * four look identical if the page only draws what executed. This is the
     * second most common question the tab is opened to answer.
     */
    @Test
    fun `unreached nodes are returned, marked, and their edges are not traversed`() {
        val json = graphJson(
            nodes = listOf(
                Triple("start", "trigger", "Start"),
                Triple("branch", "branch", "Route"),
                Triple("yes", "http", "Notify"),
                Triple("no", "http", "Escalate"),
            ),
            edges = listOf(
                Triple("e0", "start", "branch"),
                Triple("e-yes", "branch", "yes"),
                Triple("e-no", "branch", "no"),
            ),
            edgeTypes = mapOf("e-yes" to "true", "e-no" to "false"),
        )
        val spans = listOf(
            span("run", ms = 500, spanId = "r"),
            span("step", stepId = "start", ms = 10, parent = "r"),
            span("step", stepId = "branch", ms = 5, parent = "r"),
            span("step", stepId = "yes", ms = 400, parent = "r"),
        )

        val g = TraceGraphBuilder.build(json, spans, "succeeded")

        assertEquals(4, g.nodes.size, "the branch that did not run is still a node")
        val no = g.nodes.single { it.id == "no" }
        assertEquals(false, no.reached)
        assertEquals("not_reached", no.status)
        assertNull(no.totalMs, "no duration, rather than a zero that reads as instant")

        assertEquals(true, g.edges.single { it.id == "e-yes" }.traversed)
        assertEquals(false, g.edges.single { it.id == "e-no" }.traversed,
            "the road not taken must say so — that is how a reader sees what did not run")
    }

    /**
     * Traversal is DERIVED, so it says null when it cannot tell.
     *
     * A join reached from two branches that both ran cannot be attributed to
     * either edge from spans alone. Guessing would be a claim the data does not
     * support, so the answer is "no claim".
     */
    @Test
    fun `an ambiguous inbound edge reports no claim rather than a guess`() {
        val json = graphJson(
            nodes = listOf(
                Triple("fan", "parallel", "Fan out"),
                Triple("a", "http", "A"), Triple("b", "http", "B"),
                Triple("join", "join", "Join"),
            ),
            edges = listOf(
                Triple("e1", "fan", "a"), Triple("e2", "fan", "b"),
                Triple("e3", "a", "join"), Triple("e4", "b", "join"),
            ),
        )
        val spans = listOf(
            span("run", ms = 900, spanId = "r"),
            span("step", stepId = "fan", parent = "r"),
            span("step", stepId = "a", parent = "r"),
            span("step", stepId = "b", parent = "r"),
            span("step", stepId = "join", parent = "r"),
        )

        val g = TraceGraphBuilder.build(json, spans, "succeeded")
        assertNull(g.edges.single { it.id == "e3" }.traversed,
            "two reached sources: spans cannot say which delivered control")
        assertNull(g.edges.single { it.id == "e4" }.traversed)
        /* But the unambiguous ones are still exact. */
        assertEquals(true, g.edges.single { it.id == "e1" }.traversed)
    }

    // ── ACCEPTANCE: a healthy run with warnings has something to show ────────

    /**
     * Two retries and a truncation produce three markers.
     *
     * All three leave the run GREEN. They are the difference between "this
     * worked" and "this worked this time", and today a run like this renders as
     * an unbroken row of success with nothing to look at.
     */
    @Test
    fun `a successful run with two retries and a truncation shows three warnings`() {
        val json = graphJson(
            nodes = listOf(
                Triple("fetch", "http", "Fetch"),
                Triple("enrich", "http", "Enrich"),
                Triple("summarise", "agent", "Summarise"),
            ),
            edges = listOf(Triple("e1", "fetch", "enrich"), Triple("e2", "enrich", "summarise")),
        )
        val spans = listOf(
            span("run", ms = 5_000, spanId = "r"),
            // fetch: failed once, then succeeded — one retry
            span("step", stepId = "fetch", status = "error", ms = 200, atMs = 0, parent = "r"),
            span("step", stepId = "fetch", status = "ok", ms = 180, atMs = 300, parent = "r"),
            // enrich: failed once, then succeeded — one retry
            span("step", stepId = "enrich", status = "error", ms = 90, atMs = 600, parent = "r"),
            span("step", stepId = "enrich", status = "ok", ms = 95, atMs = 800, parent = "r"),
            // summarise: fine, but the context did not fit
            span("step", stepId = "summarise", ms = 3_000, atMs = 1_000, parent = "r", spanId = "sum"),
            span("llm_call", ms = 2_900, parent = "sum",
                attrs = """{"context_truncated":true,"context_dropped_sections":3}"""),
        )

        val g = TraceGraphBuilder.build(json, spans, "succeeded")

        val all = g.nodes.flatMap { n -> n.warnings.map { n.id to it.kind } }
        assertEquals(3, all.size, "two retries and a truncation, each visible: $all")
        assertEquals(2, all.count { it.second == "retry" })
        assertEquals(1, all.count { it.second == "context_truncated" })

        /* Every node still reads as successful — the warnings are additional, not
           a downgrade. A retried-then-succeeded node is not a failure. */
        assertTrue(g.nodes.all { it.status == "ok" })
    }

    /** One node retried twice is ONE marker carrying the count, not two dots. */
    @Test
    fun `repeated retries on one node collapse into a counted marker`() {
        val json = graphJson(listOf(Triple("flaky", "http", "Flaky")), emptyList())
        val spans = listOf(
            span("run", ms = 900, spanId = "r"),
            span("step", stepId = "flaky", status = "error", atMs = 0, parent = "r"),
            span("step", stepId = "flaky", status = "error", atMs = 100, parent = "r"),
            span("step", stepId = "flaky", status = "ok", atMs = 200, parent = "r"),
        )
        val w = TraceGraphBuilder.build(json, spans, "succeeded").nodes.single().warnings
        assertEquals(1, w.size, "three identical dots on one node is not the message")
        assertEquals(2, w.single().count)
    }

    // ── ACCEPTANCE: a mostly-parked run reads as mostly parked ───────────────

    /**
     * The single most common misreading of an agent run.
     *
     * "This took 4 minutes" is heard as "the product worked for 4 minutes". Here
     * it worked for 68s and sat waiting for a human for 2m38s. Those are opposite
     * problems and the header gave them the same number.
     */
    @Test
    fun `a run parked on an approval reads as mostly parked`() {
        val spans = listOf(
            span("run", ms = 226_000, spanId = "r"),
            span("wait", name = "wait:approval", ms = 158_000, parent = "r"),
            span("step", stepId = "a", ms = 68_000, parent = "r"),
        )
        val bar = TraceGraphBuilder.runBar(spans, "succeeded")

        val parked = bar.segments.single { it.kind == "parked" }
        val working = bar.segments.single { it.kind == "working" }
        assertEquals(158_000, parked.ms)
        assertEquals(68_000, working.ms)
        assertTrue(parked.ms.toDouble() / bar.totalMs > 0.6,
            "60%+ of the wall clock was waiting and the bar must show it")
        assertEquals("Waiting for approval", parked.label,
            "'parked' is not actionable; the reason is")

        assertEquals(bar.totalMs, bar.segments.sumOf { it.ms },
            "the segments are the wall clock, so they must add up to it")
    }

    /** Queued, working and failed are separated too, and still sum to the bar. */
    @Test
    fun `a failed run carves out the time spent in the failing step`() {
        val spans = listOf(
            span("run", ms = 10_000, status = "error", spanId = "r"),
            span("wait", name = "wait:queue", ms = 2_000, parent = "r"),
            span("step", stepId = "ok-one", ms = 1_000, parent = "r"),
            span("step", stepId = "boom", status = "error", ms = 6_000, parent = "r"),
        )
        val bar = TraceGraphBuilder.runBar(spans, "failed")

        assertEquals(2_000, bar.segments.single { it.kind == "queued" }.ms)
        assertEquals(6_000, bar.segments.single { it.kind == "failed" }.ms)
        assertEquals(2_000, bar.segments.single { it.kind == "working" }.ms)
        assertEquals(bar.totalMs, bar.segments.sumOf { it.ms })
    }

    /** A segment worth nothing is absent, not a zero-width sliver. */
    @Test
    fun `empty segments are omitted`() {
        val bar = TraceGraphBuilder.runBar(
            listOf(span("run", ms = 1_000, spanId = "r"), span("step", stepId = "a", ms = 900, parent = "r")),
            "succeeded",
        )
        assertEquals(listOf("working"), bar.segments.map { it.kind })
    }

    // ── Labels ──────────────────────────────────────────────────────────────

    /**
     * Never a bare type. "Agent" tells nobody WHICH agent, and an unnamed agent
     * node is the common case because the builder auto-creates them.
     */
    @Test
    fun `an unnamed agent node borrows its activation's name`() {
        val json = """{"nodes":[{"id":"1a2b3c4d-aaaa","type":"agent","label":""}],"edges":[]}"""
        val spans = listOf(
            span("run", ms = 500, spanId = "r"),
            span("step", stepId = "1a2b3c4d-aaaa", parent = "r", spanId = "st"),
            span("activation", name = "researcher", parent = "st"),
        )
        assertEquals("researcher", TraceGraphBuilder.build(json, spans, "succeeded").nodes.single().label)
    }

    /** With no activation to borrow from, the id stays attached to the type. */
    @Test
    fun `a nameless node falls back to type and id, never type alone`() {
        val json = """{"nodes":[{"id":"1a2b3c4d-aaaa","type":"http","label":""}],"edges":[]}"""
        val label = TraceGraphBuilder.build(json, emptyList(), "succeeded").nodes.single().label
        assertEquals("HTTP · 1a2b3c4d", label)
        assertTrue(label.contains("1a2b3c4d"), "a type with no id is not a name")
    }

    /** The worker's generated `type:id8` fallback is replaced, a real label is not. */
    @Test
    fun `a real label survives and a generated one does not`() {
        val real = """{"nodes":[{"id":"1a2b3c4d-aa","type":"http","label":"Fetch: the CRM"}],"edges":[]}"""
        assertEquals("Fetch: the CRM",
            TraceGraphBuilder.build(real, emptyList(), "succeeded").nodes.single().label)

        val generated = """{"nodes":[{"id":"1a2b3c4d-aa","type":"http","label":"http:1a2b3c4d"}],"edges":[]}"""
        assertEquals("HTTP · 1a2b3c4d",
            TraceGraphBuilder.build(generated, emptyList(), "succeeded").nodes.single().label)
    }

    // ── Degraded inputs ─────────────────────────────────────────────────────

    /**
     * A run outlives the workflow version that made it.
     *
     * A deleted or unparseable version must still produce a readable trace: this
     * is the page people open when something has already gone wrong, and a 500
     * here is a second failure on top of the one they came to investigate.
     */
    @Test
    fun `an unreadable graph degrades to the nodes the spans mention`() {
        val spans = listOf(
            span("run", ms = 500, spanId = "r"),
            span("step", stepId = "a", name = "First", ms = 100, atMs = 0, parent = "r"),
            span("step", stepId = "b", name = "Second", ms = 200, atMs = 200, parent = "r"),
        )
        for (json in listOf(null, "", "{", "not json at all")) {
            val g = TraceGraphBuilder.build(json, spans, "succeeded")
            assertTrue(g.graphUnavailable, "must SAY the structure is missing, for input ${json?.take(12)}")
            assertEquals(listOf("a", "b"), g.nodes.map { it.id }, "ordered by first execution")
            assertTrue(g.edges.isEmpty(), "no structure means no edges, never invented ones")
        }
    }

    /** A run with no spans at all still renders the whole workflow, all unreached. */
    @Test
    fun `a run that never started still shows the workflow it would have run`() {
        val json = graphJson(
            nodes = listOf(Triple("a", "http", "A"), Triple("b", "http", "B")),
            edges = listOf(Triple("e", "a", "b")),
        )
        val g = TraceGraphBuilder.build(json, emptyList(), "queued")
        assertEquals(2, g.nodes.size)
        assertTrue(g.nodes.none { it.reached })
        assertEquals(false, g.edges.single().traversed)
    }

    // ── Agent and team summaries ────────────────────────────────────────────

    /** A team node says how many members ran and which one broke, unexpanded. */
    @Test
    fun `a team node summarises its activations and names the failing member`() {
        val json = """{"nodes":[{"id":"triage","type":"agent_team","label":"Triage"}],"edges":[]}"""
        val spans = listOf(
            span("run", ms = 5_000, status = "error", spanId = "r"),
            span("step", stepId = "triage", status = "error", ms = 4_800, parent = "r", spanId = "st"),
            span("activation", name = "supervisor", parent = "st"),
            span("activation", name = "researcher", status = "error", parent = "st", rootCause = true),
            span("activation", name = "writer", status = "skipped", parent = "st"),
        )
        val n = TraceGraphBuilder.build(json, spans, "failed").nodes.single()
        val s = assertNotNull(n.summary)
        assertEquals(3, s.activations)
        assertEquals("researcher", s.failingMember)
        assertEquals(listOf("supervisor", "researcher", "writer"), s.members.map { it.name })
        /* Status and duration travel with the name: a list of names answers
           neither of the questions an expanded team node is opened to answer. */
        assertEquals("error", s.members.single { it.name == "researcher" }.status)
        assertEquals("skipped", s.members.single { it.name == "writer" }.status)
        assertTrue(n.isRootCause, "the root cause is under this node, so the node carries the mark")
    }

    /**
     * A member activated three times is ONE row, with the time summed.
     *
     * Three identical rows would read as three agents, which is the same mistake
     * as one card per span at the node level.
     */
    @Test
    fun `repeated activations of one member collapse into a single row`() {
        val json = """{"nodes":[{"id":"t","type":"agent_team","label":"T"}],"edges":[]}"""
        val spans = listOf(
            span("run", ms = 900, spanId = "r"),
            span("step", stepId = "t", ms = 800, parent = "r", spanId = "st"),
            span("activation", name = "supervisor", ms = 100, parent = "st"),
            span("activation", name = "supervisor", ms = 250, parent = "st"),
            span("activation", name = "researcher", ms = 400, parent = "st"),
        )
        val s = TraceGraphBuilder.build(json, spans, "succeeded").nodes.single().summary!!
        assertEquals(3, s.activations, "three activations happened")
        assertEquals(2, s.members.size, "of two members")
        assertEquals(350, s.members.single { it.name == "supervisor" }.totalMs)
    }

    /** A node with no agents beneath it has no summary line rather than an empty one. */
    @Test
    fun `an ordinary node has no summary`() {
        val json = """{"nodes":[{"id":"a","type":"http","label":"A"}],"edges":[]}"""
        val spans = listOf(
            span("run", ms = 100, spanId = "r"),
            span("step", stepId = "a", parent = "r"),
        )
        assertNull(TraceGraphBuilder.build(json, spans, "succeeded").nodes.single().summary)
    }
}
