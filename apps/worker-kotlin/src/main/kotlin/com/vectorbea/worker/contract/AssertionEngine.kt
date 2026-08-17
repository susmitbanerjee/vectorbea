package com.vectorbea.worker.contract

import com.vectorbea.worker.contract.ExpressionParser.Node
import com.vectorbea.worker.contract.ExpressionParser.Segment
import org.slf4j.LoggerFactory
import kotlin.math.abs
import kotlin.math.floor
import kotlin.math.roundToLong

/**
 * Evaluates contract assertions against a node's output.
 *
 * Layer 1 of the defence in §4: catches semantic nonsense that is structurally
 * valid — `risk_score: 340` where the schema says integer and the business says
 * 0–100. Constrained decoding (Layer 0) cannot catch that, because 340 IS an
 * integer.
 *
 * THE FAILURE MESSAGE IS THE PRODUCT
 * ----------------------------------
 * §3 of the prompt is explicit that the message reaches the user, in run detail
 * and in the approval gate. So the engine does not report "assertion
 * score_within_range failed" — it reports **"risk_score was 340, expected 0–100"**.
 *
 * That means capturing the *actual values* at evaluation time and interpolating
 * them, which is why [evaluate] returns the resolved operands rather than a
 * boolean. A message written after the fact from the expression source cannot know
 * what the value was.
 *
 * NULL SEMANTICS
 * --------------
 * Comparisons involving null are **false**, never an error and never true. An
 * assertion over a field the model omitted should fail cleanly and say the field
 * was missing — not throw, and not silently pass because `null > 70` evaluated to
 * something unexpected. `isNull` / `isNotNull` / `coalesce` are the intended way
 * to handle absence deliberately.
 */
class AssertionEngine {

    // slf4j directly rather than the worker's logger helper: this file is compiled
    // into BOTH services (see the api module's sourceSets) and must not depend on
    // anything worker-only.
    private val log = LoggerFactory.getLogger(AssertionEngine::class.java)

    /** The four roots an expression may reference. */
    data class Context(
        val input: Any?,
        val output: Any?,
        /** Historical statistics for this node — p50, stddev, and friends. */
        val stats: Map<String, Any?> = emptyMap(),
        /** Run metadata: runId, nodeId, attempt, workspace. */
        val context: Map<String, Any?> = emptyMap(),
    )

    enum class Severity { FAIL, WARN, GATE }

    data class Assertion(
        val name: String,
        val expr: String,
        val severity: Severity,
        /**
         * Human-readable failure message, with `{expr}` placeholders interpolated
         * from the evaluation. Null falls back to a generated message that still
         * names the actual value.
         */
        val message: String? = null,
    )

    data class Result(
        val name: String,
        val severity: Severity,
        val passed: Boolean,
        val message: String,
        /** What the operands actually were. This is what makes the message specific. */
        val actual: Map<String, Any?> = emptyMap(),
        val error: String? = null,
    )

    /**
     * Evaluate every assertion. Never throws.
     *
     * An assertion that cannot be evaluated — a typo in the expression, a path into
     * a structure that is not there — is reported as a **failure**, not skipped.
     *
     * That is the safe direction and worth stating: an assertion is a rule the user
     * asked to be enforced, and silently skipping the ones that error means the
     * strictest contracts protect the least. A broken assertion should be loud.
     */
    fun evaluateAll(assertions: List<Assertion>, ctx: Context): List<Result> =
        assertions.map { a ->
            try {
                val ast = ExpressionParser.parse(a.expr)
                val captured = mutableMapOf<String, Any?>()
                val value = eval(ast, ctx, captured)
                val passed = truthy(value)
                Result(
                    name = a.name,
                    severity = a.severity,
                    passed = passed,
                    message = if (passed) "${a.name} passed" else renderMessage(a, captured, ctx),
                    actual = captured,
                )
            } catch (e: Exception) {
                log.warn("[assert] '{}' could not be evaluated: {}", a.name, e.message)
                Result(
                    name = a.name,
                    severity = a.severity,
                    passed = false,
                    message = "Assertion '${a.name}' could not be evaluated: ${e.message}. " +
                        "This is treated as a failure — check the expression.",
                    error = e.message,
                )
            }
        }

