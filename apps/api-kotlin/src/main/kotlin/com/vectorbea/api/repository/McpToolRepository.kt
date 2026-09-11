package com.vectorbea.api.repository

import org.slf4j.LoggerFactory
import java.time.Instant
import java.util.UUID
import javax.sql.DataSource

/**
 * One tool an MCP server advertises, ready to be granted.
 *
 * There is deliberately no row here for a SERVER. `mcp_tools_available` has none
 * either, and its comment says why: granting is per tool, and the absence is the
 * design rather than an oversight.
 */
data class McpToolRow(
    val toolId: UUID,
    val name: String,
    val mcpToolName: String?,
    val description: String?,
    val serverName: String?,
    val lastSeenAt: Instant?,
    /**
     * The server has not advertised this tool in a week.
     *
     * "Possibly", not "is": a server that has been down for eight days has
     * withdrawn nothing, and a UI that said otherwise would be telling somebody
     * their tools were removed when their network was.
     */
    val possiblyWithdrawn: Boolean,
    /**
     * Which agents hold a grant to this tool.
     *
     * The answer to "what breaks if this server goes away", and a join the
     * client cannot do cheaply — `allowed_tool_ids` is an array column, so
     * finding the holders of one uuid is a query, not a filter over a list the
     * browser already has.
     */
    val grantedToAgentIds: List<UUID>,
) {
    fun toResponse(): Map<String, Any?> = mapOf(
        "toolId" to toolId.toString(),
        "name" to name,
        "mcpToolName" to mcpToolName,
        "description" to description,
        "serverName" to serverName,
        "lastSeenAt" to lastSeenAt?.toString(),
        "possiblyWithdrawn" to possiblyWithdrawn,
        "grantedToAgentIds" to grantedToAgentIds.map { it.toString() },
    )
}

/** The cached manifest's health, which is a different fact from the tools. */
data class McpManifestRow(
    val fetchedAt: Instant,
    val lastError: String?,
    val lastErrorAt: Instant?,
    val toolCount: Int,
    val resourceCount: Int,
) {
    /**
     * Stale means "the last refresh failed", not "this is old".
     *
     * Derived from `last_error_at` being at or after `fetched_at`: a manifest
     * that was fetched successfully and has an old error from before it is not
     * stale, and showing a banner for it would train people to ignore banners.
     */
    val stale: Boolean get() = lastError != null &&
        (lastErrorAt == null || !lastErrorAt.isBefore(fetchedAt))

    fun toResponse(): Map<String, Any?> = mapOf(
        "fetchedAt" to fetchedAt.toString(),
        "lastError" to lastError,
        "lastErrorAt" to lastErrorAt?.toString(),
        "stale" to stale,
        "toolCount" to toolCount,
        "resourceCount" to resourceCount,
    )
}

/**
 * Reads what discovery wrote.
 *
 * ── WHY THIS IS A READER AND NOT A WRITER ───────────────────────────────────
 * Nothing here writes a `tools` row. `McpDiscovery.syncTools` in
 * `packages/mcp-kotlin` is the only writer of an MCP tool, shared by both
 * services, and a second INSERT path here would be the duplicate implementation
 * the module was extracted to prevent.
 */
class McpToolRepository(dataSource: DataSource) : BaseRepository(dataSource) {
    override val log = LoggerFactory.getLogger(McpToolRepository::class.java)

    /**
     * Every tool this server advertises — including the ones it has stopped
     * advertising.
     *
     * A withdrawn tool keeps its row, its uuid and its grants (MCP.md §3), so it
     * has to keep its place in this list too. Filtering it out here would
     * reintroduce, at the read, exactly the silent shrinking the write path
     * refuses to do.
     */
    fun listForConnection(connectionId: UUID, workspaceId: UUID): List<McpToolRow> = query(
        """SELECT v.tool_id, v.name, v.mcp_tool_name, v.description, v.server_name,
                  v.mcp_last_seen_at, v.possibly_withdrawn,
                  COALESCE(
                    (SELECT array_agg(a.id::text)
                       FROM agents a
                      WHERE a.workspace_id = v.workspace_id
                        /* allowed_tool_ids is TEXT[] (V003), so the uuid is cast
                           rather than the column — casting the column would
                           discard the index and scan every agent. */
                        AND a.allowed_tool_ids @> ARRAY[v.tool_id::text]),
                    '{}') AS granted_to
             FROM mcp_tools_available v
            WHERE v.mcp_server_connection_id = ?
              AND v.workspace_id = ?
            ORDER BY v.possibly_withdrawn, v.name""",
        { setUuid(1, connectionId); setUuid(2, workspaceId) },
    ) { rs ->
        val granted = (rs.getArray("granted_to")?.array as? Array<*>)
            ?.mapNotNull { cell ->
                when (cell) {
                    is UUID -> cell
                    /* A grant list that somehow holds a non-uuid string is a
                       row we cannot name an agent from. Dropped rather than
                       thrown: one malformed grant must not blank the panel. */
                    is String -> runCatching { UUID.fromString(cell) }.getOrNull()
                    else -> null
                }
            }
            ?: emptyList()
        McpToolRow(
            toolId = rs.uuid("tool_id"),
            name = rs.getString("name"),
            mcpToolName = rs.getString("mcp_tool_name"),
            description = rs.getString("description"),
            serverName = rs.getString("server_name"),
            lastSeenAt = rs.instantOrNull("mcp_last_seen_at"),
            possiblyWithdrawn = rs.getBoolean("possibly_withdrawn"),
            grantedToAgentIds = granted,
        )
    }

    /** The manifest cache row, workspace-scoped like everything else. */
    fun manifestFor(connectionId: UUID, workspaceId: UUID): McpManifestRow? = queryOne(
        """SELECT fetched_at, last_error, last_error_at,
                  jsonb_array_length(tools_json)     AS tool_count,
                  jsonb_array_length(resources_json) AS resource_count
             FROM mcp_server_manifests
            WHERE connection_id = ? AND workspace_id = ?""",
        { setUuid(1, connectionId); setUuid(2, workspaceId) },
    ) { rs ->
        McpManifestRow(
            fetchedAt = rs.instant("fetched_at"),
            lastError = rs.getString("last_error"),
            lastErrorAt = rs.instantOrNull("last_error_at"),
            toolCount = rs.getInt("tool_count"),
            resourceCount = rs.getInt("resource_count"),
        )
    }

    /**
     * How many tools and how many grants a server is currently carrying.
     *
     * Used by the delete confirmation, which has to name the blast radius:
     * removing the connection revokes every tool discovered through it, because
     * `mcp_server_connection_id` is an FK. That is the one server-level action
     * that should exist, and a person about to take it deserves the number.
     */
    fun blastRadius(connectionId: UUID, workspaceId: UUID): Pair<Int, Int> = queryOne(
        """SELECT count(*) AS tools,
                  COALESCE((SELECT count(DISTINCT a.id)
                              FROM agents a
                             WHERE a.workspace_id = ?
                               AND a.allowed_tool_ids && (
                                 SELECT COALESCE(array_agg(t2.id::text), '{}')
                                   FROM tools t2
                                  WHERE t2.mcp_server_connection_id = ?
                                    AND t2.workspace_id = ?)), 0) AS agents
             FROM tools t
            WHERE t.mcp_server_connection_id = ? AND t.workspace_id = ?""",
        {
            setUuid(1, workspaceId); setUuid(2, connectionId); setUuid(3, workspaceId)
            setUuid(4, connectionId); setUuid(5, workspaceId)
        },
    ) { rs -> rs.getInt("tools") to rs.getInt("agents") } ?: (0 to 0)
}
