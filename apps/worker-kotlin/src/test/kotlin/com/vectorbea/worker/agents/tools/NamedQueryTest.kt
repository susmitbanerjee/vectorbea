package com.vectorbea.worker.agents.tools

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * Named queries: the catalogue, the binding, and the classification.
 *
 * ── WHAT REPLACED WHAT ──────────────────────────────────────────────────────
 * `ToolNodeExecutor` decided read-versus-write by upper-casing the first
 * whitespace-delimited token of the stored SQL. These tests do not check that the
 * classifier got better — they check that there is no longer a classifier, which
 * is the only version of this that cannot be defeated by an input somebody did
 * not think of.
 */
class NamedQueryTest {

    private val catalogueJson = """
    {
      "version": 1,
      "queries": [
        {
          "id": "orders_by_customer",
          "description": "Orders for one customer, newest first.",
          "parameters": [
            {"name": "customerId", "type": "string", "required": true,
             "description": "Customer id, as returned by crm.search."},
            {"name": "limit", "type": "number", "required": false}
          ],
          "sql": "SELECT id, status, total_cents FROM orders WHERE customer_id = :customerId ORDER BY created_at DESC",
          "access": "read",
          "maxRows": 25,
          "timeoutMs": 3000
        },
        {
          "id": "cancel_order",
          "description": "Cancel one order.",
          "parameters": [{"name": "orderId", "type": "string", "required": true}],
          "sql": "UPDATE orders SET status = 'cancelled' WHERE id = :orderId",
          "access": "write",
          "maxRows": 1,
          "timeoutMs": 3000
        }
      ]
    }
    """.trimIndent()

    private val catalogue = NamedQuery.parseCatalogue(catalogueJson)

    // ── ACCEPTANCE: nothing outside the catalogue is executable ──────────────

    /**
     * ACCEPTANCE: an agent cannot execute SQL that is not in the catalogue.
     *
     * Asserted at the level the guarantee lives at — the catalogue is a lookup by
     * id, and there is no path from an arbitrary string to a statement. A test
     * that tried a clever injection would be testing a sanitiser; there is no
     * sanitiser, because there is nothing to sanitise.
     */
    @Test
    fun `only catalogued ids resolve to a statement`() {
        assertEquals(2, catalogue.size)
        assertNull(catalogue.firstOrNull { it.id == "DROP TABLE orders" })
        assertNull(catalogue.firstOrNull { it.id == "orders_by_customer; DELETE FROM orders" })
        assertNull(catalogue.firstOrNull { it.id == "" })
        assertTrue(catalogue.any { it.id == "orders_by_customer" })
    }

    /**
     * ACCEPTANCE: a CTE-wrapped write cannot masquerade as a read.
     *
     * The exact statement the old classifier misreads. Its first token is `WITH`,
     * it contains a `DELETE`, and under a keyword match its classification depends
     * entirely on which branch happens to see it first. Here it is a write because
     * the author said so, and there is no arrangement of the SQL that changes
     * that.
     */
    @Test
    fun `a CTE-wrapped write is a write because it is declared one`() {
        val sneaky = NamedQuery.parseCatalogue("""
        {"queries": [{
          "id": "archive_orders",
          "description": "Move cancelled orders to the archive.",
          "sql": "WITH moved AS (DELETE FROM orders WHERE status = 'cancelled' RETURNING *) INSERT INTO orders_archive SELECT * FROM moved",
          "access": "write", "maxRows": 1, "timeoutMs": 5000
        }]}
        """.trimIndent()).single()

        assertEquals(NamedQuery.Access.WRITE, sneaky.access)

        /* And the reverse: a statement that LOOKS like a write is still a read if
           that is what was declared — the declaration is the whole authority, in
           both directions. Nothing reads the SQL. */
        val looksLikeAWrite = NamedQuery.parseCatalogue("""
        {"queries": [{
          "id": "audit",
          "description": "Rows that a DELETE would remove.",
          "sql": "SELECT id FROM orders WHERE status = 'cancelled'",
          "access": "read", "maxRows": 10, "timeoutMs": 1000
        }]}
        """.trimIndent()).single()
        assertEquals(NamedQuery.Access.READ, looksLikeAWrite.access)
    }

    /**
     * An unreadable access declaration is a WRITE.
     *
     * The asymmetry is the safety property. A misspelled `"raed"` that defaulted
     * to READ would be a write executing unapproved, silently, forever; defaulting
     * to WRITE costs an approval prompt somebody will notice and fix.
     */
    @Test
    fun `an unrecognised access level fails closed`() {
        listOf("\"raed\"", "\"\"", "null", "\"readonly\"", "\"READ ONLY\"").forEach { v ->
            val q = NamedQuery.parseCatalogue("""
            {"queries": [{"id": "q", "description": "d", "sql": "SELECT 1", "access": $v}]}
            """.trimIndent()).single()
            assertEquals(NamedQuery.Access.WRITE, q.access,
                "access $v was treated as a read; an unreadable declaration must gate")
        }
        /* And the one spelling that IS a read, so the default is not vacuous. */
        assertEquals(NamedQuery.Access.READ, NamedQuery.parseCatalogue("""
            {"queries": [{"id": "q", "description": "d", "sql": "SELECT 1", "access": "READ"}]}
        """.trimIndent()).single().access)
    }

