package com.vectorbea.worker.mapping

import com.vectorbea.worker.runtime.graph.*
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.assertThrows
import java.util.UUID

class MappingResolverTest {

    private fun ctx(
        input: Map<String, Any> = emptyMap(),
        completedNodes: Set<String> = emptySet(),
        graph: WorkflowGraph = WorkflowGraph(),
    ): RuntimeContext {
        val c = RuntimeContext(
            runId             = UUID.fromString("00000000-0000-0000-0000-000000000001"),
            workspaceId       = UUID.fromString("00000000-0000-0000-0000-000000000002"),
            environmentId     = UUID.fromString("00000000-0000-0000-0000-000000000003"),
            workflowVersionId = UUID.fromString("00000000-0000-0000-0000-000000000004"),
            workflowInput     = input,
            graph             = graph,
        )
        completedNodes.forEach { c.markCompleted(it) }
        return c
    }

    private fun view(vararg pairs: Pair<String, Map<String, Any>>): InMemoryStepOutputView {
        val v = InMemoryStepOutputView()
        pairs.forEach { (nodeId, output) ->
            v.putRaw(nodeId, output)
            v.putExtracted(nodeId, output)
            v.putValidated(nodeId, output)
        }
        return v
    }

    // ── workflow.input resolution ─────────────────────────────────────────────

    @Test
    fun `resolves workflow input template`() {
        val c = ctx(input = mapOf("customerId" to "C123"))
        val result = MappingResolver.resolveTemplateString("{{ workflow.input.customerId }}", c, view())
        assertEquals("C123", result)
    }

    @Test
    fun `resolves nested workflow input`() {
        val c = ctx(input = mapOf("customer" to mapOf("id" to 42)))
        val result = MappingResolver.resolveTemplateString("{{ workflow.input.customer.id }}", c, view())
        assertEquals(42, result)
    }

    @Test
    fun `resolves mixed string with template`() {
        val c = ctx(input = mapOf("name" to "Alice"))
        val result = MappingResolver.resolveTemplateString("Hello {{ workflow.input.name }}!", c, view())
        assertEquals("Hello Alice!", result)
    }

    @Test
    fun `missing workflow input key resolves to null so callers can default it`() {
        // Intentional leniency: triggers without input must not hard-fail mapping —
        // the caller supplies defaults or passes NULL (e.g. SQL params).
        val c = ctx(input = emptyMap())
        val result = MappingResolver.resolveTemplateString("{{ workflow.input.missing }}", c, view())
        assertNull(result)
    }

    // ── run.* resolution ──────────────────────────────────────────────────────

    @Test
    fun `resolves run id`() {
        val c = ctx()
        val result = MappingResolver.resolveTemplateString("{{ run.id }}", c, view())
        assertEquals("00000000-0000-0000-0000-000000000001", result)
    }

    @Test
    fun `throws for unknown run field`() {
        val c = ctx()
        assertThrows<MappingException> {
            MappingResolver.resolveTemplateString("{{ run.secretKey }}", c, view())
        }
    }

    // ── steps.*.output resolution ─────────────────────────────────────────────

    @Test
    fun `resolves step output from completed step`() {
        val node = WorkflowNode(id = "step1", type = "transform")
        val graph = WorkflowGraph(nodes = listOf(node))
        val c = ctx(completedNodes = setOf("step1"), graph = graph)
        val v = view("step1" to mapOf("customer" to mapOf("id" to "C999")))

        val result = MappingResolver.resolveTemplateString(
            "{{ steps.step1.output.extracted.customer.id }}", c, v
        )
        assertEquals("C999", result)
    }

    @Test
    fun `resolves step output without tier (defaults to validated)`() {
        val node = WorkflowNode(id = "fetch", type = "transform")
        val graph = WorkflowGraph(nodes = listOf(node))
        val c = ctx(completedNodes = setOf("fetch"), graph = graph)
        val v = view("fetch" to mapOf("score" to 0.95))

        val result = MappingResolver.resolveTemplateString("{{ steps.fetch.output.score }}", c, v)
        assertEquals(0.95, result)
    }

    @Test
    fun `throws for future step reference`() {
        val node = WorkflowNode(id = "step2", type = "transform")
        val graph = WorkflowGraph(nodes = listOf(node))
        val c = ctx(completedNodes = emptySet(), graph = graph) // step2 not completed

        assertThrows<MappingException> {
            MappingResolver.resolveTemplateString("{{ steps.step2.output.result }}", c, view())
        }
    }

    @Test
    fun `throws for non-existent step`() {
        val c = ctx(completedNodes = emptySet())
        assertThrows<MappingException> {
            MappingResolver.resolveTemplateString("{{ steps.ghost.output.x }}", c, view())
        }
    }

    // ── Security: blocked namespaces ──────────────────────────────────────────

    @Test
    fun `blocks secret namespace`() {
        val c = ctx()
        assertThrows<MappingException> {
            MappingResolver.resolveTemplateString("{{ secret.apiKey }}", c, view())
        }
    }

    @Test
    fun `blocks env namespace`() {
        val c = ctx()
        assertThrows<MappingException> {
            MappingResolver.resolveTemplateString("{{ env.DATABASE_URL }}", c, view())
        }
    }

    @Test
    fun `blocks system namespace`() {
        val c = ctx()
        assertThrows<MappingException> {
            MappingResolver.resolveTemplateString("{{ system.property }}", c, view())
        }
    }

    @Test
    fun `blocks process namespace`() {
        val c = ctx()
        assertThrows<MappingException> {
            MappingResolver.resolveTemplateString("{{ process.env.SECRET }}", c, view())
        }
    }

    @Test
    fun `throws for unknown namespace`() {
        val c = ctx()
        assertThrows<MappingException> {
            MappingResolver.resolveTemplateString("{{ db.query }}", c, view())
        }
    }

    // ── resolveMapping ────────────────────────────────────────────────────────

    @Test
    fun `resolveMapping returns map of resolved values`() {
        val c = ctx(input = mapOf("userId" to "U1", "amount" to 100))
        val mapping = mapOf(
            "id"  to "{{ workflow.input.userId }}",
            "amt" to "{{ workflow.input.amount }}",
        )
        val result = MappingResolver.resolveMapping(mapping, c, view())
        assertEquals("U1", result["id"])
        assertEquals(100,  result["amt"])
    }

    // ── Literal strings (no templates) ───────────────────────────────────────

    @Test
    fun `plain string with no template is returned as-is`() {
        val c = ctx()
        val result = MappingResolver.resolveTemplateString("hello world", c, view())
        assertEquals("hello world", result)
    }
}
