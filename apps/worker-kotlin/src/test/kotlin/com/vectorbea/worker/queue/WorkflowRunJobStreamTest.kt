package com.vectorbea.worker.queue

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Test
import java.util.UUID

class WorkflowRunJobStreamTest {

    private fun job() = WorkflowRunJob(
        streamMessageId = "1-0",
        jobType = WorkflowRunJob.JobType.RESUME_RUN,
        runId = UUID.randomUUID(),
        workflowId = UUID.randomUUID(),
        triggeredBy = "yielded",
        inputJson = """{"large":"payload-that-should-not-be-re-enqueued"}""",
        retryCount = 0,
        nodeId = null,
        checkpointId = null,
        workspaceId = UUID.randomUUID(),
    )

    /** The yield re-enqueue (RESUME_RUN) must never carry inputJson. */
    @Test
    fun `toStreamFields omits inputJson and carries reason`() {
        val fields = job().toStreamFields()
        assertFalse(fields.containsKey("inputJson"), "RESUME_RUN re-enqueue must not carry inputJson")
        assertEquals("yielded", fields["reason"])
        assertEquals("yielded", fields["triggeredBy"])
        assertEquals("RESUME_RUN", fields["jobType"])
    }

    /** A slim message with no inputJson parses with the default empty input. */
    @Test
    fun `parse tolerates a missing inputJson and reads reason as triggeredBy`() {
        val original = job()
        val parsed = WorkflowRunJob.parse(original.streamMessageId, original.toStreamFields())
        assertEquals("{}", parsed.inputJson, "missing inputJson defaults to empty object")
        assertEquals("yielded", parsed.triggeredBy, "reason should populate triggeredBy")
        assertEquals(original.runId, parsed.runId)
    }
}
