package com.vectorbea.worker.queue

import org.junit.jupiter.api.Test
import org.junit.jupiter.params.ParameterizedTest
import org.junit.jupiter.params.provider.ValueSource
import java.util.UUID
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertNotNull
import kotlin.test.assertNull

class WorkflowRunJobTest {

    private val validRunId = UUID.randomUUID()
    private val validWorkflowId = UUID.randomUUID()

    // ── parse — success cases ─────────────────────────────────────────────────

    @Test
    fun `parse START_RUN with all required fields`() {
        val fields = mapOf(
            "jobType" to "START_RUN",
            "runId" to validRunId.toString(),
            "workflowId" to validWorkflowId.toString(),
            "triggeredBy" to "user-123",
            "inputJson" to """{"param":"value"}""",
            "retryCount" to "0",
        )
        val job = WorkflowRunJob.parse("1234567890-0", fields)

        assertEquals(WorkflowRunJob.JobType.START_RUN, job.jobType)
        assertEquals(validRunId, job.runId)
        assertEquals(validWorkflowId, job.workflowId)
        assertEquals("user-123", job.triggeredBy)
        assertEquals(0, job.retryCount)
        assertEquals("1234567890-0", job.streamMessageId)
    }

    @Test
    fun `parse RESUME_RUN with checkpoint id`() {
        val checkpointId = UUID.randomUUID()
        val fields = mapOf(
            "jobType" to "RESUME_RUN",
            "runId" to validRunId.toString(),
            "workflowId" to validWorkflowId.toString(),
            "checkpointId" to checkpointId.toString(),
        )
        val job = WorkflowRunJob.parse("msg-001", fields)

        assertEquals(WorkflowRunJob.JobType.RESUME_RUN, job.jobType)
        assertEquals(checkpointId, job.checkpointId)
    }

    @Test
    fun `parse RETRY_NODE with nodeId`() {
        val fields = mapOf(
            "jobType" to "RETRY_NODE",
            "runId" to validRunId.toString(),
            "workflowId" to validWorkflowId.toString(),
            "nodeId" to "step-agent-3",
            "retryCount" to "2",
        )
        val job = WorkflowRunJob.parse("msg-002", fields)

        assertEquals(WorkflowRunJob.JobType.RETRY_NODE, job.jobType)
        assertEquals("step-agent-3", job.nodeId)
        assertEquals(2, job.retryCount)
    }

    @Test
    fun `parse uses snake_case field names as fallback`() {
        val fields = mapOf(
            "job_type" to "START_RUN",
            "run_id" to validRunId.toString(),
            "workflow_id" to validWorkflowId.toString(),
        )
        val job = WorkflowRunJob.parse("msg-003", fields)
        assertEquals(WorkflowRunJob.JobType.START_RUN, job.jobType)
        assertEquals(validRunId, job.runId)
    }

    @Test
    fun `parse unknown job type maps to UNKNOWN`() {
        val fields = mapOf(
            "jobType" to "FUTURE_JOB_TYPE",
            "runId" to validRunId.toString(),
            "workflowId" to validWorkflowId.toString(),
        )
        val job = WorkflowRunJob.parse("msg-004", fields)
        assertEquals(WorkflowRunJob.JobType.UNKNOWN, job.jobType)
    }

    @Test
    fun `parse uses empty string defaults for optional fields`() {
        val fields = mapOf(
            "jobType" to "START_RUN",
            "runId" to validRunId.toString(),
            "workflowId" to validWorkflowId.toString(),
        )
        val job = WorkflowRunJob.parse("msg-005", fields)

        assertEquals("{}", job.inputJson)
        assertEquals(0, job.retryCount)
        assertNull(job.nodeId)
        assertNull(job.checkpointId)
    }

    @Test
    fun `parse missing runId throws ParseException`() {
        val fields = mapOf(
            "jobType" to "START_RUN",
            "workflowId" to validWorkflowId.toString(),
        )
        assertFailsWith<WorkflowRunJob.ParseException> {
            WorkflowRunJob.parse("msg-bad", fields)
        }
    }

    @Test
    fun `parse missing workflowId throws ParseException`() {
        val fields = mapOf(
            "jobType" to "START_RUN",
            "runId" to validRunId.toString(),
        )
        assertFailsWith<WorkflowRunJob.ParseException> {
            WorkflowRunJob.parse("msg-bad2", fields)
        }
    }

    @Test
    fun `parse invalid UUID for runId throws ParseException`() {
        val fields = mapOf(
            "jobType" to "START_RUN",
            "runId" to "not-a-uuid",
            "workflowId" to validWorkflowId.toString(),
        )
        assertFailsWith<WorkflowRunJob.ParseException> {
            WorkflowRunJob.parse("msg-bad3", fields)
        }
    }

    @Test
    fun `parse invalid checkpointId is silently ignored`() {
        val fields = mapOf(
            "jobType" to "RESUME_RUN",
            "runId" to validRunId.toString(),
            "workflowId" to validWorkflowId.toString(),
            "checkpointId" to "bad-uuid",
        )
        val job = WorkflowRunJob.parse("msg-006", fields)
        assertNull(job.checkpointId, "Invalid checkpoint UUID should be null, not throw")
    }

    // ── JobType.fromString ────────────────────────────────────────────────────

    @ParameterizedTest
    @ValueSource(strings = ["START_RUN", "start_run", "Start_Run"])
    fun `JobType fromString is case-insensitive for START_RUN`(input: String) {
        assertEquals(WorkflowRunJob.JobType.START_RUN, WorkflowRunJob.JobType.fromString(input))
    }

    @Test
    fun `JobType fromString null returns UNKNOWN`() {
        assertEquals(WorkflowRunJob.JobType.UNKNOWN, WorkflowRunJob.JobType.fromString(null))
    }

    @Test
    fun `JobType fromString empty returns UNKNOWN`() {
        assertEquals(WorkflowRunJob.JobType.UNKNOWN, WorkflowRunJob.JobType.fromString(""))
    }
}
