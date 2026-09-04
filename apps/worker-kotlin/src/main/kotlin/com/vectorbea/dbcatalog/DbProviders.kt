package com.vectorbea.dbcatalog

/* ══════════════════════════════════════════════════════════════════════════════
   WHAT A DATABASE PROVIDER IS — resolved in exactly one place.

   THE BUG THIS CLOSES. Three parts of this product independently decided what a
   `provider` string means, and all three disagreed:

     · `DbTester.POSTGRES_WIRE` / `MYSQL_WIRE` (api) knew about neon, supabase,
       timescale, cockroach, planetscale, aurora — a wide list, keyed on the wire
       protocol, so testing those worked.

     · `ClientDbPoolManager.driverFor` / `defaultPortFor` / `buildJdbcUrl`
       (worker) knew about exactly four names. `buildJdbcUrl` THREW
       "Unsupported DB provider 'supabase'", and `driverFor` silently returned
       the PostgreSQL driver for every unknown name — including `planetscale`
       and `aiven`, which speak MySQL.

     · `JdbcTimeouts.paramsFor` (worker) knew about the same four, and returned
       an EMPTY map for anything else. `applyTo` short-circuits on an empty map,
       so a connection stored as provider `supabase` got no connectTimeout, no
       socketTimeout and no prepareThreshold — silently opting that tenant out of
       the only bound protecting every other tenant's execution slot.

   The visible symptom was the worst kind: a connection that TESTS GREEN in the
   API and then fails, or hangs, the first time a run reaches it. The registry
   said the credential was good, because the part of the system that dialled it
   understood the provider and the part that would later use it did not.

   So the mapping lives here, once, and both services compile this same file —
   `api-kotlin/build.gradle.kts` adds this directory as a source root, the same
   way it already shares the contract expression language. See the comment there.

   WHAT A MODE IS, AND WHY IT IS NOT COSMETIC. Managed Postgres and MySQL are
   almost never reached directly any more; they are reached through a pooler, and
   WHICH pooler changes what the driver may do:

     · TRANSACTION pooling (PgBouncer/Supavisor transaction mode, RDS Proxy,
       Neon's -pooler endpoint) multiplexes many clients over few backends and
       hands the backend back at COMMIT. Named server-side prepared statements do
       not survive that. pgjdbc promotes a statement to a named one after the
       fifth identical execution, so a db_read node succeeds four times and then
       starts failing with `prepared statement "S_1" already exists`. The fix is
       `prepareThreshold=0`, and it can only be applied by something that knows
       the connection is transaction-pooled.

     · SESSION pooling keeps one backend for the life of the connection, so
       prepared statements, `SET`, advisory locks and temp tables all work — but
       the connection ceiling is much lower.

     · DIRECT is the full session, and on several providers it is also the only
       mode with an IPv4 address, or the only one that is NOT available on the
       free tier.

   Nothing here can be inferred safely from the connection string alone, which is
   why [ConnectionMode] is an explicit choice with a detected default rather than
   a guess.
══════════════════════════════════════════════════════════════════════════════ */

/** The protocol on the wire, which is what actually decides the driver. */
enum class DbWire { POSTGRES, MYSQL, SQLSERVER, MONGODB }

/**
 * How the connection reaches the database.
 *
 * The names are the ones the provider dashboards use, because the user is
 * copying a string out of one of those dashboards and the words have to match.
 */
enum class ConnectionMode {
    /** Straight to the database. Full session semantics, lowest connection ceiling. */
    DIRECT,

    /** One backend held for the life of the connection. Session state works. */
    SESSION_POOLER,

    /** Backend returned at COMMIT. No named prepared statements, no session state. */
    TRANSACTION_POOLER;

    companion object {
        /**
         * Parse the value stored in `config.connectionMode`. Unknown → null.
         *
         * `connection_string` and `host_port` are deliberately NOT modes. They
         * are the pre-existing values of that same key, describing how the
         * credential was ENTERED rather than how the database is reached, and
         * they must fall through to null so a connection saved before modes
         * existed keeps its detected default.
         */
        fun parse(raw: String?): ConnectionMode? = when (raw?.trim()?.lowercase()?.replace('-', '_')) {
            "direct", "direct_connection", "no_pooler" -> DIRECT
            "session", "session_pooler", "session_pooling", "session_mode" -> SESSION_POOLER
            "transaction", "transaction_pooler", "transaction_pooling", "transaction_mode", "pooled" ->
                TRANSACTION_POOLER
            else -> null
        }
    }
}

/** TLS expectation for a provider, which is not a user preference on managed hosts. */
enum class TlsPolicy {
    /** The server refuses cleartext. Never downgrade. */
    REQUIRED,

    /** Encrypt when offered; do not fail the connection if it is not. */
    PREFERRED,

    /** The server presents a certificate chaining to a public CA — verify the hostname. */
    VERIFY_IDENTITY,
}

