package com.vectorbea.api.connector

import com.vectorbea.api.security.Redactor
import org.slf4j.LoggerFactory
import java.sql.DriverManager
import java.util.Properties
import java.sql.SQLException
import java.sql.SQLTimeoutException

/**
 * Tests database connections by opening a JDBC connection and executing
 * a lightweight query (SELECT 1 for Postgres/MySQL, db.runCommand for MongoDB).
 *
 * SECURITY:
 * - The connection string / password is NEVER logged.
 * - Redacted form is used for any diagnostic output.
 * - Errors are sanitized before return — no host/user/password in messages.
 */
object DbTester {

    private val log = LoggerFactory.getLogger(DbTester::class.java)

    private const val CONNECT_TIMEOUT_SECONDS = 10
    private const val QUERY_TIMEOUT_SECONDS = 8

    data class DbTestInput(
        val dbType: String,      // "postgres" | "mysql" | "mongodb"
        /** Full JDBC/connection URL — NEVER log this */
        val connectionUrl: String?,
        /** Plain password — NEVER log this */
        val password: String?,
        val username: String?,
        val host: String?,
        val port: Int?,
        val database: String?,
        val sslRequired: Boolean? = null,
    )

    fun test(input: DbTestInput): ConnectionTestResult {
        val start = System.currentTimeMillis()
        return try {
            when (val kind = input.dbType.lowercase()) {
                in POSTGRES_WIRE -> testPostgres(input, start)
                in MYSQL_WIRE -> testMysql(input, start)
                "mongodb" -> testMongoDB(input, start)
                else -> ConnectionTestResult.failed(0, "UNSUPPORTED_DB",
                    "Database type '$kind' is not yet supported for testing")
            }
        } catch (e: Exception) {
            val latency = System.currentTimeMillis() - start
            // SECURITY: do not include e.message (may contain connection string details)
            val (code, msg) = classifyException(e)
            log.warn("DB connection test failed [dbType={}] errorClass={}", input.dbType, e.javaClass.simpleName)
            // The HOST is not a secret - it is the one part of the connection
            // string that turns "it failed" into "here is what to change".
            val guidance = hostGuidance(code, hostOf(input)) ?: credentialGuidance(code, input)
            ConnectionTestResult.failed(latency, code, if (guidance == null) msg else "$msg. $guidance")
        }
    }

    /* -- Wire-protocol families ------------------------------------------------
       Keyed on the WIRE PROTOCOL, not the vendor. Every product below speaks
       PostgreSQL's or MySQL's protocol, so the stock JDBC driver already talks
       to it. The previous four-name allowlist turned Timescale, Cockroach,
       Redshift, RDS, Aurora and PlanetScale away with "not yet supported for
       testing" purely because nobody had added the string - a support gap that
       was never a capability gap. */
    private val POSTGRES_WIRE = setOf(
        "postgres", "postgresql", "pgsql", "neon", "supabase", "timescale", "timescaledb",
        "cockroach", "cockroachdb", "yugabyte", "yugabytedb", "redshift", "citus",
        "aurora_postgresql", "aurora-postgresql", "rds_postgresql", "rds-postgresql",
        "cloudsql_postgresql", "alloydb", "digitalocean_postgres",
    )

    private val MYSQL_WIRE = setOf(
        "mysql", "mariadb", "planetscale", "singlestore", "vitess", "tidb",
        "aurora_mysql", "aurora-mysql", "rds_mysql", "rds-mysql", "cloudsql_mysql",
    )

    private val NETWORK_LEVEL_CODES = setOf(
        "NETWORK_UNREACHABLE", "CONNECTION_REFUSED", "DNS_FAILED", "TIMEOUT", "CONNECTION_ERROR",
    )

    private val PRIVATE_172 = Regex("^172\\.(1[6-9]|2\\d|3[01])\\.")

    /**
     * The host being dialled, for diagnosis only. Never the credentials.
     *
     * Uses the tolerant parser rather than `URI`, which is the whole point: a
     * password containing `#` or a space made `URI` throw or return a null
     * host, so the one piece of guidance that could have helped went missing on
     * exactly the connection strings that needed it most.
     */
    internal fun hostOf(input: DbTestInput): String? {
        input.host?.takeIf { it.isNotBlank() }?.let { return it }
        val url = input.connectionUrl?.takeIf { it.isNotBlank() }?.trim() ?: return null
        val normalised = if (url.startsWith("jdbc:")) url.removePrefix("jdbc:") else url
        val parsed = ConnectionUrl.parse(normalised) ?: return null
        // hostAndPath is "host[:port][/db][?query]"; take the host, allowing for
        // a bracketed IPv6 literal.
        val authority = parsed.hostAndPath.substringBefore('/').substringBefore('?')
        return when {
            authority.startsWith("[") -> authority.substringAfter('[').substringBefore(']')
            else -> authority.substringBefore(':')
        }.takeIf { it.isNotBlank() }
    }

