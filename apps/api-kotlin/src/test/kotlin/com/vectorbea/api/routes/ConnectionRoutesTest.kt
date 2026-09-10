package com.vectorbea.api.routes

import com.vectorbea.api.cache.CacheService
import com.vectorbea.api.cache.NoOpCacheService
import com.vectorbea.api.http.Request
import com.vectorbea.api.http.Router
import com.vectorbea.api.http.fromJson
import com.vectorbea.api.http.toJson
import com.vectorbea.api.repository.Connection
import com.vectorbea.api.repository.ConnectionRepository
import com.vectorbea.api.repository.CreateConnectionRequest
import com.vectorbea.api.repository.Page
import com.vectorbea.api.repository.PageParams
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import java.time.Instant
import java.util.UUID
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

/**
 * Tests for ConnectionRoutes — in-memory stub repository, no DB needed.
 */
class ConnectionRoutesTest {

    private val workspaceId = UUID.randomUUID()
    private val environmentId = UUID.randomUUID()
    private lateinit var router: Router
    private lateinit var stubRepo: StubConnectionRepository
    private val cache: CacheService = NoOpCacheService()

    @BeforeEach
    fun setUp() {
        stubRepo = StubConnectionRepository()
        router = Router()
        ConnectionRoutes(stubRepo, cache).register(router)
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    private fun get(path: String, extraHeaders: Map<String, String> = emptyMap()) =
        router.dispatch(Request(
            method = "GET", path = path, requestId = "test-id",
            headers = defaultHeaders() + extraHeaders,
        ))

    private fun post(path: String, body: Any, extraHeaders: Map<String, String> = emptyMap()) =
        router.dispatch(Request(
            method = "POST", path = path, requestId = "test-id",
            headers = defaultHeaders() + extraHeaders,
            body = toJson(body),
        ))

    private fun patch(path: String, body: Any) =
        router.dispatch(Request(
            method = "PATCH", path = path, requestId = "test-id",
            headers = defaultHeaders(),
            body = toJson(body),
        ))

    private fun delete(path: String) =
        router.dispatch(Request(
            method = "DELETE", path = path, requestId = "test-id",
            headers = defaultHeaders(),
        ))

    private fun defaultHeaders() = mapOf(
        "x-workspace-id" to workspaceId.toString(),
        "x-environment-id" to environmentId.toString(),
    )

    // ── GET /api/connections ─────────────────────────────────────────────────

    @Test
    fun `GET connections returns 200 with empty list`() {
        val response = get("/api/connections")
        assertEquals(200, response.status)
        val body = fromJson<Map<String, Any>>(response.body)
        assertEquals(emptyList<Any>(), body["items"])
    }

    @Test
    fun `GET connections requires workspace header`() {
        val response = router.dispatch(
            Request(method = "GET", path = "/api/connections", requestId = "r")
        )
        assertEquals(400, response.status)
        val body = fromJson<Map<String, Any>>(response.body)
        val error = body["error"] as Map<*, *>
        assertEquals("VALIDATION_ERROR", error["code"])
    }

    @Test
    fun `GET connections returns seeded connections`() {
        stubRepo.seed(makeConnection("My Conn", "llm", "openai"))
        val response = get("/api/connections")
        assertEquals(200, response.status)
        val body = fromJson<Map<String, Any>>(response.body)
        val items = body["items"] as List<*>
        assertEquals(1, items.size)
    }

    // ── POST /api/connections ────────────────────────────────────────────────

    @Test
    fun `POST connection creates and returns 201`() {
        val response = post("/api/connections", mapOf(
            "name" to "My LLM Connection",
            "type" to "llm",
            "provider" to "openai",
            "authType" to "api_key",
        ))
        assertEquals(201, response.status)
        val body = fromJson<Map<String, Any>>(response.body)
        assertEquals("My LLM Connection", body["name"])
        assertEquals("llm", body["type"])
        assertEquals("openai", body["provider"])
    }

    @Test
    fun `POST connection does not return secretConfigured=true when no secret`() {
        val response = post("/api/connections", mapOf(
            "name" to "No Secret Conn", "type" to "llm",
            "provider" to "anthropic", "authType" to "api_key",
        ))
        assertEquals(201, response.status)
        val body = fromJson<Map<String, Any>>(response.body)
        assertEquals(false, body["secretConfigured"])
        assertFalse(body.containsKey("secretRef"), "secretRef must never appear in response")
    }

    @Test
    fun `POST connection rejects missing name`() {
        val response = post("/api/connections", mapOf(
            "type" to "llm", "provider" to "openai", "authType" to "api_key",
        ))
        assertEquals(400, response.status)
        val error = (fromJson<Map<String, Any>>(response.body)["error"] as Map<*, *>)
        assertEquals("VALIDATION_ERROR", error["code"])
        assertTrue((error["message"] as String).contains("name"))
    }

    @Test
    fun `POST connection rejects invalid type`() {
        val response = post("/api/connections", mapOf(
            "name" to "bad", "type" to "invalid_type", "provider" to "x", "authType" to "api_key",
        ))
        assertEquals(400, response.status)
    }

    @Test
    fun `POST connection rejects config with secret field`() {
        val response = post("/api/connections", mapOf(
            "name" to "Sneaky Conn", "type" to "llm", "provider" to "openai", "authType" to "api_key",
            "config" to mapOf("api_key" to "sk-secret123"),
        ))
        assertEquals(400, response.status)
        val error = (fromJson<Map<String, Any>>(response.body)["error"] as Map<*, *>)
        assertEquals("VALIDATION_ERROR", error["code"])
    }

    @Test
    fun `POST connection rejects invalid authType`() {
        val response = post("/api/connections", mapOf(
            "name" to "X", "type" to "llm", "provider" to "openai", "authType" to "magic",
        ))
        assertEquals(400, response.status)
    }

    // ── GET /api/connections/{id} ────────────────────────────────────────────

    @Test
    fun `GET connection by id returns 200`() {
        val conn = makeConnection("My Conn", "database", "neon")
        stubRepo.seed(conn)
        val response = get("/api/connections/${conn.id}")
        assertEquals(200, response.status)
        val body = fromJson<Map<String, Any>>(response.body)
        assertEquals(conn.id.toString(), body["id"])
    }

    @Test
    fun `GET connection by id returns 404 when not found`() {
        val response = get("/api/connections/${UUID.randomUUID()}")
        assertEquals(404, response.status)
    }

    @Test
    fun `GET connection never returns secretRef field`() {
        val conn = makeConnection("Secret Conn", "llm", "openai", secretRef = "secret-uuid-here")
        stubRepo.seed(conn)
        val response = get("/api/connections/${conn.id}")
        assertEquals(200, response.status)
        val body = fromJson<Map<String, Any>>(response.body)
        assertFalse(body.containsKey("secretRef"), "secretRef must never be in response")
        assertEquals(true, body["secretConfigured"], "secretConfigured should be true when secretRef is set")
    }

    // ── PATCH /api/connections/{id} ──────────────────────────────────────────

    @Test
    fun `PATCH connection updates name`() {
        val conn = makeConnection("Old Name", "llm", "openai")
        stubRepo.seed(conn)
        val response = patch("/api/connections/${conn.id}", mapOf("name" to "New Name"))
        assertEquals(200, response.status)
        val body = fromJson<Map<String, Any>>(response.body)
        assertEquals("New Name", body["name"])
    }

    @Test
    fun `PATCH connection returns 404 for unknown id`() {
        val response = patch("/api/connections/${UUID.randomUUID()}", mapOf("name" to "x"))
        assertEquals(404, response.status)
    }

    // ── DELETE /api/connections/{id} ─────────────────────────────────────────

    @Test
    fun `DELETE connection returns 204`() {
        val conn = makeConnection("To Delete", "http", "custom")
        stubRepo.seed(conn)
        val response = delete("/api/connections/${conn.id}")
        assertEquals(204, response.status)
    }

    @Test
    fun `DELETE connection returns 404 for unknown id`() {
        val response = delete("/api/connections/${UUID.randomUUID()}")
        assertEquals(404, response.status)
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    private fun makeConnection(
        name: String,
        type: String,
        provider: String,
        secretRef: String? = null,
    ) = Connection(
        id = UUID.randomUUID(),
        workspaceId = workspaceId,
        environmentId = environmentId,
        name = name,
        slug = name.lowercase().replace(" ", "-"),
        type = type,
        provider = provider,
        status = "not_tested",
        networkStatus = "unknown",
        authType = "api_key",
        secretRef = secretRef,
        configJson = "{}",
        allowedHosts = "[]",
        allowedPaths = "[]",
        allowedSchemas = "[]",
        allowedTables = "[]",
        lastTestedAt = null,
        lastTestStatus = null,
        lastTestLatencyMs = null,
        lastTestErrorCode = null,
        lastTestErrorMessageSanitized = null,
        createdAt = Instant.now(),
        updatedAt = Instant.now(),
    )

    // ── In-memory stub ────────────────────────────────────────────────────────

    inner class StubConnectionRepository : ConnectionRepository(FakeDataSource()) {
        private val store = mutableMapOf<UUID, Connection>()

        fun seed(conn: Connection) { store[conn.id] = conn }

        override fun findById(id: UUID, workspaceId: UUID) =
            store[id]?.takeIf { it.workspaceId == workspaceId }

        override fun list(
            workspaceId: UUID, environmentId: UUID?, type: String?,
            status: String?, params: PageParams,
        ): Page<Connection> {
            val items = store.values
                .filter { it.workspaceId == workspaceId }
                .filter { environmentId == null || it.environmentId == environmentId }
                .filter { type == null || it.type == type }
                .filter { status == null || it.status == status }
            return Page(items, items.size.toLong(), params.page, params.pageSize)
        }

        override fun create(req: CreateConnectionRequest): Connection {
            val conn = Connection(
                id = UUID.randomUUID(),
                workspaceId = req.workspaceId,
                environmentId = req.environmentId,
                name = req.name,
                slug = req.slug,
                type = req.type,
                provider = req.provider,
                status = "not_tested",
                networkStatus = "unknown",
                authType = req.authType,
                secretRef = req.secretRef,
                configJson = "{}",
                allowedHosts = "[]",
                allowedPaths = "[]",
                allowedSchemas = "[]",
                allowedTables = "[]",
                lastTestedAt = null,
                lastTestStatus = null,
                lastTestLatencyMs = null,
                lastTestErrorCode = null,
                lastTestErrorMessageSanitized = null,
                createdAt = Instant.now(),
                updatedAt = Instant.now(),
            )
            store[conn.id] = conn
            return conn
        }

        override fun update(
            id: UUID, workspaceId: UUID, name: String?, configJson: Map<String, Any>?,
            allowedHosts: List<String>?, allowedPaths: List<String>?,
            allowedSchemas: List<String>?, allowedTables: List<String>?, status: String?,
            secretRef: String?, egressPolicy: String?, egressPolicySetBy: UUID?,
            protocol: String?,
        ): Connection? {
            val existing = store[id]?.takeIf { it.workspaceId == workspaceId } ?: return null
            val updated = existing.copy(
                name = name ?: existing.name,
                status = status ?: existing.status,
                egressPolicy = egressPolicy ?: existing.egressPolicy,
                protocol = protocol ?: existing.protocol,
                updatedAt = Instant.now(),
            )
            store[id] = updated
            return updated
        }

        override fun delete(id: UUID, workspaceId: UUID): Boolean {
            return store.remove(id) != null
        }
    }
}

// Minimal DataSource stub (not used — methods are overridden)
private class FakeDataSource : javax.sql.DataSource by FakeDataSourceImpl()
private class FakeDataSourceImpl : javax.sql.DataSource {
    override fun getConnection(): java.sql.Connection = throw UnsupportedOperationException("stub")
    override fun getConnection(u: String?, p: String?) = getConnection()
    override fun getLogWriter() = null
    override fun setLogWriter(out: java.io.PrintWriter?) {}
    override fun setLoginTimeout(seconds: Int) {}
    override fun getLoginTimeout() = 0
    override fun getParentLogger(): java.util.logging.Logger = throw java.sql.SQLFeatureNotSupportedException("stub")
    override fun <T : Any?> unwrap(iface: Class<T>?): T = throw UnsupportedOperationException()
    override fun isWrapperFor(iface: Class<*>?) = false
}
