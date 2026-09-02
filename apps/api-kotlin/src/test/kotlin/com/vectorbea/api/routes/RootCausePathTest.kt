package com.vectorbea.api.routes

import org.junit.jupiter.api.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * The chain from the run's first activation to the one that broke.
 *
 * ── WHY THE SERVER COMPUTES THIS ────────────────────────────────────────────
 * `run_spans.is_root_cause` marks the SPAN that failed, which is usually a tool
 * call several levels below the agent worth looking at. Walking up to the owning
 * activation and then to its ancestors needs the parent links and the span tree
 * together, and the constellation view has neither.
 *
 * Emphasising the chain is what stops a reader scanning twelve nodes to find the
 * one that matters.
 */
class RootCausePathTest {

    /** supervisor → researcher → crm-worker, with an unrelated sibling. */
    private val tree = mapOf(
        "sup" to null,
        "researcher" to "sup",
        "crm" to "researcher",
        "writer" to "sup",
    )

    @Test
    fun `the path runs from the failure up to the first activation`() {
        val path = ConstellationRoutes.rootCausePath(tree, setOf("crm"))
        assertEquals(setOf("crm", "researcher", "sup"), path)
    }

    /** The siblings that had nothing to do with it are NOT emphasised. */
    @Test
    fun `an unrelated sibling is left off the path`() {
        val path = ConstellationRoutes.rootCausePath(tree, setOf("crm"))
        assertTrue("writer" !in path,
            "emphasising a sibling that had nothing to do with the failure is how a " +
            "reader ends up debugging the wrong agent")
    }

    /** Two failures produce the union, not the first one found. */
    @Test
    fun `two root causes both light their chains`() {
        val path = ConstellationRoutes.rootCausePath(tree, setOf("crm", "writer"))
        assertEquals(setOf("crm", "researcher", "sup", "writer"), path)
    }

    /** No root cause means nothing is emphasised, rather than everything. */
    @Test
    fun `no root cause emphasises nothing`() {
        assertTrue(ConstellationRoutes.rootCausePath(tree, emptySet()).isEmpty())
    }

    /**
     * A parent chain that loops back must not hang the request.
     *
     * A delegation graph is exactly the kind that can: an agent that hands back
     * to its supervisor, recorded with the supervisor as its own descendant's
     * parent, is a cycle in the parent links.
     */
    @Test
    fun `a cyclic parent chain terminates`() {
        val cyclic = mapOf("a" to "b", "b" to "c", "c" to "a")
        val path = ConstellationRoutes.rootCausePath(cyclic, setOf("a"))
        assertEquals(setOf("a", "b", "c"), path)
    }

    /** A single-activation run: the root cause is the whole path. */
    @Test
    fun `a single activation is its own path`() {
        assertEquals(setOf("only"),
            ConstellationRoutes.rootCausePath(mapOf("only" to null), setOf("only")))
    }

    /** An id with no row is kept, not dropped — it is still where the failure was. */
    @Test
    fun `an activation missing from the tree still marks itself`() {
        assertEquals(setOf("ghost"),
            ConstellationRoutes.rootCausePath(tree, setOf("ghost")))
    }
}
