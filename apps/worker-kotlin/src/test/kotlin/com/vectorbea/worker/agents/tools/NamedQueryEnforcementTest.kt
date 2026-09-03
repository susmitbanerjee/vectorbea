package com.vectorbea.worker.agents.tools

import com.vectorbea.worker.runtime.executor.NodeResult
import com.vectorbea.worker.runtime.executor.ToolNodeExecutor
import com.vectorbea.worker.runtime.graph.RuntimeContext
import com.vectorbea.worker.testsupport.Infra
import com.vectorbea.worker.testsupport.RecordingEventStore
import com.vectorbea.worker.testsupport.noOpDataSource
import com.vectorbea.graph.WorkflowGraph
import com.vectorbea.graph.WorkflowNode
import kotlinx.coroutines.runBlocking
import org.junit.jupiter.api.Tag
import java.util.UUID
import javax.sql.DataSource
import kotlin.test.AfterTest
import kotlin.test.Test
import kotlin.test.assertTrue

/**
 * The enforcement, through the real executor.
 *
 * `NamedQueryTest` covers the catalogue's own arithmetic. This covers the thing
 * that actually protects a production database: what `ToolNodeExecutor` does when
 * a caller asks for something the catalogue does not contain.
 *
 * ── WHY THESE ASSERT ON REFUSAL AND NOT ON RESULTS ──────────────────────────
 * Every case here must fail BEFORE a connection is opened, so there is nothing to
 * connect to and no tenant database in the fixture. A test that needed one would
 * be asserting that the query ran, which is the opposite of the property: the
 * guarantee is that the executor stops at the catalogue.
 */
@Tag("integration")
class NamedQueryEnforcementTest {

    private val ds: DataSource = Infra.postgres
    private val ws: UUID = UUID.randomUUID()
    private val env: UUID = UUID.randomUUID()
    private val runId: UUID = UUID.randomUUID()

    private val catalogue = """
    {"queries": [
      {"id": "orders_by_customer", "description": "Orders for one customer.",
       "parameters": [{"name": "customerId", "type": "string", "required": true}],
       "sql": "SELECT id FROM orders WHERE customer_id = :customerId",
       "access": "read", "maxRows": 25, "timeoutMs": 2000},
      {"id": "cancel_order", "description": "Cancel one order.",
       "parameters": [{"name": "orderId", "type": "string", "required": true}],
       "sql": "UPDATE orders SET status = 'cancelled' WHERE id = :orderId",
       "access": "write", "maxRows": 1, "timeoutMs": 2000}
    ]}
    """.trimIndent()

    // ── Fixture ──────────────────────────────────────────────────────────────

    private fun seedTool(
        namedQueries: String?,
        allowFreeform: Boolean,
        requiresApproval: Boolean = false,
        sqlTemplate: String? = null,
    ): UUID {
        val id = UUID.randomUUID()
        ds.connection.use { c ->
            c.prepareStatement("INSERT INTO workspaces (id,name,slug) VALUES (?,?,?) " +
                "ON CONFLICT DO NOTHING").use {
                it.setObject(1, ws); it.setString(2, "nq"); it.setString(3, "nq-$ws")
                it.executeUpdate()
            }
            c.prepareStatement("INSERT INTO environments (id,workspace_id,name,slug,type) " +
                "VALUES (?,?,'t','t','development') ON CONFLICT DO NOTHING").use {
                it.setObject(1, env); it.setObject(2, ws); it.executeUpdate()
            }
            c.prepareStatement(
                """INSERT INTO tools
                     (id, workspace_id, environment_id, name, slug, type, description,
                      config_json, named_queries_json, allow_freeform_sql,
                      requires_approval, status)
                   VALUES (?,?,?,?,?,'database','t',?::jsonb,?::jsonb,?,?,'active')"""
            ).use {
                it.setObject(1, id); it.setObject(2, ws); it.setObject(3, env)
                it.setString(4, "orders"); it.setString(5, "orders-$id")
                it.setString(6, sqlTemplate?.let { s ->
                    """{"sqlTemplate": ${com.fasterxml.jackson.databind.ObjectMapper()
                        .writeValueAsString(s)}}"""
                } ?: "{}")
                it.setString(7, namedQueries)
                it.setBoolean(8, allowFreeform)
                it.setBoolean(9, requiresApproval)
                it.executeUpdate()
            }
        }
        return id
    }

    @AfterTest
    fun cleanup() {
        runCatching {
            ds.connection.use { c ->
                c.prepareStatement("DELETE FROM tools WHERE workspace_id=?")
                    .use { it.setObject(1, ws); it.executeUpdate() }
                c.prepareStatement("DELETE FROM workspaces WHERE id=?")
                    .use { it.setObject(1, ws); it.executeUpdate() }
            }
        }
    }

    private fun executor() = ToolNodeExecutor(
        dataSource = ds,
        connectionResolver = com.vectorbea.worker.connector.ConnectionResolver(
            ds, com.vectorbea.worker.testsupport.noOpSecretService()),
        dbPoolManager = com.vectorbea.worker.connector.pool.ClientDbPoolManager(),
        eventStore = RecordingEventStore(),
    )

    private fun ctx() = RuntimeContext(
        runId = runId, workspaceId = ws, environmentId = env,
        workflowVersionId = UUID.randomUUID(), workflowInput = emptyMap(),
        graph = WorkflowGraph(),
    )

    private fun call(toolRef: String, inputs: Map<String, Any>): NodeResult = runBlocking {
        executor().execute(
            WorkflowNode(id = "n1", type = "tool", config = mapOf("toolId" to toolRef)),
            inputs, ctx())
    }

    private fun reasonOf(r: NodeResult): String =
        (r as? NodeResult.Failed)?.reason ?: "<not a failure: ${r::class.simpleName}>"

