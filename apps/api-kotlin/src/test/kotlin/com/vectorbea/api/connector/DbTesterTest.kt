package com.vectorbea.api.connector

import org.junit.jupiter.api.Test
import java.net.ConnectException
import java.net.UnknownHostException
import java.sql.SQLException
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

class DbTesterTest {

    @Test
    fun `postgres URL credentials are extracted into JDBC properties`() {
        val target = DbTester.resolvePostgresTarget(
            DbTester.DbTestInput(
                dbType = "postgresql",
                connectionUrl = "postgres://app%40tenant:p%2Bass@db.example.com:5433/workflows?sslmode=require",
                password = null,
                username = null,
                host = null,
                port = null,
                database = null,
            ),
        )

        assertEquals("jdbc:postgresql://db.example.com:5433/workflows?sslmode=require", target.jdbcUrl)
        assertEquals("app@tenant", target.username)
        assertEquals("p+ass", target.password)
    }

    @Test
    fun `component credentials remain JDBC properties`() {
        val target = DbTester.resolvePostgresTarget(
            DbTester.DbTestInput(
                dbType = "postgresql",
                connectionUrl = null,
                password = "secret",
                username = "vectorbea",
                host = "db.internal",
                port = 5432,
                database = "agents",
            ),
        )

        assertEquals("jdbc:postgresql://db.internal:5432/agents", target.jdbcUrl)
        assertEquals("vectorbea", target.username)
        assertEquals("secret", target.password)
    }

    @Test
    fun `mysql URL credentials are extracted into JDBC properties`() {
        val target = DbTester.resolveMysqlTarget(
            DbTester.DbTestInput(
                dbType = "mysql",
                connectionUrl = "mysql://app%40tenant:p%2Bass@db.example.com:3307/workflows?useSSL=true",
                password = null,
                username = null,
                host = null,
                port = null,
                database = null,
            ),
        )

        assertEquals("jdbc:mysql://db.example.com:3307/workflows?useSSL=true", target.jdbcUrl)
        assertEquals("app@tenant", target.username)
        assertEquals("p+ass", target.password)
    }

    @Test
    fun `host is extracted from every connection-string shape`() {
        fun host(url: String?, host: String? = null) = DbTester.hostOf(
            DbTester.DbTestInput(
                dbType = "postgresql", connectionUrl = url, password = null,
                username = null, host = host, port = null, database = null,
            ),
        )

        assertEquals("db.abcdefgh.supabase.co",
            host("postgresql://postgres:pw@db.abcdefgh.supabase.co:5432/postgres"))
        assertEquals("aws-0-eu-west-2.pooler.supabase.com",
            host("postgres://postgres.abcdefgh:pw@aws-0-eu-west-2.pooler.supabase.com:6543/postgres"))
        assertEquals("db.example.com",
            host("jdbc:postgresql://db.example.com:5432/app"))
        // Component form wins, and a URL-less input is not a parse failure.
        assertEquals("db.internal", host(null, host = "db.internal"))
        assertNull(host(null))
    }

    @Test
    fun `unroutable hosts are named rather than described as generic failures`() {
        // Loopback from a hosted API can never work, whatever the credentials.
        val loopback = DbTester.hostGuidance("CONNECTION_REFUSED", "localhost")
        assertNotNull(loopback)
        assertTrue(loopback.contains("private runner"))

        assertNotNull(DbTester.hostGuidance("NETWORK_UNREACHABLE", "10.0.0.4"))
        assertNotNull(DbTester.hostGuidance("NETWORK_UNREACHABLE", "192.168.1.10"))
        assertNotNull(DbTester.hostGuidance("NETWORK_UNREACHABLE", "172.16.0.9"))
        // 172.32 is public space — must NOT be claimed as private.
        assertNull(DbTester.hostGuidance("NETWORK_UNREACHABLE", "172.32.0.9"))

        // A Supabase direct host always gets the pooler hint on a network error.
        val supabase = DbTester.hostGuidance("NETWORK_UNREACHABLE", "db.abcdefgh.supabase.co")
        assertNotNull(supabase)
        assertTrue(supabase.contains("pooler.supabase.com"))

        // The pooler host itself is already the fix — do not tell them to use it.
        assertNull(DbTester.hostGuidance("NETWORK_UNREACHABLE", "aws-0-eu-west-2.pooler.supabase.com"))

        // Guidance is for NETWORK failures only. A wrong password is not a
        // routing problem, and suggesting a different host would send the user
        // to fix something that is not broken.
        assertNull(DbTester.hostGuidance("AUTH_FAILED", "db.abcdefgh.supabase.co"))
        assertNull(DbTester.hostGuidance("DATABASE_NOT_FOUND", "localhost"))
    }

    @Test
    fun `private address detection does not over-claim`() {
        assertTrue(DbTester.isPrivateAddress("10.1.2.3"))
        assertTrue(DbTester.isPrivateAddress("192.168.0.1"))
        assertTrue(DbTester.isPrivateAddress("172.16.0.1"))
        assertTrue(DbTester.isPrivateAddress("172.31.255.254"))
        assertFalse(DbTester.isPrivateAddress("172.15.0.1"))
        assertFalse(DbTester.isPrivateAddress("172.32.0.1"))
        // Must anchor: a public host that merely CONTAINS the octets is public.
        assertFalse(DbTester.isPrivateAddress("db-10.0.0.1.example.com"))
        assertFalse(DbTester.isPrivateAddress("host192.168.1.1.example.com"))
    }

    @Test
    fun `an explicit sslmode in the URL survives into the JDBC url`() {
        val target = DbTester.resolvePostgresTarget(
            DbTester.DbTestInput(
                dbType = "supabase",
                connectionUrl = "postgresql://postgres.abc:pw@aws-0-eu-west-2.pooler.supabase.com:6543/postgres?sslmode=verify-full",
                password = null, username = null, host = null, port = null, database = null,
            ),
        )
        assertTrue(target.jdbcUrl.contains("sslmode=verify-full"))
        assertEquals("postgres.abc", target.username)
    }

    @Test
    fun `sql states and nested network causes produce actionable errors`() {
        assertEquals(
            "AUTH_FAILED" to "Database authentication failed - check credentials",
            DbTester.classifyException(SQLException("redacted", "28P01")),
        )
        assertEquals(
            "DNS_FAILED" to "Database host could not be resolved - check the hostname",
            DbTester.classifyException(SQLException("connection attempt failed", "08001", UnknownHostException())),
        )
        assertEquals(
            "CONNECTION_REFUSED" to "Database refused the connection - check host, port, and firewall rules",
            DbTester.classifyException(SQLException("connection attempt failed", "08001", ConnectException())),
        )
    }
}