    /**
     * The message a user sees.
     *
     * Three tiers, best first:
     *   1. The author's message, with `{output.risk_score}` style placeholders
     *      replaced by the values actually observed.
     *   2. No placeholders — the author's message, plus the observed values
     *      appended, because "score out of range" without the score is a support
     *      ticket.
     *   3. No message at all — generated from the expression and the values.
     */
    private fun renderMessage(a: Assertion, captured: Map<String, Any?>, ctx: Context): String {
        val template = a.message
        if (template == null) {
            val detail = captured.entries.joinToString(", ") { "${it.key} = ${format(it.value)}" }
            return if (detail.isEmpty())
                "Assertion '${a.name}' failed: ${a.expr}"
            else
                "Assertion '${a.name}' failed: ${a.expr} — observed $detail"
        }

        var rendered: String = template
        var substituted = false
        for ((path, value) in captured) {
            val placeholder = "{$path}"
            if (rendered.contains(placeholder)) {
                rendered = rendered.replace(placeholder, format(value))
                substituted = true
            }
        }
        // Also allow {name} for the assertion's own name.
        rendered = rendered.replace("{name}", a.name)

        return if (substituted || captured.isEmpty()) rendered
               else "$rendered (observed ${captured.entries.joinToString(", ") { "${it.key} = ${format(it.value)}" }})"
    }

    private fun format(v: Any?): String = when (v) {
        null -> "null (missing)"
        is Double -> if (v == floor(v) && !v.isInfinite()) v.toLong().toString() else v.toString()
        is String -> "\"$v\""
        is List<*> -> "[${v.joinToString(", ") { format(it) }}]"
        else -> v.toString()
    }

    // ── Evaluation ──────────────────────────────────────────────────────────

    /**
     * @param captured records every path resolved during evaluation, so the failure
     *        message can name the values that produced it.
     */
    private fun eval(node: Node, ctx: Context, captured: MutableMap<String, Any?>): Any? = when (node) {
        is Node.Literal -> node.value

        is Node.Path -> {
            val value = resolve(node.segments, ctx)
            captured[pathString(node.segments)] = value
            value
        }

        is Node.Unary -> when (node.op) {
            "not" -> !truthy(eval(node.operand, ctx, captured))
            "-" -> num(eval(node.operand, ctx, captured))?.let { -it }
            else -> throw IllegalStateException("Unknown unary operator '${node.op}'")
        }

        is Node.Binary -> binary(node, ctx, captured)

        is Node.Call -> call(node, ctx, captured)
    }

