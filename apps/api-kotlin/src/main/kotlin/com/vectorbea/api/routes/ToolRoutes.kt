package com.vectorbea.api.routes

import com.vectorbea.api.api.RISK_LEVELS
import com.vectorbea.api.api.TOOL_TYPES
import com.vectorbea.api.api.compatibleConnectionTypes
import com.vectorbea.api.api.context
import com.vectorbea.api.api.pageParams
import com.vectorbea.api.api.pathUUID
import com.vectorbea.api.api.requireField
import com.vectorbea.api.api.requireMaxLength
import com.vectorbea.api.api.requireOneOf
import com.vectorbea.api.api.requirePositive
import com.vectorbea.api.api.slugify
import com.vectorbea.api.api.toolRequiresConnection
import com.vectorbea.api.api.validateConfigJsonNotContainsSecrets
import com.vectorbea.api.cache.CacheKeys
import com.vectorbea.api.cache.CacheService
import com.vectorbea.api.cache.getOrSet
import com.vectorbea.api.errors.ApiError
import com.vectorbea.api.http.Request
import com.vectorbea.api.http.Response
import com.vectorbea.api.http.Router
import com.vectorbea.api.http.mapper
import com.vectorbea.api.repository.ConnectionRepository
import com.vectorbea.api.repository.CreateToolRequest
import com.vectorbea.api.repository.Page
import com.vectorbea.api.repository.Tool
import com.vectorbea.api.repository.ToolRepository
import java.util.UUID

private data class CreateToolBody(
    val name: String?,
    val slug: String? = null,
    val type: String?,
    val description: String? = null,
    val connectionId: String? = null,
    val inputSchema: Map<String, Any>? = null,
    val outputSchema: Map<String, Any>? = null,
    val config: Map<String, Any>? = null,
    val riskLevel: String?,
    val requiresApproval: Boolean? = null,
    val timeoutMs: Int? = null,
    val retryPolicy: Map<String, Any>? = null,
    val idempotencyStrategy: String? = null,
    val status: String? = null,
)

private data class UpdateToolBody(
    val name: String? = null,
    val description: String? = null,
    val connectionId: String? = null,
    val inputSchema: Map<String, Any>? = null,
    val outputSchema: Map<String, Any>? = null,
    val config: Map<String, Any>? = null,
    val riskLevel: String? = null,
    val requiresApproval: Boolean? = null,
    val timeoutMs: Int? = null,
    val retryPolicy: Map<String, Any>? = null,
    val idempotencyStrategy: String? = null,
    val status: String? = null,
)

@Suppress("UNCHECKED_CAST")
private fun Tool.toResponse(): Map<String, Any?> = mapOf(
    "id" to id.toString(),
    "workspaceId" to workspaceId.toString(),
    "environmentId" to environmentId.toString(),
    "name" to name,
    "slug" to slug,
    "type" to type,
    "description" to description,
    "connectionId" to connectionId?.toString(),
    "inputSchema" to runCatching { mapper.readValue(inputSchemaJson, Map::class.java) }.getOrDefault(emptyMap<String, Any>()),
    "outputSchema" to runCatching { mapper.readValue(outputSchemaJson, Map::class.java) }.getOrDefault(emptyMap<String, Any>()),
    "config" to runCatching { mapper.readValue(configJson, Map::class.java) }.getOrDefault(emptyMap<String, Any>()),
    "riskLevel" to riskLevel,
    "requiresApproval" to requiresApproval,
    "timeoutMs" to timeoutMs,
    "retryPolicy" to runCatching { mapper.readValue(retryPolicyJson, Map::class.java) }.getOrDefault(emptyMap<String, Any>()),
    "idempotencyStrategy" to idempotencyStrategy,
    "status" to status,
    "createdAt" to createdAt.toString(),
    "updatedAt" to updatedAt.toString(),
)