/**
 * One database product Vectorbea can reach.
 *
 * [hostPatterns] exist so the product can name the provider from a pasted
 * connection string. That matters more than it sounds: almost every diagnostic
 * worth printing ("Aiven allowlists client IPs", "this Supabase host has no
 * IPv4 address") is only actionable once you know WHOSE database it is, and the
 * user selecting "Postgres" from a dropdown never tells us that.
 */
data class DbProvider(
    val id: String,
    val label: String,
    val wire: DbWire,
    /** Aliases accepted in the stored `provider` column. */
    val aliases: Set<String> = emptySet(),
    /** Regexes matched against the HOSTNAME, lower-cased. */
    val hostPatterns: List<Regex> = emptyList(),
    val defaultPort: Int = if (wire == DbWire.MYSQL) 3306 else 5432,
    /** Modes this product actually offers. A single-entry set means no choice to make. */
    val modes: Set<ConnectionMode> = setOf(ConnectionMode.DIRECT),
    val tls: TlsPolicy = TlsPolicy.PREFERRED,
    /** Shown under the mode picker. One sentence per mode, in the provider's own words. */
    val modeNotes: Map<ConnectionMode, String> = emptyMap(),
    /** Printed when a connection to this provider fails at the network level. */
    val networkHint: String? = null,
    /** Printed when this provider rejects the credentials. */
    val authHint: String? = null,
    /** Where the connection string is found, for the connect dialog. */
    val whereToFind: String? = null,
) {
    /** True when the user has a real decision to make about pooling. */
    val hasModeChoice: Boolean get() = modes.size > 1
}

object DbProviders {

    // ── Postgres ──────────────────────────────────────────────────────────────

    private val SUPABASE = DbProvider(
        id = "supabase", label = "Supabase", wire = DbWire.POSTGRES,
        hostPatterns = listOf(
            Regex("""^db\.[a-z0-9]+\.supabase\.co$"""),
            Regex("""\.pooler\.supabase\.com$"""),
        ),
        modes = setOf(ConnectionMode.DIRECT, ConnectionMode.SESSION_POOLER, ConnectionMode.TRANSACTION_POOLER),
        tls = TlsPolicy.REQUIRED,
        modeNotes = mapOf(
            ConnectionMode.DIRECT to
                "db.<ref>.supabase.co:5432. IPv6-only unless the project has the IPv4 add-on, " +
                "and Vectorbea dials over IPv4 — so this usually cannot be reached from here.",
            ConnectionMode.SESSION_POOLER to
                "aws-0-<region>.pooler.supabase.com:5432, user postgres.<project-ref>. " +
                "Dual-stack, full session semantics. This is the one to use.",
            ConnectionMode.TRANSACTION_POOLER to
                "aws-0-<region>.pooler.supabase.com:6543. Highest connection ceiling, " +
                "but no prepared statements, no SET and no temp tables.",
        ),
        /* No provider-wide networkHint on purpose. The IPv4 advice is true of
           `db.<ref>.supabase.co` and false of `*.pooler.supabase.com`, and
           `DbTester.hostGuidance` already distinguishes them — it even checks
           DNS before asserting. A blanket hint here fires on the pooler host as
           well, telling someone who is already using the fix to go and use the
           fix. */
        authHint = "The pooler expects the username postgres.<project-ref>, not the plain postgres " +
            "that works against the direct host.",
        whereToFind = "Project Settings → Database → Connection string",
    )

    private val NEON = DbProvider(
        id = "neon", label = "Neon", wire = DbWire.POSTGRES,
        hostPatterns = listOf(Regex("""\.neon\.tech$"""), Regex("""\.neon\.build$""")),
        modes = setOf(ConnectionMode.DIRECT, ConnectionMode.TRANSACTION_POOLER),
        tls = TlsPolicy.REQUIRED,
        modeNotes = mapOf(
            ConnectionMode.DIRECT to
                "ep-<endpoint>.<region>.aws.neon.tech. Full session semantics.",
            ConnectionMode.TRANSACTION_POOLER to
                "ep-<endpoint>-pooler.<region>.aws.neon.tech — PgBouncer in transaction mode. " +
                "Note the -pooler suffix on the endpoint id.",
        ),
        networkHint = "Neon suspends idle computes. The first connection after a suspend can take " +
            "several seconds while the compute resumes — that is a slow success, not a failure.",
        whereToFind = "Dashboard → Connection details (toggle \"Pooled connection\")",
    )

