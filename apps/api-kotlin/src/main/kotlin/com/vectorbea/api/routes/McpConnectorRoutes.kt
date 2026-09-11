package com.vectorbea.api.routes

import com.vectorbea.api.api.context
import com.vectorbea.api.api.pathUUID
import com.vectorbea.api.entitlements.EntitlementGuard
import com.vectorbea.api.entitlements.EntitlementKeys
import com.vectorbea.api.errors.ApiError
import com.vectorbea.api.http.Request
import com.vectorbea.api.http.Response
import com.vectorbea.api.http.Router
import com.vectorbea.api.mcp.ApiMcpTransport
import com.vectorbea.api.repository.Connection
import com.vectorbea.api.repository.ConnectionRepository
import com.vectorbea.api.repository.McpToolRepository
import com.vectorbea.api.secrets.SecretService
import com.vectorbea.mcp.McpClient
import com.vectorbea.mcp.McpDiscovery
import org.slf4j.LoggerFactory
import java.util.UUID
import javax.sql.DataSource

/**
 * Connecting an MCP server, and seeing what it offers.
 *
 * ── TWO ENDPOINTS, AND WHY THERE IS NO THIRD ────────────────────────────────
 * `POST …/mcp/discover` asks a server what it has and writes a `tools` row for
 * each. `GET …/mcp/tools` reads those rows back with their server's health.
 *
 * There is deliberately no endpoint that grants anything. Granting is
 * `PUT /api/agents/:id` writing `allowed_tool_ids`, one tool uuid at a time,
 * exactly as it is for an HTTP tool — and there is no column anywhere that
 * could express "every tool from this server". MCP.md §3: the server-level
 * grant is structurally impossible rather than merely discouraged, and adding a
 * convenience endpoint here is how that stops being true.
 *
 * ── DISCOVERY IS ONE IMPLEMENTATION, SHARED ─────────────────────────────────
 * [McpDiscovery] is `packages/mcp-kotlin`, the same code the worker runs when it
 * builds an agent's tool list. This route is a caller, not a second copy: the
 * count it reports has to be a fact about the code that will actually run the
 * customer's tools.
 */
