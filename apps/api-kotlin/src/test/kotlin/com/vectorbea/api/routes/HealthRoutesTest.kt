package com.vectorbea.api.routes

import com.vectorbea.api.config.AppConfig
import com.vectorbea.api.http.Request
import com.vectorbea.api.http.Router
import com.vectorbea.api.http.fromJson
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

class HealthRoutesTest {

    private lateinit var router: Router
    private lateinit var config: AppConfig

    @BeforeEach
    fun setUp() {
        config = AppConfig(
            port = 8080,
            appEnv = "test",
            db = null,
            redis = null,
            secretEncryptionKeyPresent = false,
            corsAllowedOrigins = setOf("*"),
            logLevel = "INFO",
            version = "0.1.0-test",
            commit = "abc1234",
            maxRequestBodyBytes = 2 * 1024 * 1024,
        )
        router = Router()
        // No database or redis wired — tests degraded/disabled paths
        HealthRoutes(config, database = null, redis = null).register(router)
    }

    private fun get(path: String) = router.dispatch(
        Request(method = "GET", path = path, requestId = "test-id")
    )

    @Test
    fun `GET health returns 200`() {
        val response = get("/health")
        assertEquals(200, response.status)
    }

    @Test
    fun `GET health body has required fields`() {
        val response = get("/health")
        val body = fromJson<Map<String, Any>>(response.body)

        assertEquals("ok", body["status"])
        assertEquals("vectorbea-api", body["service"])
        assertNotNull(body["time"])
        assertEquals("0.1.0-test", body["version"])
    }

    @Test
    fun `GET ready returns non-200 when db missing (required)`() {
        // DB is required — missing DB → error → 503
        val response = get("/ready")
        assertEquals(503, response.status)
    }

    @Test
    fun `GET ready body has status error when db missing`() {
        val response = get("/ready")
        val body = fromJson<Map<String, Any>>(response.body)
        assertEquals("error", body["status"])
    }

    @Test
    fun `GET ready body checks map contains db and redis keys`() {
        val response = get("/ready")
        val body = fromJson<Map<String, Any>>(response.body)
        @Suppress("UNCHECKED_CAST")
        val checks = body["checks"] as? Map<String, Any>
        assertNotNull(checks)
        assertTrue(checks.containsKey("db"))
        assertTrue(checks.containsKey("redis"))
    }

    @Test
    fun `GET ready checks db=disabled when no db configured`() {
        val response = get("/ready")
        val body = fromJson<Map<String, Any>>(response.body)
        @Suppress("UNCHECKED_CAST")
        val checks = body["checks"] as Map<String, Any>
        assertEquals("disabled", checks["db"])
    }

    @Test
    fun `health response content-type is JSON`() {
        val response = get("/health")
        assertEquals("application/json; charset=utf-8", response.headers["Content-Type"])
    }

    @Test
    fun `ready response content-type is JSON`() {
        val response = get("/ready")
        assertEquals("application/json; charset=utf-8", response.headers["Content-Type"])
    }
}
