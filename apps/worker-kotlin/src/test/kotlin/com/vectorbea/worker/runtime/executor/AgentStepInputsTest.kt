package com.vectorbea.worker.runtime.executor

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * What a single-call agent step is actually asked.
 *
 * Both cases were silent failures in a workflow built on the canvas: the task
 * typed on the step was stored under a key the worker did not read, and a step
 * with a task AND mapped inputs sent the task alone.
 */
class AgentStepInputsTest {

    @Test
    fun `the builder's taskOverride is read when taskInstruction is absent`() {
        assertEquals("Review these changes.", nodeTaskInstruction(mapOf("taskOverride" to "Review these changes.")))
        assertEquals("canonical", nodeTaskInstruction(mapOf("taskInstruction" to "canonical", "taskOverride" to "legacy")))
        assertNull(nodeTaskInstruction(mapOf("taskOverride" to "  ")))
    }

    @Test
    fun `a task and mapped inputs both reach the model`() {
        val content = singleCallUserContent(
            "Review these changes.",
            mapOf("changes" to listOf(mapOf("repo" to "acme/api", "title" to "Fix login")), "changeCount" to 1),
            nodeHasInstruction = true,
        )
        assertTrue(content.startsWith("Review these changes."))
        assertTrue(content.contains("INPUT DATA:"))
        assertTrue(content.contains("acme/api") && content.contains("changeCount"))
    }

    @Test
    fun `an instruction taken from the inputs is not repeated under itself`() {
        val content = singleCallUserContent("Summarise", mapOf("prompt" to "Summarise", "text" to "hello"), nodeHasInstruction = false)
        assertTrue(content.contains("\"text\""))
        assertFalse(content.contains("\"prompt\""))
    }

    @Test
    fun `output fields declared on the step become a schema and a reply format`() {
        val fields = stepOutputFields(mapOf("outputFields" to listOf(
            mapOf("name" to "changes", "type" to "array", "description" to "One entry per change"),
            mapOf("name" to "changeCount", "type" to "number"),
            mapOf("name" to "bad name", "type" to "string"),
            mapOf("name" to "changes", "type" to "string"),
        )))!!
        assertEquals(listOf("changes", "changeCount"), fields.map { it.name })

        @Suppress("UNCHECKED_CAST")
        val properties = outputFieldsSchema(fields)["properties"] as Map<String, Map<String, Any>>
        assertEquals("array", properties["changes"]!!["type"])
        assertEquals(listOf("changes", "changeCount"), outputFieldsSchema(fields)["required"])

        val format = replyFormatInstruction(fields)
        assertTrue(format.contains("- changes (list): One entry per change") && format.contains("- changeCount (number)"))
        assertNull(stepOutputFields(emptyMap()))
    }

    @Test
    fun `a fenced JSON reply still yields its fields, and every agent has a full reply`() {
        assertEquals("{\"a\":1}", stripJsonFence("```json\n{\"a\":1}\n```"))
        assertEquals("plain", stripJsonFence("  plain "))
        assertEquals("done", withFullReply(mapOf("content" to "done"))["content"])
        assertEquals("short answer", withFullReply(mapOf("answer" to "short answer"))["content"])
        assertTrue((withFullReply(mapOf("findings" to listOf("x")))["content"] as String).contains("findings"))
    }

    @Test
    fun `no instruction sends the data, and nothing sends nothing`() {
        assertTrue(singleCallUserContent(null, mapOf("a" to 1), nodeHasInstruction = false).contains("\"a\""))
        assertEquals("Only this", singleCallUserContent("Only this", emptyMap(), nodeHasInstruction = true))
        assertEquals("", singleCallUserContent(null, emptyMap(), nodeHasInstruction = false))
    }
}
