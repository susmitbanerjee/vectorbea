package com.vectorbea.dbcatalog

import org.junit.jupiter.api.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * The catalogue is the single answer to "what is at the other end of this
 * connection string", and three separate copies of that answer had drifted
 * before it existed. These tests pin the parts that drifted.
 */
class DbProvidersTest {

    // ── Identification ────────────────────────────────────────────────────────

    @Test
    fun `Aiven MySQL is identified from its hostname, not from the provider dropdown`() {
        // The connect dialog can only offer "MySQL". The host is the only thing
        // that says Aiven, and every useful diagnostic depends on knowing that.
        val provider = DbProviders.resolve("mysql", "mysql-2b1f0a-vectorbea.a.aivencloud.com")

        assertEquals("aiven_mysql", provider.id)
        assertEquals(DbWire.MYSQL, provider.wire)
        assertEquals(TlsPolicy.REQUIRED, provider.tls)
    }

    @Test
    fun `Aiven Postgres and Aiven MySQL are told apart by host prefix`() {
        assertEquals("aiven_postgresql", DbProviders.resolve("postgresql", "pg-3c2.a.aivencloud.com").id)
        assertEquals("aiven_mysql", DbProviders.resolve("mysql", "mysql-3c2.a.aivencloud.com").id)
    }

    @Test
    fun `an RDS host does not drag a MySQL connection onto the Postgres entry`() {
        /* Both RDS entries match `*.rds.amazonaws.com` and the Postgres one is
           listed first. Host detection must not override a declared wire it
           disagrees with, or every RDS MySQL connection is handed pgjdbc. */
        val mysql = DbProviders.resolve("mysql", "shop.abc123.eu-west-1.rds.amazonaws.com")
        assertEquals(DbWire.MYSQL, mysql.wire)
        assertEquals("rds_mysql", mysql.id)

        val postgres = DbProviders.resolve("postgresql", "shop.abc123.eu-west-1.rds.amazonaws.com")
        assertEquals(DbWire.POSTGRES, postgres.wire)
    }

    @Test
    fun `provider names are matched past case and separator drift`() {
        // The `provider` column is free text and has accumulated all of these.
        for (name in listOf("postgres", "PostgreSQL", "pgsql", "PG")) {
            assertEquals(DbWire.POSTGRES, DbProviders.resolve(name, null).wire, name)
        }
        for (name in listOf("aurora-postgresql", "aurora_postgresql", "rds_postgresql")) {
            assertEquals("rds_postgresql", DbProviders.resolve(name, null).id, name)
        }
        for (name in listOf("aurora_mysql", "aurora-mysql", "rds_mysql")) {
            assertEquals("rds_mysql", DbProviders.resolve(name, null).id, name)
        }
    }

    @Test
    fun `every managed provider the tester used to accept still resolves`() {
        /* The literal wire-family sets that DbTester carried, verbatim. None of
           these may regress to "not yet supported for testing". */
        val postgresWire = listOf(
            "postgres", "postgresql", "pgsql", "neon", "supabase", "timescale", "timescaledb",
            "cockroach", "cockroachdb", "yugabyte", "yugabytedb", "redshift", "citus",
            "aurora_postgresql", "aurora-postgresql", "rds_postgresql", "rds-postgresql",
            "cloudsql_postgresql", "alloydb",
        )
        for (name in postgresWire) {
            assertEquals(DbWire.POSTGRES, DbProviders.resolveOrNull(name, null)?.wire, name)
        }
        val mysqlWire = listOf(
            "mysql", "mariadb", "planetscale", "singlestore", "vitess", "tidb",
            "aurora_mysql", "aurora-mysql", "rds_mysql", "rds-mysql", "cloudsql_mysql",
        )
        for (name in mysqlWire) {
            assertEquals(DbWire.MYSQL, DbProviders.resolveOrNull(name, null)?.wire, name)
        }
    }

    @Test
    fun `an unknown database type is refused rather than dialled as Postgres`() {
        // `resolve` defaults to Postgres so a driver can always be named.
        // `resolveOrNull` must not, or "test connection" would open a pgjdbc
        // handshake against something that is not Postgres and report the
        // resulting protocol error as the user's fault.
        assertNull(DbProviders.resolveOrNull("cassandra", null))
        assertEquals(DbWire.POSTGRES, DbProviders.resolve("cassandra", null).wire)
    }

