package com.vectorbea.api.connector

import org.junit.jupiter.api.Test
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
}
