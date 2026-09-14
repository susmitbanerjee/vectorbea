package com.vectorbea.mcp

import com.fasterxml.jackson.databind.JsonNode
import com.fasterxml.jackson.databind.ObjectMapper
import java.net.URI
import java.net.URLEncoder
import java.net.http.HttpRequest
import java.security.MessageDigest
import java.security.SecureRandom
import java.util.Base64

/**
 * Signing in to an MCP server, the way the MCP authorization specification says.
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────────
 * The connector used to offer "bearer token or none". Most hosted MCP servers
 * offer neither: they are OAuth 2.1 resource servers, they answer a cold call
 * with 401, and there is no token to paste because the token is minted for a
 * person, by a sign-in, on the server's own domain. So every such server failed
 * the verify step with "the server rejected the token" — for a token nobody had
 * given it — and the only way forward was a button labelled "Save without
 * verifying", which saved a connection that could never work.
 *
 * This is the flow MCP clients (Claude, Claude Code, the reference SDKs) run
 * instead, and every step is discovered rather than configured:
 *
 *   1. The 401 names the protected-resource metadata (RFC 9728), or it is found
 *      at the well-known path.
 *   2. That document names the authorization server; its metadata (RFC 8414, or
 *      OpenID discovery) names the endpoints.
 *   3. The client registers itself (RFC 7591 dynamic client registration), so
 *      nobody has to create an OAuth app by hand.
 *   4. The person signs in at the authorization server, with PKCE (S256) and the
 *      `resource` indicator (RFC 8707) binding the token to this one server.
 *   5. The code is exchanged; the refresh token keeps the connection alive.
 *
 * The person types a URL and presses one button. That is the whole point.
 *
 * ── WHAT THIS MODULE DOES NOT DO ────────────────────────────────────────────
 * Store anything. Tokens are credentials and each service stores them on its own
 * terms — the API in `encrypted_secrets`, the worker in `connection_oauth_tokens`
 * (HTTP-TOOLS.md §5 on why the worker owns that one table). This file is the
 * protocol: it takes values in and hands values back, and never logs one.
 *
 * ── ERRORS NEVER CARRY A CREDENTIAL ─────────────────────────────────────────
 * An authorization server's error body is echoed as its OAuth `error` code and a
 * sanitized, length-capped description — never as the raw body, which on a
 * misbehaving server can contain the very token or code that was sent.
 */
class McpOAuth(private val transport: McpTransport) {

    private val mapper = ObjectMapper()

    class McpOAuthException(message: String, val code: String = "OAUTH_FAILED") : RuntimeException(message)

    data class ProtectedResource(
        /** The canonical resource identifier to bind tokens to. */
        val resource: String,
        val authorizationServers: List<String>,
        val scopesSupported: List<String>,
    )

    data class AuthorizationServer(
        val issuer: String,
        val authorizationEndpoint: String,
        val tokenEndpoint: String,
        val registrationEndpoint: String?,
        val scopesSupported: List<String>,
        val codeChallengeMethods: List<String>,
        val tokenEndpointAuthMethods: List<String>,
    )

    /** Everything needed to send a person to sign in. */
    data class Discovery(
        val resource: String,
        val authorizationServer: AuthorizationServer,
        /** Space-separated, or null to let the server pick its default. */
        val scope: String?,
    )

    data class ClientRegistration(
        val clientId: String,
        /** Present only when the server issued a confidential client. */
        val clientSecret: String?,
        /** `none`, `client_secret_basic` or `client_secret_post`. */
        val tokenEndpointAuthMethod: String,
    )

    data class Pkce(val verifier: String, val challenge: String)

    data class TokenSet(
        val accessToken: String,
        val refreshToken: String?,
        /** Epoch millis, or null when the server did not say. */
        val expiresAtMs: Long?,
        val scope: String?,
    )

    // ── Discovery ────────────────────────────────────────────────────────────

