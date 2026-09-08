package com.vectorbea.worker.tools.http

import com.fasterxml.jackson.databind.ObjectMapper
import com.vectorbea.worker.connector.SecretService
import com.vectorbea.worker.logging.logger
import java.sql.Timestamp
import java.time.Instant
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import javax.sql.DataSource

/**
 * Where an OAuth2 access token lives between the call that minted it and the
 * call that spends it.
 *
 * ── WHY A TOKEN CACHE IS NOT AN OPTIMISATION ────────────────────────────────
 * Without one, every tool call is two calls: a token request and the request the
 * agent asked for. An agent loop of eight iterations against one API becomes
 * sixteen requests, half of them to a token endpoint whose rate limits are
 * invariably tighter than the API's — so the first thing a busy agent does is
 * throttle its own authentication. Providers also bill token issuance against
 * quota, and some (Salesforce, notably) cap concurrent sessions per user.
 *
 * ── THE KEY IS THE CONNECTION, NEVER THE TOOL ───────────────────────────────
 * Ten tools on one connection share one token by construction. Keying by tool
 * would mint ten tokens for one credential — the concurrent-session cap above,
 * hit immediately — and would leave nine of them to expire unused.
 *
 * Workspace is in the key too. It is redundant (a connection id belongs to
 * exactly one workspace) and it stays because an in-memory map keyed on
 * something a caller supplies is precisely where a cross-tenant bug hides, and
 * invariant 8 is that such a bug should be impossible rather than absent.
 *
 * ── WHY IT IS ALSO ON DISK, FOR ONE OF THE TWO GRANTS ───────────────────────
 * Client credentials are re-mintable from a secret we hold, so losing the cache
 * on deploy costs one extra token request. An AUTHORIZATION-CODE refresh token
 * is not: many providers ROTATE it, returning a new refresh token with each
 * refresh and invalidating the old one. Keeping that only in memory means the
 * next process refreshes with a token the provider has already retired, the
 * refresh fails, and a user who connected the integration months ago is told to
 * reconnect — for no reason except a restart.
 *
 * So the rotated material is written to `connection_oauth_tokens`, encrypted
 * with the same workspace-bound AES-GCM the rest of the product uses (V064).
 * Client-credentials tokens are memory-only: writing a re-mintable value to a
 * table is more places for a live credential to sit, for no benefit.
 */
