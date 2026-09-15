package com.vectorbea.api.runner

import com.vectorbea.api.errors.ApiError
import org.slf4j.LoggerFactory
import java.security.MessageDigest
import java.security.SecureRandom
import java.time.Instant
import java.util.UUID
import javax.sql.DataSource

/**
 * Pools, runners, tokens and leases — the durable half of the runner protocol.
 *
 * ── WHY A RUNNER TOKEN IS NOT AN API KEY ────────────────────────────────────
 * An API key can start runs, read every result, manage connections and read
 * every payload the workspace has ever produced. A runner needs three verbs
 * against one pool. If a runner token leaks out of the customer's network — and
 * it lives on a machine we cannot see, deployed by a process we do not control
 * — the blast radius has to be "somebody can lease our queued runs", not
 * "somebody can read everything we have ever run".
 *
 * That could have been a scope on `api_keys`. A scope is a filter somebody can
 * forget to apply at one call site; a separate table with no path to the rest
 * of the API cannot be forgotten.
 */
class RunnerStore(private val dataSource: DataSource) {

    private val log = LoggerFactory.getLogger(RunnerStore::class.java)

    /** A pool, as the lease path needs it. */
    data class Pool(
        val id: UUID,
        val workspaceId: UUID,
        val name: String,
        val payloadPolicy: RunnerReport.PayloadPolicy,
        val enabled: Boolean,
    )

    /** An authenticated runner token, resolved to its pool. */
    data class Authenticated(val tokenId: UUID, val pool: Pool)

    // ── Authentication ───────────────────────────────────────────────────────

    /**
     * Resolve a presented token to its pool, or refuse.
     *
     * Constant-time comparison is not needed and would be theatre: the lookup is
     * by SHA-256 of the whole secret, so there is no prefix to walk and nothing
     * to time. What matters is that a revoked or expired token is refused in the
     * SAME query that finds it — a two-step check has a window, and this one
     * runs on every heartbeat of every run.
     */
    fun authenticate(presented: String): Authenticated {
        if (!presented.startsWith(TOKEN_PREFIX) || presented.length < 24) {
            throw ApiError.Unauthorized("This is not a runner token.")
        }
        val hash = hash(presented)
        return dataSource.connection.use { c ->
            c.prepareStatement(
                """SELECT t.id AS token_id, p.id AS pool_id, p.workspace_id, p.name,
                          p.payload_policy, p.enabled
                     FROM runner_tokens t
                     JOIN runner_pools p ON p.id = t.pool_id
                    WHERE t.token_hash = ?
                      AND t.revoked_at IS NULL
                      AND (t.expires_at IS NULL OR t.expires_at > now())"""
            ).use { st ->
                st.setString(1, hash)
                st.executeQuery().use { rs ->
                    if (!rs.next()) throw ApiError.Unauthorized(
                        "This runner token is not valid. It may have been revoked or expired; " +
                            "mint a new one from the runner pool's settings.")
                    val pool = Pool(
                        id = rs.getObject("pool_id", UUID::class.java),
                        workspaceId = rs.getObject("workspace_id", UUID::class.java),
                        name = rs.getString("name"),
                        payloadPolicy = RunnerReport.PayloadPolicy.of(rs.getString("payload_policy")),
                        enabled = rs.getBoolean("enabled"),
                    )
                    if (!pool.enabled) throw ApiError.Forbidden(
                        "The runner pool '${pool.name}' is disabled, so it will not be given work.")
                    Authenticated(rs.getObject("token_id", UUID::class.java), pool)
                }
            }
        }.also { touchToken(it.tokenId) }
    }

    /** Best-effort: "when did this token last check in" is an operator question. */
    private fun touchToken(tokenId: UUID) = runCatching {
        dataSource.connection.use { c ->
            c.prepareStatement("UPDATE runner_tokens SET last_used_at = now() WHERE id = ?")
                .use { it.setObject(1, tokenId); it.executeUpdate() }
        }
    }

    // ── Registration ─────────────────────────────────────────────────────────