    /**
     * Find out how to sign in to [serverUrl].
     *
     * [challenge] is what the server's 401 said, when there was one. Its
     * `resource_metadata` is tried first because it is authoritative; the
     * well-known paths are the fallback the specification names for servers that
     * do not send it.
     *
     * A server that publishes no protected-resource metadata at all is handled
     * as the 2025-03-26 revision described: the authorization server is the MCP
     * server's own origin. That revision is still widely deployed.
     */
    fun discover(serverUrl: String, challenge: McpClient.AuthChallenge?): Discovery {
        val server = parseHttpUrl(serverUrl, "server URL")

        val prm = protectedResourceCandidates(server, challenge?.resourceMetadata)
            .firstNotNullOfOrNull { url -> fetchJson(url)?.let { toProtectedResource(it, server) } }

        val issuers = prm?.authorizationServers?.takeIf { it.isNotEmpty() }
            ?: listOf(originOf(server))

        val authServer = issuers.firstNotNullOfOrNull { issuer -> authorizationServerFor(issuer) }
            ?: legacyDefaults(server).takeIf { prm == null }
            ?: throw McpOAuthException(
                "The MCP server asks for sign-in, but its authorization server does not publish " +
                "OAuth metadata, so Vectorbea cannot find where to send you. Ask the server's " +
                "owner for an access token and paste it instead.",
                code = "OAUTH_METADATA_MISSING",
            )

        if (authServer.codeChallengeMethods.isNotEmpty() && "S256" !in authServer.codeChallengeMethods) {
            throw McpOAuthException(
                "The server's sign-in does not support PKCE with S256, which MCP requires. " +
                "Vectorbea will not use a weaker flow.",
                code = "OAUTH_PKCE_UNSUPPORTED",
            )
        }

        val resource = prm?.resource ?: canonicalResource(serverUrl)
        val scope = challenge?.scope?.takeIf { it.isNotBlank() }
            ?: prm?.scopesSupported?.takeIf { it.isNotEmpty() }?.joinToString(" ")
        return Discovery(resource, authServer, scope)
    }

    /**
     * Register Vectorbea as a client of this authorization server.
     *
     * Public client (`token_endpoint_auth_method: none`) by preference: the
     * security comes from PKCE, and a client secret we did not need is one more
     * credential to hold. A server that insists on issuing one gets it stored
     * alongside the tokens and used.
     */
    fun registerClient(authServer: AuthorizationServer, redirectUri: String, clientName: String): ClientRegistration {
        val endpoint = authServer.registrationEndpoint ?: throw McpOAuthException(
            "The server's sign-in does not allow Vectorbea to register itself, so it needs an " +
            "OAuth client created by hand. Paste an access token instead, or ask the server's " +
            "owner to enable dynamic client registration.",
            code = "OAUTH_REGISTRATION_UNSUPPORTED",
        )
        val authMethod = when {
            authServer.tokenEndpointAuthMethods.isEmpty() -> "none"
            "none" in authServer.tokenEndpointAuthMethods -> "none"
            "client_secret_basic" in authServer.tokenEndpointAuthMethods -> "client_secret_basic"
            else -> "client_secret_post"
        }
        val body = mapper.writeValueAsString(mapOf(
            "client_name" to clientName,
            "redirect_uris" to listOf(redirectUri),
            "grant_types" to listOf("authorization_code", "refresh_token"),
            "response_types" to listOf("code"),
            "token_endpoint_auth_method" to authMethod,
        ))
        val response = post(endpoint, body, "application/json")
        val json = jsonOrThrow(response, "register with the server's sign-in")
        val clientId = json["client_id"]?.asText()?.takeIf { it.isNotBlank() }
            ?: throw McpOAuthException("The server accepted the registration but returned no client id.")
        val secret = json["client_secret"]?.asText()?.takeIf { it.isNotBlank() }
        return ClientRegistration(
            clientId = clientId,
            clientSecret = secret,
            tokenEndpointAuthMethod = json["token_endpoint_auth_method"]?.asText()
                ?.takeIf { it.isNotBlank() } ?: if (secret == null) "none" else authMethod,
        )
    }

