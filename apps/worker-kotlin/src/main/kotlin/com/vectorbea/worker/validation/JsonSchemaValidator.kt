package com.vectorbea.worker.validation

/**
 * MVP JSON Schema validator (no external library dependency).
 *
 * Supports a practical subset of JSON Schema draft-07 sufficient for
 * workflow input/output validation:
 *
 *   type        — "object", "array", "string", "number", "integer", "boolean", "null"
 *   required    — list of required property names (for objects)
 *   properties  — nested schema definitions for object properties
 *   items       — schema for array elements (all-items mode)
 *   enum        — list of allowed values
 *   minimum     — numeric minimum (inclusive)
 *   maximum     — numeric maximum (inclusive)
 *   minLength   — string minimum length
 *   maxLength   — string maximum length
 *   minItems    — array minimum item count
 *   maxItems    — array maximum item count
 *   nullable    — true → null is also allowed
 *
 * Keywords NOT supported (silently skipped, not validated):
 *   $ref, anyOf, oneOf, allOf, not, if/then/else, pattern, format,
 *   additionalProperties, uniqueItems, const
 *
 * SECURITY: schema definitions come from workflow builder config and are
 * treated as untrusted data.  They are never eval'd as code.
 */
object JsonSchemaValidator {

    /**
     * Validate [value] against [schema].
     *
     * @param value   the value to validate (Map/List/String/Number/Boolean/null)
     * @param schema  JSON Schema as Map<String, Any> (from node config / graph)
     * @param path    dot-path prefix for error messages (start with field name or "$")
     * @return [ValidationResult] with zero or more errors
     */
    fun validate(value: Any?, schema: Map<String, Any>, path: String = "$"): ValidationResult {
        val errors = mutableListOf<ValidationError>()
        validateNode(value, schema, path, errors)
        return ValidationResult(errors)
    }

    // ── Core validation ───────────────────────────────────────────────────────

    @Suppress("UNCHECKED_CAST")
    private fun validateNode(
        value: Any?,
        schema: Map<String, Any>,
        path: String,
        errors: MutableList<ValidationError>,
    ) {
        val schemaType = schema["type"] as? String
        val nullable   = schema["nullable"] as? Boolean ?: false

        // Null check — only fail null if schema explicitly declares a type (other than "null")
        // or if nullable is explicitly set to false.
        if (value == null) {
            if (nullable || schemaType == "null" || schemaType == null) return
            errors.add(ValidationError(path, "Value is null but schema type '$schemaType' does not allow null"))
            return
        }

        // Type check
        if (schemaType != null) {
            val typeError = checkType(value, schemaType, path)
            if (typeError != null) {
                errors.add(typeError)
                return // can't validate further without correct type
            }
        }

        // Enum check
        val enum = schema["enum"] as? List<*>
        if (enum != null && value !in enum) {
            errors.add(ValidationError(path, "Value '${truncate(value)}' is not in allowed values: ${enum.take(10)}"))
        }

        // Type-specific keywords
        when {
            value is Map<*, *> -> validateObject(value as Map<String, Any>, schema, path, errors)
            value is List<*>   -> validateArray(value, schema, path, errors)
            value is String    -> validateString(value, schema, path, errors)
            value is Number    -> validateNumber(value, schema, path, errors)
        }
    }

    @Suppress("UNCHECKED_CAST")
    private fun validateObject(
        obj: Map<String, Any>,
        schema: Map<String, Any>,
        path: String,
        errors: MutableList<ValidationError>,
    ) {
        // required
        val required = schema["required"] as? List<*>
        if (required != null) {
            for (key in required) {
                if (key.toString() !in obj) {
                    errors.add(ValidationError("$path.$key", "Required property '$key' is missing"))
                }
            }
        }

        // properties — recurse
        val properties = schema["properties"] as? Map<String, Any>
        if (properties != null) {
            for ((propKey, propSchema) in properties) {
                if (propSchema is Map<*, *> && propKey in obj) {
                    validateNode(obj[propKey], propSchema as Map<String, Any>, "$path.$propKey", errors)
                }
            }
        }
    }

    @Suppress("UNCHECKED_CAST")
    private fun validateArray(
        arr: List<*>,
        schema: Map<String, Any>,
        path: String,
        errors: MutableList<ValidationError>,
    ) {
        val minItems = (schema["minItems"] as? Number)?.toInt()
        val maxItems = (schema["maxItems"] as? Number)?.toInt()

        if (minItems != null && arr.size < minItems) {
            errors.add(ValidationError(path, "Array has ${arr.size} items, minimum is $minItems"))
        }
        if (maxItems != null && arr.size > maxItems) {
            errors.add(ValidationError(path, "Array has ${arr.size} items, maximum is $maxItems"))
        }

        val items = schema["items"] as? Map<String, Any>
        if (items != null) {
            arr.forEachIndexed { i, elem ->
                validateNode(elem, items, "$path[$i]", errors)
            }
        }
    }

    private fun validateString(value: String, schema: Map<String, Any>, path: String, errors: MutableList<ValidationError>) {
        val minLength = (schema["minLength"] as? Number)?.toInt()
        val maxLength = (schema["maxLength"] as? Number)?.toInt()
        if (minLength != null && value.length < minLength) {
            errors.add(ValidationError(path, "String length ${value.length} is less than minimum $minLength"))
        }
        if (maxLength != null && value.length > maxLength) {
            errors.add(ValidationError(path, "String length ${value.length} exceeds maximum $maxLength"))
        }
    }

    private fun validateNumber(value: Number, schema: Map<String, Any>, path: String, errors: MutableList<ValidationError>) {
        val d = value.toDouble()
        val minimum = (schema["minimum"] as? Number)?.toDouble()
        val maximum = (schema["maximum"] as? Number)?.toDouble()
        if (minimum != null && d < minimum) {
            errors.add(ValidationError(path, "Value $d is less than minimum $minimum"))
        }
        if (maximum != null && d > maximum) {
            errors.add(ValidationError(path, "Value $d exceeds maximum $maximum"))
        }
    }

    // ── Type checking ─────────────────────────────────────────────────────────

    private fun checkType(value: Any, schemaType: String, path: String): ValidationError? {
        val matches = when (schemaType) {
            "object"  -> value is Map<*, *>
            "array"   -> value is List<*>
            "string"  -> value is String
            "number"  -> value is Number
            "integer" -> value is Int || value is Long || (value is Number && value.toDouble() % 1.0 == 0.0)
            "boolean" -> value is Boolean
            "null"    -> value == null
            else      -> true // unknown type → skip
        }
        return if (matches) null
        else ValidationError(path, "Expected type '$schemaType' but got '${typeName(value)}'")
    }

    // ── Utilities ─────────────────────────────────────────────────────────────

    private fun typeName(v: Any?): String = when (v) {
        null       -> "null"
        is Map<*,*> -> "object"
        is List<*>  -> "array"
        is String   -> "string"
        is Boolean  -> "boolean"
        is Number   -> "number"
        else        -> v.javaClass.simpleName
    }

    private fun truncate(v: Any?, max: Int = 50): String = v.toString().take(max)
}

/** Result of a schema validation operation. */
data class ValidationResult(val errors: List<ValidationError>) {
    val isValid: Boolean get() = errors.isEmpty()
    fun summarize(): String = if (isValid) "valid" else errors.take(5).joinToString("; ") { it.message }
}

data class ValidationError(val path: String, val message: String)
