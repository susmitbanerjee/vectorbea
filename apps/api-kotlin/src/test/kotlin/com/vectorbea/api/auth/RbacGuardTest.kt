package com.vectorbea.api.auth

import com.vectorbea.api.http.Request
import com.vectorbea.api.http.Response
import com.vectorbea.api.http.Router
import org.junit.jupiter.api.Test
import java.util.UUID
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * The rule these cover: a workspace member's ROLE decides what they may write.
 *
 * This is a regression suite as much as a unit test. `Permission.kt` described
 * the four roles for a long time while `permissionsForRole` had no call sites,
 * so a viewer could create and delete workflows, agents and tools. Anything
 * here going green again means that hole is back.
 */
class RbacGuardTest {

    private val workspace: UUID = UUID.fromString("11111111-1111-4111-8111-111111111111")
    private val other: UUID = UUID.fromString("22222222-2222-4222-8222-222222222222")

    private fun principal(role: String, workspaces: Set<UUID> = setOf(workspace)) = AuthPrincipal(
        supabaseUserId = "sub",
        appUserId = UUID.randomUUID(),
        email = "member@acme.test",
        authorizedWorkspaceIds = workspaces,
        workspaceRoles = workspaces.associateWith { role },
        betaStatus = "approved",
    )

    private fun request(method: String, path: String, role: String?, workspaceHeader: UUID? = workspace) =
        Request(
            method = method,
            path = path,
            headers = workspaceHeader?.let { mapOf("x-workspace-id" to it.toString()) } ?: emptyMap(),
            requestId = "test",
            principal = role?.let { principal(it) },
        )

    /** A router carrying the guard, with one handler per pattern under test. */
    private fun router(): Router {
        val router = Router()
        router.authorize = { req, method, pattern -> RbacGuard.check(req, method, pattern) }
        router.post("/api/workflows") { Response.ok(mapOf("ok" to true)) }
        router.delete("/api/workflows/:id") { Response.ok(mapOf("ok" to true)) }
        router.post("/api/agents") { Response.ok(mapOf("ok" to true)) }
        router.delete("/api/agents/:id") { Response.ok(mapOf("ok" to true)) }
        router.post("/api/tools") { Response.ok(mapOf("ok" to true)) }
        router.get("/api/workflows") { Response.ok(mapOf("ok" to true)) }
        router.post("/api/connections") { Response.ok(mapOf("ok" to true)) }
        router.post("/api/workflows/:workflowId/run") { Response.ok(mapOf("ok" to true)) }
        router.post("/api/some/route/added/later") { Response.ok(mapOf("ok" to true)) }
        router.post("/api/workspaces") { Response.ok(mapOf("ok" to true)) }
        return router
    }

    // ── The reported bug ─────────────────────────────────────────────────────

    @Test
    fun `viewer cannot create or delete workflows agents or tools`() {
        val router = router()
        val refused = listOf(
            "POST" to "/api/workflows",
            "DELETE" to "/api/workflows/abc",
            "POST" to "/api/agents",
            "DELETE" to "/api/agents/abc",
            "POST" to "/api/tools",
        )
        for ((method, path) in refused) {
            val response = router.dispatch(request(method, path, "viewer"))
            assertEquals(403, response.status, "$method $path must be refused for a viewer")
        }
    }

    @Test
    fun `the refusal names the role held and the role needed`() {
        val response = router().dispatch(request("POST", "/api/agents", "viewer"))
        assertEquals(403, response.status)
        assertTrue(response.body.contains("Viewer"), "should name the role held: ${response.body}")
        assertTrue(response.body.contains("Developer"), "should name the role needed: ${response.body}")
    }

    // ── Reading is settled by membership, not role ───────────────────────────

    @Test
    fun `viewer can still read`() {
        assertEquals(200, router().dispatch(request("GET", "/api/workflows", "viewer")).status)
    }

    // ── The hierarchy ────────────────────────────────────────────────────────

    @Test
    fun `developer can build and run but cannot touch connections`() {
        val router = router()
        assertEquals(200, router.dispatch(request("POST", "/api/workflows", "developer")).status)
        assertEquals(200, router.dispatch(request("POST", "/api/agents", "developer")).status)
        assertEquals(200, router.dispatch(request("POST", "/api/workflows/abc/run", "developer")).status)
        assertEquals(403, router.dispatch(request("POST", "/api/connections", "developer")).status)
    }

    @Test
    fun `admin can do everything a developer can, plus connections`() {
        val router = router()
        assertEquals(200, router.dispatch(request("POST", "/api/workflows", "admin")).status)
        assertEquals(200, router.dispatch(request("POST", "/api/connections", "admin")).status)
    }

    @Test
    fun `owner can do everything an admin can`() {
        val router = router()
        assertEquals(200, router.dispatch(request("POST", "/api/workflows", "owner")).status)
        assertEquals(200, router.dispatch(request("POST", "/api/connections", "owner")).status)
    }

    // ── Deny by default ──────────────────────────────────────────────────────

    @Test
    fun `an unclassified write route still requires the developer floor`() {
        val router = router()
        assertEquals(403, router.dispatch(request("POST", "/api/some/route/added/later", "viewer")).status)
        assertEquals(200, router.dispatch(request("POST", "/api/some/route/added/later", "developer")).status)
    }

    @Test
    fun `routes that are not workspace scoped are exempt`() {
        // Creating a workspace cannot require a role in a workspace that does
        // not exist yet.
        assertEquals(200, router().dispatch(request("POST", "/api/workspaces", "viewer")).status)
    }

    // ── Edges ────────────────────────────────────────────────────────────────

    @Test
    fun `an unknown role is treated as viewer, never as a bypass`() {
        val router = Router()
        router.authorize = { req, method, pattern -> RbacGuard.check(req, method, pattern) }
        router.post("/api/agents") { Response.ok(mapOf("ok" to true)) }
        assertEquals(403, router.dispatch(request("POST", "/api/agents", "wizard")).status)
    }

    @Test
    fun `a role in one workspace grants nothing in another`() {
        val router = router()
        // Owner of `workspace`, acting on `other`: the guard cannot resolve a
        // role there, and RequestContext refuses the workspace itself.
        val response = router.dispatch(
            request("POST", "/api/agents", role = null).copy(
                principal = principal("owner", setOf(workspace)),
                headers = mapOf("x-workspace-id" to other.toString()),
            ),
        )
        // Refused by the guard itself, not left to the handler's own membership
        // check — the guard must hold even behind a handler that forgets.
        assertEquals(403, response.status, "acting on another tenant must be refused")
        assertTrue(response.body.contains("not a member"), response.body)
    }

    @Test
    fun `no principal means auth is disabled and the guard stands down`() {
        // Dev mode. RequestContext already trusts the workspace header outright
        // in this configuration, so enforcing roles on an unverified identity
        // would prove nothing.
        assertEquals(200, router().dispatch(request("POST", "/api/agents", role = null)).status)
    }
}