    fun authorizationUrl(
        discovery: Discovery,
        client: ClientRegistration,
        redirectUri: String,
        state: String,
        pkce: Pkce,
    ): String {
        val params = linkedMapOf(
            "response_type" to "code",
            "client_id" to client.clientId,
            "redirect_uri" to redirectUri,
            "state" to state,
            "code_challenge" to pkce.challenge,
            "code_challenge_method" to "S256",
            "resource" to discovery.resource,
        )
        discovery.scope?.let { params["scope"] = it }
        val base = discovery.authorizationServer.authorizationEndpoint
        val joiner = if (base.contains('?')) "&" else "?"
        return base + joiner + form(params)
    }

    fun exchangeCode(
        tokenEndpoint: String,
        client: ClientRegistration,
        code: String,
        verifier: String,
        redirectUri: String,
        resource: String,
    ): TokenSet = token(tokenEndpoint, client, linkedMapOf(
        "grant_type" to "authorization_code",
        "code" to code,
        "redirect_uri" to redirectUri,
        "code_verifier" to verifier,
        "resource" to resource,
    ), what = "finish signing in")

    /**
     * Trade a refresh token for a new access token.
     *
     * The returned [TokenSet.refreshToken] is null when the server did not rotate
     * it — callers keep the one they sent. When it is present, the one they sent
     * is already dead on a rotating server, which is why callers must persist
     * the new one before using the access token for anything.
     */
    fun refresh(
        tokenEndpoint: String,
        client: ClientRegistration,
        refreshToken: String,
        resource: String?,
        scope: String?,
    ): TokenSet {
        val params = linkedMapOf("grant_type" to "refresh_token", "refresh_token" to refreshToken)
        resource?.let { params["resource"] = it }
        scope?.let { params["scope"] = it }
        return token(tokenEndpoint, client, params, what = "refresh the sign-in")
    }

    // ── Internals ────────────────────────────────────────────────────────────

    private fun token(
        tokenEndpoint: String,
        client: ClientRegistration,
        params: LinkedHashMap<String, String>,
        what: String,
    ): TokenSet {
        val headers = mutableMapOf<String, String>()
        when {
            client.clientSecret != null && client.tokenEndpointAuthMethod == "client_secret_basic" -> {
                val raw = "${enc(client.clientId)}:${enc(client.clientSecret)}"
                headers["Authorization"] = "Basic " + Base64.getEncoder().encodeToString(raw.toByteArray())
            }
            client.clientSecret != null -> {
                params["client_id"] = client.clientId
                params["client_secret"] = client.clientSecret
            }
            else -> params["client_id"] = client.clientId
        }
        val response = post(tokenEndpoint, form(params), "application/x-www-form-urlencoded", headers)
        val json = jsonOrThrow(response, what)
        val access = json["access_token"]?.asText()?.takeIf { it.isNotBlank() }
            ?: throw McpOAuthException("The server's sign-in answered without an access token.")
        val expiresIn = json["expires_in"]?.takeIf { it.isNumber || it.isTextual }?.asText()?.toLongOrNull()
        return TokenSet(
            accessToken = access,
            refreshToken = json["refresh_token"]?.asText()?.takeIf { it.isNotBlank() },
            expiresAtMs = expiresIn?.takeIf { it > 0 }?.let { System.currentTimeMillis() + it * 1_000 },
            scope = json["scope"]?.asText()?.takeIf { it.isNotBlank() },
        )
    }

    private fun authorizationServerFor(issuer: String): AuthorizationServer? {
        val uri = runCatching { parseHttpUrl(issuer, "authorization server") }.getOrNull() ?: return null
        return authorizationServerCandidates(uri).firstNotNullOfOrNull { url ->
            fetchJson(url)?.let { toAuthorizationServer(it, issuer) }
        }
    }

