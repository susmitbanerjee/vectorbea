package com.vectorbea.api.routes

import com.vectorbea.api.api.WORKFLOW_STATUSES
import com.vectorbea.api.api.context
import com.vectorbea.api.api.pageParams
import com.vectorbea.api.api.pathUUID
import com.vectorbea.api.api.requireField
import com.vectorbea.api.api.requireMaxLength
import com.vectorbea.api.api.requireOneOf
import com.vectorbea.api.api.slugify
import com.vectorbea.api.cache.CacheKeys
import com.vectorbea.api.cache.CacheService
import com.vectorbea.api.cache.getOrSet
import com.vectorbea.api.errors.ApiError
import com.vectorbea.api.http.Request
import com.vectorbea.api.http.Response
import com.vectorbea.api.http.Router
import com.vectorbea.api.http.mapper
import com.vectorbea.api.repository.CreateWorkflowRequest
import com.vectorbea.api.repository.CreateWorkflowVersionRequest
import com.vectorbea.api.repository.Page
import com.vectorbea.api.repository.UpdateWorkflowRequest
import com.vectorbea.api.repository.Workflow
import com.vectorbea.api.repository.WorkflowRepository
import com.vectorbea.api.repository.WorkflowVersion

// ── Request bodies ────────────────────────────────────────────────────────────

private data class CreateWorkflowBody(
    val name: String?,
    val slug: String? = null,
    val description: String? = null,
    val status: String? = null,
)

private data class UpdateWorkflowBody(
    val name: String? = null,
    val description: String? = null,
    val status: String? = null,
)

private data class CreateVersionBody(
    val graph: Map<String, Any>?,
    val inputSchema: Map<String, Any>? = null,
    val outputSchema: Map<String, Any>? = null,
    val triggerConfig: Map<String, Any>? = null,
    val retryPolicy: Map<String, Any>? = null,
    val timeoutPolicy: Map<String, Any>? = null,
    val budgetPolicy: Map<String, Any>? = null,
    val replaySupport: String? = null,
)

// ── Response shapes ───────────────────────────────────────────────────────────

// Node types that count as "agents" in the workflow graph
private val AGENT_NODE_TYPES = setOf("agent", "llm", "iterative_agent")
// Node types that count as "tools"
private val TOOL_NODE_TYPES  = setOf("tool", "http_tool", "graphql_tool", "db_read", "db_write", "mcp_tool", "grpc_tool", "transform")

/**
 * Counts step/agent/tool nodes from a graph_json string.
 * Returns Triple(stepCount, agentCount, toolCount).
 * Returns (0, 0, 0) on any parse error.
 */
@Suppress("UNCHECKED_CAST")
private fun countGraphNodes(graphJson: String): Triple<Int, Int, Int> = runCatching {
    val graph = mapper.readValue(graphJson, Map::class.java) as Map<String, Any>
    val nodes = graph["nodes"] as? List<*> ?: return@runCatching Triple(0, 0, 0)
    val steps  = nodes.size
    val agents = nodes.count { n -> (n as? Map<*, *>)?.get("type") as? String in AGENT_NODE_TYPES }
    val tools  = nodes.count { n -> (n as? Map<*, *>)?.get("type") as? String in TOOL_NODE_TYPES }
    Triple(steps, agents, tools)
}.getOrDefault(Triple(0, 0, 0))

private fun Workflow.toResponse(graphJson: String? = null): Map<String, Any?> {
    val (stepCount, agentCount, toolCount) = if (graphJson != null) countGraphNodes(graphJson) else Triple(0, 0, 0)
    return mapOf(
        "id" to id.toString(),
        "workspaceId" to workspaceId.toString(),
        "environmentId" to environmentId.toString(),
        "name" to name,
        "slug" to slug,
        "description" to description,
        "status" to status,
        "currentVersionId" to currentVersionId?.toString(),
        "stepCount"  to stepCount,
        "agentCount" to agentCount,
        "toolCount"  to toolCount,
        "createdAt" to createdAt.toString(),
        "updatedAt" to updatedAt.toString(),
    )
}

