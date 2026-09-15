package com.vectorbea.api.mcp

import com.vectorbea.api.repository.Connection
import com.vectorbea.api.secrets.SecretService
import com.vectorbea.mcp.McpCredential
import com.vectorbea.mcp.McpCredentials
import com.vectorbea.mcp.McpOAuth
import org.slf4j.LoggerFactory
import java.security.MessageDigest
import java.sql.Timestamp
import java.time.Instant
import java.util.UUID
import javax.sql.DataSource

/**
 * The API's half of MCP authentication: where a sign-in waits, where a refreshed
 * token is kept, and how a connection's credential is read.
 *
 * The protocol is in `packages/mcp-kotlin` and shared with the worker. What is
 * here is storage, which is each service's own business — see `McpCredentials`.
 */

/**
 * Refreshed tokens, in `connection_oauth_tokens` (V064).
 *
 * The same table and the same sealed format the worker writes, so a token the
 * API refreshed while discovering is the token the worker's next tool call
 * reads, and the other way round. Two stores would mean two refresh tokens for
 * one sign-in, and on a rotating server one of them is always dead.
 */
class ApiMcpTokenStore(
    private val dataSource: DataSource,
    private val secrets: SecretService,
) : McpCredentials.Store {
    private val log = LoggerFactory.getLogger(ApiMcpTokenStore::class.java)

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
                "refresh tokens the connection will need signing in to again.", connectionId, e.javaClass.simpleName)
        }
    }

    /**
     * Forget refreshed tokens after a NEW sign-in.
     *
     * The fresh credential goes into the connection's secret; a refreshed row
     * from the previous sign-in would otherwise be read in preference to it and
     * resurrect a session the person just replaced.
     */
    fun clear(workspaceId: UUID, connectionId: UUID) {
        runCatching {
            dataSource.connection.use { c ->
                c.prepareStatement("DELETE FROM connection_oauth_tokens WHERE workspace_id = ? AND connection_id = ?").use { st ->
                    st.setObject(1, workspaceId); st.setObject(2, connectionId); st.executeUpdate()
                }
            }
        }
    }
}

/** A sign-in waiting for its callback. See V074. */
class McpOAuthPendingRepository(
    private val dataSource: DataSource,
    private val secrets: SecretService,
) {
    private val mapper = com.fasterxml.jackson.module.kotlin.jacksonObjectMapper()

    data class Context(
        val verifier: String,
        val redirectUri: String,
        val resource: String,
        val scope: String?,
        val issuer: String,
        val tokenEndpoint: String,
        val clientId: String,
        val clientSecret: String?,
        val tokenEndpointAuthMethod: String,
    )

    data class Pending(
        val workspaceId: UUID,
        val connectionId: UUID,
        val startedByUserId: UUID?,
        val returnTo: String?,
        val context: Context,
    )

    /** Returns false when there is no key to seal the context with. */
    fun create(
        state: String,
        workspaceId: UUID,
        connectionId: UUID,
        startedByUserId: UUID?,
        returnTo: String?,
        context: Context,
        ttlSeconds: Long = TTL_SECONDS,
    ): Boolean {
        val sealed = secrets.sealForWorkspace(mapper.writeValueAsString(context), workspaceId) ?: return false
        dataSource.connection.use { c ->
            /* Abandoned sign-ins are removed here rather than by a sweeper: this
               is the only code that creates them, so it is the one place that
               always runs when there might be some to remove. */
            c.prepareStatement("DELETE FROM mcp_oauth_authorizations WHERE expires_at < now()").use { it.executeUpdate() }
            c.prepareStatement(
                """INSERT INTO mcp_oauth_authorizations
                     (state_hash, workspace_id, connection_id, started_by_user_id, sealed_context, return_to, expires_at)
                   VALUES (?, ?, ?, ?, ?, ?, now() + make_interval(secs => ?))"""
            ).use { st ->
                st.setString(1, hash(state)); st.setObject(2, workspaceId); st.setObject(3, connectionId)
                st.setObject(4, startedByUserId); st.setString(5, sealed); st.setString(6, returnTo)
                st.setDouble(7, ttlSeconds.toDouble())
                st.executeUpdate()
            }
        }
        return true
    }

    /**
     * Take a sign-in by its state, exactly once.
     *
     * `DELETE … RETURNING` is the single-use guarantee: two callbacks racing on
     * one state cannot both get a row. Null for an unknown, expired or already
     * used state — the callback reports all three the same way.
     */
    fun consume(state: String): Pending? = dataSource.connection.use { c ->
        c.prepareStatement(
            """DELETE FROM mcp_oauth_authorizations
                WHERE state_hash = ? AND expires_at > now()
                RETURNING workspace_id, connection_id, started_by_user_id, sealed_context, return_to"""
        ).use { st ->
            st.setString(1, hash(state))
            st.executeQuery().use { rs ->
                if (!rs.next()) return@use null
                val workspaceId = rs.getObject("workspace_id", UUID::class.java)
                val opened = secrets.openForWorkspace(rs.getString("sealed_context"), workspaceId) ?: return@use null
                Pending(
                    workspaceId = workspaceId,
                    connectionId = rs.getObject("connection_id", UUID::class.java),
                    startedByUserId = rs.getObject("started_by_user_id", UUID::class.java),
                    returnTo = rs.getString("return_to"),
                    context = mapper.readValue(opened, Context::class.java),
                )
            }
        }
    }

    companion object {
        /** Long enough to sign in with two-factor; short enough that a stale link is useless. */
        const val TTL_SECONDS = 15 * 60L

        private fun hash(state: String): String =
            MessageDigest.getInstance("SHA-256").digest(state.toByteArray(Charsets.UTF_8))
                .joinToString("") { "%02x".format(it) }
    }
}

/**
 * The credential to present for a connection, refreshed if it needs to be.
 *
 * Reads the connection's own secret, then asks `McpCredentials` for anything
 * newer. A bearer token or no secret at all passes straight through, so every
 * connection created before sign-in existed behaves exactly as it did.
 */
class ApiMcpCredentialResolver(
    private val secrets: SecretService?,
    val credentials: McpCredentials?,
) {
    private val log = LoggerFactory.getLogger(ApiMcpCredentialResolver::class.java)

    fun fromSecret(connection: Connection): McpCredential? {
        val ref = connection.secretRef?.takeIf { it.isNotBlank() } ?: return null
        val svc = secrets ?: return null
        return try {
            McpCredential.parse(svc.resolveSecretForRuntime(ref, connection.workspaceId))
        } catch (e: Exception) {
            log.warn("[mcp] could not resolve the credential for connection {}: {}", connection.id, e.javaClass.simpleName)
            null
        }
    }

    fun current(connection: Connection): McpCredential? {
        val base = fromSecret(connection)
        val creds = credentials ?: return base
        return creds.current(connection.workspaceId, connection.id, base)
    }

    companion object {
        fun build(dataSource: DataSource, secrets: SecretService?): ApiMcpCredentialResolver =
            ApiMcpCredentialResolver(
                secrets,
                secrets?.let { McpCredentials(McpOAuth(ApiMcpTransport), ApiMcpTokenStore(dataSource, it)) },
            )
    }
}
