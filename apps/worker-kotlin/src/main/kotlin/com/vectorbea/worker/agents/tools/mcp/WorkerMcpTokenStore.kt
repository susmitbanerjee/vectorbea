package com.vectorbea.worker.agents.tools.mcp

import com.vectorbea.mcp.McpCredential
import com.vectorbea.mcp.McpCredentials
import com.vectorbea.worker.connector.SecretService
import com.vectorbea.worker.logging.logger
import java.sql.Timestamp
import java.time.Instant
import java.util.UUID
import javax.sql.DataSource

/**
 * Where the worker keeps an MCP server's refreshed sign-in.
 *
 * `connection_oauth_tokens` (V064) — the one table the worker writes ciphertext
 * to, through the same `sealForWorkspace` pair `OAuth2TokenStore` uses for HTTP
 * tools. The API writes the same row in the same format when it refreshes during
 * discovery, so whichever service refreshes first, the other reads the result
 * instead of spending a refresh token a rotating server has already retired.
 *
 * The document stored is the whole credential (`McpCredential.OAuth.toJson`),
 * which carries `accessToken` and `refreshToken` under the keys the HTTP path
 * reads — so neither reader misparses the other's rows.
 */
class WorkerMcpTokenStore(
    private val dataSource: DataSource,
    private val secrets: SecretService,
) : McpCredentials.Store {

    private val log = logger()

    override fun loadRefreshed(workspaceId: UUID, connectionId: UUID): McpCredential.OAuth? = try {
        dataSource.connection.use { c ->
            c.prepareStatement(
                "SELECT token_ciphertext FROM connection_oauth_tokens WHERE workspace_id = ? AND connection_id = ?"
            ).use { st ->
                st.setObject(1, workspaceId); st.setObject(2, connectionId)
                st.executeQuery().use { rs ->
                    if (!rs.next()) null
                    else McpCredential.parse(secrets.openForWorkspace(rs.getString(1), workspaceId)) as? McpCredential.OAuth
                }
            }
        }
    } catch (e: Exception) {
        log.debug("[mcp-oauth] no refreshed token for {}: {}", connectionId, e.javaClass.simpleName)
        null
    }

    override fun saveRefreshed(workspaceId: UUID, connectionId: UUID, credential: McpCredential.OAuth) {
        try {
            val sealed = secrets.sealForWorkspace(credential.toJson(), workspaceId) ?: return
            dataSource.connection.use { c ->
                c.prepareStatement(
                    """INSERT INTO connection_oauth_tokens (workspace_id, connection_id, token_ciphertext, expires_at, updated_at)
                       VALUES (?, ?, ?, ?, now())
                       ON CONFLICT (workspace_id, connection_id) DO UPDATE
                         SET token_ciphertext = EXCLUDED.token_ciphertext,
                             expires_at = EXCLUDED.expires_at, updated_at = now()"""
                ).use { st ->
                    st.setObject(1, workspaceId); st.setObject(2, connectionId)
                    st.setString(3, sealed)
                    st.setTimestamp(4, credential.expiresAtMs?.let { Timestamp.from(Instant.ofEpochMilli(it)) })
                    st.executeUpdate()
                }
            }
        } catch (e: Exception) {
            log.warn("[mcp-oauth] could not persist a refreshed token for {}: {}. If this server rotates " +
                "refresh tokens, the connection will need signing in to again.", connectionId, e.javaClass.simpleName)
        }
    }
}
