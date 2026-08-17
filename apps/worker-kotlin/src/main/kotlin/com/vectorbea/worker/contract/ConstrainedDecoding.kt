package com.vectorbea.worker.contract

/**
 * Layer 0: make schema violation impossible rather than unlikely.
 *
 * §4 of the reliability doc is blunt about this and it is the cheapest win in the
 * whole document: never ask for JSON in a prompt and hope. Every provider has a
 * mechanism that constrains generation structurally, and using it converts failure
 * mode #1 from "the largest class of agent failure" into "cannot happen".
 *
 * | Provider  | Mechanism |
 * |-----------|-----------|
 * | OpenAI    | `response_format: {type: "json_schema", json_schema: {…, strict: true}}` |
 * | Anthropic | tool use with `input_schema` — a forced tool call yields structured args |
 * | Gemini    | `responseSchema` + `responseMimeType: application/json` |
 *
 * It costs nothing: no extra tokens, no extra call, no latency beyond the same
 * request with one more field.
 *
 * THE STRICT-MODE TRAP
 * --------------------
 * OpenAI's strict mode is not "JSON Schema, enforced". It is a *subset*, and two of
 * its rules break schemas that are otherwise perfectly valid:
 *
 *   1. **Every property must appear in `required`.** There is no such thing as an
 *      optional key. A schema with three properties and one required is rejected
 *      outright — not degraded, rejected.
 *   2. **`additionalProperties: false` is mandatory** on every object, including
 *      nested ones.
 *
 * The resolution the doc prescribes, and this implements: model optional fields as
 * **nullable types** — `{"type": ["string", "null"]}` — so the key is always
 * present and its absence is expressed as null. Semantic optionality then lives in
 * Layer 1, where an assertion can say what "absent" actually means for that field.
 *
 * That transformation happens here, in [openAiStrictSchema], so a contract author
 * writes ordinary JSON Schema and does not have to know any of this.
 */
object ConstrainedDecoding {

    /** Whether a provider can structurally enforce a schema at all. */
    fun supports(provider: String): Boolean = provider.lowercase() in SUPPORTED

    private val SUPPORTED = setOf("openai", "azure-openai", "anthropic", "gemini")

    /**
     * Why a provider path cannot enforce a schema.
     *
     * Returned rather than thrown because the caller is publish-time validation,
     * which wants to report every problem at once rather than the first.
     */
    fun unsupportedReason(provider: String, model: String?): String? {
        if (supports(provider)) return null
        return "Provider '$provider' does not support constrained decoding. A node that " +
            "declares an output schema must use a provider that can enforce it " +
            "structurally (OpenAI, Anthropic or Gemini) — otherwise the schema is a " +
            "suggestion and the model is free to ignore it."
    }

    /**
     * OpenAI / Azure OpenAI.
     *
     * `strict: true` is the whole point — without it `json_schema` is advisory.
     */
    fun openAiResponseFormat(schema: Map<String, Any?>, name: String = "output"): Map<String, Any> =
        mapOf(
            "type" to "json_schema",
            "json_schema" to mapOf(
                // Must match ^[a-zA-Z0-9_-]+$; a node id may contain characters
                // that do not, so it is sanitised rather than passed through.
                "name" to name.replace(Regex("[^a-zA-Z0-9_-]"), "_").take(64),
                "strict" to true,
                "schema" to openAiStrictSchema(schema),
            ),
        )

    /**
     * Rewrite a schema to satisfy OpenAI strict mode.
     *
     * Recursive, because the rules apply to nested objects too — a schema that is
     * strict-valid at the root and not three levels down is rejected with an error
     * that names the root, which is a miserable thing to debug.
     *
     * The transformation, per object:
     *   - every declared property is added to `required`
     *   - a property NOT originally required becomes nullable, so "absent" is
     *     expressible without an optional key
     *   - `additionalProperties: false` is set
     *   - keywords strict mode rejects are stripped
     */
    @Suppress("UNCHECKED_CAST")
    fun openAiStrictSchema(schema: Map<String, Any?>): Map<String, Any?> {
        val out = schema.toMutableMap()

        // Strict mode rejects these outright. Stripped rather than passed through,
        // because a rejected request is a hard failure while a dropped `minimum` is
        // a constraint Layer 1 re-checks a moment later anyway.
        STRIPPED_KEYWORDS.forEach { out.remove(it) }

        val props = schema["properties"] as? Map<String, Any?>
        if (props != null) {
            val originallyRequired = (schema["required"] as? List<*>)?.mapNotNull { it?.toString() }?.toSet()
                ?: emptySet()

            out["properties"] = props.mapValues { (key, sub) ->
                if (sub !is Map<*, *>) sub
                else {
                    val child = openAiStrictSchema(sub as Map<String, Any?>)
                    // Optional in the author's schema -> nullable in the strict one.
                    if (key !in originallyRequired) makeNullable(child) else child
                }
            }
            // Every property required, no exceptions. This is the rule that
            // surprises people.
            out["required"] = props.keys.toList()
            out["additionalProperties"] = false
        }

        (schema["items"] as? Map<*, *>)?.let {
            out["items"] = openAiStrictSchema(it as Map<String, Any?>)
        }

        return out
    }