class McpConnectorRoutes(
    private val connections: ConnectionRepository,
    private val mcpTools: McpToolRepository,
    private val dataSource: DataSource,
    private val secretService: SecretService? = null,
    private val entitlements: EntitlementGuard? = null,
    private val audit: com.vectorbea.api.audit.AuditLog? = null,
) {
    private val log = LoggerFactory.getLogger(McpConnectorRoutes::class.java)

    /**
     * Built once. The manifest TTL lives inside it, and a per-request instance
     * would be a per-request cache decision.
     */
    private val discovery by lazy {
        McpDiscovery(dataSource, McpClient(ApiMcpTransport))
    }

    fun register(router: Router) {
        router.post("/api/connections/:id/mcp/discover", ::discover)
        router.get("/api/connections/:id/mcp/tools", ::listTools)
    }

    // ── Discover ─────────────────────────────────────────────────────────────

    /**
     * Ask the server what it offers, and write a grantable row for each tool.
     *
     * ── WHY AN OPERATOR PRESSES THIS ────────────────────────────────────────
     * There is no scheduler (MCP.md §9), on purpose: a background refresh is a
     * scheduler decision, not a protocol one, and the run path already refreshes
     * on its own five-minute TTL. What was missing was any way for a person to
     * trigger it at all — so until this existed, no MCP tool row was ever
     * written in the shipped product and nothing was grantable.
     */
    private fun discover(req: Request): Response {
        val ctx = req.context()
        if (!FLAG_ENABLED) {
            throw ApiError.ValidationError(
                "MCP discovery is not enabled on this deployment. Set " +
                "$FLAG_NAME=true to turn it on.")
        }

        val connection = requireMcpConnection(req.pathUUID("id"), ctx.workspaceId)

        /*
         * Resolved from the workspace's BILLING ACCOUNT, never the caller's own
         * plan — invariant 11. `requireFeature` takes a workspace and has no
         * parameter for a user, and this call site must not acquire one.
         */
        entitlements?.requireFeature(ctx.workspaceId, EntitlementKeys.MCP_TOOLS)

        val serverUrl = serverUrlOf(connection)
            ?: throw ApiError.ValidationError(
                "This connection has no server URL. Add the MCP server's endpoint " +
                "before discovering its tools.")

        val server = McpClient.Server(
            connectionId = connection.id,
            url = serverUrl,
            transport = (configOf(connection)["transport"] as? String) ?: "streamable-http",
            authToken = bearerFor(connection, ctx.workspaceId),
        )

        /*
         * A forced refresh, not a cached read. A person pressing Discover has
         * just changed something at the other end and is asking us to look
         * again; serving them a five-minute-old manifest would answer a
         * question they did not ask.
         */
        val manifest = McpDiscovery(dataSource, McpClient(ApiMcpTransport), ttlMs = 0)
            .manifestFor(server, ctx.workspaceId)

        val written = discovery.syncTools(server, ctx.workspaceId, connection.environmentId)

        /*
         * Audited as a connection change, because it is one: it writes rows that
         * become grantable capabilities, sourced from a third party's server.
         * "Who added these twelve tools, and when" is asked after an incident.
         */
        audit?.recordUserAction(
            req = req,
            workspaceId = ctx.workspaceId,
            action = "mcp.discover",
            targetType = "connection",
            targetId = connection.id,
            environmentId = connection.environmentId,
            after = mapOf(
                "toolsFound" to manifest.tools.size,
                "toolsWritten" to written,
                "toolsFlagged" to manifest.tools.count { it.descriptionWasAltered },
                "stale" to manifest.stale,
            ),
        )

        return Response.ok(mapOf(
            "toolsFound" to manifest.tools.size,
            "toolsWritten" to written,
            /*
             * How many descriptions the sanitizer altered. Surfaced rather than
             * only logged: MCP.md §4 says the flag is for the log AND the UI,
             * and a marker nobody can see is only for the log.
             */
            "toolsFlagged" to manifest.tools.count { it.descriptionWasAltered },
            "resourcesFound" to manifest.resources.size,
            "fetchedAt" to manifest.fetchedAt.toString(),
            /*
             * Both facts at once. A stale manifest still lists tools, and the
             * screen has to say "here is what it offers" and "the last refresh
             * failed" together — replacing one with the other would undo the
             * stale-beats-empty decision at the last inch.
             */
            "stale" to manifest.stale,
            "lastError" to manifest.lastError,
            "tools" to manifest.tools.map {
                mapOf(
                    "name" to it.name,
                    "description" to it.description,
                    "descriptionWasAltered" to it.descriptionWasAltered,
                )
            },
        ))
    }

    // ── What this server offers ──────────────────────────────────────────────

    /**
     * `mcp_tools_available`, filtered to one connection, plus its manifest health.
     *
     * The view has existed since V058 and nothing read it. Its own comment names
     * this as its purpose: "the granting UI's query, and the answer to *which of
     * my tools stopped being advertised*".
     */
    private fun listTools(req: Request): Response {
        val ctx = req.context()
        val connection = requireMcpConnection(req.pathUUID("id"), ctx.workspaceId)

        val items = mcpTools.listForConnection(connection.id, ctx.workspaceId)
        val manifest = mcpTools.manifestFor(connection.id, ctx.workspaceId)

        return Response.ok(mapOf(
            "items" to items.map { it.toResponse() },
            "manifest" to manifest?.toResponse(),
            "serverName" to connection.name,
        ))
    }

    // ── Helpers ──────────────────────────────────────────────────────────────

    /**
     * The connection, if it is ours and if it is an MCP server.
     *
     * Workspace-scoped at the same boundary as every other lookup and failing
     * closed — invariant 8. A connection in another workspace is `not found`,
     * not `forbidden`: the distinction is itself a disclosure.
     */
    private fun requireMcpConnection(id: UUID, workspaceId: UUID): Connection {
        val connection = connections.findById(id, workspaceId)
            ?: throw ApiError.NotFound("Connection not found")
        if (connection.type.lowercase() !in MCP_CONNECTION_TYPES) {
            throw ApiError.ValidationError(
                "Connection '${connection.name}' is a ${connection.type} connection, " +
                "not an MCP server. Only MCP servers advertise tools.")
        }
        return connection
    }

    @Suppress("UNCHECKED_CAST")
    private fun configOf(connection: Connection): Map<String, Any?> = try {
        com.vectorbea.api.http.mapper.readValue(connection.configJson, Map::class.java)
            as Map<String, Any?>
    } catch (_: Exception) {
        emptyMap()
    }

    private fun serverUrlOf(connection: Connection): String? {
        val config = configOf(connection)
        return listOf("serverUrl", "server_url", "url", "baseUrl", "base_url")
            .firstNotNullOfOrNull { config[it] as? String }
            ?.takeIf { it.isNotBlank() }
    }

    /**
     * The bearer token, resolved for this workspace.
     *
     * Scoped to the connection's workspace rather than resolved by ref alone —
     * a secret ref is a string, and a lookup that takes only the string is one
     * mistyped id away from decrypting another tenant's credential.
     *
     * Never logged, never returned, and not held: it goes into the request
     * header and out of scope with it.
     */
    private fun bearerFor(connection: Connection, workspaceId: UUID): String? {
        val ref = connection.secretRef?.takeIf { it.isNotBlank() } ?: return null
        val svc = secretService ?: return null
        return try {
            svc.resolveSecretForRuntime(ref, workspaceId).takeIf { it.isNotBlank() }
        } catch (e: Exception) {
            log.warn("[mcp] could not resolve the credential for connection {}: {}",
                connection.id, e.javaClass.simpleName)
            null
        }
    }

    companion object {
        /** `tool` is the stored spelling; `mcp` and `mcp_server` are accepted too. */
        private val MCP_CONNECTION_TYPES = setOf("tool", "mcp", "mcp_server")

        /**
         * Off by default, per the conventions: every new runtime behaviour ships
         * behind an env-var flag until its phase is signed off.
         *
         * Only DISCOVERY is gated. Reading `mcp_tools_available` is not — a
         * workspace that already has discovered tools must keep being able to
         * see them, and a flag that hid them would make an existing grant look
         * like it pointed at nothing.
         */
        private const val FLAG_NAME = "MCP_DISCOVERY_ENABLED"
        private val FLAG_ENABLED: Boolean =
            System.getenv(FLAG_NAME)?.lowercase() in setOf("true", "1", "yes")
    }
}