    /**
     * The sentence that turns a network failure into a fix.
     *
     * "Database could not be reached" is true and useless. The overwhelmingly
     * common causes are knowable from the hostname alone, and each has its own
     * remedy:
     *
     *  - SUPABASE DIRECT HOSTS (db.<ref>.supabase.co) publish AAAA records only,
     *    unless the project has bought the IPv4 add-on. Vectorbea's API dials
     *    over IPv4, so the socket fails before TLS or authentication are ever
     *    attempted - which looks exactly like "unreachable" even though the
     *    credentials are perfect. Supabase's own Supavisor pooler
     *    (aws-0-<region>.pooler.supabase.com) is dual-stack, and is what the
     *    dashboard hands out under "Connection pooling". Whether the host really
     *    resolved to any IPv4 address is CHECKED before saying so, so the advice
     *    is a measurement rather than a guess.
     *
     *  - LOOPBACK AND PRIVATE ADDRESSES cannot be reached from a hosted API at
     *    all, and no amount of retrying changes that.
     */
    internal fun hostGuidance(code: String, host: String?): String? {
        if (host.isNullOrBlank()) return null
        if (code !in NETWORK_LEVEL_CODES) return null
        val h = host.lowercase()

        return when {
            h.startsWith("db.") && h.endsWith(".supabase.co") && resolvesIpv4(h) == false ->
                "This Supabase host publishes no IPv4 address and Vectorbea connects over IPv4. " +
                    "Use the connection-pooling URL from Supabase, Project Settings then Database " +
                    "(host aws-0-<region>.pooler.supabase.com, user postgres.<project-ref>), " +
                    "or enable Supabase's IPv4 add-on"

            // Same advice, hedged rather than asserted: DNS could not be
            // consulted, so we cannot claim the host is IPv6-only. The REMEDY is
            // identical either way, and withholding it until we can prove the
            // cause would leave the user with nothing to try.
            h.startsWith("db.") && h.endsWith(".supabase.co") ->
                "Supabase direct hosts are often IPv6-only, and Vectorbea connects over IPv4. " +
                    "Try the connection-pooling URL from Supabase, Project Settings then Database " +
                    "(host aws-0-<region>.pooler.supabase.com, user postgres.<project-ref>)"

            h == "localhost" || h == "127.0.0.1" || h == "::1" || h.endsWith(".local") ->
                "This address means 'this machine', and the machine running the test is " +
                    "Vectorbea's API rather than yours. Use a hostname reachable from the " +
                    "internet, or run a private runner inside your network"

            isPrivateAddress(h) ->
                "This is a private network address, which a hosted API cannot route to. " +
                    "Expose the database, or run a private runner inside your network"

            else -> null
        }
    }

    /**
     * What to change when the server said the credentials are wrong.
     *
     * "Database authentication failed - check credentials" is true and leaves
     * the user staring at a password they can see is correct. The two causes
     * that actually produce it here are both knowable without the secret:
     *
     *  - SUPABASE POOLERS TAKE A DIFFERENT USERNAME from the direct host. The
     *    pooler expects `postgres.<project-ref>`; the plain `postgres` that
     *    works against `db.<ref>.supabase.co` is rejected as a bad login. The
     *    dashboard shows both, one screen apart, and they are easy to mix.
     *
     *  - AN AMBIGUOUS PASSWORD. A password that looks like percent-encoded text
     *    cannot be distinguished from percent-encoded text, so `%2F` may have
     *    been read as `/`. Saying so is the difference between a fixable
     *    problem and a haunting.
     *
     * Neither branch echoes the password, and the username is only referred to
     * by shape.
     */
    internal fun credentialGuidance(code: String, input: DbTestInput): String? {
        if (code != "AUTH_FAILED") return null
        val target = runCatching { resolvePostgresTarget(input) }.getOrNull()
        val host = hostOf(input)?.lowercase()
        val user = target?.username

        if (host != null && host.endsWith(".pooler.supabase.com") && user != null && !user.contains('.')) {
            return "Supabase's pooler expects the username \"postgres.<project-ref>\" rather than " +
                "\"$user\" - the plain form only works against the direct db.<project-ref>.supabase.co host"
        }
        // Both readings of an ambiguous password have already been TRIED by the
        // time this runs (see attemptWithFallback), so neither was right and
        // the encoding is not the story. Say the one thing left that is useful.
        if (target?.alternatePassword != null) {
            return "Both readings of the password in this URL were tried - as written, and " +
                "percent-decoded - and the server rejected both. Reset the database password, " +
                "or supply it in the separate password field where no decoding is applied"
        }
        // No ambiguity to resolve, but the password does carry characters a
        // stricter client would have required encoded. It was read literally
        // here, which is what the user meant; other tools may disagree.
        if (ConnectionUrl.containsUnencodedReserved(target?.password)) {
            return "The password contains characters that are reserved in a URL (@ / ? # [ ] or a " +
                "space) and was read literally. If you percent-encoded it before pasting, supply " +
                "it in the separate password field instead, where no decoding is applied"
        }
        return null
    }

