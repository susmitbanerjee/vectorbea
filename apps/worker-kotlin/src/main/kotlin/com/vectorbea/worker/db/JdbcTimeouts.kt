package com.vectorbea.worker.db

import com.vectorbea.dbcatalog.DbProviders
import com.vectorbea.dbcatalog.DbWire
import com.vectorbea.worker.config.OutboundTimeouts
import com.zaxxer.hikari.HikariConfig

/**
 * Forces driver-level timeouts onto every JDBC URL the worker opens — the
 * worker's own Postgres and, far more importantly, tenant databases.
 *
 * WHY DRIVER-LEVEL, NOT `withTimeout`
 * -----------------------------------
 * `Statement.setQueryTimeout` on pgjdbc is implemented by opening a *second*
 * connection and sending a cancel request. Against a firewalled or blackholed
 * host that second connection hangs too, so the query timeout never fires and
 * the pool thread is parked for the lifetime of the process. `socketTimeout` is
 * the only bound that does not depend on the peer being reachable: it is a
 * `SO_TIMEOUT` on the socket, enforced by the JVM.
 *
 * WHY "FORCE"
 * -----------
 * Tenants can supply a full connection string (`connectionMode=connection_string`).
 * That string may carry `socketTimeout=0`, which means *no timeout*. Merely
 * defaulting the value would let a tenant — accidentally or otherwise — opt out
 * of the guard that protects every other tenant. [applyTo] therefore overwrites
 * an existing value whenever it is absent, zero, negative, or above the policy
 * ceiling. A tenant may tighten a timeout; they may not remove it.
 */
object JdbcTimeouts {

    /**
     * Return [jdbcUrl] with this provider's timeout parameters forced to the
     * values in [t]. Understands both query-string URLs (postgres/mysql/mariadb)
     * and the semicolon form used by the SQL Server driver.
     */
    fun applyTo(jdbcUrl: String, provider: String, t: OutboundTimeouts): String {
        val forced = paramsFor(provider, t)
        if (forced.isEmpty()) return jdbcUrl
        return if (isSqlServer(provider)) {
            forceSemicolonParams(jdbcUrl, forced, t)
        } else {
            forceQueryParams(jdbcUrl, forced, t)
        }
    }

    /**
     * The timeout parameters for [provider], with values in that driver's own
     * unit. Exposed so the startup log and the timeout audit can report exactly
     * what is on the wire rather than what the policy intends.
     */
    fun paramsFor(provider: String, t: OutboundTimeouts): Map<String, String> =
        /*
         * KEYED ON THE WIRE PROTOCOL, NOT THE VENDOR NAME.
         *
         * This used to be a four-name `when`, with `else -> emptyMap()`. Because
         * `applyTo` short-circuits on an empty map, a connection stored as
         * provider `supabase`, `neon`, `aiven_mysql`, `planetscale`, `timescale`
         * or `rds_postgresql` received NO connectTimeout, NO socketTimeout and NO
         * prepareThreshold — the exact opt-out this file's header says a tenant
         * must never get, handed out silently to most of the managed-database
         * market. `DbProviders.resolve` maps all of those onto the wire protocol
         * they actually speak.
         */
        when (DbProviders.resolve(provider, null).wire) {
            DbWire.POSTGRES -> linkedMapOf(
                // pgjdbc units: seconds
                "connectTimeout" to t.dbConnectTimeoutSeconds.toString(),
                "socketTimeout" to t.dbSocketTimeoutSeconds.toString(),
                "loginTimeout" to t.dbLoginTimeoutSeconds.toString(),
                "cancelSignalTimeout" to t.dbCancelSignalTimeoutSeconds.toString(),
                // Detect a peer that vanished without an RST (the firewalled case).
                "tcpKeepAlive" to "true",
                /*
                 * ── DEFAULT OFF, BECAUSE POOLERS CANNOT CARRY THEM ───────────
                 *
                 * pgjdbc promotes a statement to a named server-side prepared
                 * statement once the same SQL has run five times. A db_read node
                 * runs the same SQL on every execution, so the fifth run of a
                 * workflow crosses that line — and a TRANSACTION-MODE POOLER
                 * cannot carry a named statement across the backends it
                 * multiplexes. Supabase's Supavisor (port 6543), PgBouncer and
                 * RDS Proxy all work that way, and their pooled URL is what
                 * those dashboards hand out.
                 *
                 * The failure is nastier than a plain error because it is
                 * DELAYED: the connection tests green, the tool builds, the
                 * first four runs succeed, and then the node starts failing with
                 * "prepared statement S_1 already exists" for no visible reason.
                 * Schema preview hit the same wall inside a single call, which is
                 * where it was found.
                 *
                 * Unlike the timeouts around it this is a DEFAULT, not a ceiling:
                 * a tenant who sets `prepareThreshold` explicitly is pointing at
                 * a direct connection and knows what they want. See [mustOverride].
                 */
                "prepareThreshold" to "0",
            )

            DbWire.MYSQL -> linkedMapOf(
                // Connector/J and MariaDB units: milliseconds
                "connectTimeout" to (t.dbConnectTimeoutSeconds * 1_000).toString(),
                "socketTimeout" to (t.dbSocketTimeoutSeconds * 1_000).toString(),
                "tcpKeepAlive" to "true",
            )

            DbWire.SQLSERVER -> linkedMapOf(
                // loginTimeout: seconds; socketTimeout: milliseconds
                "loginTimeout" to t.dbLoginTimeoutSeconds.toString(),
                "socketTimeout" to (t.dbSocketTimeoutSeconds * 1_000).toString(),
            )

            // Not a JDBC wire — there is no URL here to force parameters onto.
            DbWire.MONGODB -> emptyMap()
        }

