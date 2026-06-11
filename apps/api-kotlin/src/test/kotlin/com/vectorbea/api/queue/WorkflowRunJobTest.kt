package com.vectorbea.api.queue

import org.junit.jupiter.api.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotEquals
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

class WorkflowRunJobTest {

    @Test
    fun `default jobId is non-null UUID`() {
        val job = WorkflowRunJob(
            runId = "run-1", workspaceId = "ws-1", environmentId = "env-1",
            workflowId = "wf-1", workflowVersionId = "ver-1", jobType = JobType.START_RUN,
        )
        assertNotNull(job.jobId)
        assertTrue(job.jobId.matches(Regex("[0-9a-f-]{36}")), "jobId should be a UUID")
    }

    @Test
    fun `two jobs have different default jobIds`() {
        val base = WorkflowRunJob(
            runId = "run-1", workspaceId = "ws-1", environmentId = "env-1",
            workflowId = "wf-1", workflowVersionId = "ver-1", jobType = JobType.START_RUN,
        )
        val other = base.copy()  // copies same jobId
        val fresh = WorkflowRunJob(
            runId = "run-1", workspaceId = "ws-1", environmentId = "env-1",
            workflowId = "wf-1", workflowVersionId = "ver-1", jobType = JobType.START_RUN,
        )
        assertNotEquals(base.jobId, fresh.jobId)
        assertEquals(base.jobId, other.jobId)  // copy preserves jobId
    }

    @Test
    fun `default attempt is 0`() {
        val job = WorkflowRunJob(
            runId = "run-1", workspaceId = "ws-1", environmentId = "env-1",
            workflowId = "wf-1", workflowVersionId = "ver-1", jobType = JobType.START_RUN,
        )
        assertEquals(0, job.attempt)
    }

    @Test
    fun `default inputJson is empty object`() {
        val job = WorkflowRunJob(
            runId = "run-1", workspaceId = "ws-1", environmentId = "env-1",
            workflowId = "wf-1", workflowVersionId = "ver-1", jobType = JobType.START_RUN,
        )
        assertEquals("{}", job.inputJson)
    }

    @Test
    fun `all job types are represented`() {
        val types = JobType.entries.toSet()
        assertTrue(JobType.START_RUN in types)
        assertTrue(JobType.RESUME_RUN in types)
        assertTrue(JobType.RETRY_NODE in types)
        assertTrue(JobType.REPLAY_RUN in types)
    }

    @Test
    fun `WorkflowQueueException carries message and cause`() {
        val cause = RuntimeException("redis down")
        val ex = WorkflowQueueException("enqueue failed", cause)
        assertEquals("enqueue failed", ex.message)
        assertEquals(cause, ex.cause)
    }

    @Test
    fun `WorkflowQueueException can be created without cause`() {
        val ex = WorkflowQueueException("no redis")
        assertEquals("no redis", ex.message)
    }
}
