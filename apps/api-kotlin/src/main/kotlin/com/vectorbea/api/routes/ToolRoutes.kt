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
    /** The declarative HTTP call. See HttpToolSpec and V064. */
    val httpSpec: Map<String, Any>? = null,
    /** What the model sees of the result. See ToolResultContract and V056. */
    val resultContract: Map<String, Any>? = null,
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
    val httpSpec: Map<String, Any>? = null,
    val resultContract: Map<String, Any>? = null,
    val riskLevel: String? = null,
    val requiresApproval: Boolean? = null,
    val timeoutMs: Int? = null,
    val retryPolicy: Map<String, Any>? = null,
    val idempotencyStrategy: String? = null,
    val status: String? = null,
)

private data class TestToolBody(
    val type: String?,
    val connectionId: String? = null,
    val inputSchema: Map<String, Any>? = null,
    val outputSchema: Map<String, Any>? = null,
    val config: Map<String, Any>? = null,
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
    "httpSpec" to httpSpecJson?.let { runCatching { mapper.readValue(it, Map::class.java) }.getOrNull() },
    "resultContract" to resultContractJson?.let { runCatching { mapper.readValue(it, Map::class.java) }.getOrNull() },
    "currentVersion" to currentVersion,
    "createdAt" to createdAt.toString(),
    "updatedAt" to updatedAt.toString(),
)