    private fun toProtectedResource(json: JsonNode, server: URI): ProtectedResource? {
        val servers = strings(json["authorization_servers"])
        if (servers.isEmpty() && json["resource"] == null) return null
        return ProtectedResource(
            resource = json["resource"]?.asText()?.takeIf { it.isNotBlank() } ?: canonicalResource(server.toString()),
            authorizationServers = servers.filter { it.startsWith("https://") || isLoopbackHttp(it) },
            scopesSupported = strings(json["scopes_supported"]),
        )
    }

    private fun toAuthorizationServer(json: JsonNode, issuer: String): AuthorizationServer? {
        val authorize = json["authorization_endpoint"]?.asText()?.takeIf { secureEndpoint(it) } ?: return null
        val token = json["token_endpoint"]?.asText()?.takeIf { secureEndpoint(it) } ?: return null
        return AuthorizationServer(
            issuer = json["issuer"]?.asText()?.takeIf { it.isNotBlank() } ?: issuer,
            authorizationEndpoint = authorize,
            tokenEndpoint = token,
            registrationEndpoint = json["registration_endpoint"]?.asText()?.takeIf { secureEndpoint(it) },
            scopesSupported = strings(json["scopes_supported"]),
            codeChallengeMethods = strings(json["code_challenge_methods_supported"]),
            tokenEndpointAuthMethods = strings(json["token_endpoint_auth_methods_supported"]),
        )
    }

    /** The 2025-03-26 fallback: conventional paths on the server's own origin. */
    private fun legacyDefaults(server: URI): AuthorizationServer {
        val origin = originOf(server)
        return AuthorizationServer(
            issuer = origin,
            authorizationEndpoint = "$origin/authorize",
            tokenEndpoint = "$origin/token",
            registrationEndpoint = "$origin/register",
            scopesSupported = emptyList(),
            codeChallengeMethods = emptyList(),
            tokenEndpointAuthMethods = emptyList(),
        )
    }

    /** GET a JSON document; null for anything that is not a 2xx JSON object. */
    private fun fetchJson(url: String): JsonNode? {
        val request = runCatching {
            HttpRequest.newBuilder().uri(URI.create(url))
                .header("Accept", "application/json")
                .header("MCP-Protocol-Version", McpClient.PROTOCOL_VERSION)
                .GET().build()
        }.getOrNull() ?: return null
        val response = runCatching { transport.send(request, METADATA_TIMEOUT_MS, MAX_METADATA_BYTES) }.getOrNull()
            ?: return null
        if (response.statusCode !in 200..299) return null
        return runCatching { mapper.readTree(response.body) }.getOrNull()?.takeIf { it.isObject }
    }

    private fun post(url: String, body: String, contentType: String, headers: Map<String, String> = emptyMap()): McpTransport.Response {
        val builder = HttpRequest.newBuilder().uri(URI.create(url))
            .header("Content-Type", contentType)
            .header("Accept", "application/json")
            .POST(HttpRequest.BodyPublishers.ofString(body))
        headers.forEach { (k, v) -> builder.header(k, v) }
        return try {
            transport.send(builder.build(), METADATA_TIMEOUT_MS, MAX_METADATA_BYTES)
        } catch (e: Exception) {
            throw McpOAuthException(
                "Could not reach the server's sign-in (${e.javaClass.simpleName}).",
                code = "OAUTH_UNREACHABLE",
            )
        }
    }

    private fun jsonOrThrow(response: McpTransport.Response, what: String): JsonNode {
        val json = runCatching { mapper.readTree(response.body) }.getOrNull()
        if (response.statusCode in 200..299 && json != null && json.isObject) return json
        val error = json?.get("error")?.asText()?.let { McpSanitizer.name(it) }
        val description = McpSanitizer.text(json?.get("error_description")?.asText(), 200)
        val detail = listOfNotNull(error, description).joinToString(": ").ifBlank { "HTTP ${response.statusCode}" }
        throw McpOAuthException(
            "Could not $what ($detail).",
            code = if (error == "invalid_grant") "OAUTH_INVALID_GRANT" else "OAUTH_FAILED",
        )
    }

