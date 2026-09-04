package com.vectorbea.worker.contract

/**
 * The JSON Schema subset that matters for output contracts.
 *
 * WHY NOT A LIBRARY
 * -----------------
 * A full JSON Schema implementation is a dependency with a CVE surface, a
 * remote-`$ref` resolver that must be disabled, and a validation vocabulary far
 * larger than an LLM output contract needs. This covers the keywords an output
 * contract actually uses — the ones in §4's example plus the obvious neighbours —
 * and produces error messages written for the person who wrote the prompt rather
 * than for a spec author.
 *
 * The message difference matters more than it sounds. A library reports
 * `#/properties/risk_score: 340 is greater than the maximum of 100`. This reports
 * **"risk_score was 340, expected at most 100"**, which is what appears in the run
 * detail and in the approval gate.
 *
 * Unsupported keywords are IGNORED rather than rejected. A contract using
 * `allOf` gets no enforcement from that keyword, which is a weaker contract than
 * the author intended — but failing every run because the validator does not
 * recognise a keyword would be worse. Publish-time validation warns about them.
 */
object JsonSchemaValidator {

    /** Keywords this validator understands. Anything else is ignored at runtime. */
    val SUPPORTED_KEYWORDS = setOf(
        "type", "properties", "required", "additionalProperties", "items",
        "enum", "const", "minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum",
        "minLength", "maxLength", "pattern", "minItems", "maxItems", "uniqueItems",
        "nullable", "description", "title", "\$schema", "definitions",
    )

    /**
     * Validate, returning human-readable errors. Empty means valid.
     *
     * Every message names the field, what was found, and what was expected. That
     * triple is what makes the error actionable — a message missing any one of the
     * three sends the user to support.
     */
    fun validate(value: Any?, schema: Map<String, Any?>): List<String> {
        val errors = mutableListOf<String>()
        check(value, schema, "", errors)
        return errors
    }

    /** Keywords present in a schema that this validator will not enforce. */
    fun unsupportedKeywords(schema: Map<String, Any?>): Set<String> {
        val found = mutableSetOf<String>()
        fun walk(s: Any?) {
            if (s !is Map<*, *>) return
            s.keys.forEach { k ->
                val key = k?.toString() ?: return@forEach
                if (key !in SUPPORTED_KEYWORDS) found += key
            }
            (s["properties"] as? Map<*, *>)?.values?.forEach { walk(it) }
            walk(s["items"])
        }
        walk(schema)
        return found
    }

    @Suppress("UNCHECKED_CAST")
    private fun check(value: Any?, schema: Map<String, Any?>, path: String, errors: MutableList<String>) {
        val label = if (path.isEmpty()) "the output" else path

        // `nullable: true` and a null value short-circuit everything else. This is
        // the construct that makes OpenAI strict mode workable: strict requires
        // every property in `required`, so an optional field is modelled as a
        // nullable one rather than an absent key.
        if (value == null) {
            if (schema["nullable"] == true) return
            val type = schema["type"]
            if (type == "null" || (type is List<*> && type.contains("null"))) return
            errors += "$label was null, expected ${describeType(schema)}"
            return
        }

        typeError(value, schema, label)?.let { errors += it; return }

        (schema["enum"] as? List<*>)?.let { allowed ->
            if (allowed.none { looseEq(it, value) }) {
                errors += "$label was ${fmt(value)}, expected one of ${allowed.joinToString(", ") { fmt(it) }}"
                return
            }
        }
        schema["const"]?.let { c ->
            if (!looseEq(c, value)) errors += "$label was ${fmt(value)}, expected ${fmt(c)}"
        }

        when (value) {
            is Number -> checkNumber(value.toDouble(), schema, label, errors)
            is String -> checkString(value, schema, label, errors)
            is List<*> -> checkArray(value, schema, path, label, errors)
            is Map<*, *> -> checkObject(value as Map<String, Any?>, schema, path, errors)
        }
    }

    private fun checkNumber(v: Double, schema: Map<String, Any?>, label: String, errors: MutableList<String>) {
        num(schema["minimum"])?.let { if (v < it) errors += "$label was ${fmt(v)}, expected at least ${fmt(it)}" }
        num(schema["maximum"])?.let { if (v > it) errors += "$label was ${fmt(v)}, expected at most ${fmt(it)}" }
        num(schema["exclusiveMinimum"])?.let {
            if (v <= it) errors += "$label was ${fmt(v)}, expected greater than ${fmt(it)}" }
        num(schema["exclusiveMaximum"])?.let {
            if (v >= it) errors += "$label was ${fmt(v)}, expected less than ${fmt(it)}" }
        if (schema["type"] == "integer" && v != Math.floor(v)) {
            errors += "$label was ${fmt(v)}, expected a whole number"
        }
    }