class OAuth2TokenStore(
    private val dataSource: DataSource?,
    private val secretService: SecretService?,
) {
    private val log = logger()
    private val mapper = ObjectMapper()

    /** In-memory tokens, keyed as described above. */
    private val cache = ConcurrentHashMap<Key, Entry>()

    /**
     * One in-flight refresh per key.
     *
     * Without this, eight agent iterations starting at once against an expired
     * token issue eight refreshes. With a rotating refresh token, seven of them
     * are then using a retired token and fail — so the herd does not merely waste
     * requests, it breaks the connection. The lock is per key so two connections
     * never wait on each other.
     */
    private val locks = ConcurrentHashMap<Key, Any>()

    data class Key(
        val workspaceId: UUID,
        val connectionId: UUID,
        val scopes: String,
        val audience: String?,
    )

    data class Entry(
        val accessToken: String,
        /** Epoch millis. Null when the provider did not say. */
        val expiresAtMs: Long?,
        val refreshToken: String? = null,
    ) {
        fun isFresh(skewSeconds: Long): Boolean {
            val exp = expiresAtMs ?: return true
            return System.currentTimeMillis() < exp - skewSeconds * 1_000
        }
    }

    fun cached(key: Key, skewSeconds: Long): Entry? =
        cache[key]?.takeIf { it.isFresh(skewSeconds) }

    fun put(key: Key, entry: Entry) {
        cache[key] = entry
    }

    fun invalidate(key: Key) {
        cache.remove(key)
    }

    /** The per-key monitor. Callers synchronise on it around a refresh. */
    fun lockFor(key: Key): Any = locks.computeIfAbsent(key) { Any() }

    // ── Durable half, for rotating refresh tokens ────────────────────────────

    /**
     * Read the persisted token for an authorization-code connection.
     *
     * Returns null on ANY failure — a missing table, a decryption error, a
     * workspace mismatch. The caller then falls back to the refresh token in the
     * connection's own secret, which is where it was before this table existed.
     * A token cache that can fail a tool call is worse than no token cache.
     */
    fun loadPersisted(workspaceId: UUID, connectionId: UUID): Entry? {
        val ds = dataSource ?: return null
        val secrets = secretService ?: return null
        return try {
            ds.connection.use { conn ->
                conn.prepareStatement(
                    """SELECT token_ciphertext, expires_at
                       FROM connection_oauth_tokens
                       WHERE workspace_id = ? AND connection_id = ?"""
                ).use { stmt ->
                    stmt.setObject(1, workspaceId)
                    stmt.setObject(2, connectionId)
                    stmt.executeQuery().use { rs ->
                        if (!rs.next()) return@use null
                        val plaintext = secrets.openForWorkspace(
                            rs.getString("token_ciphertext"), workspaceId
                        ) ?: return@use null
                        val node = mapper.readTree(plaintext)
                        Entry(
                            accessToken = node.path("accessToken").asText(""),
                            expiresAtMs = rs.getTimestamp("expires_at")?.time,
                            refreshToken = node.get("refreshToken")?.asText()?.takeIf { it.isNotBlank() },
                        ).takeIf { it.accessToken.isNotBlank() || it.refreshToken != null }
                    }
                }
            }
        } catch (e: Exception) {
            log.debug("[oauth] persisted token unavailable [connection={}]: {}",
                connectionId, e.javaClass.simpleName)
            null
        }
    }

    /**
     * Persist a refreshed token, replacing whatever was there.
     *
     * Best-effort: a failure is logged and swallowed, because the call that
     * triggered the refresh has a valid token in hand and must not be failed for
     * a bookkeeping problem. The cost of the failure is one extra refresh next
     * time — unless the provider rotates, in which case the log line is the
     * thing that explains the reconnect prompt a week later, which is why it is
     * a warning rather than a debug.
     */
    fun persist(workspaceId: UUID, connectionId: UUID, entry: Entry) {
        val ds = dataSource ?: return
        val secrets = secretService ?: return
        try {
            val payload = mapper.createObjectNode().apply {
                put("accessToken", entry.accessToken)
                entry.refreshToken?.let { put("refreshToken", it) }
            }
            val sealed = secrets.sealForWorkspace(mapper.writeValueAsString(payload), workspaceId)
                ?: return
            ds.connection.use { conn ->
                conn.prepareStatement(
                    """INSERT INTO connection_oauth_tokens
                           (workspace_id, connection_id, token_ciphertext, expires_at, updated_at)
                       VALUES (?, ?, ?, ?, now())
                       ON CONFLICT (workspace_id, connection_id) DO UPDATE
                           SET token_ciphertext = EXCLUDED.token_ciphertext,
                               expires_at       = EXCLUDED.expires_at,
                               updated_at       = now()"""
                ).use { stmt ->
                    stmt.setObject(1, workspaceId)
                    stmt.setObject(2, connectionId)
                    stmt.setString(3, sealed)
                    stmt.setTimestamp(4, entry.expiresAtMs?.let { Timestamp.from(Instant.ofEpochMilli(it)) })
                    stmt.executeUpdate()
                }
            }
        } catch (e: Exception) {
            log.warn(
                "[oauth] could not persist refreshed token [connection={}]: {} — {}. " +
                    "If this provider rotates refresh tokens, the connection will need reconnecting.",
                connectionId, e.javaClass.simpleName, e.message?.take(120)
            )
        }
    }

    companion object {
        /** A process-wide store. One cache per JVM is the point of the cache. */
        @Volatile
        private var shared: OAuth2TokenStore? = null

        fun shared(dataSource: DataSource?, secretService: SecretService?): OAuth2TokenStore =
            shared ?: synchronized(this) {
                shared ?: OAuth2TokenStore(dataSource, secretService).also { shared = it }
            }

        /** Test seam. Drops the process-wide instance. */
        fun resetForTests() {
            synchronized(this) { shared = null }
        }
    }
}
