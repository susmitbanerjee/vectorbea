package com.vectorbea.worker.validation

import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test

class JsonSchemaValidatorTest {

    private fun validate(value: Any?, schema: Map<String, Any>) =
        JsonSchemaValidator.validate(value, schema)

    // ── Type validation ───────────────────────────────────────────────────────

    @Test
    fun `string type passes for string`() {
        assertTrue(validate("hello", mapOf("type" to "string")).isValid)
    }

    @Test
    fun `string type fails for number`() {
        assertFalse(validate(42, mapOf("type" to "string")).isValid)
    }

    @Test
    fun `number type passes for int and double`() {
        assertTrue(validate(42, mapOf("type" to "number")).isValid)
        assertTrue(validate(3.14, mapOf("type" to "number")).isValid)
    }

    @Test
    fun `boolean type`() {
        assertTrue(validate(true, mapOf("type" to "boolean")).isValid)
        assertFalse(validate("true", mapOf("type" to "boolean")).isValid)
    }

    @Test
    fun `object type passes for map`() {
        assertTrue(validate(mapOf("a" to 1), mapOf("type" to "object")).isValid)
    }

    @Test
    fun `object type fails for list`() {
        assertFalse(validate(listOf(1, 2), mapOf("type" to "object")).isValid)
    }

    @Test
    fun `array type passes for list`() {
        assertTrue(validate(listOf(1, 2, 3), mapOf("type" to "array")).isValid)
    }

    // ── Required fields ───────────────────────────────────────────────────────

    @Test
    fun `required passes when all fields present`() {
        val schema = mapOf(
            "type" to "object",
            "required" to listOf("id", "name"),
        )
        val value = mapOf("id" to "C1", "name" to "Alice")
        assertTrue(validate(value, schema).isValid)
    }

    @Test
    fun `required fails when field missing`() {
        val schema = mapOf(
            "type" to "object",
            "required" to listOf("id", "name"),
        )
        val value = mapOf("id" to "C1") // missing name
        val result = validate(value, schema)
        assertFalse(result.isValid)
        assertTrue(result.errors.any { it.message.contains("name") })
    }

    // ── Nested properties ─────────────────────────────────────────────────────

    @Test
    fun `nested properties validated recursively`() {
        val schema = mapOf(
            "type" to "object",
            "properties" to mapOf(
                "score" to mapOf("type" to "number", "minimum" to 0, "maximum" to 1)
            )
        )
        val valid   = validate(mapOf("score" to 0.75), schema)
        val invalid = validate(mapOf("score" to 1.5), schema)
        assertTrue(valid.isValid)
        assertFalse(invalid.isValid)
    }

    // ── Enum ──────────────────────────────────────────────────────────────────

    @Test
    fun `enum passes for allowed value`() {
        val schema = mapOf("enum" to listOf("low", "medium", "high"))
        assertTrue(validate("medium", schema).isValid)
    }

    @Test
    fun `enum fails for disallowed value`() {
        val schema = mapOf("enum" to listOf("low", "medium", "high"))
        assertFalse(validate("critical", schema).isValid)
    }

    // ── String length ─────────────────────────────────────────────────────────

    @Test
    fun `minLength and maxLength`() {
        val schema = mapOf("type" to "string", "minLength" to 3, "maxLength" to 10)
        assertTrue(validate("hello", schema).isValid)
        assertFalse(validate("hi", schema).isValid)
        assertFalse(validate("this is too long", schema).isValid)
    }

    // ── Numeric bounds ────────────────────────────────────────────────────────

    @Test
    fun `minimum and maximum`() {
        val schema = mapOf("type" to "number", "minimum" to 0, "maximum" to 100)
        assertTrue(validate(50, schema).isValid)
        assertFalse(validate(-1, schema).isValid)
        assertFalse(validate(101, schema).isValid)
    }

    // ── Array ─────────────────────────────────────────────────────────────────

    @Test
    fun `array items validated`() {
        val schema = mapOf(
            "type" to "array",
            "items" to mapOf("type" to "string"),
        )
        assertTrue(validate(listOf("a", "b", "c"), schema).isValid)
        assertFalse(validate(listOf("a", 2, "c"), schema).isValid)
    }

    @Test
    fun `minItems and maxItems`() {
        val schema = mapOf("type" to "array", "minItems" to 2, "maxItems" to 4)
        assertTrue(validate(listOf(1, 2, 3), schema).isValid)
        assertFalse(validate(listOf(1), schema).isValid)
        assertFalse(validate(listOf(1, 2, 3, 4, 5), schema).isValid)
    }

    // ── Null handling ─────────────────────────────────────────────────────────

    @Test
    fun `null fails unless nullable`() {
        assertFalse(validate(null, mapOf("type" to "string")).isValid)
        assertTrue(validate(null, mapOf("type" to "string", "nullable" to true)).isValid)
    }

    // ── Empty schema (no constraints) ─────────────────────────────────────────

    @Test
    fun `empty schema accepts anything`() {
        assertTrue(validate("hello", emptyMap()).isValid)
        assertTrue(validate(42, emptyMap()).isValid)
        assertTrue(validate(null, emptyMap()).isValid)
    }

    // ── summarize ─────────────────────────────────────────────────────────────

    @Test
    fun `summarize returns 'valid' on success`() {
        val result = validate("ok", mapOf("type" to "string"))
        assertEquals("valid", result.summarize())
    }

    @Test
    fun `summarize returns error description on failure`() {
        val result = validate(42, mapOf("type" to "string"))
        assertFalse(result.isValid)
        assertTrue(result.summarize().isNotEmpty())
        assertNotEquals("valid", result.summarize())
    }
}
