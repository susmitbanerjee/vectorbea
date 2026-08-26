package com.vectorbea.worker.connector.pool

import com.vectorbea.worker.config.OutboundTimeouts
import com.vectorbea.worker.connector.ConnectionRecord
import com.vectorbea.worker.connector.SecretValue
import com.vectorbea.worker.db.JdbcTimeouts
import com.vectorbea.worker.logging.logger
import com.zaxxer.hikari.HikariConfig
import com.zaxxer.hikari.HikariDataSource
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import javax.sql.DataSource

/**
 * Manages per-client-connection HikariCP pools.
 *
 * Each [ConnectionRecord] that requires a JDBC connection gets its own small
 * pool keyed by [ConnectionRecord.id].  Pools are created on first use and
 * reused on subsequent calls.
 *
 * Pool sizing: max [maxConnectionsPerPool] connections per client connection.
 * This is intentionally small — client DB connections are not the worker's
 * own pool; they are outbound tenant connections.
 *
 * SECURITY:
 *  - JDBC URL is built from [ConnectionRecord.configJson], never from
 *    user-supplied template expressions.
 *  - The [SecretValue] (password) is extracted via [SecretValue.asStringRetained]
 *    only for HikariCP pool initialisation, then discarded.
 *  - Pool names never include credentials.
 *  - [close] must be called on shutdown to release all pools.
 *
 * AVAILABILITY — read this before changing anything below:
 *  These are connections to **someone else's** database, over the public
 *  internet, to a host the worker does not control. A tenant whose Postgres is
 *  firewalled (SYN dropped) or hung (TCP established, no response) will park the
 *  calling thread on a socket read. That thread is an execution slot; the agent
 *  pool is two slots wide platform-wide. Two hung tenant databases are therefore
 *  the entire platform's agent capacity, held indefinitely.
 *
 *  Every pool below MUST carry driver-level `connectTimeout`, `socketTimeout`
 *  and `loginTimeout` — see [JdbcTimeouts]. A `withTimeout` in Kotlin, or a
 *  `Statement.setQueryTimeout`, is not a substitute: neither can unpark a thread
 *  blocked in a native socket read.
 */