    private val AIVEN_PG = DbProvider(
        id = "aiven_postgresql", label = "Aiven for PostgreSQL", wire = DbWire.POSTGRES,
        aliases = setOf("aiven_pg", "aiven-postgresql"),
        hostPatterns = listOf(Regex("""^pg-.*\.aivencloud\.com$""")),
        modes = setOf(ConnectionMode.DIRECT, ConnectionMode.TRANSACTION_POOLER),
        tls = TlsPolicy.REQUIRED,
        modeNotes = mapOf(
            ConnectionMode.DIRECT to "The service URI on the Overview tab. Port is per-service, not 5432.",
            ConnectionMode.TRANSACTION_POOLER to
                "A PgBouncer pool created under Pools. It has its OWN port and its own URI — " +
                "the direct port will not reach it.",
        ),
        networkHint = "Aiven allowlists client IPs per service. Add the Vectorbea egress addresses " +
            "under Service settings → Allowed IP addresses, or the connection is dropped before TLS.",
        whereToFind = "Service → Overview → Connection information",
    )

    private val RDS_PG = DbProvider(
        id = "rds_postgresql", label = "Amazon RDS / Aurora PostgreSQL", wire = DbWire.POSTGRES,
        aliases = setOf("aurora_postgresql", "aurora-postgresql", "rds-postgresql", "rds_pg"),
        hostPatterns = listOf(
            Regex("""\.rds\.amazonaws\.com$"""),
            Regex("""\.rds\.[a-z0-9-]+\.amazonaws\.com\.cn$"""),
        ),
        modes = setOf(ConnectionMode.DIRECT, ConnectionMode.SESSION_POOLER, ConnectionMode.TRANSACTION_POOLER),
        tls = TlsPolicy.REQUIRED,
        modeNotes = mapOf(
            ConnectionMode.DIRECT to "The instance or cluster endpoint.",
            ConnectionMode.SESSION_POOLER to
                "An RDS Proxy endpoint (*.proxy-*.rds.amazonaws.com) with session pinning.",
            ConnectionMode.TRANSACTION_POOLER to
                "An RDS Proxy endpoint in the default transaction mode. Prepared statements " +
                "pin the connection, which defeats the proxy — Vectorbea disables them.",
        ),
        networkHint = "RDS instances are private by default. The instance must be publicly accessible " +
            "AND its security group must allow inbound 5432 from the Vectorbea egress addresses.",
        whereToFind = "RDS console → Databases → Connectivity & security",
    )

    private val AZURE_PG = DbProvider(
        id = "azure_postgresql", label = "Azure Database for PostgreSQL", wire = DbWire.POSTGRES,
        aliases = setOf("azure_pg", "azure-postgresql"),
        hostPatterns = listOf(Regex("""\.postgres\.database\.azure\.com$""")),
        defaultPort = 5432,
        modes = setOf(ConnectionMode.DIRECT, ConnectionMode.TRANSACTION_POOLER),
        tls = TlsPolicy.REQUIRED,
        modeNotes = mapOf(
            ConnectionMode.DIRECT to "Port 5432 on the server endpoint.",
            ConnectionMode.TRANSACTION_POOLER to
                "Flexible Server ships PgBouncer on port 6432. Enable it under " +
                "Server parameters → pgbouncer.enabled first.",
        ),
        networkHint = "Azure requires a firewall rule per client IP. Add the Vectorbea egress " +
            "addresses under Networking → Firewall rules.",
        authHint = "Single Server (the retired tier) requires the username in the form " +
            "user@servername. Flexible Server takes the plain username.",
        whereToFind = "Server → Settings → Connection strings",
    )

    private val CLOUDSQL_PG = DbProvider(
        id = "cloudsql_postgresql", label = "Google Cloud SQL for PostgreSQL", wire = DbWire.POSTGRES,
        aliases = setOf("cloudsql_pg", "gcp_postgresql", "cloudsql-postgresql"),
        hostPatterns = listOf(Regex("""\.cloudsql\..*\.goog$""")),
        tls = TlsPolicy.REQUIRED,
        networkHint = "Cloud SQL rejects anything not in Authorized networks. Add the Vectorbea " +
            "egress addresses under Connections → Networking, and give the instance a public IP.",
        whereToFind = "Instance → Overview → Connect to this instance",
    )

    private val ALLOYDB = DbProvider(
        id = "alloydb", label = "Google AlloyDB", wire = DbWire.POSTGRES,
        tls = TlsPolicy.REQUIRED,
        networkHint = "AlloyDB is VPC-only. It cannot be reached from a hosted API without a " +
            "private runner inside the VPC.",
    )

    private val TIMESCALE = DbProvider(
        id = "timescale", label = "Timescale Cloud", wire = DbWire.POSTGRES,
        aliases = setOf("timescaledb"),
        hostPatterns = listOf(Regex("""\.tsdb\.cloud\.timescale\.com$""")),
        modes = setOf(ConnectionMode.DIRECT, ConnectionMode.TRANSACTION_POOLER),
        tls = TlsPolicy.REQUIRED,
        modeNotes = mapOf(
            ConnectionMode.DIRECT to "The service URL, port 3xxxx.",
            ConnectionMode.TRANSACTION_POOLER to "The connection pooler port shown beside it in the console.",
        ),
        whereToFind = "Service → Connection info",
    )