    /**
     * Register, or find, the process asking for work.
     *
     * Upserted on `(pool, runner_name)` rather than created per lease: a runner
     * restarting must not accumulate a row per restart, and the operator
     * question the table answers — "is anything alive in our VPC" — is about
     * processes, not about how many times they have started.
     */
    fun registerRunner(
        pool: Pool,
        runnerName: String,
        version: String?,
        reportedHost: String?,
        capabilitiesJson: String,
    ): UUID = dataSource.connection.use { c ->
        c.prepareStatement(
            """INSERT INTO runners
                 (workspace_id, pool_id, runner_name, version, capabilities, reported_host)
               VALUES (?,?,?,?,?::jsonb,?)
               ON CONFLICT (pool_id, runner_name) DO UPDATE SET
                 last_seen_at = now(),
                 version = EXCLUDED.version,
                 capabilities = EXCLUDED.capabilities,
                 reported_host = EXCLUDED.reported_host
               RETURNING id"""
        ).use { st ->
            st.setObject(1, pool.workspaceId)
            st.setObject(2, pool.id)
            /* Truncated, not validated: it comes from the customer's network and
               is display-only, so the only property that matters is that it
               cannot be enormous. */
            st.setString(3, runnerName.take(200))
            st.setString(4, version?.take(60))
            st.setString(5, capabilitiesJson)
            st.setString(6, reportedHost?.take(200))
            st.executeQuery().use { rs -> rs.next(); rs.getObject("id", UUID::class.java) }
        }
    }

    // ── Leasing ──────────────────────────────────────────────────────────────

    /** A run handed to a runner, with everything it needs and nothing more. */
    data class LeasedRun(
        val runId: UUID,
        val workspaceId: UUID,
        val environmentId: UUID,
        val workflowId: UUID,
        val workflowVersionId: UUID,
        val executionClass: String?,
        val inputJson: String,
        val expiresAt: Instant,
    )

    /**
     * Claim one queued run for this pool.
     *
     * ── THE SAME SHAPE AS THE PLATFORM CLAIM, FOR THE SAME REASON ───────────
     * `FOR UPDATE SKIP LOCKED` over an ordered candidate set, in one statement.
     * Two runners in the same pool polling simultaneously is the ordinary case —
     * that is what replicas are for — and a read-then-update would hand both the
     * same run.
     *
     * Ordered by `priority DESC, fair_vtime` so a self-hosted pool inherits the
     * platform's ordering rather than reinventing it: a Sev1 pinned to a
     * customer's VPC should still outrank their nightly batch there.
     */
    fun lease(pool: Pool, runnerId: UUID, leaseSeconds: Long): LeasedRun? {
        val expiresAt = Instant.now().plusSeconds(leaseSeconds)
        return dataSource.connection.use { c ->
            c.autoCommit = false
            try {
                val row = c.prepareStatement(
                    """SELECT id, workspace_id, environment_id, workflow_id,
                              workflow_version_id, execution_class, input_json
                         FROM agent_runs
                        WHERE runner_pool_id = ?
                          AND status = 'queued'
                        ORDER BY priority DESC, fair_vtime
                        LIMIT 1
                        FOR UPDATE SKIP LOCKED"""
                ).use { st ->
                    st.setObject(1, pool.id)
                    st.executeQuery().use { rs ->
                        if (!rs.next()) null else LeasedRun(
                            runId = rs.getObject("id", UUID::class.java),
                            workspaceId = rs.getObject("workspace_id", UUID::class.java),
                            environmentId = rs.getObject("environment_id", UUID::class.java),
                            workflowId = rs.getObject("workflow_id", UUID::class.java),
                            workflowVersionId = rs.getObject("workflow_version_id", UUID::class.java),
                            executionClass = rs.getString("execution_class"),
                            inputJson = rs.getString("input_json") ?: "{}",
                            expiresAt = expiresAt,
                        )
                    }
                } ?: run { c.rollback(); return@use null }

                c.prepareStatement(
                    "UPDATE agent_runs SET status = 'running', runner_id = ?, " +
                        "started_at = COALESCE(started_at, now()), updated_at = now() WHERE id = ?"
                ).use { st -> st.setObject(1, runnerId); st.setObject(2, row.runId); st.executeUpdate() }

                c.prepareStatement(
                    """INSERT INTO runner_leases
                         (run_id, workspace_id, pool_id, runner_id, expires_at)
                       VALUES (?,?,?,?,?)
                       ON CONFLICT (run_id) DO UPDATE SET
                         runner_id = EXCLUDED.runner_id,
                         expires_at = EXCLUDED.expires_at,
                         last_heartbeat_at = now()"""
                ).use { st ->
                    st.setObject(1, row.runId); st.setObject(2, row.workspaceId)
                    st.setObject(3, pool.id); st.setObject(4, runnerId)
                    st.setTimestamp(5, java.sql.Timestamp.from(expiresAt))
                    st.executeUpdate()
                }
                c.commit()
                row
            } catch (e: Exception) {
                runCatching { c.rollback() }
                throw e
            } finally {
                runCatching { c.autoCommit = true }
            }
        }
    }

