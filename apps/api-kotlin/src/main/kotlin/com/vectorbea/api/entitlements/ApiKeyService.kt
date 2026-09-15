package com.vectorbea.api.entitlements

import com.vectorbea.api.errors.ApiError
import org.slf4j.LoggerFactory
import java.security.MessageDigest
import java.security.SecureRandom
import java.time.Instant
import java.util.UUID
import javax.sql.DataSource

/**
 * Workspace-scoped API credentials.
 *
 * ── AN API KEY IS NOT A WAY AROUND A UI LIMIT ───────────────────────────────
 * And it manages that WITHOUT a single API-specific check, which is the part
 * worth understanding.
 *
 * A key names a WORKSPACE. Every entitlement method takes a workspace and has no
 * parameter for a user, so a request authenticated by a key resolves the same
 * plan, the same quota, the same concurrency ceiling and the same feature gates
 * as the identical request from the browser. There is no second enforcement path
 * that could fall behind the first, because there is no second path at all — the
 * key produces a `RequestContext` and everything downstream is unchanged.
 *
 * The one thing a key DOES carry is [acts_as_user_id]. That is not a bypass, it
 * is the opposite: a guest who mints a key is still charged against their own
 * member spend cap, so "make an API key" is not an escape from the budget their
 * host set. A key with no actor is charged to the workspace and to nobody's cap,
 * which is why only an admin may create one of those.
 *
 * ── THE SECRET IS NEVER STORED ──────────────────────────────────────────────
 * Only SHA-256 of it. `prefix` — the first 12 characters — is kept in clear so a
 * key can be identified in a list and in a log without being usable. There is no
 * "show key again": losing it means minting another, which is the right trade
 * for a credential that can spend money.
 *
 * SHA-256 and not bcrypt/argon2, deliberately. Those exist to make a slow attack
 * on a LOW-ENTROPY human password expensive. This is 32 bytes from
 * `SecureRandom`; there is nothing to brute-force, and a deliberately slow hash
 * on the authentication path of every API request would be a self-inflicted
 * denial of service.
 */
