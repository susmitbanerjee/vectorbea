package com.vectorbea.api.connector

import org.junit.jupiter.api.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * WHAT A SAVED DATABASE CONNECTION POINTS AT.
 *
 * THE BUG THESE PIN. `SchemaPreviewRoutes` resolved this for itself instead of
 * asking `ConnectionTester`, and the two copies drifted. Testing a connection
 * read `config.connectionUrl` when the secret held only the password; schema
 * preview did not, so it resolved to no URL, fell through to host/port/database
 * fields a connection-string connection does not carry, and
 * `resolvePostgresTarget` defaulted to `jdbc:postgresql://localhost:5432/postgres`.
 *
 * The API then dialled ITS OWN loopback, was refused, and reported "Could not
 * connect to database — verify credentials and network access" — about a
 * connection the user had just watched go green, and naming the two things they
 * had already proved were fine. It made every tool that reads from a database
 * unbuildable.
 *
 * `databaseInput` is now the single answer, used by the test, the preview and
 * both of their unsaved variants. The localhost assertion below is the one that
 * matters: it is the shape of the original failure.
 */
class DatabaseConnectionInputTest {

    private val poolerHost = "aws-0-ap-south-1.pooler.supabase.com"
    private val url = "postgresql://postgres.abcdefg:MyPassw0rd@$poolerHost:5432/postgres"

    private fun jdbcUrlFor(input: DbTester.DbTestInput) =
        DbTester.resolvePostgresTarget(input).jdbcUrl

    // ── The secret is the whole connection string ────────────────────────────

    @Test
    fun `a connection-string secret becomes the url`() {
        val input = ConnectionTester.databaseInput(
            provider = "postgresql",
            // What the create dialog stores: no host, no port, no database.
            config = mapOf("connectionMode" to "connection_string", "sslRequired" to true),
            secret = url,
        )

        assertEquals(url, input.connectionUrl)
        assertNull(input.password, "the whole string is the URL, not a password")
        assertEquals(true, input.sslRequired)
        assertEquals("jdbc:postgresql://$poolerHost:5432/postgres", jdbcUrlFor(input))
    }

    // ── The secret is only the password ──────────────────────────────────────

    @Test
    fun `a password secret still finds the url in config`() {
        val input = ConnectionTester.databaseInput(
            provider = "postgresql",
            config = mapOf("connectionUrl" to url, "sslRequired" to true),
            secret = "MyPassw0rd",
        )

        assertEquals(url, input.connectionUrl)
        assertEquals("MyPassw0rd", input.password)
        // THE REGRESSION. Without the config fallback this resolved to
        // localhost:5432 and the API dialled itself.
        assertEquals("jdbc:postgresql://$poolerHost:5432/postgres", jdbcUrlFor(input))
    }

    @Test
    fun `a password secret never resolves to the API's own loopback`() {
        val input = ConnectionTester.databaseInput(
            provider = "postgresql",
            config = mapOf("connection_string" to url),
            secret = "MyPassw0rd",
        )

        val jdbc = jdbcUrlFor(input)
        assertTrue(
            !jdbc.contains("localhost") && !jdbc.contains("127.0.0.1"),
            "resolved to $jdbc — the loopback default is the bug this test exists for",
        )
    }

    @Test
    fun `host and port fields still work when there is no url anywhere`() {
        val input = ConnectionTester.databaseInput(
            provider = "postgresql",
            config = mapOf("host" to "db.example.com", "port" to 6543, "db" to "analytics", "user" to "reader"),
            secret = "MyPassw0rd",
        )

        // `db` and `user` are the alternate spellings the tester always accepted
        // and the preview's copy did not.
        assertEquals("analytics", input.database)
        assertEquals("reader", input.username)
        assertEquals(6543, input.port)
        assertEquals("jdbc:postgresql://db.example.com:6543/analytics", jdbcUrlFor(input))
    }

    @Test
    fun `a port stored as a string is still a port`() {
        val input = ConnectionTester.databaseInput(
            provider = "postgresql",
            config = mapOf("host" to "db.example.com", "port" to "6543"),
            secret = "MyPassw0rd",
        )
        assertEquals(6543, input.port)
    }

    // ── Telling a URL from a password ────────────────────────────────────────

    @Test
    fun `a password that merely starts with postgres is not mistaken for a url`() {
        // The old check was `startsWith("postgres")`, which reads a password of
        // "postgresIsGreat" as a connection string — and then fails to parse it,
        // silently losing the credential.
        val input = ConnectionTester.databaseInput(
            provider = "postgresql",
            config = mapOf("connectionUrl" to url),
            secret = "postgresIsGreat",
        )

        assertEquals("postgresIsGreat", input.password)
        assertEquals(url, input.connectionUrl)
    }

    @Test
    fun `mysql and jdbc secrets are recognised as urls`() {
        val mysql = ConnectionTester.databaseInput(
            provider = "mysql",
            config = emptyMap(),
            secret = "mysql://root:pass@db.example.com:3306/app",
        )
        assertEquals("mysql://root:pass@db.example.com:3306/app", mysql.connectionUrl)
        assertNull(mysql.password)

        val jdbc = ConnectionTester.databaseInput(
            provider = "postgresql",
            config = emptyMap(),
            secret = "jdbc:postgresql://db.example.com:5432/app",
        )
        assertNotNull(jdbc.connectionUrl)
        assertNull(jdbc.password)
    }
}

/**
 * Schema preview must accept every database the connection test accepts.
 *
 * They kept separate lists of supported databases. The tester's was keyed on the
 * WIRE PROTOCOL and covered Timescale, Cockroach, Redshift, RDS, Aurora, AlloyDB
 * and PlanetScale; the fetcher's carried four names. So those databases tested
 * green and then refused to list a table, which is indistinguishable from a
 * broken connection unless you happen to read the error carefully.
 *
 * Both now dispatch through `DbProviders`, so this walks the catalogue itself:
 * anything added there in future is covered without editing this test, which is
 * the failure mode that produced the drift in the first place.
 */
class SchemaPreviewSupportTest {

    @Test
    fun `every wire-compatible database the tester accepts can be introspected`() {
        val wireCompatible = com.vectorbea.dbcatalog.DbProviders.ALL
            .filter { it.wire == com.vectorbea.dbcatalog.DbWire.POSTGRES ||
                it.wire == com.vectorbea.dbcatalog.DbWire.MYSQL }
            .flatMap { listOf(it.id) + it.aliases }

        for (name in wireCompatible) {
            val input = DbSchemaFetcher.SchemaInput(
                dbType = name,
                // Deliberately unroutable: the point is which BRANCH is taken,
                // not whether a database answers. A supported type fails trying
                // to connect; an unsupported one fails before that, with
                // UnsupportedOperationException.
                connectionUrl = "postgresql://u:p@127.0.0.1:1/none",
                password = null, username = null, host = null, port = null, database = null,
            )

            val thrown = runCatching { DbSchemaFetcher.fetch(input) }.exceptionOrNull()
            assertTrue(
                thrown !is UnsupportedOperationException,
                "'$name' can be tested but not introspected — the two lists have drifted again",
            )
        }
    }

    @Test
    fun `a genuinely unknown database is still refused, and says so`() {
        val input = DbSchemaFetcher.SchemaInput(
            dbType = "cassandra",
            connectionUrl = null, password = null, username = null,
            host = null, port = null, database = null,
        )

        val thrown = runCatching { DbSchemaFetcher.fetch(input) }.exceptionOrNull()
        assertTrue(thrown is UnsupportedOperationException)
        assertTrue(thrown.message!!.contains("cassandra"))
    }
}