    private val COCKROACH = DbProvider(
        id = "cockroachdb", label = "CockroachDB Cloud", wire = DbWire.POSTGRES,
        aliases = setOf("cockroach"),
        hostPatterns = listOf(Regex("""\.cockroachlabs\.cloud$""")),
        defaultPort = 26257,
        tls = TlsPolicy.VERIFY_IDENTITY,
        networkHint = "CockroachDB Cloud verifies the server certificate against a public CA and " +
            "allowlists client IPs. Both must be in place.",
        whereToFind = "Cluster → Connect → General connection string",
    )

    private val DIGITALOCEAN_PG = DbProvider(
        id = "digitalocean_postgresql", label = "DigitalOcean Managed Postgres", wire = DbWire.POSTGRES,
        aliases = setOf("digitalocean_postgres", "do_postgresql"),
        hostPatterns = listOf(Regex("""\.db\.ondigitalocean\.com$""")),
        modes = setOf(ConnectionMode.DIRECT, ConnectionMode.TRANSACTION_POOLER),
        tls = TlsPolicy.REQUIRED,
        modeNotes = mapOf(
            ConnectionMode.DIRECT to "The primary connection details, port 25060.",
            ConnectionMode.TRANSACTION_POOLER to
                "A connection pool created under the Connection Pools tab. It has its own port " +
                "and its own database name.",
        ),
        networkHint = "DigitalOcean databases have a trusted-sources list. Add the Vectorbea egress " +
            "addresses, or set it to allow all inbound.",
    )

    private val HEROKU_PG = DbProvider(
        id = "heroku_postgresql", label = "Heroku Postgres", wire = DbWire.POSTGRES,
        aliases = setOf("heroku_postgres"),
        hostPatterns = listOf(Regex("""\.compute-\d+\.amazonaws\.com$""")),
        tls = TlsPolicy.REQUIRED,
        networkHint = "Heroku Postgres requires TLS but presents a self-signed certificate, so " +
            "hostname verification must stay off.",
    )

    private val RENDER_PG = DbProvider(
        id = "render_postgresql", label = "Render Postgres", wire = DbWire.POSTGRES,
        hostPatterns = listOf(Regex("""\.render\.com$"""), Regex("""\.oregon-postgres\.render\.com$""")),
        tls = TlsPolicy.REQUIRED,
        networkHint = "Use the EXTERNAL database URL. The internal one only resolves inside Render.",
    )

    private val RAILWAY_PG = DbProvider(
        id = "railway_postgresql", label = "Railway Postgres", wire = DbWire.POSTGRES,
        hostPatterns = listOf(Regex("""\.railway\.app$"""), Regex("""\.rlwy\.net$""")),
        tls = TlsPolicy.PREFERRED,
        networkHint = "Use the public networking URL. The *.railway.internal host only resolves " +
            "inside Railway's private network.",
    )

    private val REDSHIFT = DbProvider(
        id = "redshift", label = "Amazon Redshift", wire = DbWire.POSTGRES,
        hostPatterns = listOf(Regex("""\.redshift\.amazonaws\.com$""")),
        defaultPort = 5439,
        tls = TlsPolicy.REQUIRED,
        networkHint = "The cluster must be publicly accessible and its security group must allow " +
            "inbound 5439 from the Vectorbea egress addresses.",
    )

    private val YUGABYTE = DbProvider(
        id = "yugabytedb", label = "YugabyteDB", wire = DbWire.POSTGRES,
        aliases = setOf("yugabyte"), defaultPort = 5433, tls = TlsPolicy.REQUIRED,
    )

    private val CITUS = DbProvider(id = "citus", label = "Citus", wire = DbWire.POSTGRES, tls = TlsPolicy.REQUIRED)

    private val POSTGRES = DbProvider(
        id = "postgresql", label = "PostgreSQL", wire = DbWire.POSTGRES,
        aliases = setOf("postgres", "pgsql", "pg", "postgresql_enterprise", "self_hosted_postgresql"),
        modes = setOf(ConnectionMode.DIRECT, ConnectionMode.SESSION_POOLER, ConnectionMode.TRANSACTION_POOLER),
        tls = TlsPolicy.PREFERRED,
        modeNotes = mapOf(
            ConnectionMode.DIRECT to "Straight to Postgres. Full session semantics.",
            ConnectionMode.SESSION_POOLER to
                "Through PgBouncer or pgpool in session mode. Session state survives.",
            ConnectionMode.TRANSACTION_POOLER to
                "Through PgBouncer or pgpool in transaction mode. Vectorbea disables server-side " +
                "prepared statements, which a transaction pooler cannot carry.",
        ),
        whereToFind = "Whatever your DBA or platform team hands out",
    )

