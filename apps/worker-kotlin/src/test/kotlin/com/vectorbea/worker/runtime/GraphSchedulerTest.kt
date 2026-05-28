package com.vectorbea.worker.runtime

import com.vectorbea.worker.runtime.graph.*
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import java.util.UUID

class GraphSchedulerTest {

    // ── Helpers ───────────────────────────────────────────────────────────────

    private fun node(id: String, type: NodeType) = WorkflowNode(id = id, type = type.value)

    private fun edge(id: String, from: String, to: String, type: EdgeType = EdgeType.DEFAULT, cond: String? = null) =
        WorkflowEdge(id = id, source = from, target = to, type = type.value, condition = cond)

    private fun ctx(graph: WorkflowGraph) = RuntimeContext(
        runId             = UUID.randomUUID(),
        workspaceId       = UUID.randomUUID(),
        environmentId     = UUID.randomUUID(),
        workflowVersionId = UUID.randomUUID(),
        workflowInput     = emptyMap(),
        graph             = graph,
    )

    // ── findStartNode ─────────────────────────────────────────────────────────

    @Test
    fun `findStartNode returns trigger node`() {
        val trigger = node("t1", NodeType.TRIGGER)
        val end     = node("e1", NodeType.END)
        val graph   = WorkflowGraph(nodes = listOf(trigger, end), edges = emptyList())
        val result  = GraphScheduler(graph).findStartNode()
        assertEquals("t1", result.id)
    }

    @Test
    fun `findStartNode throws when no trigger`() {
        val graph = WorkflowGraph(nodes = listOf(node("n1", NodeType.TRANSFORM)), edges = emptyList())
        assertThrows(InvalidGraphException::class.java) {
            GraphScheduler(graph).findStartNode()
        }
    }

    @Test
    fun `findStartNode throws when multiple triggers`() {
        val graph = WorkflowGraph(
            nodes = listOf(node("t1", NodeType.TRIGGER), node("t2", NodeType.TRIGGER)),
            edges = emptyList()
        )
        assertThrows(InvalidGraphException::class.java) {
            GraphScheduler(graph).findStartNode()
        }
    }

    // ── findRunnableNodes ─────────────────────────────────────────────────────

    @Test
    fun `trigger node is always runnable (no inbound edges)`() {
        val trigger = node("t1", NodeType.TRIGGER)
        val graph   = WorkflowGraph(nodes = listOf(trigger), edges = emptyList())
        val c       = ctx(graph)
        val runnable = GraphScheduler(graph).findRunnableNodes(c)
        assertEquals(listOf("t1"), runnable.map { it.id })
    }

    @Test
    fun `downstream node is not runnable until its inbound edge is selected`() {
        val trigger   = node("t1", NodeType.TRIGGER)
        val transform = node("n1", NodeType.TRANSFORM)
        val e1        = edge("e1", "t1", "n1")
        val graph     = WorkflowGraph(nodes = listOf(trigger, transform), edges = listOf(e1))
        val c         = ctx(graph)

        // Before edge selection — only trigger is runnable
        val before = GraphScheduler(graph).findRunnableNodes(c)
        assertEquals(listOf("t1"), before.map { it.id })

        // After trigger completes and edge is selected
        c.markCompleted("t1")
        c.selectEdge("e1")

        val after = GraphScheduler(graph).findRunnableNodes(c)
        assertEquals(listOf("n1"), after.map { it.id })
    }

    @Test
    fun `completed nodes are not returned as runnable`() {
        val trigger = node("t1", NodeType.TRIGGER)
        val graph   = WorkflowGraph(nodes = listOf(trigger), edges = emptyList())
        val c       = ctx(graph)
        c.markCompleted("t1")
        val runnable = GraphScheduler(graph).findRunnableNodes(c)
        assertTrue(runnable.isEmpty())
    }

    // ── selectEdgesAfterNode ──────────────────────────────────────────────────

    @Test
    fun `selectEdgesAfterNode selects DEFAULT successor edge`() {
        val trigger   = node("t1", NodeType.TRIGGER)
        val transform = node("n1", NodeType.TRANSFORM)
        val e1        = edge("e1", "t1", "n1")
        val graph     = WorkflowGraph(nodes = listOf(trigger, transform), edges = listOf(e1))
        val c         = ctx(graph)

        val selected = GraphScheduler(graph).selectEdgesAfterNode(trigger, emptyMap(), c)
        assertEquals(listOf("e1"), selected.map { it.id })
        assertTrue(c.isEdgeSelected("e1"))
    }

