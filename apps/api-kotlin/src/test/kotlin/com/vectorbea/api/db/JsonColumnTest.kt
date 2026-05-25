package com.vectorbea.api.db

import org.junit.jupiter.api.Test
import org.junit.jupiter.params.ParameterizedTest
import org.junit.jupiter.params.provider.ValueSource
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

class JsonColumnTest {

    @Test
    fun `toJsonb returns PGobject with jsonb type`() {
        val result = toJsonb(mapOf("key" to "value"))
        assertEquals("jsonb", result.type)
        assertNotNull(result.value)
    }

    @Test
    fun `toJsonb serializes map correctly`() {
        val result = toJsonb(mapOf("name" to "test", "count" to 42))
        val value = result.value!!
        assertTrue(value.contains("\"name\""))
        assertTrue(value.contains("\"test\""))
        assertTrue(value.contains("42"))
    }

    @Test
    fun `toJsonb serializes list correctly`() {
        val result = toJsonb(listOf("a", "b", "c"))
        val value = result.value!!
        assertTrue(value.contains("\"a\""))
        assertTrue(value.contains("\"b\""))
        assertTrue(value.contains("\"c\""))
    }

    @Test
    fun `toJsonb serializes empty map to curly braces`() {
        val result = toJsonb(emptyMap<String, Any>())
        assertEquals("{}", result.value)
    }

    @Test
    fun `toJsonb serializes empty list to square brackets`() {
        val result = toJsonb(emptyList<Any>())
        assertEquals("[]", result.value)
    }

    @Test
    fun `JSONB_EMPTY_OBJECT has type jsonb and empty value`() {
        assertEquals("jsonb", JSONB_EMPTY_OBJECT.type)
        assertEquals("{}", JSONB_EMPTY_OBJECT.value)
    }

    @Test
    fun `JSONB_EMPTY_ARRAY has type jsonb and empty value`() {
        assertEquals("jsonb", JSONB_EMPTY_ARRAY.type)
        assertEquals("[]", JSONB_EMPTY_ARRAY.value)
    }

    @Test
    fun `toJsonb handles nested objects`() {
        val result = toJsonb(mapOf("outer" to mapOf("inner" to "value")))
        val value = result.value!!
        assertTrue(value.contains("\"outer\""))
        assertTrue(value.contains("\"inner\""))
    }
}