    private fun binary(node: Node.Binary, ctx: Context, captured: MutableMap<String, Any?>): Any? {
        // Short-circuit before evaluating the right side: `isNotNull(x) and x > 5`
        // must not evaluate `x > 5` when x is null.
        when (node.op) {
            "and" -> return truthy(eval(node.left, ctx, captured)) &&
                            truthy(eval(node.right, ctx, captured))
            "or" -> return truthy(eval(node.left, ctx, captured)) ||
                           truthy(eval(node.right, ctx, captured))
            // `a implies b` is `!a || b`. Short-circuits identically: when the
            // antecedent is false the rule does not apply and the consequent is
            // never evaluated, which matters when the consequent would error.
            "implies" -> return !truthy(eval(node.left, ctx, captured)) ||
                                truthy(eval(node.right, ctx, captured))
        }

        val l = eval(node.left, ctx, captured)
        val r = eval(node.right, ctx, captured)

        return when (node.op) {
            "==" -> looseEquals(l, r)
            "!=" -> !looseEquals(l, r)
            // Ordering comparisons with a null operand are FALSE, not an error.
            // A missing field should fail its assertion and say so, not blow up.
            "<"  -> compare(l, r)?.let { it < 0 } ?: false
            "<=" -> compare(l, r)?.let { it <= 0 } ?: false
            ">"  -> compare(l, r)?.let { it > 0 } ?: false
            ">=" -> compare(l, r)?.let { it >= 0 } ?: false

            "+" -> {
                // String concatenation when either side is a string, so a message
                // can be composed; arithmetic otherwise.
                if (l is String || r is String) "${stringify(l)}${stringify(r)}"
                else arith(l, r) { a, b -> a + b }
            }
            "-" -> arith(l, r) { a, b -> a - b }
            "*" -> arith(l, r) { a, b -> a * b }
            "/" -> num(r)?.takeIf { it != 0.0 }?.let { d -> num(l)?.let { it / d } }
            "%" -> num(r)?.takeIf { it != 0.0 }?.let { d -> num(l)?.let { it % d } }

            // `output.account_id in input.accounts[*].id` — the §4 example.
            "in" -> when (r) {
                is List<*> -> r.any { looseEquals(l, it) }
                is String -> l != null && r.contains(stringify(l))
                is Map<*, *> -> r.keys.any { looseEquals(l, it) }
                else -> false
            }
            "contains" -> when (l) {
                is List<*> -> l.any { looseEquals(it, r) }
                is String -> r != null && l.contains(stringify(r))
                is Map<*, *> -> l.keys.any { looseEquals(it, r) }
                else -> false
            }
            "matches" -> l is String && r is String &&
                // Regex authored by a customer runs against their own output only,
                // and a catastrophic pattern costs one node's evaluation rather
                // than the worker — the node timeout still applies above this.
                runCatching { Regex(r).containsMatchIn(l) }.getOrDefault(false)
            "startsWith" -> l is String && r is String && l.startsWith(r)
            "endsWith" -> l is String && r is String && l.endsWith(r)

            else -> throw IllegalStateException("Unknown operator '${node.op}'")
        }
    }

    private fun call(node: Node.Call, ctx: Context, captured: MutableMap<String, Any?>): Any? {
        val args = node.args.map { eval(it, ctx, captured) }
        val first = args.firstOrNull()

        return when (node.name) {
            "abs" -> num(first)?.let { abs(it) }
            "min" -> flatten(args).mapNotNull { num(it) }.minOrNull()
            "max" -> flatten(args).mapNotNull { num(it) }.maxOrNull()
            "round" -> num(first)?.roundToLong()?.toDouble()
            "floor" -> num(first)?.let { floor(it) }
            "ceil" -> num(first)?.let { kotlin.math.ceil(it) }
            "sum" -> flatten(args).mapNotNull { num(it) }.sum()
            "avg" -> flatten(args).mapNotNull { num(it) }.let { if (it.isEmpty()) null else it.average() }

            "count", "length" -> when (first) {
                is List<*> -> first.size.toDouble()
                is String -> first.length.toDouble()
                is Map<*, *> -> first.size.toDouble()
                null -> 0.0
                else -> 1.0
            }
            "unique" -> (first as? List<*>)?.distinct()

            // any/all take an already-projected list of booleans:
            //   all(output.items[*].valid)
            // rather than a lambda, because a lambda means binding a variable and
            // that is a whole scoping mechanism this language deliberately lacks.
            "any" -> (first as? List<*>)?.any { truthy(it) } ?: truthy(first)
            "all" -> (first as? List<*>)?.all { truthy(it) } ?: truthy(first)

            "lower" -> (first as? String)?.lowercase()
            "upper" -> (first as? String)?.uppercase()
            "trim" -> (first as? String)?.trim()

            "isNull" -> first == null
            "isNotNull" -> first != null
            "coalesce" -> args.firstOrNull { it != null }

            "isNumber" -> first is Number
            "isString" -> first is String
            "isBoolean" -> first is Boolean
            "isArray" -> first is List<*>
            "isObject" -> first is Map<*, *>

            else -> throw IllegalStateException("Unknown function '${node.name}'")
        }
    }