class ToolRoutes(
    private val repo: ToolRepository,
    private val connectionRepo: ConnectionRepository,
    private val cache: CacheService,
) {
    fun register(router: Router) {
        router.get("/api/tools", ::list)
        router.post("/api/tools", ::create)
        router.get("/api/tools/:id", ::getById)
        router.patch("/api/tools/:id", ::update)
        router.delete("/api/tools/:id", ::delete)
    }

    private fun list(req: Request): Response {
        val ctx = req.context()
        val params = req.pageParams()
        val typeFilter = req.query("type")
        val statusFilter = req.query("status")
        val envId = ctx.environmentId

        val cacheKey = "${CacheKeys.toolList(ctx.workspaceId.toString(), envId?.toString() ?: "all")}:${typeFilter.orEmpty()}:${statusFilter.orEmpty()}:${params.page}:${params.pageSize}"
        val page = cache.getOrSet(cacheKey, ttlSeconds = 60L) {
            repo.list(ctx.workspaceId, envId, typeFilter, statusFilter, params).mapItems { it.toResponse() }
        }
        return Response.ok(page)
    }

    private fun create(req: Request): Response {
        val ctx = req.context()
        val envId = ctx.requireEnvironmentId()
        val body = req.bodyAs<CreateToolBody>()

        val name = requireMaxLength(requireField(body.name, "name"), "name", 255)
        val type = requireOneOf(requireField(body.type, "type"), "type", TOOL_TYPES)
        val riskLevel = requireOneOf(requireField(body.riskLevel, "riskLevel"), "riskLevel", RISK_LEVELS)
        val config = body.config ?: emptyMap()
        validateConfigJsonNotContainsSecrets(config, "config")
        requirePositive(body.timeoutMs, "timeoutMs")
        val slug = slugify(body.slug?.takeIf { it.isNotBlank() } ?: name)

        // DB-write tools always require approval by default
        val requiresApproval = body.requiresApproval ?: (type == "database" || riskLevel in setOf("high", "critical"))

        var connectionId: UUID? = null
        if (body.connectionId != null) {
            connectionId = validateToolConnection(body.connectionId, type, ctx.workspaceId)
        } else if (toolRequiresConnection(type)) {
            throw ApiError.ValidationError("connectionId is required for tool type '$type'")
        }

        val tool = repo.create(
            CreateToolRequest(
                workspaceId = ctx.workspaceId,
                environmentId = envId,
                name = name,
                slug = slug,
                type = type,
                description = body.description,
                connectionId = connectionId,
                inputSchema = body.inputSchema ?: emptyMap(),
                outputSchema = body.outputSchema ?: emptyMap(),
                config = config,
                riskLevel = riskLevel,
                requiresApproval = requiresApproval,
                timeoutMs = body.timeoutMs,
                retryPolicy = body.retryPolicy ?: emptyMap(),
                idempotencyStrategy = body.idempotencyStrategy,
                status = body.status ?: "active",
            )
        )
        invalidateListCache(ctx.workspaceId, envId)
        return Response.created(tool.toResponse())
    }

    private fun getById(req: Request): Response {
        val ctx = req.context()
        val id = req.pathUUID("id")
        val tool = repo.findById(id, ctx.workspaceId) ?: throw ApiError.NotFound("Tool")
        return Response.ok(tool.toResponse())
    }

    private fun update(req: Request): Response {
        val ctx = req.context()
        val id = req.pathUUID("id")
        val body = req.bodyAs<UpdateToolBody>()

        if (body.config != null) validateConfigJsonNotContainsSecrets(body.config, "config")
        if (body.riskLevel != null) requireOneOf(body.riskLevel, "riskLevel", RISK_LEVELS)
        requirePositive(body.timeoutMs, "timeoutMs")

        var connectionId: UUID? = null
        if (body.connectionId != null) {
            val existing = repo.findById(id, ctx.workspaceId) ?: throw ApiError.NotFound("Tool")
            connectionId = validateToolConnection(body.connectionId, existing.type, ctx.workspaceId)
        }

        val tool = repo.update(
            id = id,
            workspaceId = ctx.workspaceId,
            name = body.name?.trim()?.takeIf { it.isNotBlank() },
            description = body.description,
            connectionId = connectionId,
            inputSchema = body.inputSchema,
            outputSchema = body.outputSchema,
            config = body.config,
            riskLevel = body.riskLevel,
            requiresApproval = body.requiresApproval,
            timeoutMs = body.timeoutMs,
            retryPolicy = body.retryPolicy,
            idempotencyStrategy = body.idempotencyStrategy,
            status = body.status,
        ) ?: throw ApiError.NotFound("Tool")

        invalidateListCache(ctx.workspaceId, tool.environmentId)
        return Response.ok(tool.toResponse())
    }

    private fun delete(req: Request): Response {
        val ctx = req.context()
        val id = req.pathUUID("id")
        val existing = repo.findById(id, ctx.workspaceId) ?: throw ApiError.NotFound("Tool")
        repo.delete(id, ctx.workspaceId)
        invalidateListCache(ctx.workspaceId, existing.environmentId)
        return Response.noContent()
    }

    private fun validateToolConnection(connIdStr: String, toolType: String, workspaceId: UUID): UUID {
        val connId = try {
            UUID.fromString(connIdStr)
        } catch (_: IllegalArgumentException) {
            throw ApiError.ValidationError("connectionId must be a valid UUID")
        }
        val conn = connectionRepo.findById(connId, workspaceId)
            ?: throw ApiError.ValidationError("connectionId '$connId' not found in this workspace")
        val compatible = compatibleConnectionTypes(toolType)
        if (compatible.isNotEmpty() && conn.type !in compatible) {
            throw ApiError.ValidationError(
                "Tool type '$toolType' requires a connection of type ${compatible.joinToString("/")} " +
                    "but connectionId '$connId' is type '${conn.type}'"
            )
        }
        return connId
    }

    private fun invalidateListCache(workspaceId: UUID, environmentId: UUID) {
        cache.del(CacheKeys.toolList(workspaceId.toString(), environmentId.toString()))
        cache.del(CacheKeys.toolList(workspaceId.toString(), "all"))
    }
}

private fun <T, R> Page<T>.mapItems(transform: (T) -> R) =
    Page(items = items.map(transform), total = total, page = page, pageSize = pageSize)
