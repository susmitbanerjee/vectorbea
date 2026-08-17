package com.vectorbea.api.queue

import kotlin.test.Test
import kotlin.test.assertEquals

class GraphClassifierTest {

    private fun graph(nodes: String, edges: String = "[]") =
        """{"nodes":[$nodes],"edges":[$edges]}"""

    private fun node(id: String, type: String) = """{"id":"$id","type":"$type","config":{}}"""
    private fun edge(from: String, to: String, type: String = "default") =
        """{"id":"$from->$to","source":"$from","target":"$to","type":"$type"}"""

    // ── AGENT dominates ───────────────────────────────────────────────────────

    @Test
    fun `a single llm node makes the whole workflow agent`() {
        val g = graph(listOf(node("n0", "trigger"), node("n1", "llm"), node("n2", "end"))
            .joinToString(","))
        assertEquals(ExecutionClass.AGENT, GraphClassifier.classify(g))
    }

    @Test
    fun `an agent node makes the whole workflow agent`() {
        val g = graph(listOf(node("n0", "trigger"), node("n1", "agent")).joinToString(","))
        assertEquals(ExecutionClass.AGENT, GraphClassifier.classify(g))
    }

    @Test
    fun `agent wins over long`() {
        val g = graph(listOf(node("n0", "http"), node("n1", "llm")).joinToString(","))
        assertEquals(ExecutionClass.AGENT, GraphClassifier.classify(g))
    }

    // ── LONG ──────────────────────────────────────────────────────────────────

    @Test
    fun `an http node makes it long`() {
        val g = graph(listOf(node("n0", "trigger"), node("n1", "http")).joinToString(","))
        assertEquals(ExecutionClass.LONG, GraphClassifier.classify(g))
    }

    @Test
    fun `a tenant database node makes it long`() {
        val g = graph(listOf(node("n0", "trigger"), node("n1", "db_query")).joinToString(","))
        assertEquals(ExecutionClass.LONG, GraphClassifier.classify(g))
    }

    @Test
    fun `many nodes make it long`() {
        val nodes = (0 until 12).joinToString(",") { node("n$it", "transform") }
        assertEquals(ExecutionClass.LONG, GraphClassifier.classify(graph(nodes)))
    }

    @Test
    fun `wide parallel fan-out makes it long`() {
        val nodes = (listOf(node("p", "parallel")) + (0 until 4).map { node("b$it", "transform") })
            .joinToString(",")
        val edges = (0 until 4).joinToString(",") { edge("p", "b$it", "parallel") }
        assertEquals(ExecutionClass.LONG, GraphClassifier.classify(graph(nodes, edges)))
    }

    // ── SHORT, and the edge-counting regression ───────────────────────────────

    @Test
    fun `a small transform chain is short`() {
        val nodes = (0 until 5).joinToString(",") { node("n$it", "transform") }
        assertEquals(ExecutionClass.SHORT, GraphClassifier.classify(graph(nodes)))
    }

    /**
     * TECH-DEBT.md#D5. The worker's classifier approximated node count by
     * counting `"type":` occurrences across the raw JSON, and edges carry a
     * `type` field too — so this graph (7 nodes, 6 edges) counted as 13, crossed
     * the threshold of 12, and was routed to the 2-slot LONG pool instead of the
     * 8-slot SHORT one. Parsing properly is what fixes it.
     */
    @Test
    fun `edges do not count toward the node threshold`() {
        val nodes = (listOf(node("n0", "trigger")) +
            (1..5).map { node("n$it", "transform") } +
            listOf(node("nEnd", "end"))).joinToString(",")
        val ids = listOf("n0", "n1", "n2", "n3", "n4", "n5", "nEnd")
        val edges = ids.zipWithNext().joinToString(",") { (a, b) -> edge(a, b) }

        // 7 nodes + 6 edges = 13 `"type"` occurrences; only the 7 nodes count.
        assertEquals(ExecutionClass.SHORT, GraphClassifier.classify(graph(nodes, edges)))
    }

    // ── Robustness: never throw, never block a run ────────────────────────────

    @Test
    fun `unparseable graph falls back to short`() {
        assertEquals(ExecutionClass.SHORT, GraphClassifier.classify("{not json"))
        assertEquals(ExecutionClass.SHORT, GraphClassifier.classify(""))
        assertEquals(ExecutionClass.SHORT, GraphClassifier.classify(null))
        assertEquals(ExecutionClass.SHORT, GraphClassifier.classify("""{"nodes":"nope"}"""))
    }

    @Test
    fun `classification is deterministic — the memo depends on it`() {
        val g = graph(listOf(node("n0", "trigger"), node("n1", "llm")).joinToString(","))
        val first = GraphClassifier.classify(g)
        repeat(10) { assertEquals(first, GraphClassifier.classify(g)) }
    }

    // ── Wire mapping ──────────────────────────────────────────────────────────

    @Test
    fun `stream keys and groups are derived from the class`() {
        assertEquals("runs.agent", ExecutionClass.AGENT.streamKey)
        assertEquals("runs.short", ExecutionClass.SHORT.streamKey)
        assertEquals("runs.agent.workers", ExecutionClass.AGENT.consumerGroup)
    }

    @Test
    fun `unknown wire values fall back to short rather than throwing`() {
        assertEquals(ExecutionClass.SHORT, ExecutionClass.fromWire(null))
        assertEquals(ExecutionClass.SHORT, ExecutionClass.fromWire(""))
        assertEquals(ExecutionClass.SHORT, ExecutionClass.fromWire("nonsense"))
        assertEquals(ExecutionClass.AGENT, ExecutionClass.fromWire("AGENT"))
        assertEquals(ExecutionClass.LONG, ExecutionClass.fromWire(" long "))
    }
}