    /**
     * Try the password, and on an authentication failure try the other reading.
     *
     * A connection string cannot say whether `%2F` in a password is an escape
     * for `/` or four literal characters. Both populations exist: people paste
     * an already-encoded URL out of a dashboard, and people type their password
     * in raw. Whichever way the parser guesses, it is wrong for the other half,
     * and being wrong looks like "Database authentication failed - check
     * credentials" against credentials that are, visibly, correct. That is the
     * bug this whole path exists to close.
     *
     * So it stops guessing and asks the server, which is the only party that
     * knows. Bounded deliberately:
     *
     *  - only on AUTH_FAILED, never on a timeout or an unreachable host, where
     *    a second dial would just double the wait;
     *  - only when the two readings actually differ, so the ordinary case makes
     *    exactly one attempt;
     *  - once. There is no third interpretation to try.
     *
     * That is at most one extra login attempt, on a connection test the user
     * explicitly asked for, and only when the first was already rejected.
     *
     * The ORIGINAL failure is what surfaces if the retry also fails: the user
     * asked about the credentials they supplied, and an error describing our
     * fallback guess would send them after a password they never typed.
     */
    internal fun <T> attemptWithFallback(
        primary: String?,
        alternate: String?,
        open: (String?) -> T,
    ): T = try {
        open(primary)
    } catch (first: Exception) {
        if (alternate == null || classifyException(first).first != "AUTH_FAILED") throw first
        try {
            open(alternate)
        } catch (_: Exception) {
            throw first
        }
    }

    /** True/false when DNS answered, null when it could not be asked. */
    internal fun resolvesIpv4(host: String): Boolean? = try {
        java.net.InetAddress.getAllByName(host).any { it is java.net.Inet4Address }
    } catch (_: java.net.UnknownHostException) {
        null
    } catch (_: SecurityException) {
        null
    }

    internal fun isPrivateAddress(host: String): Boolean =
        host.startsWith("10.") || host.startsWith("192.168.") || PRIVATE_172.containsMatchIn(host)

    // ── Postgres ──────────────────────────────────────────────────────────────

    private fun testPostgres(input: DbTestInput, start: Long): ConnectionTestResult {
        val target = resolvePostgresTarget(input)
        return attemptWithFallback(target.password, target.alternatePassword) { password ->
            val props = Properties().apply {
                setProperty("connectTimeout", CONNECT_TIMEOUT_SECONDS.toString())
                setProperty("socketTimeout", QUERY_TIMEOUT_SECONDS.toString())
                setProperty("loginTimeout", CONNECT_TIMEOUT_SECONDS.toString())
                // SECURITY: SSL preferred but not required for test (may be self-signed in dev).
                // An sslmode already present in the URL WINS: a user who wrote
                // ?sslmode=verify-full asked for certificate verification, and
                // silently downgrading them to "prefer" would make the test pass on
                // a connection the engine would later refuse.
                if (!target.jdbcUrl.contains("sslmode=", ignoreCase = true)) {
                    setProperty("sslmode", if (input.sslRequired == true) "require" else "prefer")
                }
                if (!target.username.isNullOrBlank()) setProperty("user", target.username)
                if (!password.isNullOrBlank()) setProperty("password", password)
            }

            // SECURITY: do not log jdbcUrl — it may contain credentials
            DriverManager.getConnection(target.jdbcUrl, props).use { conn ->
                conn.createStatement().use { stmt ->
                    stmt.queryTimeout = QUERY_TIMEOUT_SECONDS
                    stmt.executeQuery("SELECT 1").use { rs ->
                        rs.next()
                        val latencyMs = System.currentTimeMillis() - start
                        val version = safeGetDbVersion(conn)
                        ConnectionTestResult.connected(
                            latencyMs = latencyMs,
                            message = "PostgreSQL connection successful",
                            details = mapOf("dbVersion" to version),
                        )
                    }
                }
            }
        }
    }