    // ── ACCEPTANCE: every result is bounded ─────────────────────────────────

    /**
     * ACCEPTANCE: a query that would return 100 000 rows is bounded.
     *
     * Bounded twice, and both matter. The declaration is clamped at parse time, so
     * a catalogue asking for a hundred thousand rows cannot express it; and the
     * ceiling is far below `DbReadNodeExecutor.HARD_MAX_ROWS` (10 000), because
     * that bound counts ROWS and what actually exhausts a worker is BYTES — ten
     * thousand wide rows are materialised into a `List<Map>` before anything
     * measures their size.
     */
    @Test
    fun `a query asking for a hundred thousand rows is clamped`() {
        val greedy = NamedQuery.parseCatalogue("""
        {"queries": [{
          "id": "everything",
          "description": "Every order ever.",
          "sql": "SELECT * FROM orders",
          "access": "read",
          "maxRows": 100000,
          "timeoutMs": 600000
        }]}
        """.trimIndent()).single()

        assertEquals(NamedQuery.MAX_ROWS_CEILING, greedy.maxRows,
            "a catalogue asked for 100000 rows and got ${greedy.maxRows}")
        assertTrue(greedy.maxRows <= 500)
        assertEquals(NamedQuery.MAX_TIMEOUT_MS, greedy.timeoutMs,
            "a ten-minute statement timeout was accepted")
    }

    /** A query that declares no limit still gets one. */
    @Test
    fun `an undeclared limit defaults rather than being unbounded`() {
        val q = NamedQuery.parseCatalogue("""
        {"queries": [{"id": "q", "description": "d", "sql": "SELECT 1", "access": "read"}]}
        """.trimIndent()).single()
        assertEquals(NamedQuery.DEFAULT_MAX_ROWS, q.maxRows)
        assertEquals(NamedQuery.DEFAULT_TIMEOUT_MS, q.timeoutMs)
    }

    // ── Binding ─────────────────────────────────────────────────────────────

    /** `:name` becomes `?`, in order, and the values follow that order. */
    @Test
    fun `parameters are bound, never interpolated`() {
        val q = catalogue.first { it.id == "orders_by_customer" }
        val bound = q.bind()

        assertFalse(bound.sql.contains(":customerId"),
            "a placeholder survived the rewrite: ${bound.sql}")
        assertEquals(1, bound.sql.count { it == '?' })
        assertEquals(listOf("customerId"), bound.order)

        val values = q.bindValues(mapOf("customerId" to "cus_1"), bound.order).getOrThrow()
        assertEquals(listOf<Any?>("cus_1"), values)

        /* The injection that string interpolation would have executed is, here,
           just a string that will not match a customer id. Asserted on the VALUE
           rather than on the SQL, because the SQL never saw it. */
        val hostile = q.bindValues(
            mapOf("customerId" to "x'; DROP TABLE orders; --"), bound.order).getOrThrow()
        assertEquals("x'; DROP TABLE orders; --", hostile.single())
        assertFalse(bound.sql.contains("DROP"),
            "the statement changed when a hostile value was bound")
    }

    /** A name used twice binds twice, in the right positions. */
    @Test
    fun `a repeated placeholder binds once per occurrence`() {
        val q = NamedQuery.parseCatalogue("""
        {"queries": [{
          "id": "range", "description": "d",
          "parameters": [{"name": "d", "type": "string"}],
          "sql": "SELECT 1 WHERE a >= :d AND b <= :d",
          "access": "read"
        }]}
        """.trimIndent()).single()
        val bound = q.bind()
        assertEquals(2, bound.sql.count { it == '?' })
        assertEquals(listOf("d", "d"), bound.order)
        assertEquals(listOf<Any?>("2026-01-01", "2026-01-01"),
            q.bindValues(mapOf("d" to "2026-01-01"), bound.order).getOrThrow())
    }

    /**
     * A colon inside a string literal is not a placeholder.
     *
     * Rewriting it would corrupt the statement AND shift every later binding by
     * one — values landing in the wrong columns, silently.
     */
    @Test
    fun `a colon inside a literal is left alone`() {
        val q = NamedQuery.parseCatalogue("""
        {"queries": [{
          "id": "q", "description": "d",
          "parameters": [{"name": "id", "type": "string"}],
          "sql": "SELECT 1 FROM t WHERE note = 'see :ref' AND id = :id",
          "access": "read"
        }]}
        """.trimIndent()).single()
        val bound = q.bind()
        assertEquals(listOf("id"), bound.order)
        assertTrue(bound.sql.contains("'see :ref'"),
            "a colon inside a string literal was rewritten: ${bound.sql}")
    }

