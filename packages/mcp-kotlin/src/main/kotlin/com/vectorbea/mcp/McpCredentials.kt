package com.vectorbea.mcp

import org.slf4j.LoggerFactory
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap

/**
 * A usable credential for an MCP connection, refreshed when it needs to be.
 *
 * ── WHY THIS IS SHARED ──────────────────────────────────────────────────────
 * Both services spend these tokens — the API when somebody presses Discover, the
 * worker on every tool call — and a sign-in that lasts an hour has to keep
 * working for months in both. If each service decided on its own when a token
 * was stale and how to refresh it, the first disagreement would be a connection
 * that discovers fine and fails every run, which is precisely the gap between
 * "we found your tools" and "your agents can use them" that this feature has to
 * close.
 *
 * ── STORAGE IS THE CALLER'S ─────────────────────────────────────────────────
 * [Store] is the one thing that differs. The connection's own secret holds the
 * credential as of sign-in; a refreshed one is written to
 * `connection_oauth_tokens`, encrypted with the same workspace-bound AES-GCM
 * (V064 on why that table exists: providers rotate refresh tokens, and a token
 * kept only in memory is a reconnect prompt after every deploy).
 *
 * ── ONE REFRESH AT A TIME, PER CONNECTION ───────────────────────────────────
 * Eight tool calls starting at once against an expired token would otherwise
 * issue eight refreshes, and on a rotating server seven of them spend a refresh
 * token the first one already retired — so the herd does not merely waste
 * requests, it breaks the connection. The monitor serialises refreshes inside a
 * process, and every holder re-reads the store after acquiring it, so a refresh
 * another process has just persisted is picked up rather than repeated.
 */
class McpCredentials(
    private val oauth: McpOAuth,
    private val store: Store,
) {
    private val log = LoggerFactory.getLogger(McpCredentials::class.java)
    private val locks = ConcurrentHashMap<UUID, Any>()

    interface Store {
        /** The most recently refreshed credential for this connection, if one was persisted. */
        fun loadRefreshed(workspaceId: UUID, connectionId: UUID): McpCredential.OAuth?

        /** Persist a refreshed credential. Must not throw: the caller holds a valid token. */
        fun saveRefreshed(workspaceId: UUID, connectionId: UUID, credential: McpCredential.OAuth)
    }

    class ReauthorizationRequired(message: String) : RuntimeException(message)

    /**
     * The credential to send, given what the connection's secret holds.
     *
     * A bearer token and "no credential" pass through untouched. An OAuth
     * credential is replaced by a newer persisted one if there is one, and
     * refreshed if it is about to expire.
     */
    fun current(workspaceId: UUID, connectionId: UUID, fromSecret: McpCredential?): McpCredential? {
        if (fromSecret !is McpCredential.OAuth) return fromSecret
        val newest = store.loadRefreshed(workspaceId, connectionId) ?: fromSecret
        if (!newest.needsRefresh()) return newest
        return refresh(workspaceId, connectionId, fromSecret, stale = newest)
    }

    /**
     * Refresh after the server refused a token we believed was valid.
     *
     * Expiry is only the server's promise; a token revoked early, or one whose
     * `expires_in` was never sent, is discovered by a 401. Returns null when there
     * is nothing to refresh with — the caller reports that the server needs
     * signing in to again.
     */
    fun afterRejection(
        workspaceId: UUID,
        connectionId: UUID,
        fromSecret: McpCredential?,
        rejected: McpCredential?,
    ): McpCredential.OAuth? {
        if (fromSecret !is McpCredential.OAuth || rejected !is McpCredential.OAuth) return null
        return runCatching { refresh(workspaceId, connectionId, fromSecret, stale = rejected) }
            .getOrElse { null }
    }

    private fun refresh(
        workspaceId: UUID,
        connectionId: UUID,
        fromSecret: McpCredential.OAuth,
        stale: McpCredential.OAuth,
    ): McpCredential.OAuth {
        synchronized(locks.computeIfAbsent(connectionId) { Any() }) {
            /* Somebody may have refreshed while we waited — this process or
               another. If what is stored now is not the token we found stale,
               it is newer, and spending our refresh token would retire theirs. */
            val stored = store.loadRefreshed(workspaceId, connectionId) ?: fromSecret
            if (stored.accessToken != stale.accessToken && !stored.needsRefresh()) return stored

            val refreshToken = stored.refreshToken ?: throw ReauthorizationRequired(
                "The sign-in to this MCP server has expired and it issued no refresh token. " +
                "Sign in to the server again from its connection.")
            val tokens = try {
                oauth.refresh(stored.tokenEndpoint, stored.client, refreshToken, stored.resource, null)
            } catch (e: McpOAuth.McpOAuthException) {
                log.warn("[mcp-oauth] refresh failed for connection {}: {}", connectionId, e.code)
                throw ReauthorizationRequired(
                    if (e.code == "OAUTH_INVALID_GRANT")
                        "The sign-in to this MCP server was revoked or has expired. Sign in to the " +
                        "server again from its connection."
                    else e.message ?: "The sign-in to this MCP server could not be refreshed.")
            }
            val next = stored.refreshed(tokens)
            /* Persisted BEFORE it is returned. On a rotating server the refresh
               token we just spent is already dead; if we used the new access
               token and crashed before saving, the connection would be gone. */
            store.saveRefreshed(workspaceId, connectionId, next)
            log.info("[mcp-oauth] refreshed connection {} (rotated={})", connectionId, tokens.refreshToken != null)
            return next
        }
    }

    companion object {
        /** The token string to send, for any credential shape. */
        fun tokenOf(credential: McpCredential?): String? = when (credential) {
            is McpCredential.Bearer -> credential.token
            is McpCredential.OAuth -> credential.accessToken
            null -> null
        }
    }
}
