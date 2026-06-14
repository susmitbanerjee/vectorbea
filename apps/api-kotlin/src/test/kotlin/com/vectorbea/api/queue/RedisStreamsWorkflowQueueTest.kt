package com.vectorbea.api.queue

import org.junit.jupiter.api.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class RedisStreamsWorkflowQueueTest {

    private fun job(type: JobType, input: String = "{}") = WorkflowRunJob(
        runId = "run-1", workspaceId = "ws-1", environmentId = "env-1",
        workflowId = "wf-1", workflowVersionId = "ver-1", jobType = type,
        inputJson = input,
    )

    /** RESUME_RUN must never carry inputJson — the worker loads it from the DB. */
    @Test
    fun `resume message never carries inputJson`() {
        val fields = RedisStreamsWorkflowQueue.buildStreamFields(
            job(JobType.RESUME_RUN, input = """{"big":"value"}"""), maxPayloadBytes = 16_384)
        assertFalse(fields.containsKey("inputJson"), "RESUME_RUN must not carry inputJson")
        assertEquals("RESUME_RUN", fields["commandType"])
        assertTrue(fields.containsKey("runId") && fields.containsKey("workflowId"))
    }

    @Test
    fun `retry and replay messages never carry inputJson`() {
        for (t in listOf(JobType.RETRY_NODE, JobType.REPLAY_RUN)) {
            val fields = RedisStreamsWorkflowQueue.buildStreamFields(job(t, input = """{"x":1}"""), 16_384)
            assertFalse(fields.containsKey("inputJson"), "$t must not carry inputJson")
        }
    }

    /** Small START_RUN input is carried for backward compatibility. */
    @Test
    fun `small start input is carried`() {
        val fields = RedisStreamsWorkflowQueue.buildStreamFields(job(JobType.START_RUN, """{"a":1}"""), 16_384)
        assertEquals("""{"a":1}""", fields["inputJson"])
    }

    /** Oversized START_RUN input is omitted and the callback fires. */
    @Test
    fun `oversized start input is omitted and reported`() {
        val big = "{\"k\":\"" + "x".repeat(1000) + "\"}"
        var omittedBytes = -1
        val fields = RedisStreamsWorkflowQueue.buildStreamFields(
            job(JobType.START_RUN, big), maxPayloadBytes = 100,
        ) { _, bytes -> omittedBytes = bytes }
        assertFalse(fields.containsKey("inputJson"), "oversized input must be omitted from Redis")
        assertTrue(omittedBytes > 100, "omission callback should report the byte size")
    }

    @Test
    fun `reason and tenant aliases are present`() {
        val fields = RedisStreamsWorkflowQueue.buildStreamFields(
            job(JobType.START_RUN).copy(reason = "approval"), 16_384)
        assertEquals("approval", fields["reason"])
        assertEquals("approval", fields["triggeredBy"])
        assertEquals("ws-1", fields["tenantId"])
    }
}