    // ── The Aiven MySQL TLS fix ───────────────────────────────────────────────

    @Test
    fun `Aiven MySQL is dialled with TLS required`() {
        // The bug: no sslMode was set at all, so Connector/J ran at PREFERRED
        // and downgraded to cleartext, which Aiven then refuses.
        val provider = DbProviders.resolve("mysql", "mysql-2b1f.a.aivencloud.com")
        val params = DbProviders.driverParams(provider, ConnectionMode.DIRECT)

        assertEquals("REQUIRED", params["sslMode"])
    }

    @Test
    fun `PlanetScale and TiDB verify the server identity, Aiven does not`() {
        /* PlanetScale and TiDB present publicly trusted certificates, so the
           hostname can be asserted. Aiven, Heroku, RDS and DigitalOcean sign
           with their own CA, which is not in the JVM truststore — asking for
           VERIFY_IDENTITY there rejects every one of them. */
        assertEquals(
            "VERIFY_IDENTITY",
            DbProviders.driverParams(DbProviders.resolve("planetscale", null), ConnectionMode.TRANSACTION_POOLER)["sslMode"],
        )
        assertEquals(
            "REQUIRED",
            DbProviders.driverParams(DbProviders.resolve("mysql", "mysql-1.a.aivencloud.com"), ConnectionMode.DIRECT)["sslMode"],
        )
        assertEquals(
            "require",
            DbProviders.driverParams(DbProviders.resolve("postgresql", "x.compute-1.amazonaws.com"), ConnectionMode.DIRECT)["sslmode"],
        )
    }

    @Test
    fun `a parameter already in the URL is never overwritten`() {
        // Someone who wrote verify-full asked for certificate verification.
        val provider = DbProviders.resolve("postgresql", "db.example.com")
        val params = DbProviders.driverParams(
            provider = provider,
            mode = ConnectionMode.TRANSACTION_POOLER,
            urlAlreadyCarries = setOf("sslmode", "preparethreshold"),
        )
        assertTrue(params.isEmpty(), "expected nothing forced, got $params")
    }

    @Test
    fun `an explicit sslRequired false relaxes TLS even on a strict provider`() {
        // Local and Docker databases are plaintext by design.
        val provider = DbProviders.resolve("mysql", null)
        assertEquals(
            "PREFERRED",
            DbProviders.driverParams(provider, ConnectionMode.DIRECT, sslRequiredOverride = false)["sslMode"],
        )
    }

    // ── Pooling modes ─────────────────────────────────────────────────────────

    @Test
    fun `a transaction pooler disables server-side prepared statements`() {
        /* pgjdbc names a statement on its fifth identical execution, and a
           transaction pooler cannot carry a named statement across the backends
           it multiplexes. Four runs succeed, the fifth fails with
           `prepared statement "S_1" already exists`. */
        val pg = DbProviders.resolve("postgresql", null)
        assertEquals("0", DbProviders.driverParams(pg, ConnectionMode.TRANSACTION_POOLER)["prepareThreshold"])
        assertNull(DbProviders.driverParams(pg, ConnectionMode.DIRECT)["prepareThreshold"])
        assertNull(DbProviders.driverParams(pg, ConnectionMode.SESSION_POOLER)["prepareThreshold"])

        val mysql = DbProviders.resolve("mysql", null)
        assertEquals("false", DbProviders.driverParams(mysql, ConnectionMode.TRANSACTION_POOLER)["useServerPrepStmts"])
        assertNull(DbProviders.driverParams(mysql, ConnectionMode.DIRECT)["useServerPrepStmts"])
    }

    @Test
    fun `Supabase pooling mode is read off the host and port`() {
        val supabase = DbProviders.resolve("postgresql", "aws-0-eu-west-2.pooler.supabase.com")

        assertEquals(
            ConnectionMode.TRANSACTION_POOLER,
            DbProviders.detectMode(supabase, "aws-0-eu-west-2.pooler.supabase.com", 6543),
        )
        assertEquals(
            ConnectionMode.SESSION_POOLER,
            DbProviders.detectMode(supabase, "aws-0-eu-west-2.pooler.supabase.com", 5432),
        )
        assertEquals(
            ConnectionMode.DIRECT,
            DbProviders.detectMode(supabase, "db.abcdefgh.supabase.co", 5432),
        )
    }