    /** `::` is a cast, not a placeholder. */
    @Test
    fun `a postgres cast is not mistaken for a placeholder`() {
        val q = NamedQuery.parseCatalogue("""
        {"queries": [{
          "id": "q", "description": "d",
          "parameters": [{"name": "id", "type": "string"}],
          "sql": "SELECT id::text FROM t WHERE id = :id",
          "access": "read"
        }]}
        """.trimIndent()).single()
        val bound = q.bind()
        assertEquals(listOf("id"), bound.order)
        assertTrue(bound.sql.contains("id::text"), "the cast was rewritten: ${bound.sql}")
    }

    /** A missing required parameter is refused before anything is bound. */
    @Test
    fun `a missing required parameter is named`() {
        val q = catalogue.first { it.id == "orders_by_customer" }
        val err = q.bindValues(emptyMap(), q.bind().order).exceptionOrNull()
        assertTrue(err != null && err.message!!.contains("customerId"),
            "the error does not name the missing parameter: ${err?.message}")
        assertTrue(err.message!!.contains("crm.search"),
            "the parameter's description was not offered, so the agent has to guess " +
            "where the value comes from")
    }

    /**
     * SQL naming a placeholder the catalogue does not declare is refused.
     *
     * A tool-author error, and one that must never reach the driver: the binding
     * would be off by one and the statement would run with the wrong values in the
     * wrong columns rather than failing.
     */
    @Test
    fun `an undeclared placeholder is refused rather than bound blindly`() {
        val q = NamedQuery.parseCatalogue("""
        {"queries": [{
          "id": "q", "description": "d",
          "parameters": [{"name": "a", "type": "string"}],
          "sql": "SELECT 1 WHERE a = :a AND b = :undeclared",
          "access": "read"
        }]}
        """.trimIndent()).single()
        val err = q.bindValues(mapOf("a" to "x"), q.bind().order).exceptionOrNull()
        assertTrue(err != null && err.message!!.contains("undeclared"),
            "an undeclared placeholder was bound anyway: ${err?.message}")
    }

    /** A number parameter given prose is refused, not silently stringified. */
    @Test
    fun `a type mismatch is refused`() {
        val q = NamedQuery.parseCatalogue("""
        {"queries": [{
          "id": "q", "description": "d",
          "parameters": [{"name": "n", "type": "number"}],
          "sql": "SELECT 1 WHERE n = :n", "access": "read"
        }]}
        """.trimIndent()).single()
        assertTrue(q.bindValues(mapOf("n" to "not a number"), q.bind().order).isFailure)
        /* But a numeric string IS coerced: an agent supplies JSON and this is a
           difference it cannot see, so refusing would spend an iteration on it. */
        assertTrue(q.bindValues(mapOf("n" to "42"), q.bind().order).isSuccess)
    }

    // ── Catalogue parsing ───────────────────────────────────────────────────

    /**
     * A malformed catalogue yields NO queries, not the half that parsed.
     *
     * Running the half that happened to parse is running a set nobody reviewed.
     */
    @Test
    fun `an unreadable catalogue yields nothing`() {
        assertTrue(NamedQuery.parseCatalogue("{ not json").isEmpty())
        assertTrue(NamedQuery.parseCatalogue(null).isEmpty())
        assertTrue(NamedQuery.parseCatalogue("{}").isEmpty())
    }

    /** An entry missing an id or SQL is dropped rather than half-built. */
    @Test
    fun `an incomplete entry is dropped`() {
        val c = NamedQuery.parseCatalogue("""
        {"queries": [
          {"description": "no id", "sql": "SELECT 1", "access": "read"},
          {"id": "no_sql", "description": "d", "access": "read"},
          {"id": "good", "description": "d", "sql": "SELECT 1", "access": "read"}
        ]}
        """.trimIndent())
        assertEquals(listOf("good"), c.map { it.id })
    }

    // ── Exposure to the model ───────────────────────────────────────────────

    /** The synthetic id round-trips, and a plain uuid is untouched. */
    @Test
    fun `a synthetic tool id splits back`() {
        val toolId = "11111111-2222-3333-4444-555555555555"
        val synthetic = NamedQuery.syntheticToolId(toolId, "orders_by_customer")
        assertEquals(toolId to "orders_by_customer", NamedQuery.splitToolId(synthetic))
        assertEquals(toolId to null, NamedQuery.splitToolId(toolId))
    }

    /** The parameter schema is the same shape any other tool presents. */
    @Test
    fun `a named query presents a normal parameter schema`() {
        val q = catalogue.first { it.id == "orders_by_customer" }
        val schema = q.inputSchema()
        assertEquals("object", schema["type"])
        @Suppress("UNCHECKED_CAST")
        val props = schema["properties"] as Map<String, Map<String, Any?>>
        assertEquals("string", props["customerId"]!!["type"])
        assertEquals("number", props["limit"]!!["type"])
        assertEquals(listOf("customerId"), schema["required"])
        assertTrue(props["customerId"]!!["description"].toString().contains("crm.search"))
    }
}