@Suppress("UNCHECKED_CAST")
private fun WorkflowVersion.toResponse(): Map<String, Any?> = mapOf(
    "id" to id.toString(),
    "workflowId" to workflowId.toString(),
    "version" to version,
    "graph" to runCatching { mapper.readValue(graphJson, Map::class.java) }.getOrDefault(emptyMap<String, Any>()),
    "inputSchema" to runCatching { mapper.readValue(inputSchemaJson, Map::class.java) }.getOrDefault(emptyMap<String, Any>()),
    "outputSchema" to runCatching { mapper.readValue(outputSchemaJson, Map::class.java) }.getOrDefault(emptyMap<String, Any>()),
    "triggerConfig" to runCatching { mapper.readValue(triggerConfigJson, Map::class.java) }.getOrDefault(emptyMap<String, Any>()),
    "retryPolicy" to runCatching { mapper.readValue(retryPolicyJson, Map::class.java) }.getOrDefault(emptyMap<String, Any>()),
    "timeoutPolicy" to runCatching { mapper.readValue(timeoutPolicyJson, Map::class.java) }.getOrDefault(emptyMap<String, Any>()),
    "budgetPolicy" to runCatching { mapper.readValue(budgetPolicyJson, Map::class.java) }.getOrDefault(emptyMap<String, Any>()),
    "replaySupport" to replaySupport,
    "createdAt" to createdAt.toString(),
    "updatedAt" to updatedAt.toString(),
)

// ── Route handler ─────────────────────────────────────────────────────────────