    // ── MySQL ─────────────────────────────────────────────────────────────────

    private val AIVEN_MYSQL = DbProvider(
        id = "aiven_mysql", label = "Aiven for MySQL", wire = DbWire.MYSQL,
        aliases = setOf("aiven", "aiven-mysql"),
        hostPatterns = listOf(Regex("""^mysql-.*\.aivencloud\.com$""")),
        modes = setOf(ConnectionMode.DIRECT),
        tls = TlsPolicy.REQUIRED,
        modeNotes = mapOf(
            ConnectionMode.DIRECT to
                "The service URI on the Overview tab — user avnadmin, database defaultdb, and a " +
                "per-service port that is never 3306.",
        ),
        networkHint = "Aiven allowlists client IPs per service. Add the Vectorbea egress addresses " +
            "under Service settings → Allowed IP addresses.",
        authHint = "Aiven refuses cleartext connections. The ssl-mode=REQUIRED in Aiven's own URI is " +
            "a MySQL CLI option that the JDBC driver ignores, so Vectorbea sets the JDBC equivalent " +
            "itself — that is why this works here without editing the string.",
        whereToFind = "Service → Overview → Connection information",
    )

    private val PLANETSCALE = DbProvider(
        id = "planetscale", label = "PlanetScale", wire = DbWire.MYSQL,
        hostPatterns = listOf(Regex("""\.psdb\.cloud$"""), Regex("""\.connect\.psdb\.cloud$""")),
        modes = setOf(ConnectionMode.TRANSACTION_POOLER),
        tls = TlsPolicy.VERIFY_IDENTITY,
        modeNotes = mapOf(
            ConnectionMode.TRANSACTION_POOLER to
                "PlanetScale is Vitess — every connection goes through the pooler and there is no " +
                "direct mode. It has no session state to lose.",
        ),
        networkHint = "PlanetScale terminates TLS with a publicly trusted certificate and refuses " +
            "cleartext entirely.",
        whereToFind = "Database → Connect → General (choose the Java/JDBC format)",
    )

    private val RDS_MYSQL = DbProvider(
        id = "rds_mysql", label = "Amazon RDS / Aurora MySQL", wire = DbWire.MYSQL,
        aliases = setOf("aurora_mysql", "aurora-mysql", "rds-mysql"),
        hostPatterns = listOf(Regex("""\.rds\.amazonaws\.com$""")),
        modes = setOf(ConnectionMode.DIRECT, ConnectionMode.SESSION_POOLER, ConnectionMode.TRANSACTION_POOLER),
        tls = TlsPolicy.REQUIRED,
        modeNotes = mapOf(
            ConnectionMode.DIRECT to "The instance or cluster endpoint.",
            ConnectionMode.SESSION_POOLER to "An RDS Proxy endpoint with session pinning.",
            ConnectionMode.TRANSACTION_POOLER to "An RDS Proxy endpoint in the default transaction mode.",
        ),
        networkHint = "RDS instances are private by default. The instance must be publicly accessible " +
            "AND its security group must allow inbound 3306 from the Vectorbea egress addresses.",
    )

    private val AZURE_MYSQL = DbProvider(
        id = "azure_mysql", label = "Azure Database for MySQL", wire = DbWire.MYSQL,
        aliases = setOf("azure-mysql"),
        hostPatterns = listOf(Regex("""\.mysql\.database\.azure\.com$""")),
        tls = TlsPolicy.REQUIRED,
        networkHint = "Azure requires a firewall rule per client IP. Add the Vectorbea egress " +
            "addresses under Networking → Firewall rules.",
        authHint = "Single Server (the retired tier) requires the username in the form " +
            "user@servername. Flexible Server takes the plain username.",
    )

    private val CLOUDSQL_MYSQL = DbProvider(
        id = "cloudsql_mysql", label = "Google Cloud SQL for MySQL", wire = DbWire.MYSQL,
        aliases = setOf("gcp_mysql", "cloudsql-mysql"),
        hostPatterns = listOf(Regex("""\.cloudsql\..*\.goog$""")),
        tls = TlsPolicy.REQUIRED,
        networkHint = "Cloud SQL rejects anything not in Authorized networks. Add the Vectorbea " +
            "egress addresses under Connections → Networking.",
    )

    private val TIDB = DbProvider(
        id = "tidb", label = "TiDB Cloud", wire = DbWire.MYSQL,
        hostPatterns = listOf(Regex("""\.tidbcloud\.com$""")),
        defaultPort = 4000,
        tls = TlsPolicy.VERIFY_IDENTITY,
        networkHint = "TiDB Serverless requires TLS with hostname verification and allowlists client IPs.",
    )

