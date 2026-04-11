package com.vectorbee.api.controller

import com.sun.net.httpserver.HttpServer
import com.vectorbee.api.auth.AuthFilter
import com.vectorbee.api.auth.rbac.WorkspaceRole
import com.vectorbee.api.http.Json
import com.vectorbee.api.http.Router
import com.vectorbee.api.db.Database
import com.vectorbee.api.model.*
import com.vectorbee.api.repository.ApiKeyRepository
import com.vectorbee.api.repository.PromptRepository
import com.vectorbee.api.service.AuthService
import com.vectorbee.api.service.PromptService
import org.junit.jupiter.api.AfterAll
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNotEquals
import org.junit.jupiter.api.BeforeAll
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.TestInstance
import java.net.HttpURLConnection
import java.net.InetSocketAddress
import java.net.URI
import java.time.OffsetDateTime
import java.util.UUID

/**
 * Security regression tests for IDOR protection on prompt endpoints.
 *
 * Spins up a real [HttpServer] with [AuthFilter] backed by in-memory
 * fakes. Two tokens map to two isolated workspaces; each test verifies
 * that Workspace A cannot access Workspace B's resources.
 */
@TestInstance(TestInstance.Lifecycle.PER_CLASS)
class PromptControllerSecurityTest {

    companion object {
        private val WORKSPACE_A = UUID.randomUUID()
        private val WORKSPACE_B = UUID.randomUUID()
        private val ORG_A = UUID.randomUUID()
        private val ORG_B = UUID.randomUUID()
        private const val TOKEN_A = "vb_test_workspace_a_key"
        private const val TOKEN_B = "vb_test_workspace_b_key"
    }

    private lateinit var server: HttpServer
    private var port: Int = 0

    // ── In-memory fakes ─────────────────────────────────────────────────

    /**
     * Maps raw tokens to [AuthResult] without any DB or hashing.
     */
    /** A [Database] that never connects — safe for in-memory fakes. */
    private class NoOpDatabase : Database()

    private class FakeAuthService : AuthService(ApiKeyRepository(NoOpDatabase())) {
        override fun authenticate(rawToken: String): AuthResult? = when (rawToken) {
            TOKEN_A -> AuthResult(WORKSPACE_A, ORG_A, WorkspaceRole.EDITOR)
            TOKEN_B -> AuthResult(WORKSPACE_B, ORG_B, WorkspaceRole.EDITOR)
            else -> null
        }
    }

    private data class StoredPrompt(
        val promptId: UUID,
        val workspaceId: UUID,
        val name: String,
        val description: String?,
        val versionTag: String,
        val templateText: String,
        val isPublished: Boolean
    )

    /**
     * Workspace-scoped in-memory prompt store.
     */
    private class InMemoryPromptRepo : PromptRepository(NoOpDatabase()) {
        private val store = mutableListOf<StoredPrompt>()

        override fun createPromptWithInitialVersion(
            workspaceId: UUID, name: String, description: String?,
            versionTag: String, templateText: String, parametersJson: String
        ): Pair<PromptRecord, PromptVersionRecord> {
            val pid = UUID.randomUUID(); val vid = UUID.randomUUID()
            store.add(StoredPrompt(pid, workspaceId, name, description, versionTag, templateText, false))
            return PromptRecord(pid, workspaceId, name, description, OffsetDateTime.now()) to
                PromptVersionRecord(vid, pid, versionTag, templateText, Json.decodeJsonNode("{}"), OffsetDateTime.now())
        }

        override fun findById(promptId: UUID, workspaceId: UUID): PromptVersionView? =
            store.find { it.promptId == promptId && it.workspaceId == workspaceId }?.toView()

        override fun listPrompts(workspaceId: UUID): List<PromptListItem> =
            store.filter { it.workspaceId == workspaceId }.map {
                PromptListItem(it.promptId, it.name, it.description, it.versionTag, it.isPublished, OffsetDateTime.now())
            }

        override fun listVersions(promptId: UUID, workspaceId: UUID): List<PromptVersionView> =
            store.find { it.promptId == promptId && it.workspaceId == workspaceId }
                ?.let { listOf(it.toView()) } ?: emptyList()

        override fun updatePrompt(
            promptId: UUID, workspaceId: UUID, description: String?,
            templateText: String, parametersJson: String, versionTag: String?
        ): PromptVersionView? {
            val idx = store.indexOfFirst { it.promptId == promptId && it.workspaceId == workspaceId }
            if (idx == -1) return null
            store[idx] = store[idx].copy(description = description, templateText = templateText,
                versionTag = versionTag ?: store[idx].versionTag)
            return store[idx].toView()
        }

        override fun publishPrompt(promptId: UUID, workspaceId: UUID): PromptVersionView? {
            val idx = store.indexOfFirst { it.promptId == promptId && it.workspaceId == workspaceId }
            if (idx == -1) return null
            store[idx] = store[idx].copy(isPublished = true)
            return store[idx].toView()
        }

        override fun findLatestByName(workspaceId: UUID, name: String): PromptVersionView? =
            store.find { it.workspaceId == workspaceId && it.name == name && it.isPublished }?.toView()

        private fun StoredPrompt.toView() = PromptVersionView(
            promptId, UUID.randomUUID(), workspaceId, name, description,
            versionTag, templateText, Json.decodeJsonNode("{}"), isPublished, OffsetDateTime.now()
        )
    }

