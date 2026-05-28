package com.vectorbea.worker.runtime.executor

import com.vectorbea.worker.runtime.checkpoint.ApprovalRow
import com.vectorbea.worker.runtime.checkpoint.ApprovalStore
import com.vectorbea.worker.runtime.graph.RuntimeContext
import com.vectorbea.worker.runtime.graph.WorkflowGraph
import com.vectorbea.worker.runtime.graph.WorkflowNode
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import java.util.UUID

/**
 * Tests for [ApprovalNodeExecutor] — specifically the idempotent approval check
 * that prevents duplicate approval rows when a run is resumed.
 */
class ApprovalNodeExecutorTest {

    private val runId         = UUID.randomUUID()
    private val workspaceId   = UUID.randomUUID()
    private val environmentId = UUID.randomUUID()

    private fun ctx() = RuntimeContext(
        runId             = runId,
        workspaceId       = workspaceId,
        environmentId     = environmentId,
        workflowVersionId = UUID.randomUUID(),
        workflowInput     = emptyMap(),
        graph             = WorkflowGraph(emptyList(), emptyList()),
    )

    private fun node(nodeId: String = "ap1", msg: String = "Please review") = WorkflowNode(
        id     = nodeId,
        type   = "approval",
        config = mapOf("message" to msg),
    )

    // ── No existing approval row → create new PENDING row ────────────────────

    @Test
    fun `no existing approval creates new pending approval`() {
        val store = object : ApprovalStore(noopDataSource()) {
            var createCalled = false
            override fun findApproval(runId: UUID, nodeId: String): ApprovalRow? = null
            override fun createPendingApproval(
                runId: UUID, workspaceId: UUID, environmentId: UUID,
                nodeId: String, message: String, approvers: List<String>,
                resolvedInputs: Map<String, Any>,
            ): String {
                createCalled = true
                return UUID.randomUUID().toString()
            }
        }

        val executor = ApprovalNodeExecutor(store)
        val result = executor.execute(node(), emptyMap(), ctx())

        assertTrue(store.createCalled, "Should have created a new approval row")
        assertInstanceOf(NodeResult.ApprovalPaused::class.java, result)
    }

    // ── Existing PENDING row → re-pause without creating duplicate ───────────

    @Test
    fun `existing PENDING approval re-pauses without creating duplicate`() {
        val existingId = UUID.randomUUID()
        val store = object : ApprovalStore(noopDataSource()) {
            var createCalled = false
            override fun findApproval(runId: UUID, nodeId: String) = ApprovalRow(
                id = existingId, runId = runId, nodeId = nodeId,
                status = "PENDING", message = "Please review", resolvedBy = null,
            )
            override fun createPendingApproval(
                runId: UUID, workspaceId: UUID, environmentId: UUID,
                nodeId: String, message: String, approvers: List<String>,
                resolvedInputs: Map<String, Any>,
            ): String { createCalled = true; return UUID.randomUUID().toString() }
        }

        val executor = ApprovalNodeExecutor(store)
        val result = executor.execute(node(), emptyMap(), ctx())

        assertFalse(store.createCalled, "Must NOT create duplicate approval row")
        val paused = assertInstanceOf(NodeResult.ApprovalPaused::class.java, result)
        assertEquals(existingId.toString(), paused.approvalId)
    }

    // ── APPROVED row → Completed ──────────────────────────────────────────────

    @Test
    fun `existing APPROVED row returns Completed`() {
        val existingId = UUID.randomUUID()
        val store = object : ApprovalStore(noopDataSource()) {
            override fun findApproval(runId: UUID, nodeId: String) = ApprovalRow(
                id = existingId, runId = runId, nodeId = nodeId,
                status = "APPROVED", message = null, resolvedBy = "alice@example.com",
            )
            override fun createPendingApproval(
                runId: UUID, workspaceId: UUID, environmentId: UUID,
                nodeId: String, message: String, approvers: List<String>,
                resolvedInputs: Map<String, Any>,
            ): String = error("Should not create new row")
        }

        val result = ApprovalNodeExecutor(store).execute(node(), emptyMap(), ctx())

        val completed = assertInstanceOf(NodeResult.Completed::class.java, result)
        assertEquals("approved", completed.output["decision"])
        assertEquals("alice@example.com", completed.output["resolvedBy"])
    }

    // ── REJECTED row → Failed ─────────────────────────────────────────────────

    @Test
    fun `existing REJECTED row returns Failed`() {
        val existingId = UUID.randomUUID()
        val store = object : ApprovalStore(noopDataSource()) {
            override fun findApproval(runId: UUID, nodeId: String) = ApprovalRow(
                id = existingId, runId = runId, nodeId = nodeId,
                status = "REJECTED", message = null, resolvedBy = "bob@example.com",
            )
            override fun createPendingApproval(
                runId: UUID, workspaceId: UUID, environmentId: UUID,
                nodeId: String, message: String, approvers: List<String>,
                resolvedInputs: Map<String, Any>,
            ): String = error("Should not create new row")
        }

        val result = ApprovalNodeExecutor(store).execute(node(), emptyMap(), ctx())

        val failed = assertInstanceOf(NodeResult.Failed::class.java, result)
        assertTrue(failed.reason.contains("rejected", ignoreCase = true))
    }

    // ── Status case-insensitivity ──────────────────────────────────────────────

    @Test
    fun `lowercase approved status is handled correctly`() {
        val store = object : ApprovalStore(noopDataSource()) {
            override fun findApproval(runId: UUID, nodeId: String) = ApprovalRow(
                id = UUID.randomUUID(), runId = runId, nodeId = nodeId,
                status = "approved",   // lowercase from DB
                message = null, resolvedBy = null,
            )
            override fun createPendingApproval(
                runId: UUID, workspaceId: UUID, environmentId: UUID,
                nodeId: String, message: String, approvers: List<String>,
                resolvedInputs: Map<String, Any>,
            ): String = error("Should not create new row")
        }

        val result = ApprovalNodeExecutor(store).execute(node(), emptyMap(), ctx())
        assertInstanceOf(NodeResult.Completed::class.java, result)
    }
}

// ── Test helpers ──────────────────────────────────────────────────────────────

private fun noopDataSource(): javax.sql.DataSource =
    object : javax.sql.DataSource, java.io.PrintWriter(java.io.StringWriter()) {
        override fun getConnection() = throw UnsupportedOperationException("stub")
        override fun getConnection(u: String?, p: String?) = throw UnsupportedOperationException("stub")
        override fun getLogWriter() = java.io.PrintWriter(java.io.StringWriter())
        override fun setLogWriter(pw: java.io.PrintWriter?) {}
        override fun setLoginTimeout(s: Int) {}
        override fun getLoginTimeout() = 0
        override fun getParentLogger() = java.util.logging.Logger.getAnonymousLogger()
        override fun <T : Any?> unwrap(iface: Class<T>?) = throw UnsupportedOperationException()
        override fun isWrapperFor(iface: Class<*>?) = false
    }
