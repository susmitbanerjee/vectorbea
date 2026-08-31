package com.vectorbea.worker.agents.orchestration

import com.fasterxml.jackson.module.kotlin.jacksonObjectMapper

/**
 * "Does this output match the declared schema" — asked in exactly one place.
 *
 * ── WHY ONE IMPLEMENTATION AND NOT TWO ──────────────────────────────────────
 * The same question is asked at two boundaries that must agree:
 *
 *   * the agent's own `FINAL`, against `AgentBrainConfig.outputSchemaJson`, and
 *   * a delegated child's result, against the CALLER's
 *     [TaskContract.outputSchema] — validated by the caller's harness, per §5.2.
 *
 * Two copies that drift by one rule give you a child whose output the callee
 * called valid and the caller called invalid, or worse the reverse. The reverse
 * is the bad one: the parent accepts a shape it cannot use and starts reading
 * nulls out of it, and the failure surfaces three steps later somewhere that has
 * no idea a delegation happened.
 *
 * ── WHAT IT ACTUALLY CHECKS ─────────────────────────────────────────────────
 * Required top-level fields, and nothing else. This is the behaviour that
 * shipped, moved rather than rewritten: a full JSON Schema validator is a
 * dependency decision, and quietly making validation STRICTER here would start
 * failing agents that pass today. What is new is that a failure now names the
 * missing fields, because "did not match the required output schema" is a
 * category and the mismatch is the answer.
 *
 * A malformed schema passes. An operator who wrote invalid JSON in the schema
 * box should get a workflow that runs, not one where every agent fails with a
 * message about a schema they cannot see.
 */
object OutputSchemaCheck {

    private val mapper = jacksonObjectMapper()

    /** Missing required fields, in declaration order. Empty means it matched. */
    data class Result(val missing: List<String>) {
        val valid: Boolean get() = missing.isEmpty()

        /**
         * What went wrong, in a sentence a person can act on.
         *
         * Names both halves — what was required and what arrived — because
         * either alone leaves the reader guessing which end to fix.
         */
        fun describe(produced: Collection<String>): String =
            "missing required field(s) ${missing.joinToString()}; it returned " +
                (produced.take(8).joinToString().ifBlank { "no fields" })
    }

    private val MATCHED = Result(emptyList())

    /** Validate against a parsed schema map. Null or empty schema means no constraint. */
    fun validate(output: Map<String, Any?>, schema: Map<String, Any?>?): Result {
        if (schema.isNullOrEmpty()) return MATCHED
        val required = (schema["required"] as? List<*>)?.map { it.toString() } ?: return MATCHED
        return Result(required.filterNot { output.containsKey(it) })
    }

    /**
     * Validate against a schema still in its stored JSON form.
     *
     * A DIFFERENT NAME, not an overload. `validate(output, null)` was ambiguous
     * between the two — which a mutation test found the hard way: the mutant did
     * not compile, Gradle served stale classes, and the run reported the mutation
     * as survived. An ambiguity that makes a call site fail to compile is the
     * benign half; the malign half is a caller holding a nullable value that binds
     * to the wrong overload and silently validates nothing.
     */
    fun validateJson(output: Map<String, Any?>, schemaJson: String?): Result {
        if (schemaJson.isNullOrBlank() || schemaJson == "{}") return MATCHED
        val schema = runCatching {
            @Suppress("UNCHECKED_CAST")
            mapper.readValue(schemaJson, Map::class.java) as Map<String, Any?>
        }.getOrNull() ?: return MATCHED
        return validate(output, schema)
    }
}
