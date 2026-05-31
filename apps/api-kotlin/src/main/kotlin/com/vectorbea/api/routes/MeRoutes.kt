package com.vectorbea.api.routes

import com.vectorbea.api.errors.ApiError
import com.vectorbea.api.http.Request
import com.vectorbea.api.http.Response
import com.vectorbea.api.http.Router
import com.vectorbea.api.users.AppUserRepository
import com.vectorbea.api.users.WorkspaceMembership
import org.slf4j.LoggerFactory
import java.util.UUID

/**
 * Routes:
 *   GET  /api/me              — returns authenticated user + workspace memberships
 *   POST /api/workspaces      — create a new workspace (authenticated user becomes owner)
 *
 * These are the bootstrap routes for workspace setup.
 * /api/me must be called after every login to discover authorized workspaces.
 */
class MeRoutes(private val userRepo: AppUserRepository) {

    private val log = LoggerFactory.getLogger(MeRoutes::class.java)

    fun register(router: Router) {
        router.get("/api/me",         ::me)
        router.post("/api/workspaces", ::createWorkspace)
    }

    // ── GET /api/me ───────────────────────────────────────────────────────────

    private fun me(req: Request): Response {
        val principal = req.principal
            ?: throw ApiError.Unauthorized("Authentication required")

        val memberships = userRepo.loadWorkspacesWithRoles(principal.appUserId)

        val defaultWorkspaceId = when {
            memberships.size == 1 -> memberships.first().workspaceId.toString()
            // Prefer owner workspace as default
            memberships.any { it.role == "owner" } ->
                memberships.first { it.role == "owner" }.workspaceId.toString()
            memberships.isNotEmpty() -> memberships.first().workspaceId.toString()
            else -> null
        }

        return Response.ok(mapOf(
            "user" to mapOf(
                "id"              to principal.appUserId.toString(),
                "supabaseUserId"  to principal.supabaseUserId,
                "email"           to principal.email,
            ),
            "workspaces" to memberships.map { it.toMap() },
            "defaultWorkspaceId" to defaultWorkspaceId,
        ))
    }

    // ── POST /api/workspaces ──────────────────────────────────────────────────

    private fun createWorkspace(req: Request): Response {
        val principal = req.principal
            ?: throw ApiError.Unauthorized("Authentication required")

        data class CreateReq(val name: String?, val slug: String?)
        val body = try {
            com.vectorbea.api.http.mapper.readValue(req.body, CreateReq::class.java)
        } catch (e: Exception) {
            throw ApiError.ValidationError("Invalid JSON body: ${e.message}")
        }

        val name = body.name?.trim()?.takeIf { it.isNotEmpty() }
            ?: throw ApiError.ValidationError("'name' is required")

        // Generate slug from name if not provided
        val slug = body.slug?.trim()?.takeIf { it.isNotEmpty() }
            ?: name.lowercase().replace(Regex("[^a-z0-9]+"), "-").trim('-')

        if (!slug.matches(Regex("[a-z0-9][a-z0-9-]{0,61}[a-z0-9]?"))) {
            throw ApiError.ValidationError("slug must be lowercase alphanumeric with hyphens, 2-63 chars")
        }

        val wsId = try {
            userRepo.createWorkspace(
                userId = principal.appUserId,
                name   = name,
                slug   = slug,
            )
        } catch (e: org.postgresql.util.PSQLException) {
            if (e.message?.contains("unique") == true || e.message?.contains("duplicate") == true) {
                throw ApiError.Conflict("A workspace with slug '$slug' already exists")
            }
            log.error("Failed to create workspace: {}", e.message)
            throw ApiError.InternalError("Failed to create workspace")
        }

        return Response(
            status = 201,
            body   = com.vectorbea.api.http.toJson(mapOf(
                "id"   to wsId.toString(),
                "name" to name,
                "slug" to slug,
                "role" to "owner",
            )),
            headers = mapOf("Content-Type" to "application/json; charset=utf-8"),
        )
    }

    private fun WorkspaceMembership.toMap() = mapOf(
        "id"   to workspaceId.toString(),
        "name" to name,
        "slug" to slug,
        "role" to role,
    )
}