class ApiKeyService(
    private val dataSource: DataSource,
    private val guard: EntitlementGuard? = null,
) {
    private val log = LoggerFactory.getLogger(ApiKeyService::class.java)

    /** A key, as it exists after authentication. Never carries the secret. */
    data class ResolvedKey(
        val id: UUID,
        val workspaceId: UUID,
        val actsAsUserId: UUID?,
        val name: String,
        /**
         * This key's own ceiling, or null to be held only to the plan's.
         *
         * Carried out of `authenticate` rather than looked up again at the rate
         * check: a second read could see a different row, and a limit that
         * disagrees with the identity it was resolved with is worse than no
         * limit at all.
         */
        val rateLimitPerMinute: Int? = null,
    )

    data class Created(
        val id: UUID,
        val name: String,
        val prefix: String,
        /** The ONLY time the caller ever sees this. */
        val secret: String,
        val expiresAt: Instant?,
    )

    // ── Minting ───────────────────────────────────────────────────────────────

    /**
     * Create a key for [workspaceId], enforcing the plan's ceiling first.
     *
     * The feature gate and the count both come from the guard, so a Free
     * workspace is told "the Free plan does not include API access" rather than
     * "0 keys allowed" — two true sentences, of which only one is useful.
     */
    fun create(
        workspaceId: UUID,
        name: String,
        createdByUserId: UUID?,
        actsAsUserId: UUID?,
        expiresAt: Instant? = null,
    ): Created {
        guard?.requireApiKeyAllowed(workspaceId)

        val secret = mint()
        val prefix = secret.take(PREFIX_LENGTH)
        val id = UUID.randomUUID()

        dataSource.connection.use { c ->
            c.prepareStatement(
                """INSERT INTO api_keys
                     (id, workspace_id, name, prefix, token_hash, acts_as_user_id,
                      created_by_user_id, expires_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?)"""
            ).use { st ->
                st.setObject(1, id)
                st.setObject(2, workspaceId)
                st.setString(3, name)
                st.setString(4, prefix)
                st.setString(5, hash(secret))
                st.setObject(6, actsAsUserId)
                st.setObject(7, createdByUserId)
                st.setObject(8, expiresAt?.let { java.sql.Timestamp.from(it) })
                st.executeUpdate()
            }
        }

        log.info("[apikey] created {} for workspace {} prefix={}", id, workspaceId, prefix)
        return Created(id, name, prefix, secret, expiresAt)
    }

    // ── Authentication ────────────────────────────────────────────────────────

    /**
     * Resolve a presented key, or throw.
     *
     * ── ONE ERROR FOR FOUR CAUSES ───────────────────────────────────────────
     * Unknown, revoked, expired and malformed all produce the same
     * [ApiError.InvalidApiKey]. Distinguishing them tells somebody holding a
     * stolen key which of the four they have, which is free reconnaissance.
     *
     * `last_used_at` is updated on the same statement that reads the row, so
     * "when was this key last used" — the first question asked when one leaks —
     * costs no extra round trip and cannot drift from the authentication itself.
     */
    fun authenticate(presented: String): ResolvedKey {
        if (!presented.startsWith(PREFIX) || presented.length < 24) throw ApiError.InvalidApiKey()

        return dataSource.connection.use { c ->
            c.prepareStatement(
                """UPDATE api_keys
                      SET last_used_at = now()
                    WHERE token_hash = ?
                      AND revoked_at IS NULL
                      AND (expires_at IS NULL OR expires_at > now())
                      AND (rotation_grace_until IS NULL OR rotation_grace_until > now())
                RETURNING id, workspace_id, acts_as_user_id, name, rate_limit_per_minute"""
            ).use { st ->
                st.setString(1, hash(presented))
                st.executeQuery().use { rs ->
                    if (!rs.next()) throw ApiError.InvalidApiKey()
                    ResolvedKey(
                        id = rs.getObject("id", UUID::class.java),
                        workspaceId = rs.getObject("workspace_id", UUID::class.java),
                        actsAsUserId = rs.getObject("acts_as_user_id", UUID::class.java),
                        name = rs.getString("name"),
                        rateLimitPerMinute = rs.getInt("rate_limit_per_minute")
                            .takeIf { !rs.wasNull() },
                    )
                }
            }
        }
    }

    // ── Revocation and listing ────────────────────────────────────────────────

    /**
     * Revoke, idempotently.
     *
     * `revoked_at IS NULL` in the predicate rather than a read-then-write: two
     * admins revoking the same key at once should both succeed, and the first
     * revocation time is the one that matters.
     */
    fun revoke(workspaceId: UUID, keyId: UUID, byUserId: UUID?): Boolean =
        dataSource.connection.use { c ->
            c.prepareStatement(
                """UPDATE api_keys SET revoked_at = now(), revoked_by_user_id = ?
                    WHERE id = ? AND workspace_id = ? AND revoked_at IS NULL"""
            ).use { st ->
                st.setObject(1, byUserId)
                st.setObject(2, keyId)
                // Workspace-scoped even though the id is unique: an admin of one
                // workspace must not be able to revoke another's key by guessing
                // a UUID, and a WHERE clause is a cheaper guarantee than a check.
                st.setObject(3, workspaceId)
                st.executeUpdate() > 0
            }
        }

    fun list(workspaceId: UUID): List<Map<String, Any?>> =
        dataSource.connection.use { c ->
            c.prepareStatement(
                """SELECT k.id, k.name, k.prefix, k.acts_as_user_id, u.email AS acts_as_email,
                          k.last_used_at, k.expires_at, k.revoked_at, k.created_at
                     FROM api_keys k
                     LEFT JOIN app_users u ON u.id = k.acts_as_user_id
                    WHERE k.workspace_id = ?
                    ORDER BY k.created_at DESC"""
            ).use { st ->
                st.setObject(1, workspaceId)
                st.executeQuery().use { rs ->
                    buildList {
                        while (rs.next()) add(mapOf(
                            "id" to rs.getObject("id", UUID::class.java).toString(),
                            "name" to rs.getString("name"),
                            // The prefix, never the key. Enough to match a row to
                            // a log line; useless to anybody who finds it.
                            "prefix" to rs.getString("prefix"),
                            "actsAs" to rs.getString("acts_as_email"),
                            "lastUsedAt" to rs.getTimestamp("last_used_at")?.toInstant()?.toString(),
                            "expiresAt" to rs.getTimestamp("expires_at")?.toInstant()?.toString(),
                            "revokedAt" to rs.getTimestamp("revoked_at")?.toInstant()?.toString(),
                            "createdAt" to rs.getTimestamp("created_at").toInstant().toString(),
                        ))
                    }
                }
            }
        }

    /**
     * Requests per minute this workspace's plan allows for a key.
     *
     * Zero on a plan without API access, which the feature gate has already
     * refused — the number exists so the refusal can be specific if the gate is
     * ever relaxed without this being revisited.
     */
    fun rateLimitPerMinute(workspaceId: UUID): Int =
        guard?.resolve(workspaceId)?.setting(EntitlementKeys.API_RATE_LIMIT_PER_MINUTE)?.toInt() ?: 0

    /**
     * Mint a replacement for [keyId], and start the clock on the old one.
     *
     * ── ROTATION IS TWO LIVE KEYS, BRIEFLY ─────────────────────────
     * Anything else is an outage. The old key has to keep working while the new
     * one reaches every deployment that uses it — a fleet, a CI system, somebody
     * else's cron — and those do not all redeploy at once.
     *
     * And the overlap has to END, or this is not rotation, it is "make another
     * key". `rotation_grace_until` is what makes it finite, [authenticate]
     * enforces it, and the default is 24 hours because that is long enough for a
     * deploy and short enough that a leaked key is not live for a week.
     *
     * The new key carries the old one's `acts_as_user_id` and per-key limit, so
     * it is held to exactly the same caps. A rotation that quietly widened a
     * key's reach would be the most inviting way to escalate one.
     */
    fun rotate(
        workspaceId: UUID,
        keyId: UUID,
        byUserId: UUID?,
        graceSeconds: Long = DEFAULT_ROTATION_GRACE_SECONDS,
    ): Created? {
        val old = dataSource.connection.use { c ->
            c.prepareStatement(
                """SELECT name, acts_as_user_id, rate_limit_per_minute
                     FROM api_keys
                    WHERE id = ? AND workspace_id = ? AND revoked_at IS NULL"""
            ).use { st ->
                st.setObject(1, keyId); st.setObject(2, workspaceId)
                st.executeQuery().use { rs ->
                    if (!rs.next()) null else Triple(
                        rs.getString("name"),
                        rs.getObject("acts_as_user_id", UUID::class.java),
                        rs.getInt("rate_limit_per_minute").takeIf { !rs.wasNull() },
                    )
                }
            }
        } ?: return null

        val (name, actsAs, perKeyLimit) = old
        val secret = mint()
        val id = UUID.randomUUID()
        val prefix = secret.take(PREFIX_LENGTH)

        dataSource.connection.use { c ->
            c.autoCommit = false
            try {
                c.prepareStatement(
                    """INSERT INTO api_keys
                         (id, workspace_id, name, prefix, token_hash, acts_as_user_id,
                          created_by_user_id, rotated_from_id, rate_limit_per_minute)
                       VALUES (?,?,?,?,?,?,?,?,?)"""
                ).use { st ->
                    st.setObject(1, id); st.setObject(2, workspaceId)
                    st.setString(3, name); st.setString(4, prefix)
                    st.setString(5, hash(secret)); st.setObject(6, actsAs)
                    st.setObject(7, byUserId); st.setObject(8, keyId)
                    if (perKeyLimit != null) st.setInt(9, perKeyLimit)
                    else st.setNull(9, java.sql.Types.INTEGER)
                    st.executeUpdate()
                }
                /* The grace window on the OLD key, in the SAME transaction as the
                   new key's insert. A crash between the two would otherwise either
                   expire a key with no replacement, or mint a replacement nobody
                   knows to switch to. */
                c.prepareStatement(
                    "UPDATE api_keys SET rotation_grace_until = now() + make_interval(secs => ?) " +
                        "WHERE id = ? AND workspace_id = ?"
                ).use { st ->
                    st.setDouble(1, graceSeconds.toDouble())
                    st.setObject(2, keyId); st.setObject(3, workspaceId)
                    st.executeUpdate()
                }
                c.commit()
            } catch (e: Exception) {
                runCatching { c.rollback() }
                throw e
            } finally {
                runCatching { c.autoCommit = true }
            }
        }

        log.info("[apikey] rotated {} -> {} for workspace {} (grace {}s)",
            keyId, id, workspaceId, graceSeconds)
        return Created(id, name, prefix, secret, null)
    }

    /**
     * Set this key's own ceiling.
     *
     * ── WHY PER KEY AND NOT PER WORKSPACE ──────────────────────────
     * The limit was per workspace, so one runaway integration consumed the
     * budget of every other key in the workspace — including the one an operator
     * was using to investigate it. A per-key ceiling contains the blast radius to
     * the thing that is misbehaving.
     *
     * Null removes it and the plan limit applies alone. The plan limit is always
     * the ceiling: a per-key value above it is clamped, because an admin must not
     * be able to sell themselves more throughput by adding keys.
     */
    fun setRateLimit(workspaceId: UUID, keyId: UUID, perMinute: Int?): Boolean {
        val planCeiling = rateLimitPerMinute(workspaceId)
        val effective = perMinute?.let {
            if (planCeiling > 0) it.coerceIn(1, planCeiling) else it.coerceAtLeast(1)
        }
        return dataSource.connection.use { c ->
            c.prepareStatement(
                "UPDATE api_keys SET rate_limit_per_minute = ? WHERE id = ? AND workspace_id = ?"
            ).use { st ->
                if (effective != null) st.setInt(1, effective)
                else st.setNull(1, java.sql.Types.INTEGER)
                st.setObject(2, keyId); st.setObject(3, workspaceId)
                st.executeUpdate() > 0
            }
        }
    }

    private companion object {
        const val PREFIX = "vb_"

        /**
         * How long a rotated key keeps working.
         *
         * Long enough for a deploy to reach a fleet; short enough that a key
         * rotated because it leaked is not live for a week.
         */
        const val DEFAULT_ROTATION_GRACE_SECONDS = 24L * 60 * 60
        const val PREFIX_LENGTH = 12
        private val RANDOM = SecureRandom()

        /** 32 bytes of entropy, URL-safe, prefixed so it is greppable in a leak. */
        fun mint(): String {
            val bytes = ByteArray(32).also { RANDOM.nextBytes(it) }
            return PREFIX + java.util.Base64.getUrlEncoder().withoutPadding().encodeToString(bytes)
        }

        fun hash(secret: String): String =
            MessageDigest.getInstance("SHA-256")
                .digest(secret.toByteArray())
                .joinToString("") { "%02x".format(it) }
    }
}