    private val SINGLESTORE = DbProvider(
        id = "singlestore", label = "SingleStore", wire = DbWire.MYSQL,
        hostPatterns = listOf(Regex("""\.singlestore\.com$"""), Regex("""\.memcompute\.com$""")),
        defaultPort = 3306, tls = TlsPolicy.REQUIRED,
    )

    private val MARIADB = DbProvider(
        id = "mariadb", label = "MariaDB", wire = DbWire.MYSQL,
        aliases = setOf("mariadb_enterprise", "skysql"),
        tls = TlsPolicy.PREFERRED,
    )

    private val VITESS = DbProvider(id = "vitess", label = "Vitess", wire = DbWire.MYSQL, tls = TlsPolicy.PREFERRED)

    private val MYSQL = DbProvider(
        id = "mysql", label = "MySQL", wire = DbWire.MYSQL,
        aliases = setOf("mysql8", "self_hosted_mysql", "mysql_enterprise"),
        modes = setOf(ConnectionMode.DIRECT, ConnectionMode.SESSION_POOLER, ConnectionMode.TRANSACTION_POOLER),
        tls = TlsPolicy.PREFERRED,
        modeNotes = mapOf(
            ConnectionMode.DIRECT to "Straight to MySQL.",
            ConnectionMode.SESSION_POOLER to "Through ProxySQL or MySQL Router with session affinity.",
            ConnectionMode.TRANSACTION_POOLER to
                "Through ProxySQL in multiplexing mode. Vectorbea disables server-side prepared " +
                "statements, which multiplexing cannot carry.",
        ),
        whereToFind = "Whatever your DBA or platform team hands out",
    )

    // ── Other wires ───────────────────────────────────────────────────────────

    private val SQLSERVER = DbProvider(
        id = "sqlserver", label = "SQL Server", wire = DbWire.SQLSERVER,
        aliases = setOf("mssql", "azure_sql"), defaultPort = 1433, tls = TlsPolicy.REQUIRED,
    )

    private val MONGODB = DbProvider(
        id = "mongodb", label = "MongoDB", wire = DbWire.MONGODB,
        aliases = setOf("mongo", "atlas"), defaultPort = 27017, tls = TlsPolicy.REQUIRED,
    )

    /** Every provider, most specific first — [byHost] returns the first match. */
    val ALL: List<DbProvider> = listOf(
        // Postgres
        SUPABASE, NEON, AIVEN_PG, RDS_PG, AZURE_PG, CLOUDSQL_PG, ALLOYDB, TIMESCALE,
        COCKROACH, DIGITALOCEAN_PG, RENDER_PG, RAILWAY_PG, REDSHIFT, YUGABYTE, CITUS,
        HEROKU_PG, POSTGRES,
        // MySQL
        AIVEN_MYSQL, PLANETSCALE, RDS_MYSQL, AZURE_MYSQL, CLOUDSQL_MYSQL, TIDB,
        SINGLESTORE, MARIADB, VITESS, MYSQL,
        // Other
        SQLSERVER, MONGODB,
    )

    private val BY_NAME: Map<String, DbProvider> = buildMap {
        for (p in ALL) {
            put(p.id, p)
            for (alias in p.aliases) putIfAbsent(alias, p)
        }
    }

    /** The generic entry for a wire, used when only the protocol is known. */
    fun generic(wire: DbWire): DbProvider = when (wire) {
        DbWire.POSTGRES -> POSTGRES
        DbWire.MYSQL -> MYSQL
        DbWire.SQLSERVER -> SQLSERVER
        DbWire.MONGODB -> MONGODB
    }

    /**
     * Look a provider up by the string stored in `connections.provider`.
     *
     * Tolerant on purpose: the column is free text with a 100-character limit and
     * has accumulated `postgres`, `postgresql`, `Postgres`, `aurora-postgresql`
     * and `aurora_postgresql` over its life. Separators are normalised and case
     * is ignored, so all five land on the same entry.
     */
    fun byName(provider: String?): DbProvider? {
        val key = provider?.trim()?.lowercase()?.replace('-', '_')?.takeIf { it.isNotEmpty() } ?: return null
        BY_NAME[key]?.let { return it }
        // `rds_postgresql_15` and friends: fall back to the longest id that prefixes it.
        return BY_NAME.entries
            .filter { key.startsWith(it.key) }
            .maxByOrNull { it.key.length }
            ?.value
    }

