package com.vectorbea.worker.durable

import com.vectorbea.worker.metrics.WorkerMetrics
import kotlinx.coroutines.runBlocking
import org.junit.jupiter.api.Assumptions.assumeTrue
import org.postgresql.ds.PGSimpleDataSource
import java.util.UUID
import javax.sql.DataSource
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotEquals
import kotlin.test.assertTrue
import org.junit.jupiter.api.Tag

/**
 * Proves the dedupe path actually fires.
 *
 * WHY THIS EXISTS SEPARATELY FROM THE CHAOS SUITE
 * -----------------------------------------------
 * The chaos suite reported zero duplicate side effects — and also zero dedupe
 * events. Both are true, and the second one is the interesting part: the dedupe
 * path never ran, so the suite proved that no duplicates occurred without
 * proving the mechanism that is supposed to prevent them.
 *
 * The reason is layering. `StepExecutionGuard` short-circuits a retry at the
 * *node* level: if the step already succeeded, the node is skipped and
 * `SideEffectGuard.begin()` is never called a second time. That is the first
 * line of defence and it caught every crash the chaos suite injected.
 *
 * `SideEffectGuard` is the second line, and it covers the window the first one
 * cannot: the side effect succeeded and was recorded, but the worker died before
 * `step_executions` was marked complete. On retry the step guard sees an
 * unfinished step and re-executes the node — and only this guard stops the email
 * going out twice.
 *
 * Hitting that window by random killing is a coin flip. Asserting it directly is
 * not. `side_effect_dedupe_total` going from 0 to 1 in this test is the proof the
 * brief asks for.
 *
 * Skips when no database is reachable, so the normal `gradle test` stays green
 * without infrastructure.
 */
@Tag("integration")
class SideEffectGuardIntegrationTest {

    private val jdbcUrl = System.getenv("TEST_DATABASE_URL")
        ?: "jdbc:postgresql://127.0.0.1:15432/vectorbea?user=vectorbea&password=vectorbea"

    /**
     * The database, or a thrown exception naming what is missing.
     *
     * This used to probe a hard-coded localhost port and return null, which
     * turned every test in this class into a silent pass on any machine
     * without it. See [Infra].
     */
    private fun dataSourceOrNull(): DataSource? = com.vectorbea.worker.testsupport.Infra.postgres

    /** Minimal FK chain so a side_effects row can exist. */
    private fun seedRun(ds: DataSource): Pair<UUID, UUID> {
        val ws = UUID.randomUUID()
        val env = UUID.randomUUID()
        val wf = UUID.randomUUID()
        val ver = UUID.randomUUID()
        val run = UUID.randomUUID()
        ds.connection.use { c ->
            c.prepareStatement("INSERT INTO workspaces (id,name,slug) VALUES (?,?,?)").use {
                it.setObject(1, ws); it.setString(2, "sideeffect-test")
                it.setString(3, "sideeffect-test-$ws"); it.executeUpdate()
            }
            c.prepareStatement(
                "INSERT INTO environments (id,workspace_id,name,slug,type) VALUES (?,?,'t','t','development')"
            ).use { it.setObject(1, env); it.setObject(2, ws); it.executeUpdate() }
            c.prepareStatement(
                "INSERT INTO workflows (id,workspace_id,environment_id,name,slug,status) VALUES (?,?,?,'t',?,'active')"
            ).use {
                it.setObject(1, wf); it.setObject(2, ws); it.setObject(3, env)
                it.setString(4, "wf-$wf"); it.executeUpdate()
            }
            c.prepareStatement(
                "INSERT INTO workflow_versions (id,workflow_id,version,graph_json) VALUES (?,?,1,'{}')"
            ).use { it.setObject(1, ver); it.setObject(2, wf); it.executeUpdate() }
            c.prepareStatement(
                """INSERT INTO agent_runs
                   (id,workspace_id,environment_id,workflow_id,workflow_version_id,status)
                   VALUES (?,?,?,?,?,'running')"""
            ).use {
                it.setObject(1, run); it.setObject(2, ws); it.setObject(3, env)
                it.setObject(4, wf); it.setObject(5, ver); it.executeUpdate()
            }
        }
        return ws to run
    }

    private fun cleanup(ds: DataSource, ws: UUID) {
        runCatching {
            ds.connection.use { c ->
                c.prepareStatement("DELETE FROM workspaces WHERE id=?").use {
                    it.setObject(1, ws); it.executeUpdate()
                }
            }
        }
    }

    private fun dedupeCount(): Long =
        WorkerMetrics.sideEffectDedupeTotal.cells.values.sumOf { it.get() }

    // ── The proof ─────────────────────────────────────────────────────────────