    /**
     * Ceiling for a parameter, in that parameter's own unit. A value above the
     * ceiling — or at/below zero, which means "unbounded" for every driver here —
     * is replaced.
     */
    private fun ceilingFor(key: String, provider: String, t: OutboundTimeouts): Long? {
        // pgjdbc expresses connect/socket timeouts in seconds; every other driver
        // here uses milliseconds. loginTimeout is seconds everywhere. Resolved
        // through the catalogue so `neon` and `supabase` are recognised as
        // pgjdbc — reading their ceiling in milliseconds would have made every
        // supplied value look 1000x too large and forced it back down.
        val unit = if (DbProviders.resolve(provider, null).wire == DbWire.POSTGRES) 1L else 1_000L
        return when (key.lowercase()) {
            "connecttimeout" -> t.dbConnectTimeoutSeconds * unit
            "sockettimeout" -> t.dbSocketTimeoutSeconds * unit
            "logintimeout" -> t.dbLoginTimeoutSeconds.toLong()
            "cancelsignaltimeout" -> t.dbCancelSignalTimeoutSeconds.toLong()
            else -> null // non-numeric (tcpKeepAlive) — always force
        }
    }

    /** Parameters this forces only when ABSENT — a default rather than a bound. */
    private val DEFAULT_ONLY = setOf("preparethreshold")

    /** True when the caller-supplied value must be replaced by the policy value. */
    private fun mustOverride(existing: String?, key: String, provider: String, t: OutboundTimeouts): Boolean {
        if (existing == null) return true
        // A tenant who named this one meant it. It protects them from a pooler,
        // not the platform from them, so their choice stands.
        if (key.lowercase() in DEFAULT_ONLY) return false
        val ceiling = ceilingFor(key, provider, t) ?: return true
        val current = existing.trim().toLongOrNull() ?: return true
        // <= 0 means "wait forever" for every driver we support.
        return current <= 0L || current > ceiling
    }

    // ── URL rewriting ─────────────────────────────────────────────────────────

    private fun isSqlServer(provider: String) =
        DbProviders.resolve(provider, null).wire == DbWire.SQLSERVER

