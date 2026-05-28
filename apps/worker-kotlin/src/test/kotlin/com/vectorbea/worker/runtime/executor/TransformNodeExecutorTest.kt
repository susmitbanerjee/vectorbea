package com.vectorbea.worker.runtime.executor

import com.vectorbea.worker.mapping.InMemoryStepOutputView
import com.vectorbea.worker.runtime.graph.*
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import java.util.UUID

class TransformNodeExecutorTest {

    private fun ctx(
        input: Map<String, Any> = emptyMap(),
        completedNodes: Map<String, Map<String, Any>> = emptyMap(),
        graph: WorkflowGraph = WorkflowGraph(),
    ): RuntimeContext {
        val c = RuntimeContext(
            runId             = UUID.randomUUID(),
            workspaceId       = UUID.randomUUID(),
            environmentId     = UUID.randomUUID(),
            workflowVersionId = UUID.randomUUID(),
            workflowInput     = input,
            graph             = graph,
        )
        completedNodes.forEach { (nodeId, output) ->
            c.markCompleted(nodeId)
            c.setOutput(nodeId, output)
        }
        return c
    }

    private fun view(vararg pairs: Pair<String, Map<String, Any>>): InMemoryStepOutputView {
        val v = InMemoryStepOutputView()
        pairs.forEach { (nodeId, data) ->
            v.putRaw(nodeId, data); v.putExtracted(nodeId, data); v.putValidated(nodeId, data)
        }
        return v
    }

    private fun executor(stepView: InMemoryStepOutputView = InMemoryStepOutputView()) =
        TransformNodeExecutor(stepView)

    // ── Basic pass-through ────────────────────────────────────────────────────

    @Test
    fun `empty transform returns resolved inputs unchanged`() {
        val node = WorkflowNode(id = "t1", type = "transform")
        val c    = ctx(input = mapOf("x" to 1))
        val result = executor().execute(node, mapOf("x" to 1), c)
        assertInstanceOf(NodeResult.Completed::class.java, result)
        assertEquals(1, (result as NodeResult.Completed).output["x"])
    }

    // ── Template input mapping ────────────────────────────────────────────────

    @Test
    fun `template input mapping resolves workflow input`() {
        val node = WorkflowNode(
            id = "t1", type = "transform",
            inputMapping = mapOf("customerId" to "{{ workflow.input.custId }}")
        )
        val c = ctx(input = mapOf("custId" to "C42"))
        val result = executor().execute(node, emptyMap(), c) as NodeResult.Completed
        assertEquals("C42", result.output["customerId"])
    }

    @Test
    fun `template input mapping from previous step`() {
        val prevNode = WorkflowNode(id = "fetch", type = "transform")
        val graph    = WorkflowGraph(nodes = listOf(prevNode))
        val stepData = mapOf("score" to 0.92)
        val v        = view("fetch" to stepData)

        val node = WorkflowNode(
            id = "t2", type = "transform",
            inputMapping = mapOf("riskScore" to "{{ steps.fetch.output.score }}")
        )
        val c = ctx(completedNodes = mapOf("fetch" to stepData), graph = graph)
        val result = executor(v).execute(node, emptyMap(), c) as NodeResult.Completed
        assertEquals(0.92, result.output["riskScore"])
    }

    @Test
    fun `blocked secret reference returns Failed`() {
        val node = WorkflowNode(
            id = "t1", type = "transform",
            inputMapping = mapOf("key" to "{{ secret.apiKey }}")
        )
        val c      = ctx()
        val result = executor().execute(node, emptyMap(), c)
        assertInstanceOf(NodeResult.Failed::class.java, result)
        val msg = (result as NodeResult.Failed).reason
        assertTrue(msg.contains("secret", ignoreCase = true) || msg.contains("forbidden", ignoreCase = true))
    }

    @Test
    fun `future step reference returns Failed`() {
        val futureNode = WorkflowNode(id = "future", type = "transform")
        val graph      = WorkflowGraph(nodes = listOf(futureNode))
        val node       = WorkflowNode(
            id = "t1", type = "transform",
            inputMapping = mapOf("x" to "{{ steps.future.output.value }}")
        )
        val c      = ctx(graph = graph)  // future not completed
        val result = executor().execute(node, emptyMap(), c)
        assertInstanceOf(NodeResult.Failed::class.java, result)
    }

    // ── Output mapping ────────────────────────────────────────────────────────

    @Test
    fun `output mapping renames fields`() {
        val node = WorkflowNode(
            id = "t1", type = "transform",
            outputMapping = mapOf("userId" to "input.id")
        )
        val c      = ctx()
        val result = executor().execute(node, mapOf("id" to "U1"), c) as NodeResult.Completed
        assertEquals("U1", result.output["userId"])
    }

    @Test
    fun `output mapping with literal prefix`() {
        val node = WorkflowNode(
            id = "t1", type = "transform",
            outputMapping = mapOf("source" to "literal:manual")
        )
        val c      = ctx()
        val result = executor().execute(node, emptyMap(), c) as NodeResult.Completed
        assertEquals("manual", result.output["source"])
    }

    // ── Output extraction ─────────────────────────────────────────────────────

    @Test
    fun `json_path extraction in config`() {
        val node = WorkflowNode(
            id = "t1", type = "transform",
            config = mapOf(
                "outputExtraction" to mapOf(
                    "mode" to "json_path",
                    "path" to "$.body.customer",
                    "targetKey" to "customer"
                )
            )
        )
        val inputs = mapOf("body" to mapOf("customer" to mapOf("id" to "C1", "name" to "Alice")))
        val c      = ctx()
        val result = executor().execute(node, inputs, c) as NodeResult.Completed
        @Suppress("UNCHECKED_CAST")
        val customer = result.output["customer"] as? Map<String, Any>
        assertEquals("C1",    customer?.get("id"))
        assertEquals("Alice", customer?.get("name"))
    }

    // ── Schema validation ─────────────────────────────────────────────────────

    @Test
    fun `valid output passes schema validation`() {
        val node = WorkflowNode(
            id = "t1", type = "transform",
            outputSchema = mapOf(
                "type" to "object",
                "required" to listOf("score"),
                "properties" to mapOf(
                    "score" to mapOf("type" to "number", "minimum" to 0.0, "maximum" to 1.0)
                )
            )
        )
        val c      = ctx()
        val result = executor().execute(node, mapOf("score" to 0.85), c)
        assertInstanceOf(NodeResult.Completed::class.java, result)
    }

    @Test
    fun `schema validation warning on non-strict schema`() {
        val node = WorkflowNode(
            id = "t1", type = "transform",
            outputSchema = mapOf(
                "type" to "object",
                "required" to listOf("score"),
            )
            // strictSchema not set → default false → warning, not failure
        )
        val c      = ctx()
        // Passing empty map violates required:score but strictSchema=false
        val result = executor().execute(node, emptyMap(), c)
        // Should still complete (non-strict)
        assertInstanceOf(NodeResult.Completed::class.java, result)
    }

    @Test
    fun `strict schema fails run on validation error`() {
        val node = WorkflowNode(
            id = "t1", type = "transform",
            config = mapOf("strictSchema" to true),
            outputSchema = mapOf(
                "type" to "object",
                "required" to listOf("requiredField"),
            )
        )
        val c      = ctx()
        val result = executor().execute(node, emptyMap(), c)
        assertInstanceOf(NodeResult.Failed::class.java, result)
        assertTrue((result as NodeResult.Failed).reason.contains("requiredField", ignoreCase = true))
    }
}
