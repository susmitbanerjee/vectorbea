package com.vectorbea.worker.contract

import com.fasterxml.jackson.databind.ObjectMapper

/**
 * Layer 2: require a verifiable citation, then check it.
 *
 * THE USER NEVER WRITES THE WRAPPER
 * ---------------------------------
 * A contract author declares what they want:
 *
 * ```json
 * { "account_name": { "type": "string" } }
 * ```
 *
 * and this rewrites it, for the provider only, into:
 *
 * ```json
 * { "account_name": {
 *     "type": "object",
 *     "properties": {
 *       "value":       { "type": ["string", "null"] },
 *       "found":       { "type": "boolean" },
 *       "source_span": { "type": ["string", "null"] }
 *     }
 * }}
 * ```
 *
 * then unwraps the response back to the shape the author declared. Making the user
 * hand-write the wrapper would mean their assertions read
 * `output.account_name.value` instead of `output.account_name`, every downstream
 * mapping would change, and turning groundedness on would be a breaking edit to
 * every node that consumes the output. Turning a reliability feature on must not
 * break the workflow.
 *
 * NULL IS A CORRECT ANSWER
 * ------------------------
 * The dominant failure in business extraction is a model inventing a field rather
 * than admitting absence. So `found: false` with `value: null` is a **success**:
 * every wrapped field is nullable, the system prompt explicitly authorises "not
 * present", and no span is required for a field the model declined to answer.
 *
 * A model that says "I could not find this" is doing the job correctly, and any
 * design that penalises it teaches the model to guess.
 */
object Groundedness {

    private val mapper = ObjectMapper()

    /** The three keys of the citation envelope. */
    const val VALUE = "value"
    const val FOUND = "found"
    const val SPAN = "source_span"

    /** Whether a contract wants citations for this node. */
    fun required(groundedness: String?): Boolean = groundedness?.lowercase() == "required"

    /** Optional groundedness verifies what it is given but does not demand it. */
    fun optional(groundedness: String?): Boolean = groundedness?.lowercase() == "optional"

    fun enabled(groundedness: String?): Boolean = required(groundedness) || optional(groundedness)

    // ── Schema rewriting ────────────────────────────────────────────────────

    /**
     * Wrap every top-level property of the declared schema in a citation envelope.
     *
     * Top-level only, deliberately. Nesting the envelope inside arrays and sub-objects
     * multiplies the token cost of every response and produces a shape that is
     * miserable to read in the inspector — and the fields a business extraction
     * actually needs to ground are the scalars at the top. A nested structure the
     * author wants grounded is better modelled as separate top-level fields.
     */
    @Suppress("UNCHECKED_CAST")
    fun wrapSchema(schema: Map<String, Any?>): Map<String, Any?> {
        val props = schema["properties"] as? Map<String, Any?> ?: return schema

        val wrapped = props.mapValues { (_, sub) ->
            if (sub !is Map<*, *>) sub else citationEnvelope(sub as Map<String, Any?>)
        }

        return schema.toMutableMap().apply {
            put("properties", wrapped)
            // Every field is required in the envelope form, because "absent" is now
            // expressed as found:false rather than as a missing key. That also
            // happens to be what OpenAI strict mode demands, so the two align.
            put("required", props.keys.toList())
            put("additionalProperties", false)
        }
    }

    /**
     * One field's envelope.
     *
     * `value` is nullable whatever the declared type was — that nullability IS the
     * mechanism by which "not present" is expressible, and without it the model has
     * no legal way to decline.
     */
    private fun citationEnvelope(declared: Map<String, Any?>): Map<String, Any?> {
        val valueSchema = declared.toMutableMap()
        valueSchema["type"] = nullableType(declared["type"])

        val what = declared["description"] as? String

        return mapOf(
            "type" to "object",
            "description" to (
                "The extracted value together with the evidence for it. " +
                    (what?.let { "$it " } ?: "") +
                    "If the input does not contain this information, set found to false and " +
                    "value to null. Do not guess."
                ),
            "properties" to mapOf(
                VALUE to valueSchema,
                FOUND to mapOf(
                    "type" to "boolean",
                    "description" to "true if this was found in the input, false if it is absent.",
                ),
                SPAN to mapOf(
                    "type" to listOf("string", "null"),
                    "description" to
                        "The exact text from the input that this value came from, copied " +
                        "verbatim. Must appear word for word in the input. Null when found is false.",
                ),
            ),
            "required" to listOf(VALUE, FOUND, SPAN),
            "additionalProperties" to false,
        )
    }