    /**
     * Make a subschema accept null.
     *
     * `nullable: true` is OpenAPI, not JSON Schema, and OpenAI wants the JSON Schema
     * form — a type union. Both are emitted: the union for the provider, and the
     * flag retained so [JsonSchemaValidator] (which honours `nullable`) agrees with
     * what was sent.
     */
    private fun makeNullable(schema: Map<String, Any?>): Map<String, Any?> {
        val out = schema.toMutableMap()
        when (val t = schema["type"]) {
            null -> Unit
            is String -> if (t != "null") out["type"] = listOf(t, "null")
            is List<*> -> if (!t.contains("null")) out["type"] = t + "null"
        }
        out["nullable"] = true
        return out
    }

    /**
     * Anthropic: a forced tool call.
     *
     * Anthropic has no `response_format`, but a tool's `input_schema` IS enforced —
     * so declaring one tool whose input is the desired output and forcing its use
     * gives structured generation by another route. The model's "arguments" become
     * the output.
     *
     * `tool_choice: {type: "tool", name: …}` is the forcing part. Without it the
     * model may answer in prose and never call the tool, which is precisely the
     * failure being eliminated.
     */
    fun anthropicToolConfig(schema: Map<String, Any?>, name: String = "emit_output"): Map<String, Any> {
        val toolName = name.replace(Regex("[^a-zA-Z0-9_-]"), "_").take(64)
        return mapOf(
            "tools" to listOf(mapOf(
                "name" to toolName,
                "description" to "Return the result in the required structure. " +
                    "You must call this tool; do not answer in prose.",
                "input_schema" to schema,
            )),
            "tool_choice" to mapOf("type" to "tool", "name" to toolName),
        )
    }

    /**
     * Gemini: `responseSchema` plus the mime type.
     *
     * Both are required. `responseSchema` alone is ignored without
     * `responseMimeType: application/json`, which is a silent failure — the call
     * succeeds and returns prose.
     */
    fun geminiGenerationConfig(schema: Map<String, Any?>): Map<String, Any> = mapOf(
        "responseMimeType" to "application/json",
        "responseSchema" to geminiSchema(schema),
    )

    /**
     * Gemini's schema dialect is OpenAPI-flavoured, not JSON Schema.
     *
     * Types are UPPERCASE, and unknown keywords cause a 400 rather than being
     * ignored — so this is an allow-list translation rather than a pass-through.
     */
    @Suppress("UNCHECKED_CAST")
    fun geminiSchema(schema: Map<String, Any?>): Map<String, Any?> {
        val out = mutableMapOf<String, Any?>()

        (schema["type"] as? String)?.let { out["type"] = it.uppercase() }
        (schema["type"] as? List<*>)?.let { types ->
            // A union is expressed as the non-null type plus nullable.
            types.firstOrNull { it != "null" }?.let { out["type"] = it.toString().uppercase() }
            if (types.contains("null")) out["nullable"] = true
        }
        if (schema["nullable"] == true) out["nullable"] = true
        (schema["description"] as? String)?.let { out["description"] = it }
        (schema["enum"] as? List<*>)?.let { out["enum"] = it.map { e -> e?.toString() } }

        (schema["properties"] as? Map<String, Any?>)?.let { props ->
            out["properties"] = props.mapValues { (_, sub) ->
                if (sub is Map<*, *>) geminiSchema(sub as Map<String, Any?>) else sub
            }
            (schema["required"] as? List<*>)?.let { out["required"] = it.mapNotNull { r -> r?.toString() } }
        }
        (schema["items"] as? Map<*, *>)?.let { out["items"] = geminiSchema(it as Map<String, Any?>) }

        return out
    }

    /**
     * Keywords OpenAI strict mode rejects.
     *
     * Note what is here: the numeric and string bounds. Strict mode enforces shape,
     * not range — so `{"type":"integer","minimum":0,"maximum":100}` becomes just
     * the integer constraint, and 340 still gets through Layer 0.
     *
     * That is not a gap in this implementation, it is the reason Layer 1 exists.
     * `risk_score: 340` is the canonical example in §3 precisely because
     * constrained decoding cannot catch it.
     */
    private val STRIPPED_KEYWORDS = setOf(
        "minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum",
        "minLength", "maxLength", "pattern", "minItems", "maxItems", "uniqueItems",
        "default", "\$schema", "definitions", "\$ref", "allOf", "oneOf", "not",
    )
}
