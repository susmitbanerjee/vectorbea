package com.vectorbea.worker.connector.pool

import com.vectorbea.worker.connector.ConnectionRecord
import org.junit.jupiter.api.Test
import java.util.UUID
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * What the worker does with a connection the API has already marked healthy.
 *
 * THE BUG THESE PIN
 * ─────────────────
 * The API tested connections against a wide, wire-keyed list of providers. The
 * worker had a four-name list of its own, and the two never agreed:
 *
 *  · `driverFor` returned the **PostgreSQL** driver for every name it did not
 *    recognise — including `planetscale`, `aiven_mysql`, `tidb` and
 *    `singlestore`, all of which speak MySQL. `mariadb` named a driver that has
 *    never been on the classpath at all.
 *
 *  · `buildJdbcUrl` THREW `Unsupported DB provider 'supabase'` in host/port
 *    mode, for a connection the user had just watched go green.
 *
 *  · MySQL connection strings in `config.url` were ignored, because the check
 *    tested only for the two Postgres schemes. Execution then fell through to
 *    host/port, where nothing was configured, and dialled `localhost:3306`.
 *
 * Every one of those surfaced as "your database is unreachable" about a database
 * the worker had never contacted.
 */
class ClientDbProviderRoutingTest {

    private val manager = ClientDbPoolManager()

    private fun record(
        provider: String,
        config: Map<String, Any> = emptyMap(),
        name: String = "test-connection",
    ) = ConnectionRecord(
        id = UUID.randomUUID(),
        workspaceId = UUID.randomUUID(),
        environmentId = UUID.randomUUID(),
        name = name,
        type = "database",
        provider = provider,
        status = "active",
        authType = "connection_string",
        secretRef = null,
        configJson = config,
        allowedHosts = emptyList(),
        allowedPaths = emptyList(),
        allowedSchemas = emptyList(),
        allowedTables = emptyList(),
    )

    // ── Driver selection ──────────────────────────────────────────────────────

    @Test
    fun `MySQL-wire providers are not handed the Postgres driver`() {
        for (provider in listOf("mysql", "mariadb", "planetscale", "aiven_mysql", "tidb", "singlestore")) {
            assertEquals("com.mysql.cj.jdbc.Driver", manager.driverFor(provider), provider)
        }
    }

    @Test
    fun `Postgres-wire providers keep the Postgres driver`() {
        for (provider in listOf("postgresql", "postgres", "supabase", "neon", "timescale", "cockroachdb")) {
            assertEquals("org.postgresql.Driver", manager.driverFor(provider), provider)
        }
    }

    // ── URL construction ──────────────────────────────────────────────────────

    @Test
    fun `a managed provider in host-port mode builds a URL instead of throwing`() {
        // This threw `Unsupported DB provider 'supabase'`.
        val url = manager.buildJdbcUrl(
            record("supabase", mapOf("host" to "db.abc.supabase.co", "port" to 5432, "database" to "postgres")),
        )
        assertEquals("jdbc:postgresql://db.abc.supabase.co:5432/postgres", url)
    }

    @Test
    fun `a MySQL connection string in config is recognised rather than ignored`() {
        val url = manager.buildJdbcUrl(
            record("mysql", mapOf("url" to "mysql://mysql-1.a.aivencloud.com:23861/defaultdb")),
        )
        assertEquals("jdbc:mysql://mysql-1.a.aivencloud.com:23861/defaultdb", url)
    }

    @Test
    fun `an unknown provider name falls back to its declared port rather than 5432`() {
        val url = manager.buildJdbcUrl(record("tidb", mapOf("host" to "gw.tidbcloud.com", "database" to "test")))
        assertTrue(url.startsWith("jdbc:mysql://gw.tidbcloud.com:4000/"), url)
    }

    // ── TLS and pooling parameters ────────────────────────────────────────────

