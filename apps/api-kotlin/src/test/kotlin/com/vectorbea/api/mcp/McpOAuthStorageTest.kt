package com.vectorbea.api.mcp

import com.vectorbea.api.secrets.EncryptedSecretService
import com.vectorbea.api.secrets.SecretRepository
import com.vectorbea.mcp.McpCredential
import org.junit.jupiter.api.Tag
import java.util.UUID
import javax.sql.DataSource
import kotlin.test.AfterTest
import kotlin.test.BeforeTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * The two places a signed-in MCP server's credentials rest, against a real
 * Postgres: a sign-in in flight (V074) and a refreshed token (V064).
 */
@Tag("integration")
class McpOAuthStorageTest {

    private val ds: DataSource get() = com.vectorbea.api.testsupport.Infra.postgres
    private val ws = UUID.randomUUID()
    private val env = UUID.randomUUID()
    private val connectionId = UUID.randomUUID()
    private val key = ByteArray(32) { it.toByte() }
    private val secrets by lazy { EncryptedSecretService(SecretRepository(ds), key) }

    private fun context() = McpOAuthPendingRepository.Context(
        verifier = "verifier-abc", redirectUri = "https://devapi.vectorbea.com/api/mcp/oauth/callback",
        resource = "https://mcp.example.test/mcp", scope = null, issuer = "https://auth.example.test",
        tokenEndpoint = "https://auth.example.test/token", clientId = "cid", clientSecret = "shh",
        tokenEndpointAuthMethod = "client_secret_post",
    )

    @BeforeTest
    fun seed() {
        ds.connection.use { c ->
            c.prepareStatement("INSERT INTO workspaces (id,name,slug) VALUES (?,?,?)").use {
                it.setObject(1, ws); it.setString(2, "mcp-oauth"); it.setString(3, "mcp-oauth-$ws"); it.executeUpdate()
            }
            c.prepareStatement("INSERT INTO environments (id,workspace_id,name,slug,type) VALUES (?,?,'t','t','development')").use {
                it.setObject(1, env); it.setObject(2, ws); it.executeUpdate()
            }
            c.prepareStatement(
                "INSERT INTO connections (id,workspace_id,environment_id,name,slug,type,provider,auth_type) " +
                    "VALUES (?,?,?,'srv','srv','mcp','mcp','oauth2')"
            ).use { it.setObject(1, connectionId); it.setObject(2, ws); it.setObject(3, env); it.executeUpdate() }
        }
    }

    @AfterTest
    fun cleanup() {
        runCatching {
            ds.connection.use { c ->
                c.prepareStatement("DELETE FROM connection_oauth_tokens WHERE workspace_id = ?").use { it.setObject(1, ws); it.executeUpdate() }
                c.prepareStatement("DELETE FROM workspaces WHERE id = ?").use { it.setObject(1, ws); it.executeUpdate() }
            }
        }
    }

    @Test
    fun `a sign-in state works exactly once`() {
        val repo = McpOAuthPendingRepository(ds, secrets)
        assertTrue(repo.create("state-1", ws, connectionId, null, "/connections", context()))

        val first = repo.consume("state-1")
        assertNotNull(first)
        assertEquals(connectionId, first.connectionId)
        assertEquals("verifier-abc", first.context.verifier)
        assertEquals("shh", first.context.clientSecret)

        assertNull(repo.consume("state-1"), "a replayed callback finds nothing")
        assertNull(repo.consume("never-issued"))
    }

    @Test
    fun `the verifier and client secret are not stored in clear`() {
        McpOAuthPendingRepository(ds, secrets).create("state-2", ws, connectionId, null, null, context())
        val raw = ds.connection.use { c ->
            c.prepareStatement("SELECT state_hash, sealed_context FROM mcp_oauth_authorizations WHERE workspace_id = ?").use { st ->
                st.setObject(1, ws); st.executeQuery().use { rs -> rs.next(); rs.getString(1) + "|" + rs.getString(2) }
            }
        }
        assertFalse(raw.contains("state-2"), "the state is stored hashed")
        assertFalse(raw.contains("verifier-abc"))
        assertFalse(raw.contains("shh"))
    }

    @Test
    fun `an expired sign-in cannot be completed`() {
        val repo = McpOAuthPendingRepository(ds, secrets)
        repo.create("state-3", ws, connectionId, null, null, context(), ttlSeconds = -1)
        assertNull(repo.consume("state-3"))
    }

    @Test
    fun `a refreshed token round-trips sealed, and a new sign-in clears it`() {
        val store = ApiMcpTokenStore(ds, secrets)
        val credential = McpCredential.OAuth("at", "rt", System.currentTimeMillis() + 3_600_000,
            "https://auth.example.test/token", "cid", null, "none", null, null, null)
        store.saveRefreshed(ws, connectionId, credential)

        assertEquals("rt", store.loadRefreshed(ws, connectionId)?.refreshToken)
        assertNull(store.loadRefreshed(UUID.randomUUID(), connectionId), "another workspace cannot open it")

        store.clear(ws, connectionId)
        assertNull(store.loadRefreshed(ws, connectionId))
    }
}