    /**
     * Walk a path, projecting across `[*]`.
     *
     * Once a wildcard is crossed the value becomes a list, and every subsequent
     * field access maps over it — so `input.accounts[*].id` yields the ids rather
     * than erroring on a list having no `id` field. Nulls are dropped from a
     * projection: an account without an id contributes nothing rather than a null
     * that would then have to be handled by every comparison downstream.
     */
    private fun resolve(segments: List<Segment>, ctx: Context): Any? {
        var current: Any? = when ((segments.firstOrNull() as? Segment.Field)?.name) {
            "input" -> ctx.input
            "output" -> ctx.output
            "stats" -> ctx.stats
            "context" -> ctx.context
            else -> return null
        }
        var projected = false

        for (seg in segments.drop(1)) {
            current = when (seg) {
                is Segment.Field ->
                    if (projected) (current as? List<*>)?.mapNotNull { field(it, seg.name) }
                    else field(current, seg.name)
                is Segment.Index -> (current as? List<*>)?.getOrNull(seg.i)
                Segment.Wildcard -> { projected = true; current as? List<*> ?: emptyList<Any?>() }
            }
            if (current == null) return null
        }
        return current
    }

    private fun field(container: Any?, name: String): Any? = when (container) {
        is Map<*, *> -> container[name]
        else -> null
    }

    private fun pathString(segments: List<Segment>) = buildString {
        segments.forEachIndexed { i, s ->
            when (s) {
                is Segment.Field -> { if (i > 0) append('.'); append(s.name) }
                is Segment.Index -> append("[${s.i}]")
                Segment.Wildcard -> append("[*]")
            }
        }
    }

    // ── Coercion ────────────────────────────────────────────────────────────

    /**
     * Truthiness.
     *
     * Deliberately narrow: only a real `true`, a non-zero number, a non-empty
     * string or a non-empty collection is true. Notably `"false"` the STRING is
     * false — a model that returns the word rather than the boolean should not
     * silently satisfy an assertion.
     */
    private fun truthy(v: Any?): Boolean = when (v) {
        null -> false
        is Boolean -> v
        is Number -> v.toDouble() != 0.0
        is String -> v.isNotEmpty() && !v.equals("false", ignoreCase = true)
        is List<*> -> v.isNotEmpty()
        is Map<*, *> -> v.isNotEmpty()
        else -> true
    }

    private fun num(v: Any?): Double? = when (v) {
        is Number -> v.toDouble()
        // A model returning "42" for a numeric field is a schema problem that
        // Layer 0 prevents; coercing here means an assertion still evaluates
        // sensibly for a node without constrained decoding.
        is String -> v.trim().toDoubleOrNull()
        is Boolean -> if (v) 1.0 else 0.0
        else -> null
    }

    private fun stringify(v: Any?): String = when (v) {
        null -> ""
        is Double -> if (v == floor(v) && !v.isInfinite()) v.toLong().toString() else v.toString()
        else -> v.toString()
    }

    /** Cross-type equality: `42 == "42"` holds, because JSON numbers arrive both ways. */
    private fun looseEquals(l: Any?, r: Any?): Boolean {
        if (l == null && r == null) return true
        if (l == null || r == null) return false
        val ln = num(l); val rn = num(r)
        if (ln != null && rn != null) return ln == rn
        return stringify(l) == stringify(r)
    }

    /** Null when the operands are not comparable — every caller reads that as false. */
    private fun compare(l: Any?, r: Any?): Int? {
        if (l == null || r == null) return null
        val ln = num(l); val rn = num(r)
        if (ln != null && rn != null) return ln.compareTo(rn)
        if (l is String && r is String) return l.compareTo(r)
        return null
    }

    private fun arith(l: Any?, r: Any?, f: (Double, Double) -> Double): Double? {
        val a = num(l) ?: return null
        val b = num(r) ?: return null
        return f(a, b)
    }

    /** `sum(a, b)` and `sum(output.items[*].price)` both work. */
    private fun flatten(args: List<Any?>): List<Any?> =
        args.flatMap { if (it is List<*>) it else listOf(it) }
}