    @Test
    fun `Neon's pooled endpoint is recognised by its -pooler suffix`() {
        val neon = DbProviders.resolve("postgresql", "ep-cool-dawn-123-pooler.eu-central-1.aws.neon.tech")
        assertEquals("neon", neon.id)
        assertEquals(
            ConnectionMode.TRANSACTION_POOLER,
            DbProviders.defaultMode(neon, "ep-cool-dawn-123-pooler.eu-central-1.aws.neon.tech", 5432),
        )
        assertEquals(
            ConnectionMode.DIRECT,
            DbProviders.defaultMode(neon, "ep-cool-dawn-123.eu-central-1.aws.neon.tech", 5432),
        )
    }

    @Test
    fun `PlanetScale is always transaction-pooled because it is Vitess`() {
        val ps = DbProviders.resolve("mysql", "aws.connect.psdb.cloud")
        assertEquals("planetscale", ps.id)
        assertEquals(setOf(ConnectionMode.TRANSACTION_POOLER), ps.modes)
        assertEquals(ConnectionMode.TRANSACTION_POOLER, DbProviders.defaultMode(ps, "aws.connect.psdb.cloud", 3306))
    }

    @Test
    fun `the legacy connectionMode values are not mistaken for pooling modes`() {
        /* `connectionMode` already meant "how the credential was entered".
           Parsing "connection_string" as a pooling mode would silently pick one. */
        assertNull(ConnectionMode.parse("connection_string"))
        assertNull(ConnectionMode.parse("host_port"))
        assertNull(ConnectionMode.parse(null))
        assertNull(ConnectionMode.parse(""))

        assertEquals(ConnectionMode.DIRECT, ConnectionMode.parse("direct"))
        assertEquals(ConnectionMode.SESSION_POOLER, ConnectionMode.parse("session_pooler"))
        assertEquals(ConnectionMode.SESSION_POOLER, ConnectionMode.parse("session-pooler"))
        assertEquals(ConnectionMode.TRANSACTION_POOLER, ConnectionMode.parse("transaction_pooler"))
        assertEquals(ConnectionMode.TRANSACTION_POOLER, ConnectionMode.parse("TRANSACTION-POOLER"))
    }

    @Test
    fun `the default mode is direct wherever the host does not say otherwise`() {
        val pg = DbProviders.resolve("postgresql", "db.internal.example.com")
        assertEquals(ConnectionMode.DIRECT, DbProviders.defaultMode(pg, "db.internal.example.com", 5432))
    }

    // ── Driver facts ──────────────────────────────────────────────────────────

    @Test
    fun `MySQL-wire providers get the MySQL driver`() {
        // The worker returned pgjdbc for every one of these.
        for (name in listOf("planetscale", "aiven_mysql", "tidb", "singlestore", "mariadb", "vitess")) {
            assertEquals(
                "com.mysql.cj.jdbc.Driver",
                DbProviders.driverClassFor(DbProviders.resolve(name, null).wire),
                name,
            )
        }
    }

    @Test
    fun `default ports follow the product, not the protocol`() {
        assertEquals(26257, DbProviders.resolve("cockroachdb", null).defaultPort)
        assertEquals(5439, DbProviders.resolve("redshift", null).defaultPort)
        assertEquals(4000, DbProviders.resolve("tidb", null).defaultPort)
        assertEquals(5432, DbProviders.resolve("postgresql", null).defaultPort)
        assertEquals(3306, DbProviders.resolve("mysql", null).defaultPort)
    }

    @Test
    fun `providers that mandate TLS carry a network hint naming their own screen`() {
        /* "Could not be reached" is identical for Aiven, Azure, RDS, Cloud SQL
           and DigitalOcean, and the fix is on a different page for each. */
        for (host in listOf(
            "mysql-1.a.aivencloud.com",
            "srv.postgres.database.azure.com",
            "shop.abc.eu-west-1.rds.amazonaws.com",
            "db-postgresql-lon1-1.db.ondigitalocean.com",
        )) {
            assertNotNull(DbProviders.byHost(host)?.networkHint, host)
        }
    }
}
