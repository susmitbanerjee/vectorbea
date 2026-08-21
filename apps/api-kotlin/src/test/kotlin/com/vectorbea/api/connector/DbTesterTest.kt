package com.vectorbea.api.connector

import org.junit.jupiter.api.Test
import java.net.ConnectException
import java.net.UnknownHostException
import java.sql.SQLException
import kotlin.test.assertEquals

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
    fun `sql states and nested network causes produce actionable errors`() {
        assertEquals(
            "AUTH_FAILED" to "Database authentication failed — check credentials",
            DbTester.classifyException(SQLException("redacted", "28P01")),
        )
        assertEquals(
            "DNS_FAILED" to "Database host could not be resolved — check the hostname",
            DbTester.classifyException(SQLException("connection attempt failed", "08001", UnknownHostException())),
        )
        assertEquals(
            "CONNECTION_REFUSED" to "Database refused the connection — check host, port, and firewall rules",
            DbTester.classifyException(SQLException("connection attempt failed", "08001", ConnectException())),
        )
    }
}