    @Test
    fun `selectEdgesAfterNode selects matching branch edge`() {
        val branch = node("b1", NodeType.BRANCH)
        val left   = node("left", NodeType.TRANSFORM)
        val right  = node("right", NodeType.TRANSFORM)
        val eLeft  = edge("eL", "b1", "left",  EdgeType.BRANCH, cond = "output.choice == \"left\"")
        val eRight = edge("eR", "b1", "right", EdgeType.BRANCH, cond = "output.choice == \"right\"")
        val graph  = WorkflowGraph(nodes = listOf(branch, left, right), edges = listOf(eLeft, eRight))
        val c      = ctx(graph)

        val output   = mapOf("choice" to "left")
        val selected = GraphScheduler(graph).selectEdgesAfterNode(branch, output, c)

        assertEquals(listOf("eL"), selected.map { it.id })
        assertTrue(c.isEdgeSelected("eL"))
        assertFalse(c.isEdgeSelected("eR"))
    }

    @Test
    fun `END node selects no edges`() {
        val end   = node("end", NodeType.END)
        val graph = WorkflowGraph(nodes = listOf(end), edges = emptyList())
        val c     = ctx(graph)
        val selected = GraphScheduler(graph).selectEdgesAfterNode(end, emptyMap(), c)
        assertTrue(selected.isEmpty())
    }

    // ── validateGraph ─────────────────────────────────────────────────────────

    @Test
    fun `validateGraph passes for minimal valid graph`() {
        val graph  = WorkflowGraph(nodes = listOf(node("t", NodeType.TRIGGER)), edges = emptyList())
        val errors = GraphScheduler(graph).validateGraph()
        assertTrue(errors.isEmpty())
    }

    @Test
    fun `validateGraph fails for graph with dangling edge`() {
        val trigger = node("t", NodeType.TRIGGER)
        val e       = edge("e1", "t", "nonexistent")
        val graph   = WorkflowGraph(nodes = listOf(trigger), edges = listOf(e))
        val errors  = GraphScheduler(graph).validateGraph()
        assertTrue(errors.any { it.contains("nonexistent") })
    }

    // ── joinIsReady ───────────────────────────────────────────────────────────

    @Test
    fun `joinIsReady wait_all requires all inbound edges selected`() {
        val parallel = node("p1", NodeType.PARALLEL)
        val branch1  = node("b1", NodeType.TRANSFORM)
        val branch2  = node("b2", NodeType.TRANSFORM)
        val join     = WorkflowNode(id = "j1", type = "join", config = mapOf("joinPolicy" to "wait_all"))
        val ep1      = edge("ep1", "p1", "b1", EdgeType.PARALLEL)
        val ep2      = edge("ep2", "p1", "b2", EdgeType.PARALLEL)
        val ej1      = edge("ej1", "b1", "j1")
        val ej2      = edge("ej2", "b2", "j1")
        val graph    = WorkflowGraph(
            nodes = listOf(parallel, branch1, branch2, join),
            edges = listOf(ep1, ep2, ej1, ej2)
        )
        val c        = ctx(graph)
        val scheduler = GraphScheduler(graph)

        // Before any branch — not ready
        assertFalse(scheduler.joinIsReady(join, c))

        // After branch1 completes and ej1 is selected — still not ready (wait_all)
        c.markCompleted("b1")
        c.selectEdge("ej1")
        assertFalse(scheduler.joinIsReady(join, c))

        // After branch2 also completes
        c.markCompleted("b2")
        c.selectEdge("ej2")
        assertTrue(scheduler.joinIsReady(join, c))
    }

    // ── isRunComplete ─────────────────────────────────────────────────────────

    @Test
    fun `isRunComplete returns true when END node is completed`() {
        val trigger = node("t1", NodeType.TRIGGER)
        val end     = node("e1", NodeType.END)
        val e1      = edge("e1", "t1", "e1")
        val graph   = WorkflowGraph(nodes = listOf(trigger, end), edges = listOf(e1))
        val c       = ctx(graph)
        assertFalse(GraphScheduler(graph).isRunComplete(c))
        c.markCompleted("t1")
        c.markCompleted("e1")
        assertTrue(GraphScheduler(graph).isRunComplete(c))
    }

    // ── detectDeadlock ────────────────────────────────────────────────────────

    @Test
    fun `detectDeadlock identifies blocked node when its source fails`() {
        val trigger   = node("t1", NodeType.TRIGGER)
        val transform = node("n1", NodeType.TRANSFORM)
        val e1        = edge("e1", "t1", "n1")
        val graph     = WorkflowGraph(nodes = listOf(trigger, transform), edges = listOf(e1))
        val c         = ctx(graph)

        // Trigger fails, edge never selected
        c.markFailed("t1")

        val deadlocked = GraphScheduler(graph).detectDeadlock(c)
        assertTrue(deadlocked.contains("n1"))
    }
}
