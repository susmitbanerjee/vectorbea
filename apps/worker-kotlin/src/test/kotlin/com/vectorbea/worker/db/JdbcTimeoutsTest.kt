package com.vectorbea.worker.db

import com.vectorbea.worker.config.OutboundTimeouts
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
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

    /* ── Server-side prepared statements ──────────────────────────────────────
       pgjdbc promotes a statement to a NAMED server-side prepared statement after
       five executions, and a transaction-mode pooler cannot carry a named
       statement across the backends it multiplexes. A db_read node runs the same
       SQL every time, so the fifth run of a workflow started failing with
       "prepared statement S_1 already exists" — against Supabase's pooled URL,
       PgBouncer and RDS Proxy, which is what those dashboards hand out. */

    @Test
    fun `postgres urls disable server-side prepared statements by default`() {
        val out = JdbcTimeouts.applyTo("jdbc:postgresql://db.example.com:6543/app", "postgresql", t)
        assertTrue(out.contains("prepareThreshold=0"), out)
    }

    @Test
    fun `a tenant who sets prepareThreshold keeps their value`() {
        // Unlike the timeouts, this is a default rather than a bound: it protects
        // the tenant from a pooler, not the platform from the tenant. Somebody
        // who named it is pointing at a direct connection and means it.
        val out = JdbcTimeouts.applyTo(
            "jdbc:postgresql://db.example.com:5432/app?prepareThreshold=5", "postgresql", t,
        )
        assertTrue(out.contains("prepareThreshold=5"), out)
        assertFalse(out.contains("prepareThreshold=0"), out)
    }

    @Test
    fun `applying twice is idempotent`() {
        val once = JdbcTimeouts.applyTo("jdbc:postgresql://h/app", "postgresql", t)
        val twice = JdbcTimeouts.applyTo(once, "postgresql", t)
        assertEquals(once, twice)
    }

    @Test
    fun `every managed provider gets timeouts, not just the four hardcoded names`() {
        /* THE BUG THIS PINS. `paramsFor` was a four-name `when` with
           `else -> emptyMap()`, and `applyTo` short-circuits on an empty map.
           So a connection stored as `supabase`, `neon`, `planetscale`,
           `aiven_mysql`, `timescale` or `rds_postgresql` — most of the managed
           database market — was opened with NO connectTimeout and NO
           socketTimeout at all. This file's own header explains why that is the
           one thing a tenant must never be able to have: an unbounded socket
           read parks an execution slot for the lifetime of the process, and the
           agent pool is two slots wide platform-wide. */
        for (provider in listOf(
            "supabase", "neon", "timescale", "cockroachdb", "rds_postgresql",
            "aurora_postgresql", "redshift", "azure_postgresql",
            "planetscale", "aiven_mysql", "tidb", "singlestore", "rds_mysql",
        )) {
            val params = JdbcTimeouts.paramsFor(provider, t)
            assertTrue(params.isNotEmpty(), "$provider got no timeout parameters at all")
            assertTrue(params.containsKey("connectTimeout"), "$provider has no connectTimeout")
            assertTrue(params.containsKey("socketTimeout"), "$provider has no socketTimeout")

            val out = JdbcTimeouts.applyTo("jdbc:postgresql://h/app", provider, t)
            assertTrue(out.contains("socketTimeout="), "$provider: $out")
        }
    }

    @Test
    fun `Postgres-wire aliases keep pgjdbc's seconds unit`() {
        /* The unit is chosen per driver: pgjdbc reads seconds, Connector/J reads
           milliseconds. `supabase` used to miss the Postgres branch, so its
           ceiling would have been read in milliseconds — making every value the
           tenant supplied look a thousand times too large and forcing it down. */
        val supabase = JdbcTimeouts.paramsFor("supabase", t)
        val postgres = JdbcTimeouts.paramsFor("postgresql", t)
        assertEquals(postgres, supabase)

        val planetscale = JdbcTimeouts.paramsFor("planetscale", t)
        val mysql = JdbcTimeouts.paramsFor("mysql", t)
        assertEquals(mysql, planetscale)
    }

    @Test
    fun `a tenant socketTimeout of zero is still overridden on a managed provider`() {
        // "Wait forever" is exactly the opt-out this file exists to refuse, and
        // it was reachable for every provider outside the old four-name list.
        val out = JdbcTimeouts.applyTo(
            "jdbc:postgresql://db.abc.supabase.co:5432/app?socketTimeout=0", "supabase", t,
        )
        assertFalse(out.contains("socketTimeout=0"), out)
    }

    @Test
    fun `clampTotalCallMs bounds a hostile node timeout`() {
        assertEquals(t.httpTotalCallCeilingMs, t.clampTotalCallMs(Long.MAX_VALUE / 4))
        assertEquals(t.httpDefaultTotalCallMs, t.clampTotalCallMs(null))
        assertEquals(t.httpDefaultTotalCallMs, t.clampTotalCallMs(0L))
        assertEquals(1_000L, t.clampTotalCallMs(1L))
    }
}