    // ── ACCEPTANCE ───────────────────────────────────────────────────────────

    /**
     * ACCEPTANCE: an agent cannot execute SQL that is not in the catalogue.
     *
     * Three ways to try, all refused, none of which opens a connection: raw SQL as
     * an input, a query id that does not exist, and no query id at all.
     */
    @Test
    fun `a tool with a catalogue refuses everything outside it`() {
        val tool = seedTool(catalogue, allowFreeform = false)

        val rawSql = call(tool.toString(), mapOf("query" to "SELECT * FROM users"))
        assertTrue(rawSql is NodeResult.Failed, "raw SQL was accepted by a catalogued tool")
        assertTrue(reasonOf(rawSql).contains("named queries only"),
            "the refusal does not say why: ${reasonOf(rawSql)}")
        assertTrue(reasonOf(rawSql).contains("orders_by_customer"),
            "the refusal does not tell the agent what it CAN call, so its next move " +
            "is another guess: ${reasonOf(rawSql)}")

        val unknownId = call(
            NamedQuery.syntheticToolId(tool.toString(), "drop_everything"),
            mapOf("customerId" to "c1"))
        assertTrue(unknownId is NodeResult.Failed, "an unknown query id was executed")
        assertTrue(reasonOf(unknownId).contains("no query 'drop_everything'"))

        val noId = call(tool.toString(), mapOf("customerId" to "c1"))
        assertTrue(noId is NodeResult.Failed, "a catalogued tool ran with no query id")
        assertTrue(reasonOf(noId).contains("requires a query id"))

        /* Even with the free-form flag ON, a tool that has declared a catalogue has
           declared what may run. The flag is the migration path for tools that have
           no catalogue, not an override for tools that do. */
        val both = seedTool(catalogue, allowFreeform = true)
        val stillRefused = call(both.toString(), mapOf("query" to "SELECT 1"))
        assertTrue(stillRefused is NodeResult.Failed,
            "allow_freeform_sql overrode a declared catalogue")
    }

    /**
     * ACCEPTANCE: a write query triggers approval.
     *
     * The tool's own `requires_approval` is FALSE here, which is the case that
     * matters: `requires_approval` is a property of a tool, and one database tool
     * can expose a dozen reads and one write. The declaration on the QUERY is what
     * gates.
     */
    @Test
    fun `a declared write requires approval even when the tool does not`() {
        val tool = seedTool(catalogue, allowFreeform = false, requiresApproval = false)

        val write = call(
            NamedQuery.syntheticToolId(tool.toString(), "cancel_order"),
            mapOf("orderId" to "o1"))
        assertTrue(write is NodeResult.ApprovalPaused,
            "a declared write ran without approval; got ${write::class.simpleName}")

        /* And the read on the same tool does NOT gate, or the property would be
           "this tool needs approval" rather than "this query does". A read on a
           tool with no reachable database fails at the connection — which is past
           the gate, and therefore proves the gate was not taken. */
        val read = call(
            NamedQuery.syntheticToolId(tool.toString(), "orders_by_customer"),
            mapOf("customerId" to "c1"))
        assertTrue(read !is NodeResult.ApprovalPaused,
            "a read query was gated for approval; the gate is on the tool, not the query")
    }

    /**
     * ACCEPTANCE: existing free-form tools keep working.
     *
     * Two shapes, and the distinction is the whole migration story.
     */
    @Test
    fun `tools without a catalogue are unaffected`() {
        /* A tool running its OWN stored SQL needs no flag: that statement is the
           author's, which is the property named queries introduce, and such a tool
           already has it. This is the overwhelming majority of existing tools and
           they must not need touching. */
        val stored = seedTool(null, allowFreeform = false,
            sqlTemplate = "SELECT id FROM orders LIMIT 10")
        val ranStored = call(stored.toString(), emptyMap())
        assertTrue(ranStored !is NodeResult.Failed ||
            !reasonOf(ranStored).contains("does not accept raw SQL"),
            "a tool running its own stored SQL was refused: ${reasonOf(ranStored)}")

        /* A CALLER-supplied statement is the case that must be gated. Off by
           default... */
        val closed = seedTool(null, allowFreeform = false)
        val refused = call(closed.toString(), mapOf("query" to "SELECT 1"))
        assertTrue(refused is NodeResult.Failed &&
            reasonOf(refused).contains("does not accept raw SQL"),
            "caller-supplied SQL was accepted with the flag off: ${reasonOf(refused)}")

        /* ...and available with the flag on, which is what keeps a workflow that
           genuinely composes SQL working while its catalogue is written. */
        val open = seedTool(null, allowFreeform = true)
        val allowed = call(open.toString(), mapOf("query" to "SELECT 1"))
        assertTrue(allowed !is NodeResult.Failed ||
            !reasonOf(allowed).contains("does not accept raw SQL"),
            "the free-form flag did not re-enable caller SQL: ${reasonOf(allowed)}")
    }

    /**
     * A bad parameter is refused by name, before a connection is opened.
     *
     * The agent-facing half: an error that names the parameter and the query is
     * one the agent can act on in its next turn, and one that says "invalid input"
     * costs an iteration to guess at.
     */
    @Test
    fun `a missing parameter is refused with the parameter named`() {
        val tool = seedTool(catalogue, allowFreeform = false)
        val r = call(
            NamedQuery.syntheticToolId(tool.toString(), "orders_by_customer"),
            emptyMap())
        assertTrue(r is NodeResult.Failed, "a query ran without its required parameter")
        assertTrue(reasonOf(r).contains("customerId") && reasonOf(r).contains("orders_by_customer"),
            "the refusal names neither the parameter nor the query: ${reasonOf(r)}")
    }
}
