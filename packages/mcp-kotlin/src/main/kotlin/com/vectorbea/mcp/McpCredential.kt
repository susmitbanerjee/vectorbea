package com.vectorbea.mcp

import com.fasterxml.jackson.databind.ObjectMapper

/**
 * What an MCP connection's secret holds, read the same way by both services.
 *
 * ── TWO SHAPES, ONE COLUMN ──────────────────────────────────────────────────
 * A connection's secret was always a bare bearer token. A server connected by
 * signing in needs more than a token to stay connected — the refresh token, and
 * the client id and token endpoint to spend it at — so that secret is now a JSON
 * document with `"kind": "mcp_oauth"`. Everything else is a bearer token, exactly
 * as before, which is what keeps every connection created before this file
 * working without a migration.
 *
 * The split is on DATA, not on a flag — the same call `ToolNodeExecutor` makes
 * for spec-driven HTTP tools. A connection only holds an OAuth document if
 * somebody signed in to create it.
 *
 * ── NEVER IN CONFIG, NEVER IN A LOG ─────────────────────────────────────────
 * Invariant 14's rule for HTTP tools applies unchanged: a credential never
 * appears in `config_json`. The client id is not secret in OAuth's terms and is
 * still kept here, beside the tokens it is used with, so there is exactly one
 * place a connection's authentication lives. [toString] is overridden so an
 * accidental log line prints nothing useful.
 */
sealed class McpCredential {

    /** A token somebody pasted. Used as-is, never refreshed. */
    class Bearer(val token: String) : McpCredential() {
        override fun toString() = "McpCredential.Bearer(***)"
    }

    class OAuth(
        val accessToken: String,
        val refreshToken: String?,
        val expiresAtMs: Long?,
        val tokenEndpoint: String,
        val clientId: String,
        val clientSecret: String?,
        val tokenEndpointAuthMethod: String,
        val resource: String?,
        val scope: String?,
        val issuer: String?,
    ) : McpCredential() {

        val client: McpOAuth.ClientRegistration
            get() = McpOAuth.ClientRegistration(clientId, clientSecret, tokenEndpointAuthMethod)

        /** True when the access token should be refreshed before it is spent. */
        fun needsRefresh(nowMs: Long = System.currentTimeMillis()): Boolean =
            expiresAtMs != null && nowMs >= expiresAtMs - McpOAuth.REFRESH_SKEW_MS

        /** This credential after a refresh. A refresh token the server did not rotate is kept. */
        fun refreshed(tokens: McpOAuth.TokenSet): OAuth = OAuth(
            accessToken = tokens.accessToken,
            refreshToken = tokens.refreshToken ?: refreshToken,
            expiresAtMs = tokens.expiresAtMs,
            tokenEndpoint = tokenEndpoint,
            clientId = clientId,
            clientSecret = clientSecret,
            tokenEndpointAuthMethod = tokenEndpointAuthMethod,
            resource = resource,
            scope = tokens.scope ?: scope,
            issuer = issuer,
        )

        fun toJson(): String = mapper.writeValueAsString(linkedMapOf(
            "kind" to KIND,
            "accessToken" to accessToken,
            "refreshToken" to refreshToken,
            "expiresAtMs" to expiresAtMs,
            "tokenEndpoint" to tokenEndpoint,
            "clientId" to clientId,
            "clientSecret" to clientSecret,
            "tokenEndpointAuthMethod" to tokenEndpointAuthMethod,
            "resource" to resource,
            "scope" to scope,
            "issuer" to issuer,
        ).filterValues { it != null })

        override fun toString() = "McpCredential.OAuth(issuer=$issuer, expiresAtMs=$expiresAtMs, ***)"
    }

    companion object {
        const val KIND = "mcp_oauth"
        private val mapper = ObjectMapper()

        /** Null for a blank secret — an unauthenticated server. */
        fun parse(plaintext: String?): McpCredential? {
            val raw = plaintext?.trim()?.takeIf { it.isNotEmpty() } ?: return null
            if (!raw.startsWith("{")) return Bearer(raw)
            val node = runCatching { mapper.readTree(raw) }.getOrNull()
            if (node == null || node["kind"]?.asText() != KIND) return Bearer(raw)
            fun str(name: String) = node[name]?.takeIf { !it.isNull }?.asText()?.takeIf { it.isNotBlank() }
            val access = str("accessToken") ?: return null
            val endpoint = str("tokenEndpoint") ?: return null
            val clientId = str("clientId") ?: return null
            return OAuth(
                accessToken = access,
                refreshToken = str("refreshToken"),
                expiresAtMs = node["expiresAtMs"]?.takeIf { it.isNumber }?.asLong(),
                tokenEndpoint = endpoint,
                clientId = clientId,
                clientSecret = str("clientSecret"),
                tokenEndpointAuthMethod = str("tokenEndpointAuthMethod") ?: "none",
                resource = str("resource"),
                scope = str("scope"),
                issuer = str("issuer"),
            )
        }

        fun fromSignIn(
            discovery: McpOAuth.Discovery,
            client: McpOAuth.ClientRegistration,
            tokens: McpOAuth.TokenSet,
        ): OAuth = OAuth(
            accessToken = tokens.accessToken,
            refreshToken = tokens.refreshToken,
            expiresAtMs = tokens.expiresAtMs,
            tokenEndpoint = discovery.authorizationServer.tokenEndpoint,
            clientId = client.clientId,
            clientSecret = client.clientSecret,
            tokenEndpointAuthMethod = client.tokenEndpointAuthMethod,
            resource = discovery.resource,
            scope = tokens.scope ?: discovery.scope,
            issuer = discovery.authorizationServer.issuer,
        )
    }
}