    /**
     * Extend a lease.
     *
     * @return false when the lease is gone — reclaimed on expiry, or the run was
     *   cancelled. The runner's correct response is to STOP, because something
     *   else may already have taken the work.
     */
    fun heartbeat(runId: UUID, runnerId: UUID, leaseSeconds: Long): Boolean =
        dataSource.connection.use { c ->
            c.prepareStatement(
                """UPDATE runner_leases
                      SET expires_at = now() + make_interval(secs => ?),
                          last_heartbeat_at = now(),
                          heartbeats = heartbeats + 1
                    WHERE run_id = ? AND runner_id = ?"""
            ).use { st ->
                st.setDouble(1, leaseSeconds.toDouble())
                st.setObject(2, runId); st.setObject(3, runnerId)
                st.executeUpdate() > 0
            }
        }

    /**
     * Return runs whose runner stopped answering.
     *
     * ── WHY THIS IS NOT THE WORKER RECONCILER ───────────────────────────────
     * That one reasons about processes we can observe, restart and read the logs
     * of. This lease is held by software on somebody else's machine behind a
     * NAT, which can vanish without sending a packet — a laptop closing, a pod
     * evicted, a VPN dropping. The run must return to the queue rather than
     * being stranded in `running` forever with nothing to explain it.
     *
     * Back to `queued`, not `failed`: nothing is known to have gone wrong with
     * the work, only with the machine, and the next runner in the pool should
     * pick it up.
     */
    fun reclaimExpired(limit: Int = 100): Int = runCatching {
        dataSource.connection.use { c ->
            c.prepareStatement(
                """WITH dead AS (
                       DELETE FROM runner_leases
                        WHERE expires_at < now()
                          AND run_id IN (SELECT run_id FROM runner_leases
                                          WHERE expires_at < now() LIMIT ?)
                       RETURNING run_id
                   )
                   UPDATE agent_runs SET status = 'queued', runner_id = NULL, updated_at = now()
                    WHERE id IN (SELECT run_id FROM dead)
                      AND status = 'running'"""
            ).use { st -> st.setInt(1, limit); st.executeUpdate() }
        }
    }.getOrElse {
        log.error("[runner] could not reclaim expired leases: {}", it.message)
        0
    }

    /** Release a lease at the end of a run, whatever the outcome. */
    fun releaseLease(runId: UUID) = runCatching {
        dataSource.connection.use { c ->
            c.prepareStatement("DELETE FROM runner_leases WHERE run_id = ?")
                .use { it.setObject(1, runId); it.executeUpdate() }
        }
    }

    /** The lease's owner, so a report from a runner that no longer holds it is refused. */
    fun holderOf(runId: UUID): UUID? = dataSource.connection.use { c ->
        c.prepareStatement("SELECT runner_id FROM runner_leases WHERE run_id = ?").use { st ->
            st.setObject(1, runId)
            st.executeQuery().use { rs -> if (rs.next()) rs.getObject(1, UUID::class.java) else null }
        }
    }

    // ── Pools and tokens ─────────────────────────────────────────────────────

    fun createPool(
        workspaceId: UUID, name: String, slug: String,
        locationLabel: String?, payloadPolicy: String, createdBy: UUID?,
    ): UUID = dataSource.connection.use { c ->
        c.prepareStatement(
            """INSERT INTO runner_pools
                 (workspace_id, name, slug, location_label, payload_policy, created_by_user_id)
               VALUES (?,?,?,?,?,?) RETURNING id"""
        ).use { st ->
            st.setObject(1, workspaceId); st.setString(2, name); st.setString(3, slug)
            st.setString(4, locationLabel); st.setString(5, payloadPolicy)
            st.setObject(6, createdBy)
            st.executeQuery().use { rs -> rs.next(); rs.getObject("id", UUID::class.java) }
        }
    }

