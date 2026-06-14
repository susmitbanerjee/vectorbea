package com.vectorbea.worker.queue

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test
import java.io.PrintWriter
import java.sql.Connection
import java.sql.SQLException
import java.util.UUID
import java.util.logging.Logger
import javax.sql.DataSource

class JobClassifierTest {

    /** A DataSource whose connections always fail — exercises the no-DB code paths. */
    private val throwingDataSource = object : DataSource {
        override fun getConnection(): Connection = throw SQLException("no db in test")
        override fun getConnection(username: String?, password: String?): Connection = throw SQLException("no db")
        override fun getLogWriter(): PrintWriter? = null
        override fun setLogWriter(out: PrintWriter?) {}
        override fun setLoginTimeout(seconds: Int) {}
        override fun getLoginTimeout(): Int = 0
        override fun getParentLogger(): Logger = Logger.getLogger("test")
        override fun <T : Any?> unwrap(iface: Class<T>): T = throw SQLException("unsupported")
        override fun isWrapperFor(iface: Class<*>?): Boolean = false
    }

    private val classifier = JobClassifier(throwingDataSource)

    private fun job(type: WorkflowRunJob.JobType, triggeredBy: String) = WorkflowRunJob(
        streamMessageId = "1-0",
        jobType = type,
        runId = UUID.randomUUID(),
        workflowId = UUID.randomUUID(),
        triggeredBy = triggeredBy,
        inputJson = "{}",
        retryCount = 0,
        nodeId = null,
        checkpointId = null,
        workspaceId = UUID.randomUUID(),
    )

    /** Phase 10 / scenario 2: timer/approval/recovery resumes are SYSTEM (never starved). */
    @Test
    fun `timer and approval resumes classify as SYSTEM`() {
        assertEquals(WorkerJobType.SYSTEM, classifier.classify(job(WorkflowRunJob.JobType.RESUME_RUN, "timer:abc")))
        assertEquals(WorkerJobType.SYSTEM, classifier.classify(job(WorkflowRunJob.JobType.RESUME_RUN, "approval:42")))
        assertEquals(WorkerJobType.SYSTEM, classifier.classify(job(WorkflowRunJob.JobType.RESUME_RUN, "crash-recovery")))
    }

    @Test
    fun `unknown jobs and unprobeable workflows default to SHORT`() {
        // START_RUN must probe the graph; the DB fails here, so it conservatively
        // falls back to SHORT rather than mis-routing to a heavy pool.
        assertEquals(WorkerJobType.SHORT, classifier.classify(job(WorkflowRunJob.JobType.START_RUN, "user")))
        assertEquals(WorkerJobType.SHORT, classifier.classify(job(WorkflowRunJob.JobType.UNKNOWN, "x")))
    }
}