    internal data class PostgresTarget(
        val jdbcUrl: String,
        val username: String?,
        val password: String?,
        /**
         * The password read the other way, or null when there is only one reading.
         *
         * `%2F` inside a password is either an escape for `/` or four literal
         * characters, and the connection string cannot say which. Guessing wrong
         * produced AUTH_FAILED against a password the user could see was correct.
         * Rather than explain that in prose, [testPostgres] tries this on an
         * authentication failure. See [attemptWithFallback].
         */
        val alternatePassword: String? = null,
    )

    /** Convert common postgres:// URLs into a JDBC URL and JDBC properties.
     * PostgreSQL's JDBC driver does not accept user:password in the URL authority,
     * so credentials must be extracted before opening the connection. */
    internal fun resolvePostgresTarget(input: DbTestInput): PostgresTarget {
        if (!input.connectionUrl.isNullOrBlank()) {
            val url = input.connectionUrl.trim()
            val parseable = when {
                url.startsWith("jdbc:postgresql://") -> url.removePrefix("jdbc:")
                url.startsWith("postgres://") -> "postgresql://" + url.removePrefix("postgres://")
                url.startsWith("postgresql://") -> url
                else -> null
            }
            val parsed = parseable?.let { ConnectionUrl.parse(it) }
            if (parsed != null) {
                return PostgresTarget(
                    jdbcUrl = "jdbc:postgresql://${parsed.hostAndPath}",
                    // Blank, not merely null: an empty field in the form used to
                    // win over the credentials embedded in the URL, and an empty
                    // user makes the driver fall back to the OS account — which
                    // fails as AUTH_FAILED with nothing to suggest the username
                    // was never sent at all.
                    username = input.username?.takeIf { it.isNotBlank() } ?: parsed.username,
                    password = input.password?.takeIf { it.isNotBlank() } ?: parsed.password,
                    // Only when the URL supplied the password. A password typed
                    // into its own form field is never percent-encoded, so there
                    // is no second reading to try.
                    alternatePassword = if (input.password.isNullOrBlank()) {
                        parsed.rawPassword?.takeIf { it != parsed.password }
                    } else {
                        null
                    },
                )
            }
            return PostgresTarget(
                jdbcUrl = if (url.startsWith("jdbc:")) url else "jdbc:postgresql://$url",
                username = input.username?.takeIf { it.isNotBlank() },
                password = input.password?.takeIf { it.isNotBlank() },
            )
        }
        val host = input.host ?: "localhost"
        val port = input.port ?: 5432
        val db = input.database ?: "postgres"
        return PostgresTarget(
            "jdbc:postgresql://$host:$port/$db",
            input.username?.takeIf { it.isNotBlank() },
            input.password?.takeIf { it.isNotBlank() },
        )
    }

    // ── MySQL ─────────────────────────────────────────────────────────────────

    private fun testMysql(input: DbTestInput, start: Long): ConnectionTestResult {
        val target = resolveMysqlTarget(input)
        return attemptWithFallback(target.password, target.alternatePassword) { password ->
            val props = Properties().apply {
                setProperty("connectTimeout", (CONNECT_TIMEOUT_SECONDS * 1000).toString())
                setProperty("socketTimeout", (QUERY_TIMEOUT_SECONDS * 1000).toString())
                if (!target.username.isNullOrBlank()) setProperty("user", target.username)
                if (!password.isNullOrBlank()) setProperty("password", password)
            }

            DriverManager.getConnection(target.jdbcUrl, props).use { conn ->
                conn.createStatement().use { stmt ->
                    stmt.queryTimeout = QUERY_TIMEOUT_SECONDS
                    stmt.executeQuery("SELECT 1").use { rs ->
                        rs.next()
                        val latency = System.currentTimeMillis() - start
                        ConnectionTestResult.connected(latency, "MySQL connection successful")
                    }
                }
            }
        }
    }

    internal data class MysqlTarget(
        val jdbcUrl: String,
        val username: String?,
        val password: String?,
        /** The password read the other way. See [PostgresTarget.alternatePassword]. */
        val alternatePassword: String? = null,
    )

