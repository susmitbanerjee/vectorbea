package com.vectorbea.worker.runtime.graph

/**
 * Simple expression evaluator for branch edge conditions.
 *
 * Supported expression forms (evaluated against the node's resolved output):
 *
 *   true / false               → boolean literal
 *   output.key == "value"      → equality check on a step output key
 *   output.key != "value"      → inequality check
 *   output.key > number        → numeric comparison (>, <, >=, <=)
 *   output.key                 → truthy check (non-null, non-empty, non-false)
 *   !output.key                → falsy check
 *
 * All other expressions default to `true` (take the edge) so that graphs
 * built without conditions still advance.
 *
 * SECURITY: expressions come from workflow builder config and are treated
 * as untrusted strings.  They are never eval'd as code — only matched
 * against these fixed patterns.
 */
object ConditionEvaluator {

    /**
     * Evaluate [condition] against [output] (the step output map of the preceding node).
     * Returns `true` if the edge should be followed.
     */
    fun evaluate(condition: String?, output: Map<String, Any>): Boolean {
        if (condition.isNullOrBlank()) return true
        val expr = condition.trim()
        return try {
            evalExpr(expr, output)
        } catch (_: Exception) {
            // Any evaluation error → take the edge (fail-open)
            true
        }
    }

    private fun evalExpr(expr: String, output: Map<String, Any>): Boolean {
        // Boolean literals
        if (expr.equals("true", ignoreCase = true))  return true
        if (expr.equals("false", ignoreCase = true)) return false

        // Negation: !output.key
        if (expr.startsWith("!")) {
            return !isTruthy(resolveRef(expr.drop(1).trim(), output))
        }

        // Equality: output.key == "value" or output.key == value
        val eqMatch = EQ_PATTERN.find(expr)
        if (eqMatch != null) {
            val lhs = resolveRef(eqMatch.groupValues[1], output)
            val rhs = stripQuotes(eqMatch.groupValues[2])
            return lhs?.toString() == rhs
        }

        // Inequality: output.key != "value"
        val neqMatch = NEQ_PATTERN.find(expr)
        if (neqMatch != null) {
            val lhs = resolveRef(neqMatch.groupValues[1], output)
            val rhs = stripQuotes(neqMatch.groupValues[2])
            return lhs?.toString() != rhs
        }

        // Numeric comparisons: output.key > 5
        val cmpMatch = CMP_PATTERN.find(expr)
        if (cmpMatch != null) {
            val lhs = resolveRef(cmpMatch.groupValues[1], output)?.toString()?.toDoubleOrNull() ?: return false
            val op  = cmpMatch.groupValues[2]
            val rhs = cmpMatch.groupValues[3].trim().toDoubleOrNull() ?: return false
            return when (op) {
                ">"  -> lhs > rhs
                ">=" -> lhs >= rhs
                "<"  -> lhs < rhs
                "<=" -> lhs <= rhs
                else -> false
            }
        }

        // Plain reference: output.key → truthy check
        val ref = resolveRef(expr, output)
        if (ref != null) return isTruthy(ref)

        // Unknown expression → take the edge (fail-open)
        return true
    }

    private fun resolveRef(ref: String, output: Map<String, Any>): Any? {
        val key = when {
            ref.startsWith("output.") -> ref.removePrefix("output.")
            ref.startsWith("result.") -> ref.removePrefix("result.")
            else -> ref
        }
        return output[key]
    }

    private fun isTruthy(value: Any?): Boolean = when (value) {
        null              -> false
        is Boolean        -> value
        is Number         -> value.toDouble() != 0.0
        is String         -> value.isNotEmpty() && value != "false" && value != "0"
        is Collection<*>  -> value.isNotEmpty()
        is Map<*, *>      -> value.isNotEmpty()
        else              -> true
    }

    private fun stripQuotes(s: String): String {
        val t = s.trim()
        return when {
            t.startsWith("\"") && t.endsWith("\"") -> t.drop(1).dropLast(1)
            t.startsWith("'")  && t.endsWith("'")  -> t.drop(1).dropLast(1)
            else -> t
        }
    }

    // output.key == "value"  or  output.key == value
    private val EQ_PATTERN  = Regex("""^(\S+)\s*==\s*(.+)$""")
    private val NEQ_PATTERN = Regex("""^(\S+)\s*!=\s*(.+)$""")
    private val CMP_PATTERN = Regex("""^(\S+)\s*(>=|<=|>|<)\s*(\S+)$""")
}
