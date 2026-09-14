package com.vectorbea.api.routes

import com.vectorbea.api.api.context
import com.vectorbea.api.api.pathUUID
import com.vectorbea.api.config.PublicUrls
import com.vectorbea.api.connector.McpTester
import com.vectorbea.api.entitlements.EntitlementGuard
import com.vectorbea.api.entitlements.EntitlementKeys
import com.vectorbea.api.errors.ApiError
import com.vectorbea.api.http.Request
import com.vectorbea.api.http.Response
import com.vectorbea.api.http.Router
import com.vectorbea.api.mcp.ApiMcpCredentialResolver
import com.vectorbea.api.mcp.ApiMcpTokenStore
import com.vectorbea.api.mcp.ApiMcpTransport
import com.vectorbea.api.mcp.McpOAuthPendingRepository
import com.vectorbea.api.repository.Connection
import com.vectorbea.api.repository.ConnectionRepository
import com.vectorbea.api.repository.McpToolRepository
import com.vectorbea.api.secrets.SecretService
import com.vectorbea.mcp.McpClient
import com.vectorbea.mcp.McpCredential
import com.vectorbea.mcp.McpCredentials
import com.vectorbea.mcp.McpDiscovery
import com.vectorbea.mcp.McpOAuth
import com.vectorbea.mcp.McpSanitizer
import org.slf4j.LoggerFactory
import java.net.URLEncoder
import java.util.UUID
import javax.sql.DataSource

