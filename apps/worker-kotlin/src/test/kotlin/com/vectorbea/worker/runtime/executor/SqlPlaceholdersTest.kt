package com.vectorbea.worker.runtime.executor

import org.junit.jupiter.api.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * Counting the bind parameters a statement actually asks for.
 *
 * THE BUG THIS PINS
 * ─────────────────
 * `ToolNodeExecutor` attached every resolved input to a database tool as a positional
 * parameter whenever the SQL had no `{{…}}` templates, with nothing checking whether
 * the statement had placeholders to bind them to. The driver answered:
 *
 *     The column index is out of range: 1, number of columns: 0.
 *
 * — a description of the driver's predicament, not the user's mistake.
 *
 * Counting has to be literal-aware, because a `?` or `$1` inside a string, a quoted
 * identifier or a comment is TEXT. `INTERVAL '$1 days'` binds nothing, and
 * `ToolNodeExecutor`'s own comment names that exact case as the cause of this error.
 */
class SqlPlaceholdersTest {

    // ── Counting ──────────────────────────────────────────────────────────────

    @Test
    fun `counts question marks`() {
        val a = SqlPlaceholders.analyse("INSERT INTO t (a, b) VALUES (?, ?)")
        assertEquals(2, a.questionMarks)
        assertTrue(a.dollarIndices.isEmpty())
    }

    @Test
    fun `a statement with no placeholders asks for nothing`() {
        // THE REPORTED CASE: parameters were supplied to this and the driver objected.
        val a = SqlPlaceholders.analyse("INSERT INTO city_picks (cities) VALUES ('Lisbon')")
        assertEquals(0, a.questionMarks)
        assertTrue(a.isEmpty)
    }

    @Test
    fun `ignores a question mark inside a string literal`() {
        val a = SqlPlaceholders.analyse("INSERT INTO t (q) VALUES ('why? because.')")
        assertEquals(0, a.questionMarks)
    }

    @Test
    fun `handles an escaped quote inside a literal`() {
        // '' is an escaped quote, not the end of the literal — mis-parsing it would
        // put the rest of the statement inside the string and lose real placeholders.
        val a = SqlPlaceholders.analyse("INSERT INTO t (a, b) VALUES ('it''s ?', ?)")
        assertEquals(1, a.questionMarks)
    }

    @Test
    fun `ignores placeholders in a quoted identifier`() {
        val a = SqlPlaceholders.analyse("""INSERT INTO "weird?col" (a) VALUES (?)""")
        assertEquals(1, a.questionMarks)
    }

    @Test
    fun `ignores placeholders in a line comment`() {
        val a = SqlPlaceholders.analyse("INSERT INTO t (a) VALUES (?) -- was (?, ?)\n")
        assertEquals(1, a.questionMarks)
    }

    @Test
    fun `ignores placeholders in a block comment`() {
        val a = SqlPlaceholders.analyse("/* ? and $1 */ INSERT INTO t (a) VALUES (?)")
        assertEquals(1, a.questionMarks)
        assertTrue(a.dollarIndices.isEmpty())
    }

    @Test
    fun `ignores a dollar placeholder inside a literal`() {
        // The case ToolNodeExecutor's comment calls out by name.
        val a = SqlPlaceholders.analyse("SELECT now() - INTERVAL '\$1 days'")
        assertTrue(a.dollarIndices.isEmpty())
        assertTrue(a.isEmpty)
    }

    @Test
    fun `finds dollar indices in order`() {
        val a = SqlPlaceholders.analyse("INSERT INTO t (a, b) VALUES (\$1, \$2)")
        assertEquals(listOf(1, 2), a.dollarIndices)
        assertEquals(0, a.questionMarks)
    }

    // ── Rewriting $N, which pgjdbc has never bound ────────────────────────────

    @Test
    fun `rewrites dollar placeholders to question marks`() {
        // THE REPORTED CASE: the platform's own comments describe `$N` as the
        // supported positional syntax; pgjdbc only ever binds `?`.
        val rewritten = SqlPlaceholders.rewriteDollarsToQuestionMarks(
            "INSERT INTO city_picks (cities) VALUES (\$1)"
        )
        assertEquals("INSERT INTO city_picks (cities) VALUES (?)", rewritten)
    }

    @Test
    fun `rewrites several in order`() {
        val rewritten = SqlPlaceholders.rewriteDollarsToQuestionMarks(
            "INSERT INTO t (a, b, c) VALUES (\$1, \$2, \$3)"
        )
        assertEquals("INSERT INTO t (a, b, c) VALUES (?, ?, ?)", rewritten)
    }

    @Test
    fun `does not rewrite inside a literal`() {
        val sql = "INSERT INTO t (a, b) VALUES (\$1, 'literal \$2 text')"
        assertEquals("INSERT INTO t (a, b) VALUES (?, 'literal \$2 text')",
            SqlPlaceholders.rewriteDollarsToQuestionMarks(sql))
    }

    @Test
    fun `refuses out-of-order indices rather than guessing`() {
        // Reordering is legal Postgres, but the caller has no parameter NAMES to
        // reorder by. Guessing would bind the right values into the wrong columns,
        // and a wrong write is worse than a refused one.
        assertNull(SqlPlaceholders.rewriteDollarsToQuestionMarks(
            "INSERT INTO t (a, b) VALUES (\$2, \$1)"
        ))
    }

    @Test
    fun `refuses a repeated index`() {
        assertNull(SqlPlaceholders.rewriteDollarsToQuestionMarks(
            "INSERT INTO t (a, b) VALUES (\$1, \$1)"
        ))
    }

    @Test
    fun `refuses mixed styles`() {
        assertNull(SqlPlaceholders.rewriteDollarsToQuestionMarks(
            "INSERT INTO t (a, b) VALUES (\$1, ?)"
        ))
    }

    @Test
    fun `returns null when there is nothing to rewrite`() {
        assertNull(SqlPlaceholders.rewriteDollarsToQuestionMarks("INSERT INTO t (a) VALUES (?)"))
        assertNull(SqlPlaceholders.rewriteDollarsToQuestionMarks("INSERT INTO t (a) VALUES ('x')"))
    }

    @Test
    fun `a rewritten statement counts its placeholders`() {
        // The whole point: after rewriting, the count the binder checks is correct.
        val rewritten = SqlPlaceholders.rewriteDollarsToQuestionMarks(
            "INSERT INTO t (a, b) VALUES (\$1, \$2)"
        )!!
        assertEquals(2, SqlPlaceholders.analyse(rewritten).questionMarks)
    }
}