    /**
     * THE test the brief asks for: a completed side effect is not performed twice,
     * the stored response is replayed, and the dedupe counter fires.
     */
    @Test
    fun `a completed side effect deduplicates and increments the counter`(): Unit = runBlocking {
        val ds = dataSourceOrNull()
        assumeTrue(ds != null, "no database reachable at $jdbcUrl — skipping")
        val (ws, run) = seedRun(ds!!)
        try {
            val guard = SideEffectGuard(ds, workerId = "test-worker")
            val before = dedupeCount()

            // First attempt: nobody has done this, so we get to.
            val first = guard.begin(ws, run, "n1", 0, "http", "example.com", "lease-1")
            assertTrue(first is SideEffectGuard.Outcome.Proceed,
                "first attempt must be allowed to perform the call, got $first")
            first as SideEffectGuard.Outcome.Proceed

            // ... the call happens, and we record it.
            guard.complete(first.sideEffectId, """{"messageId":"abc-123"}""")

            // Second attempt — this is the retry after a crash that lost the
            // step_executions write. The call must NOT happen again.
            val second = guard.begin(ws, run, "n1", 0, "http", "example.com", "lease-2")
            assertTrue(second is SideEffectGuard.Outcome.AlreadyDone,
                "a completed side effect must dedupe, got $second")
            second as SideEffectGuard.Outcome.AlreadyDone

            assertTrue(second.response?.contains("abc-123") == true,
                "the stored response must be replayed verbatim, got ${second.response}")
            assertEquals(first.key, second.key, "both attempts must compute the same key")

            assertEquals(before + 1, dedupeCount(),
                "side_effect_dedupe_total must fire — this is the proof the mechanism works")
        } finally {
            cleanup(ds, ws)
        }
    }

    /**
     * A genuine failure is not a duplicate risk, so a retry is allowed through.
     * Getting this wrong the other way would strand every transient failure.
     */
    @Test
    fun `a failed side effect permits a genuine retry`(): Unit = runBlocking {
        val ds = dataSourceOrNull()
        assumeTrue(ds != null, "no database reachable — skipping")
        val (ws, run) = seedRun(ds!!)
        try {
            val guard = SideEffectGuard(ds, workerId = "test-worker")

            val first = guard.begin(ws, run, "n1", 0, "http", "example.com", null)
            first as SideEffectGuard.Outcome.Proceed
            guard.fail(first.sideEffectId, "connection refused")

            val second = guard.begin(ws, run, "n1", 0, "http", "example.com", null)
            assertTrue(second is SideEffectGuard.Outcome.Proceed,
                "a failed call must be retryable, got $second")
        } finally {
            cleanup(ds, ws)
        }
    }

    /**
     * An in-flight call is never raced. The second attempt must not proceed —
     * a duplicate email is worse than a delayed one.
     */
    @Test
    fun `an in-flight side effect is never raced`(): Unit = runBlocking {
        val ds = dataSourceOrNull()
        assumeTrue(ds != null, "no database reachable — skipping")
        val (ws, run) = seedRun(ds!!)
        try {
            val guard = SideEffectGuard(ds, workerId = "test-worker")
            val first = guard.begin(ws, run, "n1", 0, "http", "example.com", null)
            assertTrue(first is SideEffectGuard.Outcome.Proceed)

            // Left in_flight deliberately — this is the crashed-mid-call state.
            val second = guard.begin(ws, run, "n1", 0, "http", "example.com", null)
            assertTrue(second is SideEffectGuard.Outcome.Undetermined,
                "an in-flight call must not be raced, got $second")
        } finally {
            cleanup(ds, ws)
        }
    }

    // ── Key semantics: the part that is easy to get subtly wrong ──────────────

    /**
     * The distinction the whole design rests on.
     *
     * Retries of one logical operation must share a key so they dedupe. A
     * user-initiated re-run must NOT, because the user is asking for the email to
     * be sent again. Deriving the key from `attempt` instead of `attempt_group`
     * would give every retry a fresh key — the mechanism would look present and
     * do nothing.
     */
    @Test
    fun `key is stable per attempt_group and changes across groups`() {
        val run = UUID.randomUUID()

        val a = SideEffectGuard.keyFor(run, "n1", 0)
        val b = SideEffectGuard.keyFor(run, "n1", 0)
        assertEquals(a, b, "the same logical operation must produce the same key on every retry")

        val rerun = SideEffectGuard.keyFor(run, "n1", 1)
        assertNotEquals(a, rerun, "a user-initiated re-run must get a fresh key and actually run")

        assertNotEquals(a, SideEffectGuard.keyFor(run, "n2", 0), "different nodes must not collide")
        assertNotEquals(a, SideEffectGuard.keyFor(UUID.randomUUID(), "n1", 0),
            "different runs must not collide")
    }

    /**
     * The key travels to the provider as an `Idempotency-Key` header, so it has to
     * survive as a header value and be recognisable in a provider's dashboard.
     */
    @Test
    fun `key is header-safe and identifiable`() {
        val key = SideEffectGuard.keyFor(UUID.randomUUID(), "node-1", 0)
        assertTrue(key.startsWith("vb_"), "keys should be identifiable as ours: $key")
        assertTrue(key.length in 8..128, "unreasonable header length: ${key.length}")
        assertTrue(key.all { it.isLetterOrDigit() || it == '_' },
            "key must be safe as an HTTP header value: $key")
    }
}
