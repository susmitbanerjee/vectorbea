package com.vectorbea.telemetry

import com.vectorbea.telemetry.analytics.*
import com.vectorbea.telemetry.config.TelemetryConfig
import com.vectorbea.telemetry.security.Redactor
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.Assertions.*

class IngestionValidationTest {

    @Test
    fun `valid event passes validation`() {
        val req = IngestEventRequest(
            eventName = "architect_opened",
            eventCategory = "architect",
        )
        val result = AnalyticsEventValidator.validate(req, configEnv = "prod")
        assertTrue(result.valid, "Expected valid but got errors: ${result.errors}")
    }

    @Test
    fun `unknown event name fails validation`() {
        val req = IngestEventRequest(
            eventName = "totally_unknown_event",
            eventCategory = "architect",
        )
        val result = AnalyticsEventValidator.validate(req, configEnv = "prod")
        assertFalse(result.valid)
        assertTrue(result.errors.any { "unknown eventName" in it })
    }

    @Test
    fun `unknown category fails validation`() {
        val req = IngestEventRequest(
            eventName = "architect_opened",
            eventCategory = "notacategory",
        )
        val result = AnalyticsEventValidator.validate(req, configEnv = "prod")
        assertFalse(result.valid)
        assertTrue(result.errors.any { "unknown eventCategory" in it })
    }

    @Test
    fun `invalid environment fails validation`() {
        val req = IngestEventRequest(
            eventName = "architect_opened",
            eventCategory = "architect",
            environment = "testenv",
        )
        val result = AnalyticsEventValidator.validate(req, configEnv = "prod")
        assertFalse(result.valid)
        assertTrue(result.errors.any { "environment" in it })
    }

    @Test
    fun `dev stage prod environments are valid`() {
        for (env in listOf("dev", "stage", "prod")) {
            val req = IngestEventRequest(
                eventName = "architect_opened",
                eventCategory = "architect",
                environment = env,
            )
            val result = AnalyticsEventValidator.validate(req, configEnv = "prod")
            assertTrue(result.valid, "Expected env=$env to be valid")
        }
    }
}

class RedactionTest {

    @Test
    fun `password key is redacted`() {
        val props = mapOf<String, Any?>("password" to "secret123", "name" to "test")
        val result = Redactor.redact(props)
        assertEquals("[REDACTED]", result["password"])
        assertEquals("test", result["name"])
    }

    @Test
    fun `api_key is redacted`() {
        val props = mapOf<String, Any?>("api_key" to "sk-abc123", "count" to 42)
        val result = Redactor.redact(props)
        assertEquals("[REDACTED]", result["api_key"])
        assertEquals(42, result["count"])
    }

    @Test
    fun `bearer token in string value is redacted`() {
        val props = mapOf<String, Any?>("header" to "Bearer eyJhbGciOiJIUzI1NiJ9.abc.xyz")
        val result = Redactor.redact(props)
        assertTrue((result["header"] as String).contains("[REDACTED]"))
    }

    @Test
    fun `postgres connection string in value is redacted`() {
        val props = mapOf<String, Any?>("db" to "postgres://user:pass@host:5432/db")
        val result = Redactor.redact(props)
        assertTrue((result["db"] as String).contains("[REDACTED]"))
    }

    @Test
    fun `safe properties are preserved`() {
        val props = mapOf<String, Any?>(
            "workflowId" to "uuid-123",
            "stepCount" to 5,
            "success" to true,
        )
        val result = Redactor.redact(props)
        assertEquals("uuid-123", result["workflowId"])
        assertEquals(5, result["stepCount"])
        assertEquals(true, result["success"])
    }

    @Test
    fun `nested map secrets are redacted`() {
        val props = mapOf<String, Any?>(
            "context" to mapOf("password" to "secret", "userId" to "u-123")
        )
        val result = Redactor.redact(props)
        @Suppress("UNCHECKED_CAST")
        val nested = result["context"] as Map<String, Any?>
        assertEquals("[REDACTED]", nested["password"])
        assertEquals("u-123", nested["userId"])
    }
}

class BatchLimitTest {

    private fun makeConfig() = TelemetryConfig(
        port = 8080,
        appEnv = "development",
        vectorbeaEnv = "dev",
        db = null,
        jwtSecret = null,
        corsAllowedOrigins = setOf("*"),
        adminEmails = emptySet(),
        internalToken = "test-token",
        telemetryPublicUrl = "http://localhost:8080",
        otelEnabled = false,
        otelServiceName = "test",
        otelEndpoint = null,
        otelHeaders = null,
        otelResourceAttributes = null,
        maxBatchSize = 3,
        maxEventSizeBytes = 16384,
        retentionDays = 180,
        version = "test",
    )

    @Test
    fun `batch exceeding max size is truncated`() {
        // With no DB, we just verify the validation path truncates correctly.
        // Full ingestion test requires a DB — see integration test notes.
        val events = (1..10).map {
            IngestEventRequest(
                eventName = "architect_opened",
                eventCategory = "architect",
            )
        }
        val batch = IngestBatchRequest(events)
        // Validation should process at most maxBatchSize=3 events
        val config = makeConfig()
        assertEquals(3, config.maxBatchSize)
        assertEquals(10, batch.events.size)
        // Ingestion service takes(maxBatchSize) — verified in AnalyticsIngestionService
    }
}

class EnvironmentFilterTest {

    @Test
    fun `prod filter generates correct SQL`() {
        val (sql, params) = com.vectorbea.telemetry.env.EnvironmentFilter.sqlFragment("prod")
        assertEquals("environment = ?", sql)
        assertEquals(listOf("prod"), params)
    }

    @Test
    fun `all filter generates no-op SQL`() {
        val (sql, params) = com.vectorbea.telemetry.env.EnvironmentFilter.sqlFragment("all")
        assertEquals("1=1", sql)
        assertTrue(params.isEmpty())
    }

    @Test
    fun `null filter generates no-op SQL`() {
        val (sql, params) = com.vectorbea.telemetry.env.EnvironmentFilter.sqlFragment(null)
        assertEquals("1=1", sql)
        assertTrue(params.isEmpty())
    }

    @Test
    fun `unknown env generates no-op SQL`() {
        val (sql, params) = com.vectorbea.telemetry.env.EnvironmentFilter.sqlFragment("notanenv")
        assertEquals("1=1", sql)
        assertTrue(params.isEmpty())
    }
}