class WorkflowRoutes(
    private val repo: WorkflowRepository,
    private val cache: CacheService,
) {
    fun register(router: Router) {
        router.get("/api/workflows", ::list)
        router.post("/api/workflows", ::create)
        router.get("/api/workflows/:id", ::getById)
        router.patch("/api/workflows/:id", ::update)
        router.delete("/api/workflows/:id", ::delete)
        router.post("/api/workflows/:id/versions", ::createVersion)
        router.get("/api/workflows/:id/versions", ::listVersions)
    }

    private fun list(req: Request): Response {
        val ctx = req.context()
        val params = req.pageParams()
        val statusFilter = req.query("status")
        val envId = ctx.environmentId

        val cacheKey = "${CacheKeys.workflowList(ctx.workspaceId.toString(), envId?.toString() ?: "all")}:${statusFilter.orEmpty()}:${params.page}:${params.pageSize}"
        val page = cache.getOrSet(cacheKey, ttlSeconds = 60L) {
            // listWithGraph LEFT JOINs workflow_versions to compute step/agent/tool counts
            repo.listWithGraph(ctx.workspaceId, envId, statusFilter, params)
                .mapItems { (wf, gj) -> wf.toResponse(gj) }
        }
        return Response.ok(page)
    }

    private fun create(req: Request): Response {
        val ctx = req.context()
        val envId = ctx.requireEnvironmentId()
        val body = req.bodyAs<CreateWorkflowBody>()

        val name = requireMaxLength(requireField(body.name, "name"), "name", 255)
        val status = if (body.status != null)
            requireOneOf(body.status, "status", WORKFLOW_STATUSES)
        else "draft"
        val slug = slugify(body.slug?.takeIf { it.isNotBlank() } ?: name)

        val workflow = repo.create(
            CreateWorkflowRequest(
                workspaceId = ctx.workspaceId,
                environmentId = envId,
                name = name,
                slug = slug,
                description = body.description,
                status = status,
            )
        )
        invalidateListCache(ctx.workspaceId.toString(), envId.toString())
        return Response.created(workflow.toResponse())
    }

    private fun getById(req: Request): Response {
        val ctx = req.context()
        val id = req.pathUUID("id")
        val wf = repo.findById(id, ctx.workspaceId) ?: throw ApiError.NotFound("Workflow")
        val graphJson = wf.currentVersionId?.let { repo.findVersionById(it)?.graphJson }
        return Response.ok(wf.toResponse(graphJson))
    }

    private fun update(req: Request): Response {
        val ctx = req.context()
        val id = req.pathUUID("id")
        val body = req.bodyAs<UpdateWorkflowBody>()

        if (body.status != null) requireOneOf(body.status, "status", WORKFLOW_STATUSES)

        val wf = repo.update(
            id = id,
            workspaceId = ctx.workspaceId,
            req = UpdateWorkflowRequest(
                name = body.name?.trim()?.takeIf { it.isNotBlank() },
                description = body.description,
                status = body.status,
            )
        ) ?: throw ApiError.NotFound("Workflow")

        invalidateListCache(ctx.workspaceId.toString(), wf.environmentId.toString())
        cache.del(CacheKeys.workflow(ctx.workspaceId.toString(), id.toString()))
        return Response.ok(wf.toResponse())
    }

    private fun delete(req: Request): Response {
        val ctx = req.context()
        val id = req.pathUUID("id")
        val existing = repo.findById(id, ctx.workspaceId) ?: throw ApiError.NotFound("Workflow")
        repo.delete(id, ctx.workspaceId)
        invalidateListCache(ctx.workspaceId.toString(), existing.environmentId.toString())
        cache.del(CacheKeys.workflow(ctx.workspaceId.toString(), id.toString()))
        return Response.noContent()
    }

    private fun createVersion(req: Request): Response {
        val ctx = req.context()
        val workflowId = req.pathUUID("id")
        val wf = repo.findById(workflowId, ctx.workspaceId) ?: throw ApiError.NotFound("Workflow")
        val body = req.bodyAs<CreateVersionBody>()

        // graph is required for a new version
        val graph = body.graph ?: throw ApiError.ValidationError("graph is required")
        validateGraphShape(graph)

        val version = repo.createVersion(
            CreateWorkflowVersionRequest(
                workflowId = workflowId,
                graph = graph,
                inputSchema = body.inputSchema ?: emptyMap(),
                outputSchema = body.outputSchema ?: emptyMap(),
                triggerConfig = body.triggerConfig ?: emptyMap(),
                retryPolicy = body.retryPolicy ?: emptyMap(),
                timeoutPolicy = body.timeoutPolicy ?: emptyMap(),
                budgetPolicy = body.budgetPolicy ?: emptyMap(),
                replaySupport = body.replaySupport ?: "full",
            )
        )

        // update workflow.current_version_id to point to the new version
        repo.setCurrentVersion(workflowId, ctx.workspaceId, version.id)
        cache.del(CacheKeys.workflowVersion(ctx.workspaceId.toString(), version.id.toString()))

        return Response.created(version.toResponse())
    }

    private fun listVersions(req: Request): Response {
        val ctx = req.context()
        val workflowId = req.pathUUID("id")
        repo.findById(workflowId, ctx.workspaceId) ?: throw ApiError.NotFound("Workflow")
        val params = req.pageParams()
        val page = repo.listVersions(workflowId, params)
        return Response.ok(page.mapItems { it.toResponse() })
    }

    /**
     * Basic structural validation of the workflow graph.
     * Checks that nodes and edges keys are present and non-null.
     * Deep semantic validation (cycle detection, node type validity) happens
     * in the execution engine — not here.
     */
    private fun validateGraphShape(graph: Map<String, Any>) {
        val nodes = graph["nodes"]
        val edges = graph["edges"]
        if (nodes != null && nodes !is List<*>) {
            throw ApiError.ValidationError("graph.nodes must be an array")
        }
        if (edges != null && edges !is List<*>) {
            throw ApiError.ValidationError("graph.edges must be an array")
        }
        // Allow empty graph (draft workflow with no nodes yet)
    }

    private fun invalidateListCache(workspaceId: String, environmentId: String) {
        cache.delByPrefix(CacheKeys.workflowList(workspaceId, "").dropLast(1))
    }
}

private fun <T, R> Page<T>.mapItems(transform: (T) -> R) =
    Page(items = items.map(transform), total = total, page = page, pageSize = pageSize)
