package com.vectorbea.worker.runtime.executor

import kotlinx.coroutines.runBlocking

import com.vectorbea.worker.runtime.checkpoint.ApprovalRow
import com.vectorbea.worker.runtime.checkpoint.ApprovalGateConfig
import com.vectorbea.worker.runtime.checkpoint.ApprovalStore
import com.vectorbea.worker.runtime.graph.RuntimeContext
import com.vectorbea.graph.WorkflowGraph
import com.vectorbea.graph.WorkflowNode
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
    fun `no existing approval creates new pending approval`(): Unit = runBlocking {
        val store = object : ApprovalStore(noopDataSource()) {
            var createCalled = false
            override fun findApproval(runId: UUID, nodeId: String): ApprovalRow? = null
            override fun createPendingApproval(
                runId: UUID, workspaceId: UUID, environmentId: UUID,
                nodeId: String, message: String, approvers: List<String>,
                resolvedInputs: Map<String, Any>,
                gate: ApprovalGateConfig,
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
    fun `existing PENDING approval re-pauses without creating duplicate`(): Unit = runBlocking {
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
                gate: ApprovalGateConfig,
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
    fun `existing APPROVED row returns Completed`(): Unit = runBlocking {
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
                gate: ApprovalGateConfig,
            ): String = error("Should not create new row")
        }

        val result = ApprovalNodeExecutor(store).execute(node(), emptyMap(), ctx())

        val completed = assertInstanceOf(NodeResult.Completed::class.java, result)
        assertEquals("approved", completed.output["decision"])
        assertEquals("alice@example.com", completed.output["resolvedBy"])
    }

    // ── The canvas configuration reaches the gate ─────────────────────────────
    //
    // The inspector has always offered an approver group, an SLA, a timeout
    // behaviour and a table of decision-context bindings. This executor read
    // `message` and `approvers` and nothing else, so none of it reached the row —
    // and the Approvals page filled the gap with `slaMs: 1` and
    // `approverGroup: "Not provided by API"`.

    @Test
    fun `the gate carries the approver group, SLA and timeout behaviour`(): Unit = runBlocking {
        var captured: ApprovalGateConfig? = null
        val store = object : ApprovalStore(noopDataSource()) {
            override fun findApproval(runId: UUID, nodeId: String): ApprovalRow? = null
            override fun createPendingApproval(
                runId: UUID, workspaceId: UUID, environmentId: UUID,
                nodeId: String, message: String, approvers: List<String>,
                resolvedInputs: Map<String, Any>,
                gate: ApprovalGateConfig,
            ): String {
                captured = gate
                return UUID.randomUUID().toString()
            }
        }

        val node = WorkflowNode(
            id = "n1", type = "approval", label = "Refund over 500",
            config = mapOf(
                "message" to "Approve the refund",
                "approverGroup" to "admin",
                "slaMinutes" to 240,
                "onTimeout" to "escalate",
                "riskLevel" to "high",
            ),
        )

        ApprovalNodeExecutor(store).execute(node, emptyMap(), ctx())

        val gate = requireNotNull(captured) { "the gate config should have been passed to the store" }
        assertEquals("admin", gate.approverGroup)
        assertEquals(240, gate.slaMinutes)
        assertEquals("escalate", gate.onTimeout)
        assertEquals("high", gate.riskLevel)
    }

    @Test
    fun `decision context is stored RESOLVED, with the expression kept as evidence`(): Unit = runBlocking {
        // V027 is explicit that decision_context_json holds resolved values, not
        // templates: an approver cannot decide from "{{ amount }}".
        var captured: ApprovalGateConfig? = null
        val store = object : ApprovalStore(noopDataSource()) {
            override fun findApproval(runId: UUID, nodeId: String): ApprovalRow? = null
            override fun createPendingApproval(
                runId: UUID, workspaceId: UUID, environmentId: UUID,
                nodeId: String, message: String, approvers: List<String>,
                resolvedInputs: Map<String, Any>,
                gate: ApprovalGateConfig,
            ): String {
                captured = gate
                return UUID.randomUUID().toString()
            }
        }

        val node = WorkflowNode(
            id = "n1", type = "approval",
            config = mapOf(
                "contextFields" to listOf(
                    mapOf("label" to "Amount", "expression" to "{{ amount }}"),
                    mapOf("label" to "Account", "expression" to "{{ missing }}"),
                ),
            ),
        )

        ApprovalNodeExecutor(store).execute(node, mapOf("amount" to 1250), ctx())

        val gate = requireNotNull(captured)
        assertEquals(1250, gate.decisionContext["Amount"])
        // A binding that resolves to nothing is recorded as unresolved rather than
        // dropped: a blank row tells the approver the gate is misconfigured, a
        // missing row looks like a gate with less context than it was given.
        assertEquals("(unresolved)", gate.decisionContext["Account"])
        @Suppress("UNCHECKED_CAST")
        val amountEvidence = gate.evidenceRefs["Amount"] as Map<String, Any?>
        assertEquals("{{ amount }}", amountEvidence["expression"])
        assertEquals(true, amountEvidence["resolved"])
    }

    // ── REJECTED row → Failed ─────────────────────────────────────────────────

    @Test
    fun `existing REJECTED row returns Failed`(): Unit = runBlocking {
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
                gate: ApprovalGateConfig,
            ): String = error("Should not create new row")
        }

        val result = ApprovalNodeExecutor(store).execute(node(), emptyMap(), ctx())

        val failed = assertInstanceOf(NodeResult.Failed::class.java, result)
        assertTrue(failed.reason.contains("rejected", ignoreCase = true))
    }

    // ── Status case-insensitivity ──────────────────────────────────────────────

    @Test
    fun `lowercase approved status is handled correctly`(): Unit = runBlocking {
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
                gate: ApprovalGateConfig,
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