    @Test
    fun `Aiven MySQL gets the JDBC spelling of the TLS requirement`() {
        /* Aiven hands out `?ssl-mode=REQUIRED`, which is the MySQL CLI option.
           Connector/J's property is `sslMode`, and it discards unrecognised
           parameters silently — so the pasted string said TLS was required and
           the driver never heard it, ran at PREFERRED, downgraded to cleartext,
           and Aiven closed the connection. */
        val url = manager.withDriverParams(
            "jdbc:mysql://mysql-1.a.aivencloud.com:23861/defaultdb?ssl-mode=REQUIRED",
            record("mysql"),
        )
        assertTrue(url.contains("sslMode=REQUIRED"), url)
        // The original parameter is left in place. It is inert, and rewriting a
        // tenant's connection string is not this method's business.
        assertTrue(url.contains("ssl-mode=REQUIRED"), url)
    }

    @Test
    fun `an explicit JDBC sslMode in the URL is never overwritten`() {
        val url = manager.withDriverParams(
            "jdbc:mysql://mysql-1.a.aivencloud.com:23861/defaultdb?sslMode=VERIFY_IDENTITY",
            record("mysql"),
        )
        assertEquals(1, Regex("sslMode=").findAll(url).count(), url)
        assertTrue(url.contains("sslMode=VERIFY_IDENTITY"), url)
    }

    @Test
    fun `a transaction-pooled Postgres connection disables server-side prepares`() {
        val url = manager.withDriverParams(
            "jdbc:postgresql://aws-0-eu-west-2.pooler.supabase.com:6543/postgres",
            record("postgresql", mapOf("poolingMode" to "transaction_pooler")),
        )
        assertTrue(url.contains("prepareThreshold=0"), url)
    }

    @Test
    fun `the pooling mode is detected from a Supabase URL when none was chosen`() {
        // Port 6543 IS Supavisor's transaction mode. Nobody has to know that.
        val url = manager.withDriverParams(
            "jdbc:postgresql://aws-0-eu-west-2.pooler.supabase.com:6543/postgres",
            record("postgresql"),
        )
        assertTrue(url.contains("prepareThreshold=0"), url)
    }

    @Test
    fun `the legacy connectionMode value is not read as a pooling mode`() {
        /* `connectionMode=connection_string` describes how the credential was
           ENTERED. Reading it as a pooling choice would silently pick one. */
        val url = manager.withDriverParams(
            "jdbc:postgresql://db.example.com:5432/app",
            record("postgresql", mapOf("connectionMode" to "connection_string")),
        )
        assertTrue(!url.contains("prepareThreshold"), url)
    }

    @Test
    fun `a local database is not forced onto TLS`() {
        // Docker and localhost Postgres are plaintext by design; `require` turns
        // a working dev connection into a handshake failure.
        val url = manager.withDriverParams(
            "jdbc:postgresql://localhost:5432/app",
            record("postgresql"),
        )
        assertTrue(url.contains("sslmode=prefer"), url)
    }

    @Test
    fun `an explicit sslRequired false wins over the provider default`() {
        val url = manager.withDriverParams(
            "jdbc:postgresql://db.abc.supabase.co:5432/postgres",
            record("supabase", mapOf("sslRequired" to false)),
        )
        assertTrue(url.contains("sslmode=prefer"), url)
    }

    @Test
    fun `parameters are appended to a URL that already has a query string`() {
        val url = manager.withDriverParams(
            "jdbc:postgresql://db.example.com:5432/app?ApplicationName=vectorbea",
            record("postgresql"),
        )
        assertTrue(url.contains("ApplicationName=vectorbea"), url)
        assertTrue(url.contains("sslmode="), url)
        assertTrue(!url.contains("??"), url)
        assertTrue(!url.contains("&&"), url)
    }

    @Test
    fun `host extraction ignores credentials and IPv6 brackets`() {
        assertEquals("db.example.com", manager.hostFromJdbcUrl("jdbc:postgresql://db.example.com:5432/app"))
        assertEquals("db.example.com", manager.hostFromJdbcUrl("jdbc:postgresql://u:p@db.example.com/app"))
        assertEquals("2001:db8::1", manager.hostFromJdbcUrl("jdbc:postgresql://[2001:db8::1]:5432/app"))
    }
}