    private fun strings(node: JsonNode?): List<String> =
        (node as? com.fasterxml.jackson.databind.node.ArrayNode)
            ?.mapNotNull { it.asText()?.takeIf { s -> s.isNotBlank() } } ?: emptyList()

    companion object {
        const val METADATA_TIMEOUT_MS = 10_000L
        const val MAX_METADATA_BYTES = 262_144L

        /** A token this close to expiry is refreshed before use rather than after a 401. */
        const val REFRESH_SKEW_MS = 60_000L

        private val random = SecureRandom()

        fun pkce(): Pkce {
            val verifier = randomToken(48)
            val challenge = Base64.getUrlEncoder().withoutPadding().encodeToString(
                MessageDigest.getInstance("SHA-256").digest(verifier.toByteArray(Charsets.US_ASCII)))
            return Pkce(verifier, challenge)
        }

        /** URL-safe, unpadded, from [bytes] of SecureRandom. */
        fun randomToken(bytes: Int = 32): String {
            val buf = ByteArray(bytes).also { random.nextBytes(it) }
            return Base64.getUrlEncoder().withoutPadding().encodeToString(buf)
        }

        /**
         * RFC 8707's canonical form of the server URL: scheme and host lowercase,
         * no fragment, no query, no trailing slash on the path.
         */
        fun canonicalResource(serverUrl: String): String {
            val uri = URI.create(serverUrl.trim())
            val port = if (uri.port == -1) "" else ":${uri.port}"
            val path = (uri.rawPath ?: "").trimEnd('/')
            return "${uri.scheme.lowercase()}://${uri.host.lowercase()}$port$path"
        }

        /**
         * RFC 9728 §3: the well-known segment goes BETWEEN the host and the path.
         * The root form is tried after, because many servers publish only that.
         */
        fun protectedResourceCandidates(server: URI, fromHeader: String?): List<String> {
            val origin = originOf(server)
            val path = (server.rawPath ?: "").trimEnd('/')
            return listOfNotNull(
                fromHeader,
                if (path.isNotEmpty()) "$origin/.well-known/oauth-protected-resource$path" else null,
                "$origin/.well-known/oauth-protected-resource",
            ).distinct()
        }

        /** RFC 8414 first, then OpenID Connect discovery, path-aware in both. */
        fun authorizationServerCandidates(issuer: URI): List<String> {
            val origin = originOf(issuer)
            val path = (issuer.rawPath ?: "").trimEnd('/')
            return if (path.isEmpty()) listOf(
                "$origin/.well-known/oauth-authorization-server",
                "$origin/.well-known/openid-configuration",
            ) else listOf(
                "$origin/.well-known/oauth-authorization-server$path",
                "$origin/.well-known/openid-configuration$path",
                "$origin$path/.well-known/openid-configuration",
            )
        }

        fun originOf(uri: URI): String {
            val port = if (uri.port == -1) "" else ":${uri.port}"
            return "${uri.scheme.lowercase()}://${uri.host.lowercase()}$port"
        }

        private fun parseHttpUrl(raw: String, what: String): URI {
            val uri = runCatching { URI.create(raw.trim()) }.getOrNull()
            if (uri?.scheme == null || uri.host == null || uri.scheme.lowercase() !in setOf("https", "http")) {
                throw McpOAuthException("The $what is not a valid http(s) URL.", code = "INVALID_URL")
            }
            return uri
        }

        /** OAuth endpoints must be https. Loopback http is allowed, for local development only. */
        private fun secureEndpoint(url: String): Boolean =
            url.startsWith("https://") || isLoopbackHttp(url)

        private fun isLoopbackHttp(url: String): Boolean = runCatching {
            val u = URI.create(url)
            u.scheme == "http" && (u.host == "localhost" || u.host == "127.0.0.1")
        }.getOrDefault(false)

        private fun enc(value: String): String = URLEncoder.encode(value, Charsets.UTF_8)

        private fun form(params: Map<String, String>): String =
            params.entries.joinToString("&") { (k, v) -> "${enc(k)}=${enc(v)}" }
    }
}
