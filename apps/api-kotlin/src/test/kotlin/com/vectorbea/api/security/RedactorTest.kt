package com.vectorbea.api.security

import org.junit.jupiter.api.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class RedactorTest {

    // ── redactConnectionString ────────────────────────────────────────────────

    @Test
    fun `redacts postgres connection string`() {
        val url = "postgres://myuser:mypassword@db.example.com:5432/mydb"
        val result = Redactor.redactConnectionString(url)
        assertFalse(result.contains("mypassword"), "Password must not appear in redacted output")
        assertFalse(result.contains("myuser"), "Username must not appear in redacted output")
        assertTrue(result.contains("db.example.com"), "Host should remain visible")
        assertTrue(result.contains(Redactor.REDACTED), "Must contain REDACTED token")
    }

    @Test
    fun `redacts mysql connection string`() {
        val url = "mysql://admin:s3cr3t@mysql.host.com/orders"
        val result = Redactor.redactConnectionString(url)
        assertFalse(result.contains("s3cr3t"))
        assertFalse(result.contains("admin"))
        assertTrue(result.contains("mysql.host.com"))
    }

    @Test
    fun `redacts https URL with credentials`() {
        val url = "https://apiuser:apipass@api.example.com/v1/data"
        val result = Redactor.redactConnectionString(url)
        assertFalse(result.contains("apipass"))
        assertFalse(result.contains("apiuser"))
        assertTrue(result.contains("api.example.com"))
    }

    @Test
    fun `redacts mongodb+srv connection string`() {
        val url = "mongodb+srv://dbuser:dbpass@cluster.mongodb.net/myapp"
        val result = Redactor.redactConnectionString(url)
        assertFalse(result.contains("dbpass"), "Password must not appear: $result")
        assertFalse(result.contains("dbuser"), "Username must not appear: $result")
        assertTrue(result.contains("cluster.mongodb.net"), "Host should remain: $result")
    }

    @Test
    fun `leaves URL without credentials unchanged`() {
        val url = "https://api.openai.com/v1/models"
        val result = Redactor.redactConnectionString(url)
        assertEquals(url, result)
    }

    // ── redactHeaders ─────────────────────────────────────────────────────────

    @Test
    fun `redacts Authorization Bearer header`() {
        val headers = mapOf(
            "authorization" to "Bearer sk-test-123",
            "content-type" to "application/json",
        )
        val result = Redactor.redactHeaders(headers)
        assertEquals(Redactor.REDACTED, result["authorization"])
        assertEquals("application/json", result["content-type"])
    }

    @Test
    fun `redacts x-api-key header`() {
        val headers = mapOf(
            "x-api-key" to "abc123secretkey",
            "x-request-id" to "req-uuid",
        )
        val result = Redactor.redactHeaders(headers)
        assertEquals(Redactor.REDACTED, result["x-api-key"])
        assertEquals("req-uuid", result["x-request-id"])
    }

    @Test
    fun `redacts x-goog-api-key header`() {
        val headers = mapOf("x-goog-api-key" to "AIza-google-key-xyz")
        val result = Redactor.redactHeaders(headers)
        assertEquals(Redactor.REDACTED, result["x-goog-api-key"])
    }

    @Test
    fun `redacts cookie header`() {
        val headers = mapOf("cookie" to "session=abc123; auth=xyz")
        val result = Redactor.redactHeaders(headers)
        assertEquals(Redactor.REDACTED, result["cookie"])
    }

    // ── redactMap ─────────────────────────────────────────────────────────────

    @Test
    fun `redacts password key in map`() {
        val map = mapOf("username" to "alice", "password" to "hunter2", "host" to "db.example.com")
        val result = Redactor.redactMap(map)
        assertEquals(Redactor.REDACTED, result["password"])
        assertEquals("alice", result["username"])
        assertEquals("db.example.com", result["host"])
    }

    @Test
    fun `redacts api_key key in map`() {
        val map = mapOf<String, Any?>("api_key" to "sk-secret", "model" to "gpt-4")
        val result = Redactor.redactMap(map)
        assertEquals(Redactor.REDACTED, result["api_key"])
        assertEquals("gpt-4", result["model"])
    }

    @Test
    fun `redacts client_secret key in map`() {
        val map = mapOf<String, Any?>("client_id" to "app123", "client_secret" to "s3cr3t")
        val result = Redactor.redactMap(map)
        assertEquals(Redactor.REDACTED, result["client_secret"])
        // client_id doesn't match sensitive fragments
        assertEquals("app123", result["client_id"])
    }

    // ── redactJson ────────────────────────────────────────────────────────────

    @Test
    fun `redacts password in JSON string`() {
        val json = """{"username":"alice","password":"hunter2","host":"localhost"}"""
        val result = Redactor.redactJson(json)
        assertFalse(result.contains("hunter2"), "Password value must be redacted")
        assertTrue(result.contains("alice"), "Username value should remain")
    }

    @Test
    fun `redacts api_key in JSON`() {
        val json = """{"model":"gpt-4","api_key":"sk-secret-key"}"""
        val result = Redactor.redactJson(json)
        assertFalse(result.contains("sk-secret-key"), "API key must be redacted: $result")
    }

    // ── redactString ──────────────────────────────────────────────────────────

    @Test
    fun `redacts Bearer token in string`() {
        val input = "Sending request with Authorization: Bearer sk-abc123456789abcdef"
        val result = Redactor.redactString(input)
        assertFalse(result.contains("sk-abc123456789abcdef"), "Bearer token must be redacted")
    }

    @Test
    fun `redacts sk- prefixed key in string`() {
        val input = "Using key sk-test-abcdefghijklmnopqrstuvwxyz for OpenAI"
        val result = Redactor.redactString(input)
        assertFalse(result.contains("sk-test-abcdefghijklmnopqrstuvwxyz"), "sk- key must be redacted: $result")
    }

    // ── maskedPreview ─────────────────────────────────────────────────────────

    @Test
    fun `maskedPreview shows first and last 4 chars`() {
        val preview = Redactor.maskedPreview("sk-abcdefghijklmnop")
        assertTrue(preview.startsWith("sk-a"), "Should show first 4: $preview")
        assertTrue(preview.endsWith("mnop"), "Should show last 4: $preview")
        assertTrue(preview.contains("..."), "Should have ellipsis: $preview")
    }

    @Test
    fun `maskedPreview shows stars for short secrets`() {
        val preview = Redactor.maskedPreview("short")
        assertEquals("****", preview)
    }
}
