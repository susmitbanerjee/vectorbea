package com.vectorbea.worker.db

import com.vectorbea.worker.config.OutboundTimeouts
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * These tests exist because the failure they guard against is invisible in
 * production: a tenant DB with no `socketTimeout` does not error, it simply
 * never returns, and the slot it holds is never reported as lost.
 */
class JdbcTimeoutsTest {

    private val t = OutboundTimeouts.fromEnv()

    private fun params(url: String): Map<String, String> {
        val q = url.substringAfter('?', "")
        if (q.isBlank()) return emptyMap()
        return q.split('&').associate {
            val i = it.indexOf('=')
            if (i < 0) it to "" else it.substring(0, i) to it.substring(i + 1)
        }
    }

    @Test
    fun `postgres url without params gains connect socket and login timeouts`() {
        val out = JdbcTimeouts.applyTo("jdbc:postgresql://db.example.com:5432/app", "postgresql", t)
        val p = params(out)
        assertEquals(t.dbConnectTimeoutSeconds.toString(), p["connectTimeout"])
        assertEquals(t.dbSocketTimeoutSeconds.toString(), p["socketTimeout"])
        assertEquals(t.dbLoginTimeoutSeconds.toString(), p["loginTimeout"])
        assertEquals(t.dbCancelSignalTimeoutSeconds.toString(), p["cancelSignalTimeout"])
    }

    @Test
    fun `existing query params are preserved`() {
        val out = JdbcTimeouts.applyTo(
            "jdbc:postgresql://db.example.com:5432/app?sslmode=require", "postgresql", t)
        assertEquals("require", params(out)["sslmode"])
        assertEquals(t.dbSocketTimeoutSeconds.toString(), params(out)["socketTimeout"])
    }

    @Test
    fun `a tenant cannot disable the socket timeout with zero`() {
        // socketTimeout=0 means "wait forever" in pgjdbc. This is the case that
        // lets one tenant hold an execution slot indefinitely.
        val out = JdbcTimeouts.applyTo(
            "jdbc:postgresql://db.example.com:5432/app?socketTimeout=0", "postgresql", t)
        assertEquals(t.dbSocketTimeoutSeconds.toString(), params(out)["socketTimeout"])
    }

    @Test
    fun `a tenant cannot raise a timeout above the policy ceiling`() {
        val out = JdbcTimeouts.applyTo(
            "jdbc:postgresql://db.example.com:5432/app?socketTimeout=86400", "postgresql", t)
        assertEquals(t.dbSocketTimeoutSeconds.toString(), params(out)["socketTimeout"])
    }

    @Test
    fun `a tenant may tighten a timeout below the ceiling`() {
        val out = JdbcTimeouts.applyTo(
            "jdbc:postgresql://db.example.com:5432/app?socketTimeout=5", "postgresql", t)
        assertEquals("5", params(out)["socketTimeout"])
    }

    @Test
    fun `mysql timeouts are expressed in milliseconds`() {
        val out = JdbcTimeouts.applyTo("jdbc:mysql://db.example.com:3306/app", "mysql", t)
        val p = params(out)
        assertEquals((t.dbSocketTimeoutSeconds * 1_000).toString(), p["socketTimeout"])
        assertEquals((t.dbConnectTimeoutSeconds * 1_000).toString(), p["connectTimeout"])
    }

    @Test
    fun `sqlserver uses semicolon separated properties`() {
        val out = JdbcTimeouts.applyTo(
            "jdbc:sqlserver://db.example.com:1433;databaseName=app", "sqlserver", t)
        assertTrue(out.startsWith("jdbc:sqlserver://db.example.com:1433"))
        assertTrue(out.contains(";databaseName=app"), out)
        assertTrue(out.contains(";socketTimeout=${t.dbSocketTimeoutSeconds * 1_000}"), out)
        assertTrue(out.contains(";loginTimeout=${t.dbLoginTimeoutSeconds}"), out)
    }

    @Test
    fun `applying twice is idempotent`() {
        val once = JdbcTimeouts.applyTo("jdbc:postgresql://h/app", "postgresql", t)
        val twice = JdbcTimeouts.applyTo(once, "postgresql", t)
        assertEquals(once, twice)
    }

    @Test
    fun `clampTotalCallMs bounds a hostile node timeout`() {
        assertEquals(t.httpTotalCallCeilingMs, t.clampTotalCallMs(Long.MAX_VALUE / 4))
        assertEquals(t.httpDefaultTotalCallMs, t.clampTotalCallMs(null))
        assertEquals(t.httpDefaultTotalCallMs, t.clampTotalCallMs(0L))
        assertEquals(1_000L, t.clampTotalCallMs(1L))
    }
}
