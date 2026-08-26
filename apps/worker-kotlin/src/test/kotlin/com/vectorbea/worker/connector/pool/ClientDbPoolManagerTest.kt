package com.vectorbea.worker.connector.pool

import org.junit.jupiter.api.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

/**
 * Connection-string parsing.
 *
 * THE BUG THESE PIN
 * ─────────────────
 * A `database` connection in `connection_string` mode stores what the user pastes —
 * `postgresql://user:password@host:5432/db` — and the pool used to hand that
 * straight to JDBC after only swapping the scheme.
 *
 * pgjdbc does not accept credentials in the authority: it reads everything between
 * `//` and the next `/` as the host spec, so `user:password@host` became the
 * HOSTNAME and the driver reported the generic "The connection attempt failed".
 * That reads like an unreachable database, which sends whoever is debugging it to
 * check firewalls and security groups for a server that was never contacted.
 * Verified against pgjdbc 42.7.4: the userinfo form fails, the same host with
 * `user=`/`password=` connects.
 *
 * Every database tool and every db_read / db_write node on a connection-string
 * connection failed this way.
 */
class ClientDbPoolManagerTest {

    private val manager = ClientDbPoolManager()

    @Test
    fun `lifts credentials out of the authority and off the URL`() {
        val parsed = manager.parseConnectionString(
            "postgresql://vectorbea:s3cret@db.example.com:5432/appdb",
            "postgres",
        )

        assertEquals("jdbc:postgresql://db.example.com:5432/appdb", parsed.jdbcUrl)
        assertEquals("vectorbea", parsed.username)
        assertEquals("s3cret", parsed.password)
    }

    @Test
    fun `leaves a URL without credentials alone`() {
        val parsed = manager.parseConnectionString(
            "postgresql://db.example.com:5432/appdb?sslmode=require",
            "postgres",
        )

        assertEquals("jdbc:postgresql://db.example.com:5432/appdb?sslmode=require", parsed.jdbcUrl)
        assertNull(parsed.username)
        assertNull(parsed.password)
    }

    @Test
    fun `strips credentials from an already-jdbc URL too`() {
        // Same defect, same fix: `jdbc:postgresql://u:p@host/db` is no more valid
        // than the libpq form, so accepting the scheme is not enough.
        val parsed = manager.parseConnectionString(
            "jdbc:postgresql://u:p@db.example.com:5432/appdb",
            "postgres",
        )

        assertEquals("jdbc:postgresql://db.example.com:5432/appdb", parsed.jdbcUrl)
        assertEquals("u", parsed.username)
        assertEquals("p", parsed.password)
    }

    @Test
    fun `splits at the last at-sign so a password containing one survives`() {
        val parsed = manager.parseConnectionString(
            "postgresql://admin:p@ss@db.example.com:5432/appdb",
            "postgres",
        )

        assertEquals("jdbc:postgresql://db.example.com:5432/appdb", parsed.jdbcUrl)
        assertEquals("admin", parsed.username)
        assertEquals("p@ss", parsed.password)
    }

    @Test
    fun `percent-decodes credentials`() {
        // `@` and `/` can only reach us encoded, so they have to be decoded back.
        val parsed = manager.parseConnectionString(
            "postgresql://a%40b:p%2Fw%3Ad@db.example.com/appdb",
            "postgres",
        )

        assertEquals("a@b", parsed.username)
        assertEquals("p/w:d", parsed.password)
    }

    @Test
    fun `keeps a plus sign in the password`() {
        // URLDecoder.decode would turn this into a space — form decoding, not URI
        // decoding — and produce an authentication failure nobody could explain.
        val parsed = manager.parseConnectionString(
            "postgresql://user:pa+ss@db.example.com/appdb",
            "postgres",
        )

        assertEquals("pa+ss", parsed.password)
    }

    @Test
    fun `handles a user with no password`() {
        val parsed = manager.parseConnectionString(
            "postgresql://readonly@db.example.com:5432/appdb",
            "postgres",
        )

        assertEquals("jdbc:postgresql://db.example.com:5432/appdb", parsed.jdbcUrl)
        assertEquals("readonly", parsed.username)
        assertNull(parsed.password)
    }

    @Test
    fun `keeps the query string when credentials are removed`() {
        val parsed = manager.parseConnectionString(
            "postgresql://u:p@db.example.com:5432/appdb?sslmode=require&application_name=vectorbea",
            "postgres",
        )

        assertEquals(
            "jdbc:postgresql://db.example.com:5432/appdb?sslmode=require&application_name=vectorbea",
            parsed.jdbcUrl,
        )
    }

    @Test
    fun `handles mysql connection strings`() {
        val parsed = manager.parseConnectionString(
            "mysql://root:root@db.example.com:3306/appdb",
            "mysql",
        )

        assertEquals("jdbc:mysql://db.example.com:3306/appdb", parsed.jdbcUrl)
        assertEquals("root", parsed.username)
        assertEquals("root", parsed.password)
    }
}
