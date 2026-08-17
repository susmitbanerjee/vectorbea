package com.vectorbea.worker.contract

import org.junit.jupiter.api.Test
import org.junit.jupiter.api.assertThrows
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/**
 * The assertion engine's contract with its users.
 *
 * Two things are being protected here, and they pull in different directions:
 *
 *   1. **The language is expressive enough** for the rules in §4 of the reliability
 *      doc — membership across a projection, implication, statistical comparison.
 *      If any of those cannot be written, users fall back to permissive contracts.
 *   2. **The language cannot execute code.** Every test in the security section is
 *      an attempt to reach outside the four roots, and each must be a parse error
 *      rather than something that evaluates.
 */
class AssertionEngineTest {

    private val engine = AssertionEngine()

    private fun ctx(
        output: Any? = emptyMap<String, Any?>(),
        input: Any? = emptyMap<String, Any?>(),
        stats: Map<String, Any?> = emptyMap(),
    ) = AssertionEngine.Context(input = input, output = output, stats = stats)

    private fun evalOne(expr: String, c: AssertionEngine.Context): AssertionEngine.Result =
        engine.evaluateAll(
            listOf(AssertionEngine.Assertion("t", expr, AssertionEngine.Severity.FAIL)), c
        ).first()

    private fun holds(expr: String, c: AssertionEngine.Context) = evalOne(expr, c).passed

    // ── The §4 examples, verbatim ───────────────────────────────────────────

    @Test
    fun `membership across a wildcard projection`() {
        val c = ctx(
            output = mapOf("account_id" to "acc_abc123def456"),
            input = mapOf("accounts" to listOf(
                mapOf("id" to "acc_zzz000000000"),
                mapOf("id" to "acc_abc123def456"),
            )),
        )
        assertTrue(holds("output.account_id in input.accounts[*].id", c))
    }

    @Test
    fun `membership fails when the value was invented`() {
        // Failure mode #2: a field fabricated because it was not in the source.
        val c = ctx(
            output = mapOf("account_id" to "acc_hallucinated"),
            input = mapOf("accounts" to listOf(mapOf("id" to "acc_abc123def456"))),
        )
        assertFalse(holds("output.account_id in input.accounts[*].id", c))
    }

    @Test
    fun `implication holds when the antecedent is false`() {
        // The rule does not apply, so it is satisfied. This is the semantics that
        // makes `implies` worth having: writing it as `!a || b` is a translation
        // authors get wrong.
        val c = ctx(output = mapOf("risk_score" to 30.0, "recommendation" to "no_action"))
        assertTrue(holds("output.risk_score > 70 implies output.recommendation != \"no_action\"", c))
    }

    @Test
    fun `implication fails when the antecedent holds and the consequent does not`() {
        val c = ctx(output = mapOf("risk_score" to 85.0, "recommendation" to "no_action"))
        assertFalse(holds("output.risk_score > 70 implies output.recommendation != \"no_action\"", c))
    }

    @Test
    fun `statistical comparison against history`() {
        val c = ctx(
            output = mapOf("risk_score" to 52.0),
            stats = mapOf("p50_risk_score" to 50.0, "stddev" to 5.0),
        )
        assertTrue(holds("abs(output.risk_score - stats.p50_risk_score) < 3 * stats.stddev", c))

        val outlier = ctx(
            output = mapOf("risk_score" to 95.0),
            stats = mapOf("p50_risk_score" to 50.0, "stddev" to 5.0),
        )
        assertFalse(holds("abs(output.risk_score - stats.p50_risk_score) < 3 * stats.stddev", outlier))
    }

    // ── Null semantics ──────────────────────────────────────────────────────

    @Test
    fun `comparison against a missing field is false, not an error`() {
        // The failure that matters: an assertion over a field the model omitted must
        // fail cleanly rather than throw or accidentally pass.
        val c = ctx(output = mapOf("other" to 1.0))
        val r = evalOne("output.risk_score > 70", c)
        assertFalse(r.passed)
        assertEquals(null, r.error, "a missing field is a failure, not an evaluation error")
        assertTrue(r.message.contains("null (missing)"), "the message names the absence: ${r.message}")
    }

    @Test
    fun `null checks let an author handle absence deliberately`() {
        val present = ctx(output = mapOf("note" to "hello"))
        val absent = ctx(output = emptyMap<String, Any?>())
        assertTrue(holds("isNotNull(output.note)", present))
        assertTrue(holds("isNull(output.note)", absent))
        assertTrue(holds("coalesce(output.note, \"fallback\") == \"fallback\"", absent))
    }

    @Test
    fun `and short-circuits so a guarded comparison is safe`() {
        val c = ctx(output = emptyMap<String, Any?>())
        // Without short-circuiting the right side would evaluate against null.
        assertFalse(holds("isNotNull(output.score) and output.score > 5", c))
    }

    // ── Array predicates ────────────────────────────────────────────────────