    private fun checkString(v: String, schema: Map<String, Any?>, label: String, errors: MutableList<String>) {
        num(schema["minLength"])?.let {
            if (v.length < it) errors +=
                "$label was ${v.length} characters, expected at least ${it.toInt()}" }
        num(schema["maxLength"])?.let {
            if (v.length > it) errors +=
                "$label was ${v.length} characters, expected at most ${it.toInt()}" }
        (schema["pattern"] as? String)?.let { p ->
            // A malformed pattern is the contract author's bug, not the model's.
            // Reported as such rather than failing the output.
            val re = runCatching { Regex(p) }.getOrNull()
            if (re == null) errors += "$label could not be checked: the contract's pattern '$p' is not valid"
            else if (!re.containsMatchIn(v)) errors += "$label was ${fmt(v)}, expected to match $p"
        }
    }

    private fun checkArray(
        v: List<*>, schema: Map<String, Any?>, path: String, label: String, errors: MutableList<String>,
    ) {
        num(schema["minItems"])?.let {
            if (v.size < it) errors += "$label had ${v.size} items, expected at least ${it.toInt()}" }
        num(schema["maxItems"])?.let {
            if (v.size > it) errors += "$label had ${v.size} items, expected at most ${it.toInt()}" }
        if (schema["uniqueItems"] == true && v.size != v.distinct().size) {
            errors += "$label contained duplicate items, expected all to be unique"
        }
        @Suppress("UNCHECKED_CAST")
        (schema["items"] as? Map<String, Any?>)?.let { itemSchema ->
            v.forEachIndexed { i, item ->
                check(item, itemSchema, if (path.isEmpty()) "[$i]" else "$path[$i]", errors)
            }
        }
    }

    @Suppress("UNCHECKED_CAST")
    private fun checkObject(
        v: Map<String, Any?>, schema: Map<String, Any?>, path: String, errors: MutableList<String>,
    ) {
        val props = schema["properties"] as? Map<String, Any?>

        (schema["required"] as? List<*>)?.forEach { r ->
            val key = r?.toString() ?: return@forEach
            if (!v.containsKey(key)) {
                errors += "${child(path, key)} was missing, and is required"
            }
        }

        if (schema["additionalProperties"] == false && props != null) {
            v.keys.filter { it !in props.keys }.forEach { extra ->
                errors += "${child(path, extra)} was not expected — the contract does not declare it"
            }
        }

        props?.forEach { (key, sub) ->
            if (v.containsKey(key) && sub is Map<*, *>) {
                check(v[key], sub as Map<String, Any?>, child(path, key), errors)
            }
        }
    }

    private fun child(path: String, key: String) = if (path.isEmpty()) key else "$path.$key"

    /**
     * Type check.
     *
     * `integer` accepts a whole-valued double, because JSON has one number type and
     * every parser in the chain produces a Double for `42`. Rejecting that would
     * fail every integer contract on a correct output.
     */
    private fun typeError(value: Any?, schema: Map<String, Any?>, label: String): String? {
        val declared = schema["type"] ?: return null
        val types = when (declared) {
            is String -> listOf(declared)
            is List<*> -> declared.mapNotNull { it?.toString() }
            else -> return null
        }
        val actual = actualType(value)
        val ok = types.any { t ->
            when (t) {
                "integer" -> value is Number && value.toDouble() == Math.floor(value.toDouble())
                "number" -> value is Number
                "string" -> value is String
                "boolean" -> value is Boolean
                "array" -> value is List<*>
                "object" -> value is Map<*, *>
                "null" -> value == null
                else -> true
            }
        }
        return if (ok) null
               else "$label was $actual (${fmt(value)}), expected ${types.joinToString(" or ")}"
    }

    private fun actualType(v: Any?): String = when (v) {
        null -> "null"
        is Boolean -> "boolean"
        is Number -> if (v.toDouble() == Math.floor(v.toDouble())) "integer" else "number"
        is String -> "string"
        is List<*> -> "array"
        is Map<*, *> -> "object"
        else -> v.javaClass.simpleName
    }

    private fun describeType(schema: Map<String, Any?>): String = when (val t = schema["type"]) {
        is String -> t
        is List<*> -> t.joinToString(" or ")
        else -> "a value"
    }

    private fun num(v: Any?): Double? = (v as? Number)?.toDouble() ?: (v as? String)?.toDoubleOrNull()

    private fun looseEq(a: Any?, b: Any?): Boolean {
        if (a == b) return true
        val an = (a as? Number)?.toDouble(); val bn = (b as? Number)?.toDouble()
        if (an != null && bn != null) return an == bn
        return a?.toString() == b?.toString()
    }

    private fun fmt(v: Any?): String = when (v) {
        null -> "null"
        is Double -> if (v == Math.floor(v) && !v.isInfinite()) v.toLong().toString() else v.toString()
        is String -> "\"${v.take(60)}${if (v.length > 60) "…" else ""}\""
        else -> v.toString()
    }
}