    // ── Server lifecycle ────────────────────────────────────────────────

    @BeforeAll
    fun setup() {
        val repo = InMemoryPromptRepo()
        val controller = PromptController(PromptService(repo))

        val router = Router().apply {
            post("/api/prompts") { e -> controller.create(e) }
            get("/api/prompts") { e -> controller.list(e) }
            get("/api/prompts/:id") { e -> controller.getByReference(e) }
            get("/api/prompts/:id/versions") { e -> controller.versions(e) }
            post("/api/prompts/:id") { e -> controller.update(e) }
            post("/api/prompts/:id/publish") { e -> controller.publish(e) }
        }

        server = HttpServer.create(InetSocketAddress(0), 0).apply {
            createContext("/", router).filters.add(
                AuthFilter(
                    authService = FakeAuthService(),
                    protectedRoutes = listOf(
                        AuthFilter.RouteDefinition("POST", "/api/prompts"),
                        AuthFilter.RouteDefinition("GET", "/api/prompts"),
                        AuthFilter.RouteDefinition("GET", "/api/prompts/:id"),
                        AuthFilter.RouteDefinition("GET", "/api/prompts/:id/versions"),
                        AuthFilter.RouteDefinition("POST", "/api/prompts/:id"),
                        AuthFilter.RouteDefinition("POST", "/api/prompts/:id/publish"),
                    )
                )
            )
        }
        server.start()
        port = server.address.port
    }

    @AfterAll
    fun teardown() {
        server.stop(0)
    }

    // ── Helpers ──────────────────────────────────────────────────────────

    private fun http(
        method: String, path: String,
        token: String? = null, body: String? = null
    ): Pair<Int, String> {
        val conn = URI("http://localhost:$port$path").toURL()
            .openConnection() as HttpURLConnection
        conn.requestMethod = method
        conn.setRequestProperty("Content-Type", "application/json")
        token?.let { conn.setRequestProperty("Authorization", "Bearer $it") }
        if (body != null) { conn.doOutput = true; conn.outputStream.use { it.write(body.toByteArray()) } }
        val status = conn.responseCode
        val text = try { conn.inputStream.bufferedReader().readText() }
                   catch (_: Exception) { conn.errorStream?.bufferedReader()?.readText() ?: "" }
        return status to text
    }

    private fun createPromptAs(token: String, name: String): UUID {
        val json = """{"name":"$name","versionTag":"v1.0.0","templateText":"Hello {{name}}"}"""
        val (status, body) = http("POST", "/api/prompts", token, json)
        assertEquals(201, status, "Create should succeed")
        return UUID.fromString(Json.decodeJsonNode(body).get("promptId").asText())
    }

    // ── Security tests ──────────────────────────────────────────────────

    @Test
    fun `unauthenticated request returns 401`() {
        val (status, _) = http("GET", "/api/prompts")
        assertEquals(401, status)
    }

    @Test
    fun `invalid token returns 401`() {
        val (status, _) = http("GET", "/api/prompts", "bogus_token")
        assertEquals(401, status)
    }

    @Test
    fun `workspace A cannot read workspace B prompt by ID`() {
        val pid = createPromptAs(TOKEN_B, "secret-b")
        val (status, _) = http("GET", "/api/prompts/$pid", TOKEN_A)
        assertEquals(404, status, "Cross-workspace GET by ID must return 404")
    }

    @Test
    fun `workspace A listing does not contain workspace B prompts`() {
        createPromptAs(TOKEN_A, "my-prompt-a")
        createPromptAs(TOKEN_B, "my-prompt-b")
        val (status, body) = http("GET", "/api/prompts", TOKEN_A)
        assertEquals(200, status)
        val items = Json.decodeJsonNode(body)
        for (i in 0 until items.size()) {
            assertNotEquals("my-prompt-b", items[i]["name"].asText(),
                "Workspace A must not see Workspace B prompts")
        }
    }

    @Test
    fun `workspace A cannot update workspace B prompt`() {
        val pid = createPromptAs(TOKEN_B, "update-target-b")
        val (status, _) = http("POST", "/api/prompts/$pid", TOKEN_A,
            """{"templateText":"pwned","parameters":{}}""")
        assertEquals(404, status, "Cross-workspace update must return 404")
    }

    @Test
    fun `workspace A cannot publish workspace B prompt`() {
        val pid = createPromptAs(TOKEN_B, "publish-target-b")
        val (status, _) = http("POST", "/api/prompts/$pid/publish", TOKEN_A)
        assertEquals(404, status, "Cross-workspace publish must return 404")
    }

    @Test
    fun `workspace A cannot list versions of workspace B prompt`() {
        val pid = createPromptAs(TOKEN_B, "versions-target-b")
        val (status, _) = http("GET", "/api/prompts/$pid/versions", TOKEN_A)
        assertEquals(404, status, "Cross-workspace version listing must return 404")
    }

    @Test
    fun `same-workspace access succeeds`() {
        val pid = createPromptAs(TOKEN_A, "own-prompt")
        val (status, _) = http("GET", "/api/prompts/$pid", TOKEN_A)
        assertEquals(200, status, "Same-workspace access must succeed")
    }
}