    /** The secret, returned ONCE. Only its hash is stored. */
    data class MintedToken(val id: UUID, val secret: String, val prefix: String)

    fun mintToken(
        workspaceId: UUID, poolId: UUID, name: String,
        expiresAt: Instant?, createdBy: UUID?,
    ): MintedToken {
        val secret = mint()
        val prefix = secret.take(PREFIX_LENGTH)
        val id = dataSource.connection.use { c ->
            c.prepareStatement(
                """INSERT INTO runner_tokens
                     (workspace_id, pool_id, name, prefix, token_hash, expires_at,
                      created_by_user_id)
                   VALUES (?,?,?,?,?,?,?) RETURNING id"""
            ).use { st ->
                st.setObject(1, workspaceId); st.setObject(2, poolId)
                st.setString(3, name); st.setString(4, prefix)
                st.setString(5, hash(secret))
                st.setTimestamp(6, expiresAt?.let { java.sql.Timestamp.from(it) })
                st.setObject(7, createdBy)
                st.executeQuery().use { rs -> rs.next(); rs.getObject("id", UUID::class.java) }
            }
        }
        return MintedToken(id, secret, prefix)
    }

    fun listPools(workspaceId: UUID): List<Map<String, Any?>> = dataSource.connection.use { c ->
        c.prepareStatement(
            """SELECT p.id, p.name, p.slug, p.location_label, p.payload_policy, p.enabled,
                      p.created_at,
                      (SELECT count(*) FROM runners r
                        WHERE r.pool_id = p.id AND r.last_seen_at > now() - interval '2 minutes')
                        AS live_runners,
                      (SELECT count(*) FROM agent_runs a
                        WHERE a.runner_pool_id = p.id AND a.status = 'queued') AS queued_runs
                 FROM runner_pools p
                WHERE p.workspace_id = ?
                ORDER BY p.created_at DESC"""
        ).use { st ->
            st.setObject(1, workspaceId)
            st.executeQuery().use { rs ->
                buildList {
                    while (rs.next()) add(mapOf(
                        "id" to rs.getObject("id", UUID::class.java).toString(),
                        "name" to rs.getString("name"),
                        "slug" to rs.getString("slug"),
                        "location" to rs.getString("location_label"),
                        "payloadPolicy" to rs.getString("payload_policy"),
                        "enabled" to rs.getBoolean("enabled"),
                        /*
                         * The two numbers an operator actually looks at. "Zero
                         * live runners and forty queued runs" is the answer to
                         * "why is nothing happening", and it is not derivable
                         * from anywhere else in the product.
                         */
                        "liveRunners" to rs.getInt("live_runners"),
                        "queuedRuns" to rs.getInt("queued_runs"),
                        "createdAt" to rs.getTimestamp("created_at").toInstant().toString(),
                    ))
                }
            }
        }
    }

    companion object {
        /** `vbr_` — distinct from `vb_` so a token in a log is identifiable at a glance. */
        const val TOKEN_PREFIX = "vbr_"
        const val PREFIX_LENGTH = 12

        /** Clamped: long enough to survive a slow network, short enough that a
            dead runner returns its work in about a minute. */
        const val MIN_LEASE_SECONDS = 30L
        const val MAX_LEASE_SECONDS = 300L

        private val RANDOM = SecureRandom()

        fun mint(): String {
            val bytes = ByteArray(32).also { RANDOM.nextBytes(it) }
            return TOKEN_PREFIX +
                java.util.Base64.getUrlEncoder().withoutPadding().encodeToString(bytes)
        }

        /**
         * SHA-256, not a password hash.
         *
         * The secret is 32 bytes from `SecureRandom`: there is nothing to
         * brute-force, and a deliberately slow hash on a path that runs on every
         * heartbeat of every run would be a self-inflicted rate limit.
         */
        fun hash(secret: String): String =
            MessageDigest.getInstance("SHA-256")
                .digest(secret.toByteArray())
                .joinToString("") { "%02x".format(it) }
    }
}