    private fun forceQueryParams(
        url: String,
        forced: Map<String, String>,
        t: OutboundTimeouts,
    ): String {
        val qIndex = url.indexOf('?')
        val base = if (qIndex >= 0) url.substring(0, qIndex) else url
        val query = if (qIndex >= 0) url.substring(qIndex + 1) else ""

        val provider = providerFromJdbcUrl(base)
        val pairs = LinkedHashMap<String, String>()
        if (query.isNotBlank()) {
            for (part in query.split('&')) {
                if (part.isBlank()) continue
                val eq = part.indexOf('=')
                if (eq < 0) pairs[part] = "" else pairs[part.substring(0, eq)] = part.substring(eq + 1)
            }
        }

        for ((key, value) in forced) {
            val existingKey = pairs.keys.firstOrNull { it.equals(key, ignoreCase = true) }
            val existingValue = existingKey?.let { pairs[it] }
            if (mustOverride(existingValue, key, provider, t)) {
                /* Overwritten IN PLACE. Removing and re-adding moved the key to
                   the end of the query string, so applying this twice produced a
                   different URL each time — harmless until a second always-forced
                   key was added after the first, at which point the two swapped
                   on every pass. A LinkedHashMap keeps the position of a key it
                   already has, so assigning through the existing spelling is what
                   makes this idempotent. */
                pairs[existingKey ?: key] = value
            }
        }

        if (pairs.isEmpty()) return base
        return base + "?" + pairs.entries.joinToString("&") { (k, v) ->
            if (v.isEmpty()) k else "$k=$v"
        }
    }

    private fun forceSemicolonParams(
        url: String,
        forced: Map<String, String>,
        t: OutboundTimeouts,
    ): String {
        val parts = url.split(';').filter { it.isNotBlank() }.toMutableList()
        if (parts.isEmpty()) return url
        val head = parts.removeAt(0)

        val pairs = LinkedHashMap<String, String>()
        for (part in parts) {
            val eq = part.indexOf('=')
            if (eq < 0) pairs[part] = "" else pairs[part.substring(0, eq)] = part.substring(eq + 1)
        }

        for ((key, value) in forced) {
            val existingKey = pairs.keys.firstOrNull { it.equals(key, ignoreCase = true) }
            val existingValue = existingKey?.let { pairs[it] }
            if (mustOverride(existingValue, key, "sqlserver", t)) {
                // In place, for the same reason as the query-string form above.
                pairs[existingKey ?: key] = value
            }
        }

        return head + pairs.entries.joinToString("") { (k, v) -> if (v.isEmpty()) ";$k" else ";$k=$v" }
    }

    private fun providerFromJdbcUrl(url: String): String = when {
        url.startsWith("jdbc:postgresql:") -> "postgresql"
        url.startsWith("jdbc:mysql:") -> "mysql"
        url.startsWith("jdbc:mariadb:") -> "mariadb"
        url.startsWith("jdbc:sqlserver:") -> "sqlserver"
        else -> "postgresql"
    }

    // ── HikariCP knobs ────────────────────────────────────────────────────────

    /**
     * Apply the pool-level bounds that sit above the driver.
     *
     * `connectionTestQuery` is deliberately NOT set. Setting it makes HikariCP
     * validate with `Statement.execute("SELECT 1")`, whose only bound is
     * `setQueryTimeout` — the cancel-request path that hangs against an
     * unreachable host. Leaving it unset makes HikariCP use JDBC4
     * `Connection.isValid(timeout)`, which pgjdbc implements by temporarily
     * lowering the socket timeout, so validation is bounded by the socket rather
     * than by the peer's willingness to answer a cancel.
     */
    fun applyPoolBounds(
        cfg: HikariConfig,
        t: OutboundTimeouts,
        connectionTimeoutMs: Long,
        idleTimeoutMs: Long,
        maxLifetimeMs: Long,
        validationTimeoutMs: Long,
        leakDetectionMs: Long,
    ) {
        cfg.connectionTimeout = connectionTimeoutMs
        cfg.idleTimeout = idleTimeoutMs
        cfg.maxLifetime = maxLifetimeMs
        // Hikari requires validationTimeout < connectionTimeout.
        cfg.validationTimeout = validationTimeoutMs.coerceAtMost(connectionTimeoutMs - 250L).coerceAtLeast(250L)
        cfg.leakDetectionThreshold = leakDetectionMs
        cfg.isRegisterMbeans = false
    }
}