open class ClientDbPoolManager(
    private val maxConnectionsPerPool: Int = 3,
    private val connectionTimeoutMs: Long = 10_000L,
    private val idleTimeoutMs: Long = 300_000L,
    private val timeouts: OutboundTimeouts = OutboundTimeouts.fromEnv(),
) : AutoCloseable {

    private val log = logger()

    /** Active pools keyed by connection record UUID. */
    private val pools = ConcurrentHashMap<UUID, HikariDataSource>()

    /**
     * Return (and lazily create) a [DataSource] for [record].
     *
     * [secret] is used only during pool creation; after this call it should be
     * discarded by the caller.
     *
     * @throws [ClientDbPoolException] if the pool cannot be created.
     */
    open fun getOrCreate(record: ConnectionRecord, secret: SecretValue?): DataSource {
        // Fast path: pool already exists
        pools[record.id]?.let { return it }

        // Slow path: create under a per-ID lock pattern using computeIfAbsent
        return pools.computeIfAbsent(record.id) { _ ->
            log.info("[clientdb] creating pool [connId={}, provider={}]",
                record.id, record.provider)
            buildPool(record, secret)
        }
    }

    /** Evict and close the pool for [connectionId] (e.g. when connection is deactivated). */
    fun evict(connectionId: UUID) {
        pools.remove(connectionId)?.also { ds ->
            log.info("[clientdb] evicting pool [connId={}]", connectionId)
            ds.close()
        }
    }

    /** Close all managed pools. Safe to call multiple times. */
    override fun close() {
        log.info("[clientdb] closing all {} client pools", pools.size)
        val snapshot = pools.keys.toList()
        for (id in snapshot) {
            evict(id)
        }
    }

    // ── Pool construction ─────────────────────────────────────────────────────

    private fun buildPool(record: ConnectionRecord, secret: SecretValue?): HikariDataSource {
        val cfg = record.configJson
        val connectionMode = cfg["connectionMode"] as? String ?: "host_port"
        val readOnly = cfg["readOnly"] as? Boolean ?: false

        // ── Connection string mode ────────────────────────────────────────────
        // The frontend encrypts the full postgres:// URL as the secret.
        // Use it directly as the JDBC URL — credentials are embedded in the URL.
        // This avoids having to parse host/port/database/user separately.
        if (connectionMode == "connection_string" && secret != null && !secret.isCleared()) {
            var parsed = ParsedConnectionString("", null, null)
            secret.useOnce { raw ->
                parsed = parseConnectionString(raw, record.provider)
            }
            // Force driver-level timeouts even when the tenant supplied the whole
            // URL — a connection string carrying `socketTimeout=0` would otherwise
            // opt this tenant out of the only bound that protects the others.
            val guardedUrl = JdbcTimeouts.applyTo(parsed.jdbcUrl, record.provider, timeouts)
            return try {
                val hk = HikariConfig().apply {
                    this.jdbcUrl = guardedUrl
                    driverClassName = driverFor(record.provider)
                    poolName = "client-${record.id}"
                    maximumPoolSize = maxConnectionsPerPool
                    minimumIdle = 1
                    isReadOnly = readOnly
                    // Credentials travel as pool properties, NEVER in the URL —
                    // see [parseConnectionString].
                    parsed.username?.let { this.username = it }
                    parsed.password?.let { this.password = it }
                }
                applyBounds(hk)
                logEffective(record, "conn-string")
                HikariDataSource(hk)
            } catch (e: Exception) {
                val rootMsg = (e.cause?.message ?: e.message ?: e.javaClass.simpleName)
                    .take(300).replace(Regex("""://[^@]*@"""), "://[REDACTED]@")
                log.error("[clientdb] failed to create pool (conn-string mode) [connId={}, provider={}]: {}",
                    record.id, record.provider, rootMsg)
                throw ClientDbPoolException(
                    "Cannot create pool for connection '${record.name}' (${record.id}): $rootMsg"
                )
            }
        }

        // ── Host/port mode ────────────────────────────────────────────────────
        val jdbcUrl = JdbcTimeouts.applyTo(buildJdbcUrl(record), record.provider, timeouts)
        val username = cfg["username"] as? String ?: ""

        return try {
            val hk = HikariConfig().apply {
                this.jdbcUrl = jdbcUrl
                driverClassName = driverFor(record.provider)
                poolName = "client-${record.id}"
                maximumPoolSize = maxConnectionsPerPool
                minimumIdle = 1

                if (username.isNotBlank()) {
                    this.username = username
                }
                // Set password from secret — never log it
                if (secret != null && !secret.isCleared()) {
                    this.password = secret.asStringRetained()
                }

                isReadOnly = readOnly
            }
            applyBounds(hk)
            logEffective(record, "host-port")
            HikariDataSource(hk)
        } catch (e: Exception) {
            // Log the root cause message (safe — no JDBC URL, no credentials).
            // HikariCP wraps the real error in PoolInitializationException.cause
            val rootMsg = (e.cause?.message ?: e.message ?: e.javaClass.simpleName)
                .take(300)
                .replace(Regex("""://[^@]*@"""), "://[REDACTED]@")  // strip creds if leaked
            log.error("[clientdb] failed to create pool [connId={}, provider={}]: {}",
                record.id, record.provider, rootMsg)
            throw ClientDbPoolException(
                "Cannot create pool for connection '${record.name}' (${record.id}): $rootMsg"
            )
        }
    }

    /**
     * Pool-level bounds, applied identically to both construction paths.
     *
     * Note the absence of `connectionTestQuery`. Setting it forces HikariCP to
     * validate with `Statement.execute("SELECT 1")`, bounded only by
     * `setQueryTimeout` — the pgjdbc cancel-request path, which itself hangs
     * against an unreachable host. Without it HikariCP uses JDBC4
     * `Connection.isValid(seconds)`, which pgjdbc bounds at the socket. That is
     * the difference between "validation eventually gives up" and "validation
     * parks a pool thread forever".
     */
    private fun applyBounds(hk: HikariConfig) {
        JdbcTimeouts.applyPoolBounds(
            cfg = hk,
            t = timeouts,
            connectionTimeoutMs = connectionTimeoutMs,
            idleTimeoutMs = idleTimeoutMs,
            maxLifetimeMs = timeouts.tenantPoolMaxLifetimeMs,
            validationTimeoutMs = timeouts.tenantPoolValidationTimeoutMs,
            leakDetectionMs = timeouts.tenantPoolLeakDetectionMs,
        )
    }

    /** Log the effective bounds for this tenant pool — never the URL or credentials. */
    private fun logEffective(record: ConnectionRecord, mode: String) {
        val driverParams = JdbcTimeouts.paramsFor(record.provider, timeouts)
            .entries.joinToString(" ") { (k, v) -> "$k=$v" }
        log.info(
            "[clientdb] pool bounds [connId={}, provider={}, mode={}] driver: {} | hikari: " +
                "connectionTimeout={}ms validationTimeout={}ms maxLifetime={}ms idleTimeout={}ms leakDetection={}ms maxPoolSize={}",
            record.id, record.provider, mode, driverParams,
            connectionTimeoutMs, timeouts.tenantPoolValidationTimeoutMs,
            timeouts.tenantPoolMaxLifetimeMs, idleTimeoutMs,
            timeouts.tenantPoolLeakDetectionMs, maxConnectionsPerPool,
        )
    }

    private fun buildJdbcUrl(record: ConnectionRecord): String {
        val cfg = record.configJson

        // Allow an explicit jdbcUrl override in configJson (rare)
        val explicitUrl = cfg["jdbcUrl"] as? String
        if (!explicitUrl.isNullOrBlank()) {
            return normaliseJdbcUrl(explicitUrl, record.provider)
        }

        // Also handle a full libpq connection string stored as "connectionString" or "url"
        val connStr = cfg["connectionString"] as? String ?: cfg["url"] as? String
        if (!connStr.isNullOrBlank() &&
            (connStr.startsWith("postgresql://") || connStr.startsWith("postgres://"))) {
            return normaliseJdbcUrl(connStr, record.provider)
        }

        val host     = cfg["host"] as? String ?: "localhost"
        val port     = cfg["port"]?.toString()?.toIntOrNull() ?: defaultPortFor(record.provider)
        val database = cfg["database"] as? String ?: cfg["dbname"] as? String ?: ""

        // sslMode resolution (in priority order):
        //  1. Explicit string  cfg["sslMode"] = "require" / "disable" / etc.
        //  2. Boolean flag     cfg["sslRequired"] = true  → "require"
        //  3. Auto-detect:     non-local host             → "require"
        //                      local / Docker host        → no SSL
        val explicitSsl   = cfg["sslMode"] as? String
        val sslRequiredBool = cfg["sslRequired"] as? Boolean
        val sslMode = when {
            !explicitSsl.isNullOrBlank() -> explicitSsl
            sslRequiredBool == true      -> "require"
            sslRequiredBool == false     -> null
            isLocalHost(host)            -> null
            else                         -> "require"
        }

        return when (record.provider.lowercase()) {
            "postgresql", "postgres" -> {
                val base = "jdbc:postgresql://$host:$port/$database"
                if (!sslMode.isNullOrBlank()) "$base?sslmode=$sslMode" else base
            }
            "mysql" -> {
                val base = "jdbc:mysql://$host:$port/$database"
                if (!sslMode.isNullOrBlank()) "$base?sslMode=$sslMode" else base
            }
            "mariadb" -> "jdbc:mariadb://$host:$port/$database"
            "sqlserver", "mssql" -> "jdbc:sqlserver://$host:$port;databaseName=$database"
            else -> throw ClientDbPoolException(
                "Unsupported DB provider '${record.provider}' for connection '${record.name}'"
            )
        }
    }

    /** Returns true for hosts that are local/Docker — SSL not required. */
    private fun isLocalHost(host: String): Boolean {
        val h = host.lowercase()
        return h == "localhost" || h == "127.0.0.1" || h == "::1" ||
               h == "postgres"  || h == "postgresql" || h == "db" ||
               !h.contains('.')   // single-label names are Docker service names
    }

    private fun normaliseJdbcUrl(url: String, provider: String): String = when {
        url.startsWith("jdbc:") -> url
        url.startsWith("postgresql://") || url.startsWith("postgres://") ->
            "jdbc:postgresql://" + url.substringAfter("://")
        url.startsWith("mysql://") -> "jdbc:mysql://" + url.substringAfter("://")
        else -> url
    }

    /** A tenant connection string, split into the parts a JDBC pool can actually use. */
    internal data class ParsedConnectionString(
        val jdbcUrl: String,
        val username: String?,
        val password: String?,
    )

    /**
     * Turn a libpq-style connection string into a JDBC URL plus credentials.
     *
     * THE BUG THIS FIXES
     * ──────────────────
     * Connection-string mode stores what the user pastes — a full
     * `postgresql://user:password@host:5432/db` — and used to hand that straight
     * to the pool after only swapping the scheme for `jdbc:postgresql://`.
     *
     * pgjdbc does not accept credentials in the authority. It reads everything
     * between `//` and the next `/` as the host spec, so `user:password@host`
     * becomes the HOSTNAME, resolution fails, and the driver reports the
     * generic "The connection attempt failed" — which reads like the database is
     * unreachable, sending whoever is debugging it to check firewalls and
     * security groups for a database that was never contacted. Every database
     * tool and every db_read/db_write node on a connection-string connection
     * failed this way. Verified against pgjdbc 42.7.4: the userinfo form fails,
     * the same host with `user=`/`password=` connects.
     *
     * So the userinfo is lifted out and passed as pool credentials instead. It
     * stays out of the URL deliberately: the URL is what appears in Hikari's
     * exception messages and pool names, and a password in there is a password
     * in the logs.
     *
     * Split at the LAST `@` and the FIRST `:` — the split a URI parser makes,
     * and the one that keeps working when a password contains `@`. Both halves
     * are percent-decoded, because a password with `@`, `:` or `/` in it can
     * only reach us encoded.
     */
    internal fun parseConnectionString(raw: String, provider: String): ParsedConnectionString {
        val url = normaliseJdbcUrl(raw.trim(), provider)

        val schemeEnd = url.indexOf("//")
        if (schemeEnd < 0) return ParsedConnectionString(url, null, null)

        val authorityStart = schemeEnd + 2
        val authorityEnd = url.length.let { len ->
            val slash = url.indexOf('/', authorityStart).takeIf { it >= 0 } ?: len
            val question = url.indexOf('?', authorityStart).takeIf { it >= 0 } ?: len
            minOf(slash, question)
        }
        val authority = url.substring(authorityStart, authorityEnd)

        val at = authority.lastIndexOf('@')
        if (at < 0) return ParsedConnectionString(url, null, null)

        val userInfo = authority.substring(0, at)
        val hostPart = authority.substring(at + 1)
        val colon = userInfo.indexOf(':')
        val user = if (colon < 0) userInfo else userInfo.substring(0, colon)
        val pass = if (colon < 0) null else userInfo.substring(colon + 1)

        return ParsedConnectionString(
            jdbcUrl  = url.substring(0, authorityStart) + hostPart + url.substring(authorityEnd),
            username = user.takeIf { it.isNotBlank() }?.let { urlDecode(it) },
            password = pass?.let { urlDecode(it) },
        )
    }

    /**
     * Percent-decode one userinfo component.
     *
     * Hand-rolled rather than `URLDecoder.decode`, which is a FORM decoder: it
     * turns `+` into a space. A password containing `+` is ordinary, and silently
     * replacing it produces an authentication failure nobody can explain from the
     * error. Only `%XX` is decoded here; a malformed escape is left verbatim,
     * because a password that merely contains a literal `%` should still work.
     */
    private fun urlDecode(value: String): String {
        if (!value.contains('%')) return value
        val out = java.io.ByteArrayOutputStream(value.length)
        var i = 0
        while (i < value.length) {
            val c = value[i]
            val hex = if (c == '%' && i + 2 < value.length) {
                value.substring(i + 1, i + 3).toIntOrNull(16)
            } else null
            if (hex != null) {
                out.write(hex)
                i += 3
            } else {
                out.write(c.toString().toByteArray(Charsets.UTF_8))
                i += 1
            }
        }
        return out.toString(Charsets.UTF_8)
    }

    private fun driverFor(provider: String): String = when (provider.lowercase()) {
        "postgresql", "postgres" -> "org.postgresql.Driver"
        "mysql"                  -> "com.mysql.cj.jdbc.Driver"
        "mariadb"                -> "org.mariadb.jdbc.Driver"
        "sqlserver", "mssql"     -> "com.microsoft.sqlserver.jdbc.SQLServerDriver"
        else                     -> "org.postgresql.Driver" // fallback
    }

    private fun defaultPortFor(provider: String): Int = when (provider.lowercase()) {
        "postgresql", "postgres" -> 5432
        "mysql"                  -> 3306
        "mariadb"                -> 3306
        "sqlserver", "mssql"     -> 1433
        else                     -> 5432
    }
}

class ClientDbPoolException(message: String) : Exception(message)