    internal fun resolveMysqlTarget(input: DbTestInput): MysqlTarget {
        if (!input.connectionUrl.isNullOrBlank()) {
            val raw = input.connectionUrl.trim()
            val parseable = when {
                raw.startsWith("jdbc:mysql://") -> raw.removePrefix("jdbc:")
                raw.startsWith("mysql://") -> raw
                else -> null
            }
            // Same parser as Postgres: MySQL passwords carry the same reserved
            // characters and broke in exactly the same way.
            val parsed = parseable?.let { ConnectionUrl.parse(it) }
            if (parsed != null) {
                return MysqlTarget(
                    jdbcUrl = "jdbc:mysql://${parsed.hostAndPath}",
                    username = input.username?.takeIf { it.isNotBlank() } ?: parsed.username,
                    password = input.password?.takeIf { it.isNotBlank() } ?: parsed.password,
                    alternatePassword = if (input.password.isNullOrBlank()) {
                        parsed.rawPassword?.takeIf { it != parsed.password }
                    } else {
                        null
                    },
                )
            }
            return MysqlTarget(
                jdbcUrl = if (raw.startsWith("jdbc:")) raw else "jdbc:mysql://$raw",
                username = input.username?.takeIf { it.isNotBlank() },
                password = input.password?.takeIf { it.isNotBlank() },
            )
        }

        return run {
            val host = input.host ?: "localhost"
            val port = input.port ?: 3306
            val db = input.database ?: ""
            MysqlTarget(
                "jdbc:mysql://$host:$port/$db",
                input.username?.takeIf { it.isNotBlank() },
                input.password?.takeIf { it.isNotBlank() },
            )
        }
    }

    // ── MongoDB (scaffold) ────────────────────────────────────────────────────

    private fun testMongoDB(input: DbTestInput, start: Long): ConnectionTestResult {
        // MongoDB driver not on classpath — return informative failure
        // When the mongo-driver dependency is added, implement here.
        return ConnectionTestResult.failed(
            latencyMs = System.currentTimeMillis() - start,
            errorCode = "DRIVER_NOT_AVAILABLE",
            message = "MongoDB driver not available in this build. Add mongo-driver-sync dependency."
        )
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    private fun safeGetDbVersion(conn: java.sql.Connection): String? = try {
        conn.metaData.databaseProductVersion
    } catch (_: Exception) { null }

    internal fun classifyException(e: Exception): Pair<String, String> {
        val chain = generateSequence<Throwable>(e) { it.cause }.take(12).toList()
        val msg = chain.joinToString(" ") { it.message.orEmpty().lowercase() }
        val sqlState = chain.filterIsInstance<SQLException>().firstNotNullOfOrNull { it.sqlState }
        return when {
            chain.any { it is SQLTimeoutException || it is java.net.SocketTimeoutException } || msg.contains("timeout") ->
                "TIMEOUT" to "Database connection timed out - check network access, host, and port"
            sqlState?.startsWith("28") == true || msg.contains("authentication") ||
                msg.contains("password authentication failed") || msg.contains("access denied for user") ->
                "AUTH_FAILED" to "Database authentication failed - check credentials"
            sqlState == "3D000" || (msg.contains("database") && msg.contains("not exist")) ->
                "DATABASE_NOT_FOUND" to "Database not found - check database name"
            msg.contains("no suitable driver") ->
                "DRIVER_NOT_AVAILABLE" to "This database driver is not available in the API service"
            msg.contains("ssl") || msg.contains("tls") || msg.contains("certificate") ->
                "TLS_FAILED" to "TLS/SSL handshake failed - check the server certificate and SSL mode"
            chain.any { it is java.net.UnknownHostException } || msg.contains("unknown host") ->
                "DNS_FAILED" to "Database host could not be resolved - check the hostname"
            chain.any { it is java.net.ConnectException } || msg.contains("connection refused") ->
                "CONNECTION_REFUSED" to "Database refused the connection - check host, port, and firewall rules"
            e is IllegalArgumentException || e is java.net.URISyntaxException ->
                "INVALID_CONNECTION_STRING" to "The database connection string is invalid"
            sqlState?.startsWith("08") == true ->
                "NETWORK_UNREACHABLE" to "Database could not be reached from Vectorbea - allow the service egress IPs or configure a private runner"
            chain.any { it is SQLException } ->
                "DATABASE_ERROR" to "Database rejected the connection test"
            else ->
                "CONNECTION_ERROR" to "Database connection failed - verify the connection settings and network access"
        }
    }
}
