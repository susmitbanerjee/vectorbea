package com.vectorbea.worker.runtime.executor

import org.junit.jupiter.api.Test
import java.sql.SQLException
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/**
 * What a failed write tells you.
 *
 * THE BUG THESE PIN
 * ─────────────────
 * `DbWriteNodeExecutor` reported `e.javaClass.simpleName` and nothing else, so every
 * write failure — syntax error, missing column, type mismatch, constraint violation —
 * arrived as the single word "PSQLException":
 *
 *     DB_WRITE node 'n-new-agent-2:tool-3': statement execution failed: PSQLException
 *
 * That names a Java class and not one fact about what went wrong. An agent retrying
 * the tool got the same uninformative observation every time and had nothing to
 * correct, so it retried until it ran out of iterations.
 *
 * `DbReadNodeExecutor` has always included `e.message`; only the write path dropped
 * it. The asymmetry is the giveaway that this was caution, not intent — a write's
 * error is the one that can quote the data being written. So these tests hold BOTH
 * halves: the diagnosis is kept, and the row is not.
 */
class DbWriteErrorReportingTest {

    private fun describe(e: Throwable) = DbWriteNodeExecutor.describeDbError(e)

    @Test
    fun `names the column and the SQLSTATE`() {
        val e = SQLException(
            """ERROR: column "nosuchcolumn" of relation "city_picks" does not exist   Position: 25""",
            "42703",
        )

        val described = describe(e)
        assertTrue(described.contains("42703"), "SQLSTATE is the searchable part: $described")
        assertTrue(described.contains("nosuchcolumn"), "the column has to be named: $described")
        assertTrue(described.contains("city_picks"), "the relation has to be named: $described")
    }

    @Test
    fun `keeps a syntax error readable`() {
        val e = SQLException("""ERROR: syntax error at or near "'Lisbon'"   Position: 45""", "42601")

        val described = describe(e)
        assertTrue(described.startsWith("[42601]"), described)
        assertTrue(described.contains("syntax error"), described)
    }

    // ── The half that must NOT come through ───────────────────────────────────

    @Test
    fun `drops the DETAIL section, which is where the row is`() {
        // Postgres puts the offending VALUES in DETAIL. The primary message says what
        // rule was broken; DETAIL says with what data. Only the first is diagnosis.
        val e = SQLException(
            """ERROR: duplicate key value violates unique constraint "users_email_key"
  Detail: Key (email)=(alice@example.com) already exists.""",
            "23505",
        )

        val described = describe(e)
        assertTrue(described.contains("users_email_key"), "the constraint is diagnosis: $described")
        assertFalse(described.contains("alice@example.com"), "the row must not leak: $described")
        assertFalse(described.contains("Key (email)"), "the DETAIL section must be dropped: $described")
    }

    @Test
    fun `drops an upper-case DETAIL too`() {
        // pgjdbc renders "Detail:", the server log renders "DETAIL:".
        val e = SQLException(
            "ERROR: null value in column \"name\" violates not-null constraint\nDETAIL: Failing row contains (1, secret).",
            "23502",
        )

        val described = describe(e)
        assertTrue(described.contains("not-null constraint"), described)
        assertFalse(described.contains("secret"), "the failing row must not leak: $described")
    }

    // ── Degenerate inputs ─────────────────────────────────────────────────────

    @Test
    fun `falls back to the exception type when there is no message`() {
        // Better than an empty string: the type is still a fact.
        assertEquals("SQLException", describe(SQLException()))
    }

    @Test
    fun `handles a non-SQL exception without a SQLSTATE prefix`() {
        val described = describe(IllegalStateException("pool is closed"))
        assertEquals("pool is closed", described)
        assertFalse(described.contains("["), "no SQLSTATE means no empty bracket: $described")
    }

    @Test
    fun `caps the length`() {
        val e = SQLException("x".repeat(5_000), "42601")
        assertTrue(describe(e).length < 400, "must stay loggable")
    }
}
