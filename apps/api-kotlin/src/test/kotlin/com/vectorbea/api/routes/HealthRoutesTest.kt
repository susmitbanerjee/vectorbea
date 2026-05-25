package com.vectorbea.api.routes

import com.vectorbea.api.config.AppConfig
import com.vectorbea.api.config.DbConfig
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
            redisUrl = null,
            secretEncryptionKeyPresent = false,
            corsAllowedOrigins = setOf("*"),
            logLevel = "INFO",
            version = "0.1.0-test",
            commit = "abc1234",
            maxRequestBodyBytes = 2 * 1024 * 1024,
        )
        router = Router()
        HealthRoutes(config).register(router)
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
    fun `GET ready returns 200`() {
        val response = get("/ready")
        assertEquals(200, response.status)
    }

    @Test
    fun `GET ready body has status ok`() {
        val response = get("/ready")
        val body = fromJson<Map<String, Any>>(response.body)
        assertEquals("ok", body["status"])
    }

    @Test
    fun `GET ready body has checks field`() {
        val response = get("/ready")
        val body = fromJson<Map<String, Any>>(response.body)
        assertTrue(body.containsKey("checks"))
    }

    @Test
    fun `health response content-type is JSON`() {
        val response = get("/health")
        assertEquals("application/json; charset=utf-8", response.headers["Content-Type"])
    }
}
