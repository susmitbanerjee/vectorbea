package com.vectorbea.api.routes

import com.vectorbea.api.api.context
import com.vectorbea.api.api.pathUUID
import com.vectorbea.api.errors.ApiError
import com.vectorbea.api.http.Request
import com.vectorbea.api.http.Response
import com.vectorbea.api.http.Router
import com.vectorbea.api.http.mapper
import com.vectorbea.api.repository.ToolRepository
import com.vectorbea.api.repository.ToolVersion
import com.vectorbea.api.repository.ToolVersionRepository

/**
 * Tool versions, and the review that lets one become live.
 *
 * ── WHY APPLYING IS AN ENDPOINT AND NOT A SIDE EFFECT ───────────────────────
 * `agents.allowed_tool_ids` grants a tool by id. If a spec re-import could
 * rewrite what that id does, an agent granted `create_refund` — scoped by a
 * bound maximum amount — could be regranted a wider version of it by somebody
 * pasting a URL, and nothing in the product would say so.
 *
 * So a change lands as a pending version and stops. This is the only place that
 * makes one live, it takes a person, and it records who.
 */
class ToolVersionRoutes(
    private val versions: ToolVersionRepository,
    private val tools: ToolRepository,
) {

    fun register(router: Router) {
        router.get("/api/tool-versions/pending", ::pending)
        router.get("/api/tools/:id/versions", ::listForTool)
        router.get("/api/tool-versions/:id", ::detail)
        router.post("/api/tool-versions/:id/apply", ::apply)
        router.post("/api/tool-versions/:id/reject", ::reject)
    }

    /**
     * Everything waiting, granted tools first.
     *
     * The ordering is the design. A pending change to a tool nobody has granted
     * is a chore; to one an agent holds it is a security review, and a list that
     * mixes them puts the review below the chores on the second page.
     */
    private fun pending(req: Request): Response {
        val ctx = req.context()
        val rows = versions.pendingReview(ctx.workspaceId)
        return Response.ok(
            mapOf(
                "items" to rows.map {
                    mapOf(
                        "versionId" to it.versionId.toString(),
                        "toolId" to it.toolId.toString(),
                        "toolName" to it.toolName,
                        "version" to it.version,
                        "changeSummary" to it.changeSummary,
                        "source" to it.source,
                        "specImportId" to it.specImportId?.toString(),
                        "createdAt" to it.createdAt.toString(),
                        "isGranted" to it.isGranted,
                    )
                },
                "total" to rows.size,
                "grantedCount" to rows.count { it.isGranted },
            )
        )
    }

    private fun listForTool(req: Request): Response {
        val ctx = req.context()
        val toolId = req.pathUUID("id")
        val tool = tools.findById(toolId, ctx.workspaceId) ?: throw ApiError.NotFound("Tool")
        val rows = versions.listForTool(toolId, ctx.workspaceId)
        return Response.ok(
            mapOf(
                "currentVersion" to currentVersionOf(rows),
                "items" to rows.map { versionJson(it, includeDefinition = false) },
                "toolName" to tool.name,
            )
        )
    }

    private fun detail(req: Request): Response {
        val ctx = req.context()
        val version = versions.findById(req.pathUUID("id"), ctx.workspaceId)
            ?: throw ApiError.NotFound("Tool version")
        return Response.ok(versionJson(version, includeDefinition = true))
    }

    private fun apply(req: Request): Response {
        val ctx = req.context()
        val id = req.pathUUID("id")
        val version = versions.findById(id, ctx.workspaceId)
            ?: throw ApiError.NotFound("Tool version")

        if (version.reviewState != "pending") {
            /*
             * 409 rather than 400: the request was well formed and the STATE is
             * what refuses it. Two people opening the same review and both
             * clicking Apply is ordinary, and the second one needs to be told the
             * change already landed rather than that they did something wrong.
             */
            throw ApiError.Conflict(
                "This version is already ${version.reviewState}. Reload to see the " +
                    "tool's current definition."
            )
        }

        val applied = versions.apply(id, ctx.workspaceId, req.principal?.appUserId)
        if (!applied) {
            throw ApiError.Conflict("Somebody applied or rejected this version first.")
        }
        return Response.ok(
            mapOf(
                "applied" to true,
                "toolId" to version.toolId.toString(),
                "version" to version.version,
                "message" to "Version ${version.version} is now live. Agents granted this " +
                    "tool use the new definition from their next run.",
            )
        )
    }

    private fun reject(req: Request): Response {
        val ctx = req.context()
        val id = req.pathUUID("id")
        val version = versions.findById(id, ctx.workspaceId)
            ?: throw ApiError.NotFound("Tool version")
        if (!versions.reject(id, ctx.workspaceId)) {
            throw ApiError.Conflict("This version is already ${version.reviewState}.")
        }
        /*
         * Rejected rows are KEPT. A re-import of the same unchanged document would
         * otherwise re-propose a change somebody has already declined, every time,
         * until they stop reading the review queue.
         */
        return Response.ok(
            mapOf(
                "rejected" to true,
                "message" to "Declined. The tool is unchanged, and this change will not " +
                    "be proposed again for the same document.",
            )
        )
    }

    private fun currentVersionOf(rows: List<ToolVersion>): Int? =
        rows.firstOrNull { it.reviewState == "applied" }?.version

    private fun versionJson(v: ToolVersion, includeDefinition: Boolean): Map<String, Any?> {
        val base = mutableMapOf<String, Any?>(
            "id" to v.id.toString(),
            "toolId" to v.toolId.toString(),
            "version" to v.version,
            "name" to v.name,
            "description" to v.description,
            "reviewState" to v.reviewState,
            "source" to v.source,
            "specImportId" to v.specImportId?.toString(),
            "changeSummary" to v.changeSummary,
            "riskLevel" to v.riskLevel,
            "requiresApproval" to v.requiresApproval,
            "createdAt" to v.createdAt.toString(),
            "appliedAt" to v.appliedAt?.toString(),
        )
        if (includeDefinition) {
            /* The whole definition, only on the detail endpoint. A version list is
               rendered as rows and would otherwise ship a spec per row. */
            base["httpSpec"] = parse(v.httpSpecJson)
            base["inputSchema"] = parse(v.inputSchemaJson)
            base["resultContract"] = parse(v.resultContractJson)
            base["change"] = parse(v.changeJson)
            base["connectionId"] = v.connectionId?.toString()
            base["timeoutMs"] = v.timeoutMs
        }
        return base
    }

    private fun parse(json: String?): Any? =
        json?.let { runCatching { mapper.readValue(it, Any::class.java) }.getOrNull() }
}