    @Test
    fun `all and any over a projection`() {
        val c = ctx(output = mapOf("items" to listOf(
            mapOf("valid" to true, "price" to 10.0),
            mapOf("valid" to true, "price" to 20.0),
        )))
        assertTrue(holds("all(output.items[*].valid)", c))
        assertTrue(holds("any(output.items[*].valid)", c))
        assertTrue(holds("count(output.items) == 2", c))
        assertTrue(holds("sum(output.items[*].price) == 30", c))
    }

    @Test
    fun `all fails when one element does not hold`() {
        val c = ctx(output = mapOf("items" to listOf(
            mapOf("valid" to true), mapOf("valid" to false),
        )))
        assertFalse(holds("all(output.items[*].valid)", c))
        assertTrue(holds("any(output.items[*].valid)", c))
    }

    // ── String operations ───────────────────────────────────────────────────

    @Test
    fun `string operators`() {
        val c = ctx(output = mapOf("id" to "acc_abc123", "note" to "  Padded  "))
        assertTrue(holds("output.id startsWith \"acc_\"", c))
        assertTrue(holds("output.id endsWith \"123\"", c))
        assertTrue(holds("output.id contains \"abc\"", c))
        assertTrue(holds("output.id matches \"^acc_[a-z0-9]+$\"", c))
        assertTrue(holds("trim(output.note) == \"Padded\"", c))
        assertTrue(holds("lower(output.id) == output.id", c))
    }

    // ── Truthiness ──────────────────────────────────────────────────────────

    @Test
    fun `the string false is not truthy`() {
        // A model that returns the word rather than the boolean must not satisfy an
        // assertion by accident.
        val c = ctx(output = mapOf("approved" to "false"))
        assertFalse(holds("output.approved", c))
    }

    // ── Failure messages — the product surface ──────────────────────────────

    @Test
    fun `a templated message interpolates the observed value`() {
        val c = ctx(output = mapOf("risk_score" to 340.0))
        val r = engine.evaluateAll(listOf(AssertionEngine.Assertion(
            name = "score_in_range",
            expr = "output.risk_score >= 0 and output.risk_score <= 100",
            severity = AssertionEngine.Severity.FAIL,
            message = "risk_score was {output.risk_score}, expected 0-100",
        )), c).first()

        assertFalse(r.passed)
        // The exact sentence §5 of the prompt asks for.
        assertEquals("risk_score was 340, expected 0-100", r.message)
    }

    @Test
    fun `a message without placeholders still gets the observed values appended`() {
        val c = ctx(output = mapOf("risk_score" to 340.0))
        val r = engine.evaluateAll(listOf(AssertionEngine.Assertion(
            name = "score_in_range",
            expr = "output.risk_score <= 100",
            severity = AssertionEngine.Severity.FAIL,
            message = "The score is out of range",
        )), c).first()
        assertTrue(r.message.startsWith("The score is out of range"))
        assertTrue(r.message.contains("340"),
            "a message without the value is a support ticket: ${r.message}")
    }

    @Test
    fun `no message at all still names the value`() {
        val c = ctx(output = mapOf("risk_score" to 340.0))
        val r = evalOne("output.risk_score <= 100", c)
        assertTrue(r.message.contains("340"), r.message)
    }

    // ── Security: the language must not execute code ────────────────────────

    @Test
    fun `paths outside the four roots are rejected`() {
        for (expr in listOf(
            "System.exit(0)",
            "java.lang.Runtime.getRuntime()",
            "Runtime.exec(\"rm -rf /\")",
            "this.dataSource",
            "secrets.apiKey",
        )) {
            val e = assertThrows<ExpressionParser.ParseException>("'$expr' must not parse") {
                ExpressionParser.parse(expr)
            }
            assertTrue(
                e.message!!.contains("not available") || e.message!!.contains("Unknown function"),
                "unhelpful rejection for '$expr': ${e.message}")
        }
    }

    @Test
    fun `only allow-listed functions are callable`() {
        val e = assertThrows<ExpressionParser.ParseException> {
            ExpressionParser.parse("eval(\"1+1\")")
        }
        assertTrue(e.message!!.contains("Unknown function"))
        // The message lists the alternatives rather than leaving the author guessing.
        assertTrue(e.message!!.contains("abs"))
    }

    @Test
    fun `an unevaluable assertion fails rather than being skipped`() {
        // A rule the user asked to enforce must not become advisory because of a
        // typo — otherwise the strictest contracts protect the least.
        val r = evalOne("output.risk_score >>> 5", ctx())
        assertFalse(r.passed)
        assertTrue(r.error != null)
        assertTrue(r.message.contains("treated as a failure"))
    }

    // ── Severity resolution ─────────────────────────────────────────────────

    @Test
    fun `every assertion is reported, not just the failures`() {
        // A user debugging "why did this pass" needs the ones that held.
        val c = ctx(output = mapOf("a" to 1.0, "b" to 2.0))
        val results = engine.evaluateAll(listOf(
            AssertionEngine.Assertion("passes", "output.a == 1", AssertionEngine.Severity.FAIL),
            AssertionEngine.Assertion("fails", "output.b == 99", AssertionEngine.Severity.WARN),
        ), c)
        assertEquals(2, results.size)
        assertTrue(results[0].passed)
        assertFalse(results[1].passed)
    }
}
