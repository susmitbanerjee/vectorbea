package com.vectorbea.api.routes

import com.vectorbea.api.api.AGENT_TYPES
import com.vectorbea.api.api.context
import com.vectorbea.api.api.pageParams
import com.vectorbea.api.api.pathUUID
import com.vectorbea.api.api.requireField
import com.vectorbea.api.api.requireMaxLength
import com.vectorbea.api.api.requireOneOf
import com.vectorbea.api.api.requirePositiveDouble
import com.vectorbea.api.api.requirePositive
import com.vectorbea.api.api.slugify
import com.vectorbea.api.cache.CacheKeys
import com.vectorbea.api.cache.CacheService
import com.vectorbea.api.cache.getOrSet
import com.vectorbea.api.errors.ApiError
import com.vectorbea.api.http.Request
import com.vectorbea.api.http.Response
import com.vectorbea.api.http.Router
import com.vectorbea.api.http.mapper
import com.vectorbea.api.repository.Agent
import com.vectorbea.api.repository.AgentRepository
import com.vectorbea.api.repository.ConnectionRepository
import com.vectorbea.api.repository.CreateAgentRequest
import com.vectorbea.api.repository.Page
import java.util.UUID

// ── Request bodies ────────────────────────────────────────────────────────────

private data class CreateAgentBody(
    val name: String?,
    val slug: String? = null,
    val type: String?,
    val role: String? = null,
    val instructions: String? = null,
    val llmConnectionId: String? = null,
    val modelName: String? = null,
    val temperature: Double? = null,
    val maxTokens: Int? = null,
    val maxIterations: Int? = null,
    val allowedToolIds: List<String>? = null,
    val memoryPolicy: Map<String, Any>? = null,
    val retryPolicy: Map<String, Any>? = null,
    val timeoutPolicy: Map<String, Any>? = null,
    val approvalPolicy: Map<String, Any>? = null,
    val outputSchema: Map<String, Any>? = null,
    val status: String? = null,
)

private data class UpdateAgentBody(
    val name: String? = null,
    val role: String? = null,
    val instructions: String? = null,
    val llmConnectionId: String? = null,
    val modelName: String? = null,
    val temperature: Double? = null,
    val maxTokens: Int? = null,
    val maxIterations: Int? = null,
    val allowedToolIds: List<String>? = null,
    val memoryPolicy: Map<String, Any>? = null,
    val retryPolicy: Map<String, Any>? = null,
    val timeoutPolicy: Map<String, Any>? = null,
    val approvalPolicy: Map<String, Any>? = null,
    val outputSchema: Map<String, Any>? = null,
    val status: String? = null,
)

// ── Response ──────────────────────────────────────────────────────────────────

@Suppress("UNCHECKED_CAST")
private fun Agent.toResponse(): Map<String, Any?> = mapOf(
    "id" to id.toString(),
    "workspaceId" to workspaceId.toString(),
    "environmentId" to environmentId.toString(),
    "name" to name,
    "slug" to slug,
    "type" to type,
    "role" to role,
    "instructions" to instructions,
    "llmConnectionId" to llmConnectionId?.toString(),
    "modelName" to modelName,
    "temperature" to temperature,
    "maxTokens" to maxTokens,
    "maxIterations" to maxIterations,
    "memoryPolicy" to runCatching { mapper.readValue(memoryPolicyJson, Map::class.java) }.getOrDefault(emptyMap<String, Any>()),
    "retryPolicy" to runCatching { mapper.readValue(retryPolicyJson, Map::class.java) }.getOrDefault(emptyMap<String, Any>()),
    "timeoutPolicy" to runCatching { mapper.readValue(timeoutPolicyJson, Map::class.java) }.getOrDefault(emptyMap<String, Any>()),
    "approvalPolicy" to runCatching { mapper.readValue(approvalPolicyJson, Map::class.java) }.getOrDefault(emptyMap<String, Any>()),
    "allowedToolIds" to allowedToolIds,
    "outputSchema" to runCatching { mapper.readValue(outputSchemaJson, Map::class.java) }.getOrDefault(emptyMap<String, Any>()),
    "status" to status,
    "createdAt" to createdAt.toString(),
    "updatedAt" to updatedAt.toString(),
)

// ── Route handler ─────────────────────────────────────────────────────────────

