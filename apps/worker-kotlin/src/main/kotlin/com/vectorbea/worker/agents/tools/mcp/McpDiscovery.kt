package com.vectorbea.worker.agents.tools.mcp

import com.fasterxml.jackson.databind.JsonNode
import com.fasterxml.jackson.databind.ObjectMapper
import com.vectorbea.worker.agents.tools.ToolResultContract
import com.vectorbea.worker.logging.logger
import java.time.Instant
import java.util.UUID
import javax.sql.DataSource

/**
 * What a server offers, cached, sanitized, and turned into grantable tools.
 *
 * ── ONE ROW PER REMOTE TOOL, AND WHY THAT IS THE SECURITY DESIGN ────────────
 * A discovered MCP tool becomes its own row in `tools`, with its own uuid,
 * granted to an agent exactly like an HTTP tool. Not a synthetic id under a
 * server row and not a flag meaning "this server is allowed".
 *
 * That makes a server-level grant STRUCTURALLY impossible rather than merely
 * discouraged: `allowed_tool_ids` holds tool ids, an MCP server is a connection,
 * and there is no column that could express "every tool from this server". The
 * roster model is untouched — `AgentSafetyGuard.validateToolAllowed` reads our
 * own database and knows nothing about MCP.
 *
 * ── THE CACHE IS FAILURE ISOLATION, NOT A SPEED-UP ──────────────────────────
 * Discovery is an outbound call to somebody else's server and it happens whenever
 * an agent's tool list is built. Without the cache, one unreachable customer
 * server adds its full timeout to every run that could have used it — an
 * availability problem for runs that never touch MCP at all.
 *
 * A STALE manifest is served when refresh fails, deliberately. The alternative is
 * that a server being briefly down removes its tools from every agent's prompt,
 * which is a much larger behaviour change than a few minutes of staleness, and it
 * happens at exactly the moment things are already going wrong.
 */