/**
 * Connecting an MCP server, signing in to it, and seeing what it offers.
 *
 * ── THE FLOW THIS SERVES ────────────────────────────────────────────────────
 * The person pastes a URL. Everything after that is found out, not asked:
 *
 *   `POST /api/mcp/probe`                      — does it need a credential, and which kind?
 *   `POST /api/connections/:id/mcp/oauth/start` — where to send the person to sign in
 *   `GET  /api/mcp/oauth/callback`             — the sign-in comes back; tools are discovered
 *   `POST /api/connections/:id/mcp/discover`   — ask again, whenever
 *   `GET  /api/connections/:id/mcp/tools`      — what is registered, and is the server answering
 *
 * That is the shape of connecting a remote MCP server in Claude and Claude Code:
 * a URL, a sign-in if the server has one, and the tools appear. The previous
 * flow asked for a bearer token up front, and for the servers that matter most —
 * hosted ones, which use OAuth — there is no token to give.
 *
 * ── STILL NO ENDPOINT THAT GRANTS ───────────────────────────────────────────
 * Granting is `PUT /api/agents/:id` writing `allowed_tool_ids`, one tool uuid at
 * a time, exactly as for an HTTP tool. The connect screen offers to add the
 * discovered tools to agents, and does it by writing N explicit ids through that
 * route — there is still no column anywhere that could express "every tool from
 * this server" (MCP.md §3), and a convenience endpoint here is how that would
 * stop being true.
 *
 * ── DISCOVERY IS ONE IMPLEMENTATION, SHARED ─────────────────────────────────
 * [McpDiscovery] and [McpOAuth] are `packages/mcp-kotlin`, the same code the
 * worker runs. The count this route reports has to be a fact about the code that
 * will actually run the customer's tools.
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
    private val discovery by lazy { McpDiscovery(dataSource, McpClient(ApiMcpTransport)) }
    private val resolver by lazy { ApiMcpCredentialResolver.build(dataSource, secretService) }
    private val oauth by lazy { McpOAuth(ApiMcpTransport) }
    private val pending by lazy { secretService?.let { McpOAuthPendingRepository(dataSource, it) } }
    private val tokenStore by lazy { secretService?.let { ApiMcpTokenStore(dataSource, it) } }

    fun register(router: Router) {
        router.post("/api/mcp/probe", ::probe)
        router.post("/api/connections/:id/mcp/oauth/start", ::startSignIn)
        router.get("/api/mcp/oauth/callback", ::callback)
        router.post("/api/connections/:id/mcp/discover", ::discover)
        router.get("/api/connections/:id/mcp/tools", ::listTools)
    }

    // ── Probe ────────────────────────────────────────────────────────────────

    /**
     * What a server needs, before anything is saved.
     *
     * Answers one of: connected (no credential needed, here are the tools), sign
     * in (the server publishes OAuth), or paste a token (it wants a credential and
     * publishes no sign-in). An optional `token` is tested as a bearer token, so
     * the same call verifies a pasted one.
     */
    private fun probe(req: Request): Response {
        req.context()
        data class Body(val serverUrl: String? = null, val token: String? = null)
        val body = try { req.bodyAs<Body>() } catch (_: Exception) { Body() }
        val url = body.serverUrl?.trim()?.takeIf { it.isNotBlank() }
            ?: throw ApiError.ValidationError("Enter the MCP server's URL — the endpoint it answers on, usually ending in /mcp.")
        val credential = body.token?.trim()?.takeIf { it.isNotBlank() }?.let { McpCredential.Bearer(it) }
        return Response.ok(McpTester.probe(url, credential).toResponse())
    }

    // ── Sign in ──────────────────────────────────────────────────────────────

    /**
     * Start signing in to a saved MCP connection.
     *
     * Discovers the authorization server, registers Vectorbea as a client of it,
     * and returns the URL to send the person to. The PKCE verifier and client
     * registration wait, sealed, in `mcp_oauth_authorizations` until the callback
     * — never in the browser, which only ever holds the opaque `state`.
     */
    private fun startSignIn(req: Request): Response {
        val ctx = req.context()
        requireFlag()
        val connection = requireMcpConnection(req.pathUUID("id"), ctx.workspaceId)
        entitlements?.requireFeature(ctx.workspaceId, EntitlementKeys.MCP_TOOLS)
        val store = pending ?: throw ApiError.ValidationError(
            "This deployment cannot store credentials (SECRET_ENCRYPTION_KEY is not set), so it cannot sign in to a server.")

        data class Body(val returnTo: String? = null)
        val body = try { req.bodyAs<Body>() } catch (_: Exception) { Body() }

        val serverUrl = serverUrlOf(connection)
            ?: throw ApiError.ValidationError("This connection has no server URL. Add the MCP server's endpoint first.")

        /* Ask the server cold. Its 401 names where its sign-in is described; a
           server that answers without one needs no sign-in at all, and saying so
           beats sending somebody to a login page that does not exist. */
        val challenge = try {
            McpClient(ApiMcpTransport).probe(McpClient.Server(connection.id, serverUrl))
            return Response.ok(mapOf("authorizationUrl" to null, "signInRequired" to false,
                "message" to "This server does not need a sign-in. Discover its tools directly."))
        } catch (e: McpClient.McpAuthRequiredException) {
            e.challenge
        } catch (e: McpClient.McpException) {
            null
        }

        val redirectUri = "${PublicUrls.apiBase()}/api/mcp/oauth/callback"
        val (found, client) = try {
            val d = oauth.discover(serverUrl, challenge)
            d to oauth.registerClient(d.authorizationServer, redirectUri, "Vectorbea")
        } catch (e: McpOAuth.McpOAuthException) {
            throw ApiError.ValidationError(e.message ?: "The server's sign-in could not be started.")
        }

        val state = McpOAuth.randomToken(32)
        val pkce = McpOAuth.pkce()
        val created = store.create(
            state = state,
            workspaceId = ctx.workspaceId,
            connectionId = connection.id,
            startedByUserId = req.principal?.appUserId,
            returnTo = safeReturnTo(body.returnTo),
            context = McpOAuthPendingRepository.Context(
                verifier = pkce.verifier,
                redirectUri = redirectUri,
                resource = found.resource,
                scope = found.scope,
                issuer = found.authorizationServer.issuer,
                tokenEndpoint = found.authorizationServer.tokenEndpoint,
                clientId = client.clientId,
                clientSecret = client.clientSecret,
                tokenEndpointAuthMethod = client.tokenEndpointAuthMethod,
            ),
        )
        if (!created) throw ApiError.ValidationError("The sign-in could not be started because credentials cannot be sealed here.")

        audit?.recordUserAction(
            req = req, workspaceId = ctx.workspaceId, action = "mcp.oauth.start",
            targetType = "connection", targetId = connection.id, environmentId = connection.environmentId,
            after = mapOf("issuer" to found.authorizationServer.issuer),
        )
        return Response.ok(mapOf(
            "authorizationUrl" to oauth.authorizationUrl(found, client, redirectUri, state, pkce),
            "signInRequired" to true,
            "authorizationServer" to runCatching { java.net.URI.create(found.authorizationServer.issuer).host }.getOrNull(),
            "expiresInSeconds" to McpOAuthPendingRepository.TTL_SECONDS,
        ))
    }

    /**
     * The authorization server sends the browser back here.
     *
     * Unauthenticated by necessity — it is a redirect from somebody else's
     * domain — and safe because the `state` is the only key: 32 random bytes,
     * looked up by hash, deleted as it is read. Everything this does is scoped by
     * the workspace that row carries, never by anything in the query string.
     *
     * Always answers with a redirect to the web app, success or failure, so a
     * person is never left on a JSON error from an API they have never heard of.
     */
    private fun callback(req: Request): Response {
        val state = req.query("state")?.takeIf { it.isNotBlank() } ?: return finish(null, "error", "missing_state")
        val signIn = try { pending?.consume(state) } catch (e: Exception) {
            log.warn("[mcp-oauth] callback lookup failed: {}", e.javaClass.simpleName); null
        } ?: return finish(null, "error", "expired")

        req.query("error")?.let { error ->
            val reason = if (error == "access_denied") "cancelled" else (McpSanitizer.name(error) ?: "denied")
            return finish(signIn, "error", reason)
        }
        val code = req.query("code")?.takeIf { it.isNotBlank() } ?: return finish(signIn, "error", "missing_code")

        val connection = connections.findById(signIn.connectionId, signIn.workspaceId)
            ?: return finish(signIn, "error", "connection_deleted")
        val svc = secretService ?: return finish(signIn, "error", "no_secret_store")
        val ctx = signIn.context

        val client = McpOAuth.ClientRegistration(ctx.clientId, ctx.clientSecret, ctx.tokenEndpointAuthMethod)
        val tokens = try {
            oauth.exchangeCode(ctx.tokenEndpoint, client, code, ctx.verifier, ctx.redirectUri, ctx.resource)
        } catch (e: McpOAuth.McpOAuthException) {
            log.warn("[mcp-oauth] code exchange failed for connection {}: {}", connection.id, e.code)
            return finish(signIn, "error", "exchange_failed")
        }

        val credential = McpCredential.OAuth(
            accessToken = tokens.accessToken, refreshToken = tokens.refreshToken, expiresAtMs = tokens.expiresAtMs,
            tokenEndpoint = ctx.tokenEndpoint, clientId = ctx.clientId, clientSecret = ctx.clientSecret,
            tokenEndpointAuthMethod = ctx.tokenEndpointAuthMethod, resource = ctx.resource,
            scope = tokens.scope ?: ctx.scope, issuer = ctx.issuer,
        )

        try {
            val existingRef = connection.secretRef?.takeIf { it.isNotBlank() }
            val ref = if (existingRef != null) { svc.updateSecret(existingRef, credential.toJson()); existingRef }
                else svc.createSecret(connection.workspaceId, connection.id, credential.toJson()).ref
            /* A refreshed token from a PREVIOUS sign-in would be read in preference
               to the one just stored, resurrecting a session the person replaced. */
            tokenStore?.clear(connection.workspaceId, connection.id)
            connections.update(
                id = connection.id, workspaceId = connection.workspaceId,
                secretRef = ref.takeIf { existingRef == null }, authType = "oauth2", status = "connected",
            )
        } catch (e: Exception) {
            log.warn("[mcp-oauth] storing the credential failed for connection {}: {}", connection.id, e.javaClass.simpleName)
            return finish(signIn, "error", "store_failed")
        }

        audit?.record(
            workspaceId = connection.workspaceId, action = "mcp.oauth.connected",
            targetType = "connection", targetId = connection.id, environmentId = connection.environmentId,
            actorId = signIn.startedByUserId?.toString(), after = mapOf("issuer" to ctx.issuer),
        )

        /* The point of signing in is the tools. Discover now, so the person comes
           back to a list rather than to a second button. A failure here does not
           undo the sign-in — the connection is good and discovery can be retried. */
        val written = if (FLAG_ENABLED) runCatching {
            val server = serverOf(connection, credential)
            discovery.syncTools(server.copy(), connection.workspaceId, connection.environmentId)
        }.onFailure { log.warn("[mcp-oauth] post-sign-in discovery failed for {}: {}", connection.id, it.message) }
            .getOrNull() else null

        return finish(signIn, "ok", null, written)
    }

    /** Redirect to the web app's completion page. Only ever to our own origin. */
    private fun finish(
        signIn: McpOAuthPendingRepository.Pending?,
        status: String,
        reason: String?,
        toolsWritten: Int? = null,
    ): Response {
        val params = buildList {
            signIn?.let { add("connection" to it.connectionId.toString()) }
            add("status" to status)
            reason?.let { add("reason" to it) }
            toolsWritten?.let { add("tools" to it.toString()) }
            signIn?.returnTo?.let { add("returnTo" to it) }
        }.joinToString("&") { (k, v) -> "$k=${URLEncoder.encode(v, Charsets.UTF_8)}" }
        return Response(status = 302, body = "", headers = mapOf(
            "Location" to "${PublicUrls.appBase()}/mcp/oauth/complete?$params",
            "Cache-Control" to "no-store",
            "Referrer-Policy" to "no-referrer",
        ))
    }

    // ── Discover ─────────────────────────────────────────────────────────────

    /**
     * Ask the server what it offers, and write a grantable row for each tool.
     *
     * The credential is the connection's current one — refreshed first if it is
     * about to expire, and refreshed once more if the server refuses it anyway —
     * so a sign-in from last month discovers today without a second sign-in.
     */
    private fun discover(req: Request): Response {
        val ctx = req.context()
        requireFlag()
        val connection = requireMcpConnection(req.pathUUID("id"), ctx.workspaceId)
        entitlements?.requireFeature(ctx.workspaceId, EntitlementKeys.MCP_TOOLS)
        serverUrlOf(connection) ?: throw ApiError.ValidationError(
            "This connection has no server URL. Add the MCP server's endpoint before discovering its tools.")

        val fromSecret = resolver.fromSecret(connection)
        var credential = try {
            resolver.credentials?.current(connection.workspaceId, connection.id, fromSecret) ?: fromSecret
        } catch (e: McpCredentials.ReauthorizationRequired) {
            throw ApiError.ValidationError(e.message ?: "Sign in to this server again.")
        }

        /* Probe first, fresh, so an auth failure is an answer rather than an
           empty manifest served stale from the cache. */
        try {
            McpClient(ApiMcpTransport).probe(serverOf(connection, credential))
        } catch (e: McpClient.McpAuthRequiredException) {
            val retried = resolver.credentials?.afterRejection(connection.workspaceId, connection.id, fromSecret, credential)
            if (retried == null) throw ApiError.ValidationError(
                if (credential == null) "This server needs you to sign in before its tools can be discovered."
                else "The server refused this connection's credential. Sign in to the server again.")
            credential = retried
        } catch (_: McpClient.McpException) {
            /* Other failures fall through to discovery, which records them on the
               manifest and serves the last good list — MCP.md §6. */
        }

        val server = serverOf(connection, credential)
        val manifest = McpDiscovery(dataSource, McpClient(ApiMcpTransport), ttlMs = 0)
            .manifestFor(server, ctx.workspaceId)
        val written = discovery.syncTools(server, ctx.workspaceId, connection.environmentId)

        audit?.recordUserAction(
            req = req, workspaceId = ctx.workspaceId, action = "mcp.discover",
            targetType = "connection", targetId = connection.id, environmentId = connection.environmentId,
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
            "toolsFlagged" to manifest.tools.count { it.descriptionWasAltered },
            "resourcesFound" to manifest.resources.size,
            "fetchedAt" to manifest.fetchedAt.toString(),
            "stale" to manifest.stale,
            "lastError" to manifest.lastError,
            "tools" to manifest.tools.map {
                mapOf("name" to it.name, "description" to it.description, "descriptionWasAltered" to it.descriptionWasAltered)
            },
        ))
    }

    // ── Read ─────────────────────────────────────────────────────────────────

    private fun listTools(req: Request): Response {
        val ctx = req.context()
        val connection = requireMcpConnection(req.pathUUID("id"), ctx.workspaceId)
        val items = mcpTools.listForConnection(connection.id, ctx.workspaceId)
        val manifest = mcpTools.manifestFor(connection.id, ctx.workspaceId)
        return Response.ok(mapOf(
            "items" to items.map { it.toResponse() },
            "manifest" to manifest?.toResponse(),
            "serverName" to connection.name,
            "signedIn" to (connection.authType == "oauth2"),
        ))
    }

    // ── Helpers ──────────────────────────────────────────────────────────────

    private fun requireFlag() {
        if (!FLAG_ENABLED) throw ApiError.ValidationError(
            "Connecting MCP servers is not enabled on this deployment. Set $FLAG_NAME=true to turn it on.")
    }

    private fun requireMcpConnection(id: UUID, workspaceId: UUID): Connection {
        val connection = connections.findById(id, workspaceId) ?: throw ApiError.NotFound("Connection not found")
        if (connection.type.lowercase() !in MCP_CONNECTION_TYPES) {
            throw ApiError.ValidationError(
                "Connection '${connection.name}' is a ${connection.type} connection, not an MCP server. " +
                "Only MCP servers advertise tools.")
        }
        return connection
    }

    private fun serverOf(connection: Connection, credential: McpCredential?) = McpClient.Server(
        connectionId = connection.id,
        url = serverUrlOf(connection) ?: "",
        transport = (configOf(connection)["transport"] as? String) ?: "streamable-http",
        authToken = McpCredentials.tokenOf(credential),
    )

    @Suppress("UNCHECKED_CAST")
    private fun configOf(connection: Connection): Map<String, Any?> = try {
        com.vectorbea.api.http.mapper.readValue(connection.configJson, Map::class.java) as Map<String, Any?>
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
     * A path on the web app, or nothing.
     *
     * The callback redirects to this after an unauthenticated request, so it is
     * the textbook open redirect if it can name another origin. Only a relative
     * path is kept — not `//host`, not `\host`, not a scheme.
     */
    private fun safeReturnTo(raw: String?): String? {
        val value = raw?.trim()?.takeIf { it.isNotEmpty() && it.length <= 512 } ?: return null
        if (!value.startsWith("/") || value.startsWith("//") || value.contains('\\') || value.contains("://")) return null
        return value
    }

    companion object {
        private val MCP_CONNECTION_TYPES = setOf("tool", "mcp", "mcp_server")
        private const val FLAG_NAME = "MCP_DISCOVERY_ENABLED"
        private val FLAG_ENABLED: Boolean =
            System.getenv(FLAG_NAME)?.lowercase() in setOf("true", "1", "yes")
    }
}
