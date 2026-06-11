package com.vectorbea.worker.extraction

import com.vectorbea.worker.mapping.InMemoryStepOutputView
import com.vectorbea.worker.runtime.graph.RuntimeContext
import com.vectorbea.worker.runtime.graph.WorkflowGraph
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import java.util.UUID

class OutputExtractorTest {

    private val emptyCtx = RuntimeContext(
        runId             = UUID.randomUUID(),
        workspaceId       = UUID.randomUUID(),
        environmentId     = UUID.randomUUID(),
        workflowVersionId = UUID.randomUUID(),
        workflowInput     = emptyMap(),
        graph             = WorkflowGraph(),
    )
    private val emptyView = InMemoryStepOutputView()

    private fun extract(
        raw: Map<String, Any>,
        config: Map<String, Any>,
        legacy: Map<String, String> = emptyMap(),
    ) = OutputExtractor.extract(raw, config, legacy, emptyCtx, emptyView)

    // ── full_response ─────────────────────────────────────────────────────────

    @Test
    fun `full_response returns entire raw output`() {
        val raw    = mapOf("a" to 1, "b" to "hello")
        val result = extract(raw, mapOf("mode" to "full_response"))
        assertEquals(raw, result.extracted)
        assertEquals("full_response", result.mode)
    }

    // ── body ──────────────────────────────────────────────────────────────────

    @Test
    fun `body mode extracts body key`() {
        val body = mapOf("customerId" to "C1", "name" to "Alice")
        val raw  = mapOf("status" to 200, "body" to body)
        val result = extract(raw, mapOf("mode" to "body"))
        assertEquals(body, result.extracted)
        assertEquals("body", result.mode)
    }

    @Test
    fun `body mode falls back to raw when no body key`() {
        val raw    = mapOf("x" to 1)
        val result = extract(raw, mapOf("mode" to "body"))
        assertEquals(raw, result.extracted)
    }

    // ── json_path ─────────────────────────────────────────────────────────────

    @Test
    fun `json_path extracts nested value`() {
        val raw = mapOf("data" to mapOf("customers" to listOf(mapOf("id" to "C1"), mapOf("id" to "C2"))))
        val result = extract(raw, mapOf("mode" to "json_path", "path" to "$.data.customers"))
        // Returns the list wrapped in "result" key
        @Suppress("UNCHECKED_CAST")
        val customers = result.extracted["result"] as? List<*>
        assertEquals(2, customers?.size)
    }

    @Test
    fun `json_path with targetKey wraps result`() {
        val raw    = mapOf("response" to mapOf("userId" to "U99"))
        val result = extract(raw, mapOf("mode" to "json_path", "path" to "$.response.userId", "targetKey" to "id"))
        assertEquals("U99", result.extracted["id"])
    }

    @Test
    fun `json_path array index extraction`() {
        val raw    = mapOf("rows" to listOf(mapOf("id" to 1), mapOf("id" to 2)))
        val result = extract(raw, mapOf("mode" to "json_path", "path" to "$.rows[0]", "targetKey" to "first"))
        @Suppress("UNCHECKED_CAST")
        val first  = result.extracted["first"] as? Map<String, Any>
        assertEquals(1, first?.get("id"))
    }

    @Test
    fun `json_path throws when path resolves to null`() {
        val raw = mapOf("a" to 1)
        assertThrows(ExtractionException::class.java) {
            extract(raw, mapOf("mode" to "json_path", "path" to "$.nonexistent.deep"))
        }
    }

    // ── custom_mapping ────────────────────────────────────────────────────────

    @Test
    fun `custom_mapping extracts multiple fields by json_path`() {
        val raw = mapOf("body" to mapOf("id" to "C1", "fullName" to "Alice Smith"))
        val result = extract(raw, mapOf(
            "mode" to "custom_mapping",
            "fields" to mapOf(
                "customerId" to "$.body.id",
                "name"       to "$.body.fullName",
            )
        ))
        assertEquals("C1",          result.extracted["customerId"])
        assertEquals("Alice Smith", result.extracted["name"])
        assertEquals("custom_mapping", result.mode)
    }

    // ── no config (pass-through) ──────────────────────────────────────────────

    @Test
    fun `no extraction config returns full raw output`() {
        val raw    = mapOf("x" to 42)
        val result = extract(raw, emptyMap())
        assertEquals(raw, result.extracted)
    }

    // ── legacy per-field extraction ───────────────────────────────────────────

    @Test
    fun `legacy dot-path extraction`() {
        val raw    = mapOf("body" to mapOf("score" to 0.87))
        val result = extract(raw, emptyMap(), legacy = mapOf("riskScore" to "body.score"))
        assertEquals(0.87, result.extracted["riskScore"])
    }
}