class McpDiscovery(
    private val dataSource: DataSource,
    private val client: McpClient = McpClient(),
    /**
     * How long a manifest is used before a refresh is attempted.
     *
     * Five minutes: long enough that a burst of runs makes one call, short enough
     * that a customer adding a tool sees it within a coffee break. A refresh
     * failure does not invalidate what is cached.
     */
    private val ttlMs: Long =
        System.getenv("MCP_MANIFEST_TTL_MS")?.toLongOrNull() ?: 300_000L,
) {
    private val log = logger()
    private val mapper = ObjectMapper()

    /** One remote tool, after sanitization. */
    data class RemoteTool(
        val name: String,
        val description: String?,
        val inputSchema: Map<String, Any?>,
        /** Built from the server's own annotations, when it supplies them. */
        val resultContract: ToolResultContract?,
        /** True when the description tripped the frame-impersonation rules. */
        val descriptionWasAltered: Boolean,
    )

    /** One resource: read-only context, pulled on demand. */
    data class RemoteResource(
        val uri: String,
        val name: String?,
        val description: String?,
        val mimeType: String?,
    )

    data class Manifest(
        val tools: List<RemoteTool>,
        val resources: List<RemoteResource>,
        val fetchedAt: Instant,
        val stale: Boolean = false,
        val lastError: String? = null,
    )

    // ── Discovery ────────────────────────────────────────────────────────────

    /**
     * The manifest for [server], from cache when fresh.
     *
     * Never throws. An unreachable server yields a manifest carrying its cached
     * tools (or none) and a `lastError` — item 8: a server being down produces a
     * tool error for the tools it provides, never a run failure.
     */
    fun manifestFor(server: McpClient.Server, workspaceId: UUID): Manifest {
        val cached = readCache(server.connectionId)
        val age = cached?.let { System.currentTimeMillis() - it.fetchedAt.toEpochMilli() }
        if (cached != null && age != null && age < ttlMs) return cached

        return try {
            val tools = client.listTools(server).mapNotNull { toRemoteTool(it) }
            /* Resources are optional in the protocol and many servers implement
               none. A failure here must not lose the tools, which are the part an
               agent actually calls. */
            val resources = runCatching { client.listResources(server).mapNotNull { toResource(it) } }
                .getOrElse { emptyList() }
            val m = Manifest(tools, resources, Instant.now())
            writeCache(server.connectionId, workspaceId, m, error = null)
            m
        } catch (e: Exception) {
            val reason = e.message ?: e.javaClass.simpleName
            log.warn("[mcp] discovery failed for connection {}: {}", server.connectionId, reason)
            writeCache(server.connectionId, workspaceId, cached, error = reason)
            /* Stale beats empty. A server down for a minute must not silently
               shrink every agent's tool list. */
            cached?.copy(stale = true, lastError = reason)
                ?: Manifest(emptyList(), emptyList(), Instant.now(),
                    stale = true, lastError = reason)
        }
    }

    /**
     * A remote tool, sanitized.
     *
     * Null when the name does not survive: a tool this worker could not name is
     * one it could not call back, so keeping it would put an uncallable entry in
     * the model's prompt.
     */
    private fun toRemoteTool(node: JsonNode): RemoteTool? {
        val rawName = node["name"]?.asText()
        val name = McpSanitizer.name(rawName) ?: return null
        val rawDescription = node["description"]?.asText()
        val altered = McpSanitizer.looksLikeInjection(rawDescription)
        if (altered) {
            log.warn("[mcp] tool '{}' has a description containing prompt-frame text; " +
                "it has been defanged. The grant list is unaffected.", name)
        }
        @Suppress("UNCHECKED_CAST")
        val schema = runCatching {
            mapper.convertValue(node["inputSchema"], Map::class.java) as Map<String, Any?>
        }.getOrDefault(emptyMap())

        return RemoteTool(
            name = name,
            description = McpSanitizer.text(rawDescription),
            inputSchema = schema,
            resultContract = contractFromAnnotations(node),
            descriptionWasAltered = altered,
        )
    }

    /**
     * A default result contract from the server's own annotations.
     *
     * ── WHY THE SERVER'S ANNOTATIONS ARE A DEFAULT AND NOT THE TRUTH ────────
     * An MCP server can describe its output shape, and where it does, that is a
     * better starting point than nothing — it is the server author saying which
     * fields matter. It is still a DEFAULT: a locally-authored contract on the
     * tool row overrides it, because the customer's agent knows what it needs and
     * the server author does not.
     *
     * Annotation text goes through the same sanitizer as everything else: a field
     * `desc` reaches the prompt in the result legend, which makes it the same
     * injection surface as the description.
     */
    private fun contractFromAnnotations(node: JsonNode): ToolResultContract? {
        val out = node["outputSchema"] ?: node["annotations"]?.get("result") ?: return null
        val props = out["properties"] as? com.fasterxml.jackson.databind.node.ObjectNode
            ?: return null
        val fields = props.fields().asSequence().mapNotNull { (k, v) ->
            val name = McpSanitizer.name(k) ?: return@mapNotNull null
            mapOf(
                "path" to name,
                "as" to name,
                "desc" to McpSanitizer.text(v["description"]?.asText(), 120),
            )
        }.take(MAX_ANNOTATED_FIELDS).toList()
        if (fields.isEmpty()) return null
        return ToolResultContract.parse(mapper.writeValueAsString(mapOf("fields" to fields)))
    }

    private fun toResource(node: JsonNode): RemoteResource? {
        val uri = node["uri"]?.asText()?.takeIf { it.isNotBlank() } ?: return null
        /* The uri is used to fetch, not rendered as an instruction, so it is length
           -bounded rather than run through the prose sanitizer — stripping
           characters out of a uri would break the fetch it exists for. */
        if (uri.length > MAX_URI_CHARS) return null
        return RemoteResource(
            uri = uri,
            name = McpSanitizer.text(node["name"]?.asText(), 120),
            description = McpSanitizer.text(node["description"]?.asText(), 240),
            mimeType = McpSanitizer.name(node["mimeType"]?.asText()),
        )
    }

    // ── Materialising the catalogue ──────────────────────────────────────────

    /**
     * Turn a manifest into grantable `tools` rows.
     *
     * ── THIS IS WHERE THE GRANT MODEL IS ACTUALLY IMPLEMENTED ───────────────
     * Everything else about MCP is plumbing; this function is why a server-level
     * grant is impossible. Each remote tool becomes its own row with its own uuid,
     * so `allowed_tool_ids` — which holds tool ids — is the only thing that can
     * express access, and it can only express it one tool at a time.
     *
     * Returns the number of rows written, for the log and for the caller that
     * wants to say "found 12 tools".
     *
     * ── A WITHDRAWN TOOL IS NOT DELETED ─────────────────────────────────────
     * A tool the server has stopped advertising keeps its row, its uuid and its
     * grants, and fails at call time with a legible cause (`-32601` → "the server
     * no longer advertises this tool"). Deleting it would silently change what an
     * agent may do — an agent's tool list would shrink because somebody else's
     * server was redeployed — and a grant that disappears without a decision is
     * the kind of change nobody can audit afterwards. `mcp_last_seen_at` records
     * the withdrawal instead, and `mcp_tools_available` surfaces it.
     */
    fun syncTools(
        server: McpClient.Server,
        workspaceId: UUID,
        environmentId: UUID,
    ): Int {
        val manifest = manifestFor(server, workspaceId)
        if (manifest.tools.isEmpty()) {
            log.info("[mcp] no tools to sync for connection {} ({})",
                server.connectionId, manifest.lastError ?: "server advertises none")
            return 0
        }

        var written = 0
        runCatching {
            dataSource.connection.use { c ->
                manifest.tools.forEach { t ->
                    c.prepareStatement(
                        """INSERT INTO tools
                             (workspace_id, environment_id, name, slug, type, description,
                              input_schema_json, result_contract_json, config_json,
                              mcp_server_connection_id, mcp_tool_name, mcp_last_seen_at,
                              status)
                           VALUES (?,?,?,?, 'mcp', ?, ?::jsonb, ?::jsonb, '{}'::jsonb,
                                   ?,?, now(), 'active')
                           ON CONFLICT (mcp_server_connection_id, mcp_tool_name)
                             WHERE mcp_server_connection_id IS NOT NULL
                           DO UPDATE SET
                             description       = EXCLUDED.description,
                             input_schema_json = EXCLUDED.input_schema_json,
                             mcp_last_seen_at  = now(),
                             updated_at        = now(),
                             /*
                              * The contract is NOT overwritten when one is already
                              * stored. A server's annotations are a DEFAULT; a
                              * locally-authored contract is the customer saying
                              * what their agent needs, and a re-discovery must not
                              * quietly replace it with the server author's opinion.
                              */
                             result_contract_json =
                               COALESCE(tools.result_contract_json, EXCLUDED.result_contract_json)"""
                    ).use { st ->
                        st.setObject(1, workspaceId)
                        st.setObject(2, environmentId)
                        /* Namespaced, so two servers offering `search` are two
                           distinct, distinguishable tools in the granting UI. */
                        st.setString(3, "${serverSlug(server)}.${t.name}")
                        st.setString(4, "mcp-${server.connectionId}-${t.name}".take(200))
                        st.setString(5, t.description)
                        st.setString(6, mapper.writeValueAsString(t.inputSchema))
                        st.setString(7, t.resultContract?.let {
                            mapper.writeValueAsString(mapOf(
                                "version" to 1,
                                "fields" to it.fields.map { f ->
                                    mapOf("path" to f.path, "as" to f.name, "desc" to f.desc)
                                }))
                        })
                        st.setObject(8, server.connectionId)
                        st.setString(9, t.name)
                        written += st.executeUpdate()
                    }
                }
            }
        }.onFailure {
            log.warn("[mcp] tool sync failed for connection {}: {}",
                server.connectionId, it.message)
        }

        val flagged = manifest.tools.count { it.descriptionWasAltered }
        log.info("[mcp] synced {} tool(s) from connection {}{}",
            written, server.connectionId,
            if (flagged > 0) " ($flagged description(s) defanged)" else "")
        return written
    }

    /** A short, stable prefix so two servers' `search` tools are distinguishable. */
    private fun serverSlug(server: McpClient.Server): String =
        "mcp-" + server.connectionId.toString().take(8)

    // ── The cache ────────────────────────────────────────────────────────────

    private fun readCache(connectionId: UUID): Manifest? = runCatching {
        dataSource.connection.use { c ->
            c.prepareStatement(
                "SELECT tools_json, resources_json, fetched_at, last_error " +
                "FROM mcp_server_manifests WHERE connection_id = ?"
            ).use { st ->
                st.setObject(1, connectionId)
                st.executeQuery().use { rs ->
                    if (!rs.next()) return@use null
                    Manifest(
                        tools = parseTools(rs.getString(1)),
                        resources = parseResources(rs.getString(2)),
                        fetchedAt = rs.getTimestamp(3).toInstant(),
                        lastError = rs.getString(4),
                    )
                }
            }
        }
    }.getOrNull()

    /**
     * Store what was discovered, or record the failure beside what is already
     * there.
     *
     * A null [manifest] with an error updates only the error columns: the point is
     * that a failed refresh must not erase a good manifest.
     */
    private fun writeCache(
        connectionId: UUID, workspaceId: UUID, manifest: Manifest?, error: String?,
    ) {
        runCatching {
            dataSource.connection.use { c ->
                if (manifest == null) {
                    c.prepareStatement(
                        "UPDATE mcp_server_manifests SET last_error = ?, last_error_at = now() " +
                        "WHERE connection_id = ?"
                    ).use { st ->
                        st.setString(1, error?.take(500)); st.setObject(2, connectionId)
                        if (st.executeUpdate() == 0) {
                            /* Nothing cached and nothing reachable: record the
                               failure so the UI can show a server that has never
                               worked, rather than one that looks unconfigured. */
                            insertEmpty(c, connectionId, workspaceId, error)
                        }
                    }
                    return@use
                }
                c.prepareStatement(
                    """INSERT INTO mcp_server_manifests
                         (connection_id, workspace_id, tools_json, resources_json,
                          fetched_at, last_error, last_error_at)
                       VALUES (?,?,?::jsonb,?::jsonb, now(), ?, CASE WHEN ? IS NULL THEN NULL ELSE now() END)
                       ON CONFLICT (connection_id) DO UPDATE SET
                         tools_json = EXCLUDED.tools_json,
                         resources_json = EXCLUDED.resources_json,
                         fetched_at = now(),
                         last_error = EXCLUDED.last_error,
                         last_error_at = EXCLUDED.last_error_at"""
                ).use { st ->
                    st.setObject(1, connectionId); st.setObject(2, workspaceId)
                    /* SANITIZED ALREADY. `toRemoteTool` cleaned every string before
                       it reached this object, per invariant 4: the store keeps what
                       it is given, and what it is given is already safe. */
                    st.setString(3, mapper.writeValueAsString(manifest.tools))
                    st.setString(4, mapper.writeValueAsString(manifest.resources))
                    st.setString(5, error?.take(500)); st.setString(6, error?.take(500))
                    st.executeUpdate()
                }
            }
        }.onFailure { log.warn("[mcp] manifest cache write failed: {}", it.message) }
    }

    private fun insertEmpty(
        c: java.sql.Connection, connectionId: UUID, workspaceId: UUID, error: String?,
    ) {
        c.prepareStatement(
            """INSERT INTO mcp_server_manifests
                 (connection_id, workspace_id, tools_json, resources_json, fetched_at,
                  last_error, last_error_at)
               VALUES (?,?,'[]'::jsonb,'[]'::jsonb, now(), ?, now())
               ON CONFLICT (connection_id) DO NOTHING"""
        ).use { st ->
            st.setObject(1, connectionId); st.setObject(2, workspaceId)
            st.setString(3, error?.take(500)); st.executeUpdate()
        }
    }

    private fun parseTools(json: String?): List<RemoteTool> = runCatching {
        mapper.readTree(json ?: "[]").mapNotNull { n ->
            val name = n["name"]?.asText() ?: return@mapNotNull null
            @Suppress("UNCHECKED_CAST")
            RemoteTool(
                name = name,
                description = n["description"]?.asText(),
                inputSchema = runCatching {
                    mapper.convertValue(n["inputSchema"], Map::class.java) as Map<String, Any?>
                }.getOrDefault(emptyMap()),
                resultContract = n["resultContract"]?.let {
                    ToolResultContract.parse(mapper.writeValueAsString(it))
                },
                descriptionWasAltered = n["descriptionWasAltered"]?.asBoolean() ?: false,
            )
        }
    }.getOrDefault(emptyList())

    private fun parseResources(json: String?): List<RemoteResource> = runCatching {
        mapper.readTree(json ?: "[]").mapNotNull { n ->
            RemoteResource(
                uri = n["uri"]?.asText() ?: return@mapNotNull null,
                name = n["name"]?.asText(),
                description = n["description"]?.asText(),
                mimeType = n["mimeType"]?.asText(),
            )
        }
    }.getOrDefault(emptyList())

    companion object {
        /** A server advertising a hundred output fields is not describing a tool. */
        const val MAX_ANNOTATED_FIELDS = 20
        const val MAX_URI_CHARS = 500
    }
}