    /**
     * Identify the product from a hostname, which is how a pasted URL names itself.
     *
     * [wire] narrows the search, and matters because several hostnames are
     * shared by two products: `*.rds.amazonaws.com` is both RDS Postgres and RDS
     * MySQL, and `*.cloudsql.*.goog` is both Cloud SQL flavours. Without the
     * narrowing the first entry in [ALL] wins, so every RDS MySQL connection
     * matched the Postgres entry, disagreed about the wire, and fell back to
     * plain `mysql` — losing the security-group hint that is the single most
     * likely reason an RDS connection fails.
     */
    /**
     * The product, from all three things that can name it.
     *
     * There are three sources and they are not equally trustworthy:
     *
     *  · [declared] is `connections.provider` — "postgresql" or "mysql". It is
     *    what the connect dialog can offer, and it is authoritative about the
     *    WIRE and nothing else. It never says "Aiven".
     *  · [hosting] is `config.dbHosting` — the vendor the user picked. A claim.
     *  · [host] is the hostname out of the connection string. EVIDENCE.
     *
     * So evidence wins, then the claim, then the wire's generic entry. Both
     * refinements are constrained to the declared wire: a MySQL connection must
     * never resolve onto a Postgres entry because the hostname happens to be
     * shared (`*.rds.amazonaws.com` is both), or because somebody left the
     * hosting dropdown on its previous value after switching database type.
     *
     * Returns null only when [declared] names no database this build supports,
     * which is the one case where dialling anything at all would be wrong.
     */
    fun resolveFor(declared: String?, hosting: String?, host: String?): DbProvider? {
        val wireEntry = byName(declared) ?: return resolveOrNull(declared, host)
        val detected = byHost(host, wireEntry.wire)
        val claimed = byName(hosting)?.takeIf { it.wire == wireEntry.wire }
        return detected ?: claimed ?: wireEntry
    }

    fun byHost(host: String?, wire: DbWire? = null): DbProvider? {
        val h = host?.trim()?.lowercase()?.takeIf { it.isNotEmpty() } ?: return null
        return ALL.firstOrNull { provider ->
            (wire == null || provider.wire == wire) && provider.hostPatterns.any { it.containsMatchIn(h) }
        }
    }

    /**
     * The best available identification: the host wins over the stored name.
     *
     * Deliberately in that order. The stored name is what the user picked out of
     * a dropdown that offers "Postgres" and "MySQL"; the host is what they
     * actually pasted, and it is the only one of the two that can say "Aiven".
     * The wire protocol is taken from [declared] when the host is unrecognised,
     * so a private enterprise hostname still resolves to the right driver.
     */
    fun resolve(declared: String?, host: String?): DbProvider =
        resolveOrNull(declared, host) ?: generic(DbWire.POSTGRES)

    /**
     * As [resolve], but says so when nothing matched.
     *
     * Callers that are about to DIAL need the difference. Falling back to
     * Postgres is the right default for "which driver do I load"; it is the
     * wrong answer for "is this a database I can test at all", where the honest
     * reply is a refusal naming the type rather than a Postgres handshake
     * against something that is not Postgres.
     */
    fun resolveOrNull(declared: String?, host: String?): DbProvider? {
        val named = byName(declared)
        // Look for a host match on the wire that was declared FIRST, so a shared
        // hostname resolves to the right half of the pair. Only then widen.
        val detected = byHost(host, named?.wire) ?: byHost(host)
        // Only trust the host when it agrees about the wire, or when nothing was
        // declared. Otherwise a MySQL connection on an RDS host would be handed
        // the Postgres entry purely because that pattern is listed first.
        if (detected != null && (named == null || detected.wire == named.wire)) return detected
        return named
    }

    // ── Driver facts ──────────────────────────────────────────────────────────

    fun driverClassFor(wire: DbWire): String = when (wire) {
        DbWire.POSTGRES -> "org.postgresql.Driver"
        DbWire.MYSQL -> "com.mysql.cj.jdbc.Driver"
        DbWire.SQLSERVER -> "com.microsoft.sqlserver.jdbc.SQLServerDriver"
        DbWire.MONGODB -> throw UnsupportedOperationException("MongoDB is not a JDBC driver")
    }

    fun jdbcSchemeFor(wire: DbWire): String = when (wire) {
        DbWire.POSTGRES -> "jdbc:postgresql://"
        DbWire.MYSQL -> "jdbc:mysql://"
        DbWire.SQLSERVER -> "jdbc:sqlserver://"
        DbWire.MONGODB -> "mongodb://"
    }