class AgentRoutes(
    private val repo: AgentRepository,
    private val connectionRepo: ConnectionRepository,
    private val cache: CacheService,
) {
    fun register(router: Router) {
        router.get("/api/agents", ::list)
        router.post("/api/agents", ::create)
        router.get("/api/agents/:id", ::getById)
        router.patch("/api/agents/:id", ::update)
        router.delete("/api/agents/:id", ::delete)
    }

    private fun list(req: Request): Response {
        val ctx = req.context()
        val params = req.pageParams()
        val statusFilter = req.query("status")
        val envId = ctx.environmentId

        val cacheKey = "${CacheKeys.agentList(ctx.workspaceId.toString(), envId?.toString() ?: "all")}:${statusFilter.orEmpty()}:${params.page}:${params.pageSize}"
        val page = cache.getOrSet(cacheKey, ttlSeconds = 60L) {
            repo.list(ctx.workspaceId, envId, statusFilter, params).mapItems { it.toResponse() }
        }
        return Response.ok(page)
    }

    private fun create(req: Request): Response {
        val ctx = req.context()
        val envId = ctx.requireEnvironmentId()
        val body = req.bodyAs<CreateAgentBody>()

        val name = requireMaxLength(requireField(body.name, "name"), "name", 255)
        val type = requireOneOf(requireField(body.type, "type"), "type", AGENT_TYPES)
        val slug = slugify(body.slug?.takeIf { it.isNotBlank() } ?: name)

        // type-specific validation
        var llmConnectionId: UUID? = null
        if (type == "native_llm_agent") {
            requireField(body.instructions, "instructions (required for native_llm_agent)")
            requireField(body.modelName, "modelName (required for native_llm_agent)")
            val llmConnIdStr = requireField(body.llmConnectionId, "llmConnectionId (required for native_llm_agent)")
            llmConnectionId = parseAndValidateLlmConnection(llmConnIdStr, ctx.workspaceId)
        } else if (body.llmConnectionId != null) {
            // Optional llmConnectionId for other agent types — still validate it
            llmConnectionId = parseAndValidateLlmConnection(body.llmConnectionId, ctx.workspaceId)
        }

        requirePositiveDouble(body.temperature, "temperature")
        requirePositive(body.maxTokens, "maxTokens")
        requirePositive(body.maxIterations, "maxIterations")

        val agent = repo.create(
            CreateAgentRequest(
                workspaceId = ctx.workspaceId,
                environmentId = envId,
                name = name,
                slug = slug,
                type = type,
                role = body.role,
                instructions = body.instructions,
                llmConnectionId = llmConnectionId,
                modelName = body.modelName,
                temperature = body.temperature,
                maxTokens = body.maxTokens,
                maxIterations = body.maxIterations,
                allowedToolIds = body.allowedToolIds ?: emptyList(),
                memoryPolicy = body.memoryPolicy ?: emptyMap(),
                retryPolicy = body.retryPolicy ?: emptyMap(),
                timeoutPolicy = body.timeoutPolicy ?: emptyMap(),
                approvalPolicy = body.approvalPolicy ?: emptyMap(),
                outputSchema = body.outputSchema ?: emptyMap(),
                status = body.status ?: "active",
            )
        )
        invalidateListCache(ctx.workspaceId, envId)
        return Response.created(agent.toResponse())
    }

    private fun getById(req: Request): Response {
        val ctx = req.context()
        val id = req.pathUUID("id")
        val agent = repo.findById(id, ctx.workspaceId) ?: throw ApiError.NotFound("Agent")
        return Response.ok(agent.toResponse())
    }

    private fun update(req: Request): Response {
        val ctx = req.context()
        val id = req.pathUUID("id")
        val body = req.bodyAs<UpdateAgentBody>()

        var llmConnectionId: UUID? = null
        if (body.llmConnectionId != null) {
            llmConnectionId = parseAndValidateLlmConnection(body.llmConnectionId, ctx.workspaceId)
        }

        requirePositiveDouble(body.temperature, "temperature")
        requirePositive(body.maxTokens, "maxTokens")
        requirePositive(body.maxIterations, "maxIterations")

        val agent = repo.update(
            id = id,
            workspaceId = ctx.workspaceId,
            name = body.name?.trim()?.takeIf { it.isNotBlank() },
            role = body.role,
            instructions = body.instructions,
            llmConnectionId = llmConnectionId,
            modelName = body.modelName,
            temperature = body.temperature,
            maxTokens = body.maxTokens,
            maxIterations = body.maxIterations,
            allowedToolIds = body.allowedToolIds,
            memoryPolicy = body.memoryPolicy,
            retryPolicy = body.retryPolicy,
            timeoutPolicy = body.timeoutPolicy,
            approvalPolicy = body.approvalPolicy,
            outputSchema = body.outputSchema,
            status = body.status,
        ) ?: throw ApiError.NotFound("Agent")

        invalidateListCache(ctx.workspaceId, agent.environmentId)
        return Response.ok(agent.toResponse())
    }

    private fun delete(req: Request): Response {
        val ctx = req.context()
        val id = req.pathUUID("id")
        val existing = repo.findById(id, ctx.workspaceId) ?: throw ApiError.NotFound("Agent")
        repo.delete(id, ctx.workspaceId)
        invalidateListCache(ctx.workspaceId, existing.environmentId)
        return Response.noContent()
    }

    /**
     * Validates that [llmConnIdStr] is a valid UUID pointing to an LLM-type connection
     * in [workspaceId]. Throws [ApiError.ValidationError] if not.
     */
    private fun parseAndValidateLlmConnection(llmConnIdStr: String, workspaceId: UUID): UUID {
        val llmConnId = try {
            UUID.fromString(llmConnIdStr)
        } catch (_: IllegalArgumentException) {
            throw ApiError.ValidationError("llmConnectionId must be a valid UUID")
        }
        val conn = connectionRepo.findById(llmConnId, workspaceId)
            ?: throw ApiError.ValidationError("llmConnectionId '$llmConnId' not found in this workspace")
        if (conn.type != "llm") {
            throw ApiError.ValidationError(
                "llmConnectionId must point to an LLM-type connection, but '$llmConnId' is type '${conn.type}'"
            )
        }
        return llmConnId
    }

    private fun invalidateListCache(workspaceId: UUID, environmentId: UUID) {
        // Use prefix deletion — actual cache keys include :statusFilter:page:pageSize suffixes
        cache.delByPrefix(CacheKeys.agentList(workspaceId.toString(), "").dropLast(1))
    }
}

private fun <T, R> Page<T>.mapItems(transform: (T) -> R) =
    Page(items = items.map(transform), total = total, page = page, pageSize = pageSize)
