package com.vectorbea.worker.agents.tools

import com.vectorbea.graph.WorkflowGraph
import com.vectorbea.graph.WorkflowNode
import com.vectorbea.worker.connector.ConnectionRecord
import com.vectorbea.worker.connector.ConnectionResolver
import com.vectorbea.worker.connector.ResolvedConnection
import com.vectorbea.worker.connector.pool.ClientDbPoolManager
import com.vectorbea.worker.events.RunEventStore
import com.vectorbea.worker.runtime.executor.DbReadNodeExecutor
import com.vectorbea.worker.runtime.executor.NodeResult
import com.vectorbea.worker.runtime.graph.RuntimeContext
import com.vectorbea.worker.testsupport.Infra
import com.vectorbea.worker.testsupport.noOpDataSource
import com.vectorbea.worker.testsupport.noOpPubSub
import kotlinx.coroutines.runBlocking
import org.junit.jupiter.api.Tag
import java.util.UUID
import javax.sql.DataSource
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * ACCEPTANCE: every result is bounded, against a query that really would return
 * a hundred thousand rows.
 *
 * ── WHY THIS RUNS A REAL QUERY ──────────────────────────────────────────────
 * `NamedQueryTest` asserts the DECLARATION is clamped at parse time, which is
 * necessary and not sufficient: a clamped number that never reaches
 * `stmt.maxRows` bounds nothing. So this executes `generate_series(1, 100000)`
 * against a real Postgres and counts what comes back.
 *
 * The bound being tested is `maxRows`, which is a ROW count. The reason the
 * catalogue's ceiling (500) sits so far below `DbReadNodeExecutor.HARD_MAX_ROWS`
 * (10 000) is that rows are not what exhausts a worker — bytes are, and
 * `resultSetToList` materialises every admitted row into a `List<Map>` before
 * anything measures its size. Ten thousand wide rows is tens of megabytes of
 * heap. Five hundred narrow ones is not.
 */
@Tag("integration")
class NamedQueryRowBoundTest {

    private val ws: UUID = UUID.randomUUID()
    private val env: UUID = UUID.randomUUID()

    private fun ctx() = RuntimeContext(
        runId = UUID.randomUUID(), workspaceId = ws, environmentId = env,
        workflowVersionId = UUID.randomUUID(), workflowInput = emptyMap(),
        graph = WorkflowGraph(),
    )

    private fun events() = object : RunEventStore(noOpDataSource(), noOpPubSub()) {
        override fun appendEvent(event: RunEvent): Int = 0
    }

    /**
     * A connection record pointing at the test Postgres.
     *
     * The tenant database and the platform database are the same server here,
     * which is fine: what is under test is the row bound, and it does not care
     * whose database it is reading.
     */
    private fun record() = ConnectionRecord(
        id = UUID.randomUUID(), workspaceId = ws, environmentId = env,
        name = "bound-test", type = "database", provider = "postgresql",
        status = "active", authType = "basic", secretRef = null,
        configJson = mapOf("url" to Infra.postgresUrl),
        allowedHosts = emptyList(), allowedPaths = emptyList(),
        allowedSchemas = emptyList(), allowedTables = emptyList(),
    )

    private fun resolver(rec: ConnectionRecord) =
        object : ConnectionResolver(noOpDataSource(),
            com.vectorbea.worker.testsupport.noOpSecretService()) {
            override fun resolve(connectionId: UUID, workspaceId: UUID, expectedType: String?) =
                ResolvedConnection(record = rec, secret = null)
        }

    /** The statement a named query with `maxRows` would produce. */
    private fun runQuery(maxRows: Int): NodeResult = runBlocking {
        DbReadNodeExecutor(resolver(record()), ClientDbPoolManager(), events()).execute(
            WorkflowNode(id = "n1", type = "db_query", config = mapOf(
                "connectionId" to UUID.randomUUID().toString(),
                "query" to "SELECT g AS n, repeat('x', 40) AS pad FROM generate_series(1, 100000) g",
                "maxRows" to maxRows,
                "timeoutMs" to 20_000,
            )),
            emptyMap(), ctx())
    }

    @Test
    fun `a query that would return a hundred thousand rows returns at most the declared limit`() {
        /* The ceiling a catalogue can express, whatever it declares. */
        val limit = NamedQuery.MAX_ROWS_CEILING
        val result = runQuery(limit)

        assertTrue(result is NodeResult.Completed,
            "the bounded query did not complete: ${(result as? NodeResult.Failed)?.reason}")
        @Suppress("UNCHECKED_CAST")
        val rows = result.output["rows"] as List<Map<String, Any?>>
        assertEquals(limit, rows.size,
            "a query over 100 000 rows returned ${rows.size}; the limit is not enforced")
        assertEquals(limit, result.output["rowCount"])
    }

    /**
     * And a small declared limit is honoured, not rounded up to the ceiling.
     *
     * The ceiling is a maximum, not the value: a catalogue asking for 25 rows must
     * get 25, or every query on the system returns 500 and the declaration is
     * decoration.
     */
    @Test
    fun `a small declared limit is what is returned`() {
        val result = runQuery(25)
        assertTrue(result is NodeResult.Completed,
            "the query failed: ${(result as? NodeResult.Failed)?.reason}")
        @Suppress("UNCHECKED_CAST")
        val rows = result.output["rows"] as List<Map<String, Any?>>
        assertEquals(25, rows.size, "declared 25, got ${rows.size}")
    }

    /**
     * The catalogue cannot express an unbounded query in the first place.
     *
     * Belt and braces, and the two guard different failures: this one stops a
     * catalogue from ever asking, the tests above stop the runtime from obliging
     * if it somehow did.
     */
    @Test
    fun `the catalogue cannot declare an unbounded query`() {
        val q = NamedQuery.parseCatalogue("""
        {"queries": [{"id": "all", "description": "everything",
          "sql": "SELECT * FROM generate_series(1, 100000)",
          "access": "read", "maxRows": 100000}]}
        """.trimIndent()).single()
        assertEquals(NamedQuery.MAX_ROWS_CEILING, q.maxRows)
        assertTrue(q.maxRows < 10_000,
            "the catalogue ceiling is not meaningfully below DbReadNodeExecutor's " +
            "HARD_MAX_ROWS, so declaring a limit buys nothing")
    }
}