    /**
     * The JDBC properties a given mode and TLS policy require, in driver units.
     *
     * This is the payload of the whole file. Everything above is identification;
     * this is what identification BUYS.
     *
     * [urlAlreadyCarries] lets the caller name parameters the user wrote into the
     * connection string themselves. Those are never overwritten: someone who
     * typed `sslmode=verify-full` asked for certificate verification, and quietly
     * downgrading them to `require` would make the test pass on a connection the
     * engine would later refuse.
     */
    fun driverParams(
        provider: DbProvider,
        mode: ConnectionMode,
        sslRequiredOverride: Boolean? = null,
        urlAlreadyCarries: Set<String> = emptySet(),
    ): Map<String, String> {
        val has = urlAlreadyCarries.map { it.lowercase() }.toSet()
        val out = LinkedHashMap<String, String>()

        fun put(key: String, value: String) {
            if (key.lowercase() !in has) out[key] = value
        }

        when (provider.wire) {
            DbWire.POSTGRES -> {
                // A transaction pooler hands the backend back at COMMIT, so a
                // named server-side statement prepared on one backend is looked
                // up on another. pgjdbc names a statement on its fifth execution,
                // which is why this failure arrives four runs late.
                if (mode == ConnectionMode.TRANSACTION_POOLER) put("prepareThreshold", "0")
                put("sslmode", postgresSslMode(provider, sslRequiredOverride))
            }

            DbWire.MYSQL -> {
                // Connector/J's own multiplexing hazard. Off by default in 9.x,
                // set explicitly so a URL that turns it on cannot break a pooled
                // connection four calls later.
                if (mode == ConnectionMode.TRANSACTION_POOLER) put("useServerPrepStmts", "false")
                put("sslMode", mysqlSslMode(provider, sslRequiredOverride))
            }

            DbWire.SQLSERVER -> {
                put("encrypt", if (sslRequiredOverride == false) "false" else "true")
                if (provider.tls != TlsPolicy.VERIFY_IDENTITY) put("trustServerCertificate", "true")
            }

            DbWire.MONGODB -> Unit
        }
        return out
    }

    /**
     * pgjdbc `sslmode`.
     *
     * `require` rather than `verify-full` for REQUIRED providers is deliberate
     * and is the difference between working and not: Aiven, Heroku, DigitalOcean
     * and RDS all present certificates signed by their own CA, which is not in
     * the JVM default truststore. `verify-full` would reject every one of them.
     * `require` still encrypts — it just does not assert who is at the other end,
     * which is the same trade every one of those vendors' own quickstarts makes.
     */
    private fun postgresSslMode(provider: DbProvider, override: Boolean?): String = when {
        override == false -> "prefer"
        provider.tls == TlsPolicy.VERIFY_IDENTITY -> "verify-full"
        provider.tls == TlsPolicy.REQUIRED || override == true -> "require"
        else -> "prefer"
    }

    /**
     * Connector/J `sslMode`.
     *
     * THE AIVEN BUG. Aiven hands out `mysql://…?ssl-mode=REQUIRED`. That spelling
     * is a MySQL **CLI** option; Connector/J's property is `sslMode`, and an
     * unrecognised parameter in a JDBC URL is silently DISCARDED rather than
     * rejected — verified against Connector/J 9.0.0. So the user pastes a string
     * that plainly says TLS is required, and the driver falls back to PREFERRED,
     * which downgrades to cleartext the moment the handshake has any trouble.
     * Aiven then refuses the cleartext connection, and the error that surfaces
     * has nothing to do with TLS. Setting the JDBC spelling here is what makes
     * the pasted string mean what it says.
     */
    private fun mysqlSslMode(provider: DbProvider, override: Boolean?): String = when {
        override == false -> "PREFERRED"
        provider.tls == TlsPolicy.VERIFY_IDENTITY -> "VERIFY_IDENTITY"
        provider.tls == TlsPolicy.REQUIRED || override == true -> "REQUIRED"
        else -> "PREFERRED"
    }

    /**
     * Read the mode out of a URL that already encodes it.
     *
     * Only where the provider makes it unambiguous. A guess that is wrong is
     * worse than no guess: claiming a direct connection is transaction-pooled
     * silently disables prepared statements, and claiming the reverse re-arms the
     * bug this file exists to prevent. Returns null when the string does not say.
     */
    fun detectMode(provider: DbProvider, host: String?, port: Int?): ConnectionMode? {
        val h = host?.lowercase().orEmpty()
        return when (provider.id) {
            "supabase" -> when {
                h.endsWith(".pooler.supabase.com") && port == 6543 -> ConnectionMode.TRANSACTION_POOLER
                h.endsWith(".pooler.supabase.com") -> ConnectionMode.SESSION_POOLER
                h.startsWith("db.") -> ConnectionMode.DIRECT
                else -> null
            }
            "neon" -> if (h.contains("-pooler.")) ConnectionMode.TRANSACTION_POOLER else ConnectionMode.DIRECT
            "planetscale" -> ConnectionMode.TRANSACTION_POOLER
            "rds_postgresql", "rds_mysql" ->
                if (h.contains(".proxy-")) ConnectionMode.TRANSACTION_POOLER else ConnectionMode.DIRECT
            "azure_postgresql" -> if (port == 6432) ConnectionMode.TRANSACTION_POOLER else ConnectionMode.DIRECT
            else -> null
        }
    }

    /** The mode to use when the user has not chosen one. */
    fun defaultMode(provider: DbProvider, host: String?, port: Int?): ConnectionMode =
        detectMode(provider, host, port)
            ?: provider.modes.firstOrNull { it == ConnectionMode.DIRECT }
            ?: provider.modes.first()
}