    private fun nullableType(t: Any?): Any = when (t) {
        null -> listOf("string", "null")
        is String -> if (t == "null") t else listOf(t, "null")
        is List<*> -> if (t.contains("null")) t else t.filterNotNull() + "null"
        else -> listOf("string", "null")
    }

    /**
     * The instruction appended to the system prompt when groundedness is on.
     *
     * Explicit permission to say "not present" is not decoration — it is the half of
     * Layer 2 that prevents fabrication in the first place. A model asked to fill a
     * schema with no sanctioned way to decline will invent a plausible value, because
     * that is what the request implies is wanted.
     */
    fun systemPromptAddendum(): String = """
        For every field you return, you must also return the exact text from the input
        that the value came from, in source_span. Copy it word for word; it will be
        checked against the input automatically and an invented quotation invalidates
        the answer.

        If the input does not contain the information for a field, that is a correct
        and expected outcome: set found to false, value to null, and source_span to
        null. Do NOT guess, infer, or fill a field from general knowledge. Reporting
        that something is absent is more useful than a plausible invention.
    """.trimIndent()

    // ── Unwrapping and verification ─────────────────────────────────────────

    data class FieldResult(
        val field: String,
        val value: Any?,
        val found: Boolean,
        val span: String?,
        val verification: SpanVerifier.Result?,
    ) {
        /**
         * Whether this field is acceptable.
         *
         * `found == false` is acceptable without a span — that is the whole point of
         * making null a first-class answer. A field claiming to be found must have a
         * span that verifies.
         */
        val ok: Boolean get() = !found || (verification?.verified == true)
    }

    data class Verdict(
        val unwrapped: Map<String, Any?>,
        val fields: List<FieldResult>,
    ) {
        val verifiedCount: Int get() = fields.count { it.found && it.verification?.strong == true }
        val fuzzyCount: Int get() = fields.count {
            it.found && it.verification?.level == SpanVerifier.Level.FUZZY
        }
        val unverifiedCount: Int get() = fields.count { it.found && it.verification?.verified != true }
        val absentCount: Int get() = fields.count { !it.found }
        /** Fields that claimed to be found — the denominator for the confidence score. */
        val claimsMade: Int get() = fields.count { it.found }

        val fabricated: List<FieldResult> get() = fields.filter { !it.ok }

        fun failureMessage(): String = fabricated.joinToString(" ") { f ->
            "Field '" + f.field + "': " + (f.verification?.message ?: "citation could not be verified.")
        }
    }

    /**
     * Unwrap the envelope and verify every citation.
     *
     * @param output the model's response in wrapped form.
     * @param source the node's input, serialised, to check spans against.
     */
    @Suppress("UNCHECKED_CAST")
    fun verify(output: Any?, source: String): Verdict {
        val obj = output as? Map<String, Any?> ?: return Verdict(emptyMap(), emptyList())

        val unwrapped = mutableMapOf<String, Any?>()
        val fields = mutableListOf<FieldResult>()

        for ((key, raw) in obj) {
            val envelope = raw as? Map<String, Any?>
            if (envelope == null || !envelope.containsKey(FOUND)) {
                // Not in envelope form. Passed through untouched rather than treated
                // as a failure: a node with optional groundedness may legitimately
                // return a mix, and failing a plain field for not being wrapped
                // would punish the wrong thing.
                unwrapped[key] = raw
                continue
            }

            val found = envelope[FOUND] == true
            val value = envelope[VALUE]
            val span = envelope[SPAN] as? String

            // Unwrap to the shape the author declared. `found:false` becomes a plain
            // null, so downstream mappings and assertions see exactly what they would
            // have seen without groundedness enabled.
            unwrapped[key] = if (found) value else null

            fields += FieldResult(
                field = key,
                value = value,
                found = found,
                span = span,
                // No verification for an absent field: there is nothing to cite, and
                // demanding one would make "not present" fail.
                verification = if (found) SpanVerifier.verify(span, source) else null,
            )
        }

        return Verdict(unwrapped, fields)
    }

    /** Serialise the node input once, for span checking. */
    fun sourceText(input: Any?): String = when (input) {
        null -> ""
        is String -> input
        else -> runCatching { mapper.writeValueAsString(input) }.getOrDefault(input.toString())
    }
}
