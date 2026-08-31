package com.vectorbea.worker.testsupport

import org.junit.jupiter.api.Tag
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * The integration tier proving it has a tier.
 *
 * If this is red, every other integration test is red for the same reason and
 * this is the one to read: it names which of the three pieces of infrastructure
 * failed, before any test-specific detail can obscure it.
 *
 * It also pins the thing most likely to rot: the migration runner. Migrations
 * are added constantly and one that cannot be applied to an empty database
 * breaks every container-backed test at once, with an error about a missing
 * column rather than about the migration.
 */
@Tag("integration")
class InfraSmokeTest {

    @Test
    fun `postgres comes up with every migration applied`() {
        Infra.postgres.connection.use { c ->
            val tables = c.prepareStatement(
                "SELECT count(*) FROM pg_tables WHERE schemaname = 'public'"
            ).use { it.executeQuery().use { rs -> rs.next(); rs.getInt(1) } }
            assertTrue(tables > 60, "expected a fully migrated schema, found $tables tables")

            /* One table from the newest migration, so "the migrations ran" cannot
               pass on a database that stopped at V001. */
            c.prepareStatement("SELECT count(*) FROM workspace_otel_exports")
                .use { it.executeQuery().use { rs -> rs.next() } }

            /* And one FUNCTION, because a migration file whose `$$` body was cut
               in half by a naive statement splitter still creates its tables. */
            val fn = c.prepareStatement(
                "SELECT count(*) FROM pg_proc WHERE proname = 'run_events_allocate_seq'"
            ).use { it.executeQuery().use { rs -> rs.next(); rs.getInt(1) } }
            assertEquals(1, fn, "a function body was truncated — the migration runner is splitting on ';'")
        }
    }

    @Test
    fun `redis comes up and answers`() {
        val r = Infra.redis()
        assertEquals("PONG", r.ping())
        r.set("infra-smoke", "ok")
        assertEquals("ok", r.get("infra-smoke"))
        r.del("infra-smoke")
    }

    /** Lua, specifically: the capacity bucket is Lua and nothing else executes it. */
    @Test
    fun `redis evaluates lua`() {
        val out = Infra.redis().eval<Long>(
            "return tonumber(ARGV[1]) + 1",
            io.lettuce.core.ScriptOutputType.INTEGER,
            arrayOf<String>(), "41",
        )
        assertEquals(42L, out)
    }

    @Test
    fun `the otlp collector is up and its query api answers`() {
        assertTrue(Infra.otlpEndpoint.startsWith("http"), Infra.otlpEndpoint)
        val conn = java.net.URI(Infra.jaegerQueryUrl + "/api/services").toURL()
            .openConnection() as java.net.HttpURLConnection
        conn.connectTimeout = 5_000
        conn.readTimeout = 5_000
        assertEquals(200, conn.responseCode, "Jaeger query API did not answer")
        conn.disconnect()
    }
}