class ToolRoutes(
    private val repo: ToolRepository,
    private val connectionRepo: ConnectionRepository,
    private val cache: CacheService,
    /**
     * Records a snapshot on every definition change.
     *
     * ── WHY A UI EDIT APPLIES AND AN IMPORT DOES NOT ────────────────────────
     * A person editing their own tool has just decided to; making them then
     * approve their own edit is bureaucracy, and bureaucracy that fires on every
     * save is bureaucracy people route around. A spec RE-IMPORT is different:
     * nobody read the forty operations it changed, and one of them may be a tool
     * an agent is granted. So an edit here writes an `applied` version — history
     * and a rollback point — and `ApiSpecRoutes` writes a `pending` one.
     *
     * Null keeps existing call sites compiling and skips the snapshot.
     */
    private val versions: com.vectorbea.api.repository.ToolVersionRepository? = null,
) {
    fun register(router: Router) {
        router.get("/api/tools", ::list)
        router.post("/api/tools", ::create)
        router.post("/api/tools/test-unsaved", ::testUnsaved)
        router.get("/api/tools/:id", ::getById)
        router.patch("/api/tools/:id", ::update)
        router.delete("/api/tools/:id", ::delete)
    }

    /**
     * Validates the exact unsaved configuration that the registry form will
     * persist. This is deliberately side-effect free: validating a POST,
     * DELETE, email, or database-write tool must never execute it.
     */
    private fun testUnsaved(req: Request): Response {
        val ctx = req.context()
        val body = req.bodyAs<TestToolBody>()
        val type = requireOneOf(requireField(body.type, "type"), "type", TOOL_TYPES)
        val config = body.config ?: emptyMap()
        validateConfigJsonNotContainsSecrets(config, "config")

        if (body.connectionId != null) {
            validateToolConnection(body.connectionId, type, ctx.workspaceId)
        } else if (toolRequiresConnection(type)) {
            throw ApiError.ValidationError("connectionId is required for tool type '$type'")
        }

        when (type) {
            "http" -> {
                val url = requireField(config["url"] as? String, "config.url")
                val uri = runCatching { java.net.URI(url) }.getOrElse {
                    throw ApiError.ValidationError("config.url must be a valid HTTP or HTTPS URL")
                }
                if (uri.scheme !in setOf("http", "https") || uri.host.isNullOrBlank()) {
                    throw ApiError.ValidationError("config.url must be a valid HTTP or HTTPS URL")
                }
                val method = (config["method"] as? String)?.uppercase() ?: "GET"
                requireOneOf(method, "config.method", setOf("GET", "POST", "PUT", "PATCH", "DELETE"))
            }
            "database" -> requireField(config["sqlTemplate"] as? String, "config.sqlTemplate")
        }

        return Response.ok(mapOf(
            "valid" to true,
            "message" to "Configuration validated. No external action was executed.",
        ))
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
        val httpSpecJson = validateHttpSpec(body.httpSpec, type)
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
        /*
         * The spec is written in a second statement because `CreateToolRequest`
         * predates it and every other caller — the architect, the connector UI,
         * the tests — would otherwise grow two fields it has no value for. The
         * write is unconditional and immediate, so a tool never exists without
         * the spec it was created with.
         */
        val stored = if (httpSpecJson != null || body.resultContract != null) {
            repo.update(
                id = tool.id, workspaceId = ctx.workspaceId,
                httpSpecJson = httpSpecJson,
                resultContractJson = body.resultContract?.let { mapper.writeValueAsString(it) },
            ) ?: tool
        } else tool

        snapshot(stored, ctx.workspaceId, req.principal?.appUserId, "Created.")
        invalidateListCache(ctx.workspaceId, envId)
        return Response.created(stored.toResponse())
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

        val existing = repo.findById(id, ctx.workspaceId) ?: throw ApiError.NotFound("Tool")
        val httpSpecJson = validateHttpSpec(body.httpSpec, existing.type)

        var connectionId: UUID? = null
        if (body.connectionId != null) {
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
            httpSpecJson = httpSpecJson,
            resultContractJson = body.resultContract?.let { mapper.writeValueAsString(it) },
        ) ?: throw ApiError.NotFound("Tool")

        /* Snapshotted only when the DEFINITION changed. Renaming a tool or pausing
           it does not change what it does, and a version per rename would bury the
           changes that matter under the ones that do not. */
        if (httpSpecJson != null || body.resultContract != null || body.inputSchema != null) {
            snapshot(tool, ctx.workspaceId, req.principal?.appUserId, "Edited in the tool editor.")
        }
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

    /**
     * Check a submitted HTTP definition before it is stored, and return it as text.
     *
     * Two checks, and both matter:
     *
     *   · IT MUST PARSE WITH THE WORKER'S OWN READER. The API stores what the
     *     worker executes, so a document this service accepts and that service
     *     cannot read is a tool that saves cleanly and fails on its first run —
     *     long after whoever configured it has stopped looking. `HttpToolSpec` is
     *     compiled by both services precisely so this check is the real one.
     *   · IT MUST NOT CARRY A CREDENTIAL. `http_spec_json` is returned by the
     *     list endpoint, rendered in a form, snapshotted into `tool_versions` and
     *     shown in a re-import diff; a secret in it is a secret in all four. Auth
     *     names FIELDS of the connection's secret, never values.
     */
    private fun validateHttpSpec(spec: Map<String, Any>?, toolType: String): String? {
        if (spec == null) return null
        if (toolType !in setOf("http", "slack", "email", "crm")) {
            throw ApiError.ValidationError(
                "Only HTTP tools carry an httpSpec; this tool is type '$toolType'."
            )
        }
        val json = mapper.writeValueAsString(spec)

        com.vectorbea.api.openapi.SpecSecretScan.findInlineSecret(mapper.readTree(json))?.let {
            throw ApiError.ValidationError("The definition carries $it")
        }
        com.vectorbea.worker.tools.httpspec.HttpToolSpec.parse(json)
            ?: throw ApiError.ValidationError(
                "That definition is not one the runtime can execute. Check that " +
                    "`request.method` is a real HTTP method, that every input declares " +
                    "`in`, and that `specVersion` is not newer than this deployment."
            )
        return json
    }

    /** Record what the tool is now, so a change is reversible and legible. */
    private fun snapshot(tool: Tool, workspaceId: UUID, actor: UUID?, summary: String) {
        val store = versions ?: return
        runCatching {
            store.create(
                com.vectorbea.api.repository.CreateToolVersion(
                    toolId = tool.id,
                    workspaceId = workspaceId,
                    name = tool.name,
                    description = tool.description,
                    connectionId = tool.connectionId,
                    inputSchemaJson = tool.inputSchemaJson,
                    outputSchemaJson = tool.outputSchemaJson,
                    configJson = tool.configJson,
                    httpSpecJson = tool.httpSpecJson,
                    resultContractJson = tool.resultContractJson,
                    riskLevel = tool.riskLevel,
                    requiresApproval = tool.requiresApproval,
                    timeoutMs = tool.timeoutMs,
                    reviewState = "applied",
                    source = "manual",
                    specImportId = null,
                    changeSummary = summary,
                    changeJson = null,
                    createdBy = actor,
                )
            )
        }.onFailure {
            /* History is valuable and is not the point of the request. A tool the
               user just saved must not fail to save because its snapshot did. */
            org.slf4j.LoggerFactory.getLogger(ToolRoutes::class.java)
                .warn("[tools] could not snapshot version [tool={}]: {}", tool.id, it.message)
        }
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
        cache.delByPrefix(CacheKeys.toolList(workspaceId.toString(), "").dropLast(1))
    }
}

private fun <T, R> Page<T>.mapItems(transform: (T) -> R) =
    Page(items = items.map(transform), total = total, page = page, pageSize = pageSize)
