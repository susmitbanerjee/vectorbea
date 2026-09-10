package com.vectorbea.api.runner

import com.vectorbea.api.errors.ApiError
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Tag
import java.util.UUID
import javax.sql.DataSource
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * A run that executes inside the customer's network, and stays there.
 *
 * ── WHAT THE ACCEPTANCE CRITERION ACTUALLY CLAIMS ───────────────────────────
 * "A self-hosted runner executes a run with no payload leaving the customer
 * network, and the Debug tab degrades legibly rather than appearing broken."
 *
 * Three separable claims, and the second is the one a customer's security
 * review will test:
 *
 *   1. The run is not executed by us. A platform worker must not be able to
 *      claim it — through EITHER door, the Postgres claim and the Redis stream.
 *   2. Nothing but metadata crosses the perimeter, and that is enforced at OUR
 *      end, because a runner is software the customer deploys and may be an old
 *      build.
 *   3. The absence is legible: a failed run says why there is no message, and
 *      the run says its payloads are withheld — while it is still running, not
 *      only after it finishes.
 */
@Tag("integration")
class SelfHostedRunnerAcceptanceTest {

    private val ds: DataSource get() = com.vectorbea.api.testsupport.Infra.postgres

    private lateinit var store: RunnerStore
    private lateinit var w: World

    private class World(
        val workspaceId: UUID = UUID.randomUUID(),
        val environmentId: UUID = UUID.randomUUID(),
        val workflowId: UUID = UUID.randomUUID(),
        val versionId: UUID = UUID.randomUUID(),
    )

    @BeforeEach
    fun setUp() {
        store = RunnerStore(ds)
        w = seed()
    }

    private fun seed(): World {
        val world = World()
        ds.connection.use { c ->
            c.prepareStatement("INSERT INTO workspaces (id,name,slug) VALUES (?,?,?)").use {
                it.setObject(1, world.workspaceId); it.setString(2, "runner")
                it.setString(3, "runner-" + world.workspaceId); it.executeUpdate()
            }
            c.prepareStatement(
                "INSERT INTO environments (id,workspace_id,name,slug,type) " +
                    "VALUES (?,?,'t','t','development')"
            ).use { it.setObject(1, world.environmentId); it.setObject(2, world.workspaceId); it.executeUpdate() }
            c.prepareStatement(
                "INSERT INTO workflows (id,workspace_id,environment_id,name,slug,status) " +
                    "VALUES (?,?,?,'t',?,'active')"
            ).use {
                it.setObject(1, world.workflowId); it.setObject(2, world.workspaceId)
                it.setObject(3, world.environmentId); it.setString(4, "wf-" + world.workflowId)
                it.executeUpdate()
            }
            c.prepareStatement(
                "INSERT INTO workflow_versions (id,workflow_id,version,graph_json) VALUES (?,?,1,'{}')"
            ).use { it.setObject(1, world.versionId); it.setObject(2, world.workflowId); it.executeUpdate() }
        }
        return world
    }

    private fun pool(policy: String = "strict"): RunnerStore.Pool {
        val id = store.createPool(
            workspaceId = w.workspaceId, name = "vpc-pool",
            slug = "vpc-${UUID.randomUUID().toString().take(8)}",
            locationLabel = "eu-west-1 / our VPC", payloadPolicy = policy, createdBy = null,
        )
        return RunnerStore.Pool(
            id = id, workspaceId = w.workspaceId, name = "vpc-pool",
            payloadPolicy = RunnerReport.PayloadPolicy.of(policy), enabled = true,
        )
    }

    private fun queuedRun(poolId: UUID?, priority: Short = 0): UUID {
        val id = UUID.randomUUID()
        ds.connection.use { c ->
            c.prepareStatement(
                """INSERT INTO agent_runs
                     (id, workspace_id, environment_id, workflow_id, workflow_version_id,
                      status, input_json, execution_class, priority, runner_pool_id,
                      payloads_withheld)
                   VALUES (?,?,?,?,?, 'queued', ?::jsonb, 'short', ?, ?, ?)"""
            ).use {
                it.setObject(1, id); it.setObject(2, w.workspaceId); it.setObject(3, w.environmentId)
                it.setObject(4, w.workflowId); it.setObject(5, w.versionId)
                it.setString(6, """{"customer":"data"}""")
                it.setShort(7, priority)
                it.setObject(8, poolId)
                it.setBoolean(9, poolId != null)
                it.executeUpdate()
            }
        }
        return id
    }

    private fun statusOf(runId: UUID) = ds.connection.use { c ->
        c.prepareStatement("SELECT status FROM agent_runs WHERE id = ?").use {
            it.setObject(1, runId)
            it.executeQuery().use { rs -> rs.next(); rs.getString(1) }
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 1. THE PLATFORM MUST NOT EXECUTE IT
    // ─────────────────────────────────────────────────────────────────────────

    @Test
    fun `a pinned run is invisible to the platform claim`() {
        val p = pool()
        val pinned = queuedRun(p.id)
        val ordinary = queuedRun(null)

        /*
         * The predicate `PostgresClaim` uses, asserted directly. If this ever
         * stops holding, a platform worker executes a customer's prompts on our
         * infrastructure — not a degraded experience, the guarantee they bought,
         * broken silently with no error anywhere.
         */
        val claimable = ds.connection.use { c ->
            c.prepareStatement(
                "SELECT id FROM agent_runs WHERE workspace_id = ? AND status = 'queued' " +
                    "AND runner_pool_id IS NULL"
            ).use { st ->
                st.setObject(1, w.workspaceId)
                st.executeQuery().use { rs ->
                    buildList { while (rs.next()) add(rs.getObject(1, UUID::class.java)) }
                }
            }
        }
        assertEquals(listOf(ordinary), claimable,
            "the platform claim can see a run pinned to a customer's network")
        assertTrue(pinned !in claimable)
    }

    @Test
    fun `only a runner in the pinned pool can lease it`() {
        val ours = pool()
        val theirs = pool()
        val run = queuedRun(ours.id)

        val wrongPool = store.registerRunner(theirs, "r1", null, null, "{}")
        assertNull(store.lease(theirs, wrongPool, 60),
            "a runner in a different pool leased a run pinned to another network")

        val rightPool = store.registerRunner(ours, "r1", null, null, "{}")
        val leased = store.lease(ours, rightPool, 60)
        assertNotNull(leased)
        assertEquals(run, leased.runId)
        assertEquals("running", statusOf(run))
    }

    @Test
    fun `two runners in one pool do not both get the same run`() {
        val p = pool()
        queuedRun(p.id)
        val a = store.registerRunner(p, "replica-a", null, null, "{}")
        val b = store.registerRunner(p, "replica-b", null, null, "{}")

        val first = store.lease(p, a, 60)
        val second = store.lease(p, b, 60)
        assertNotNull(first)
        assertNull(second,
            "both replicas leased the same run — `FOR UPDATE SKIP LOCKED` is not holding, and " +
                "the work would execute twice")
    }

    @Test
    fun `the run's own input travels out, which is the one direction that is not a leak`() {
        val p = pool()
        queuedRun(p.id)
        val r = store.registerRunner(p, "r1", null, null, "{}")
        val leased = store.lease(p, r, 60)
        assertNotNull(leased)
        assertTrue(leased.inputJson.contains("customer"),
            "the runner needs the input to execute; it is the customer's own data going back " +
                "into the customer's own network")
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 2. NOTHING BUT METADATA CROSSES THE PERIMETER
    // ─────────────────────────────────────────────────────────────────────────

    @Test
    fun `a runner reporting payloads has them dropped at our end`() {
        /*
         * ── THE TEST THE SECURITY REVIEW WOULD WRITE ────────────────────────
         * A runner sending payloads is not hypothetical: it is what an old
         * build, a patched build, or a misconfigured one does. The guarantee
         * cannot depend on the remote side having redacted correctly — that is
         * a hope with a version number — so the filter runs here.
         */
        val hostile = mapOf(
            "type" to "STEP_COMPLETED",
            "status" to "success",
            "stepId" to "extract-pii",
            "durationMs" to 1234,
            "tokenCount" to 900,
            // Everything below is a payload, in the shapes a runner might send.
            "title" to "Extracted alice@example.com",
            "summary" to "Tool returned 3 rows: alice@example.com, bob@example.com",
            "output" to mapOf("email" to "alice@example.com"),
            "prompt" to "Here is the customer record: ...",
            "toolResult" to """{"ssn":"123-45-6789"}""",
            "meta" to """{"raw":"..."}""",
        )

        val filtered = RunnerReport.filterEvent(hostile, RunnerReport.PayloadPolicy.STRICT)

        assertEquals(
            setOf("type", "status", "stepId", "durationMs", "tokenCount"),
            filtered.kept.keys,
            "a field that is not on the allow-list survived the filter")

        val kept = filtered.kept.values.joinToString(" ")
        assertFalse(kept.contains("alice@example.com"),
            "an email address crossed the perimeter")
        assertFalse(kept.contains("123-45-6789"),
            "a social security number crossed the perimeter")

        assertTrue(filtered.dropped.containsAll(
            listOf("title", "summary", "output", "prompt", "toolResult", "meta")),
            "the dropped fields must be counted, so an operator learns a runner is trying to " +
                "send payloads. Got: ${filtered.dropped}")

        /* Names, never values. This list is logged, and a log line ends up in a
           search index, a support ticket and a screenshot. */
        assertFalse(filtered.dropped.joinToString(" ").contains("alice"),
            "the dropped list carried a value, which reproduces the leak inside the diagnostic " +
                "for the leak")
    }

    @Test
    fun `a title that looks harmless is still a payload`() {
        /*
         * The subtle one. A title or summary is GENERATED FROM the thing it
         * describes — "Tool returned 3 rows: alice@…" is a summary — so an
         * allow-list that let them through on the grounds that they are short
         * would leak exactly the data the feature exists to keep inside.
         */
        val filtered = RunnerReport.filterEvent(
            mapOf("type" to "STEP_COMPLETED", "title" to "anything at all"),
            RunnerReport.PayloadPolicy.STRICT,
        )
        assertFalse(filtered.kept.containsKey("title"))
        assertEquals(listOf("title"), filtered.dropped)
    }

    @Test
    fun `a widened policy accepts error text, and only error text`() {
        val filtered = RunnerReport.filterEvent(
            mapOf(
                "type" to "STEP_FAILED",
                "error" to "Connection refused to inventory-db:5432",
                "output" to "the row that caused it",
            ),
            RunnerReport.PayloadPolicy.METADATA_PLUS_ERRORS,
        )
        assertTrue((filtered.kept["error"] as String).contains("inventory-db"))
        assertEquals(listOf("output"), filtered.dropped,
            "a widened policy widened further than errors")
    }

    @Test
    fun `a widened policy is still bounded`() {
        /* A stack trace or a dumped request body arrives as "an error message".
           The cap is what stops the widening becoming unbounded. */
        val huge = "x".repeat(RunnerReport.MAX_ERROR_CHARS * 3)
        val filtered = RunnerReport.filterEvent(
            mapOf("type" to "STEP_FAILED", "error" to huge),
            RunnerReport.PayloadPolicy.METADATA_PLUS_ERRORS,
        )
        assertEquals(RunnerReport.MAX_ERROR_CHARS, (filtered.kept["error"] as String).length)
        assertTrue(filtered.dropped.any { it.endsWith(":truncated") })
    }

    @Test
    fun `a run's output has no policy that lets it through`() {
        /*
         * There is no widening for this one, and there should not be. A run's
         * output is the most concentrated form of exactly what the customer
         * deployed a runner to keep inside — and unlike an error message there
         * is no support argument for it, because the output is delivered to
         * wherever they told it to go, by a delivery target inside their own
         * network.
         */
        RunnerReport.PayloadPolicy.entries.forEach { policy ->
            val filtered = RunnerReport.filterCompletion(
                mapOf("status" to "succeeded", "outputJson" to """{"answer":"secret"}"""),
                policy,
            )
            assertFalse(filtered.kept.containsKey("outputJson"),
                "a run's output crossed the perimeter under policy $policy")
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 3. THE ABSENCE IS LEGIBLE
    // ─────────────────────────────────────────────────────────────────────────

    @Test
    fun `a run says its payloads are withheld while it is still running`() {
        /*
         * Set at CREATION, not on completion. Somebody opens the Debug tab
         * WHILE a run is going to find out why they cannot see anything — that
         * is precisely the moment the flag has to already be true.
         */
        val p = pool()
        val run = queuedRun(p.id)
        val withheld = ds.connection.use { c ->
            c.prepareStatement("SELECT payloads_withheld FROM agent_runs WHERE id = ?").use {
                it.setObject(1, run)
                it.executeQuery().use { rs -> rs.next(); rs.getBoolean(1) }
            }
        }
        assertTrue(withheld,
            "the run does not know its payloads are withheld until it finishes, so the Debug " +
                "tab renders an empty panel during the run — which reads as broken")
    }

    @Test
    fun `a failed run explains the absence instead of showing nothing`() {
        /*
         * ── THE SCREEN THIS AVOIDS ──────────────────────────────────────────
         * Under `strict` there is no error message, and the tempting answer is
         * to store nothing. That produces a failed run with an empty detail
         * panel, which reads as a broken product rather than as the policy the
         * customer deliberately chose.
         */
        val message = RunnerReport.explainWithheldFailure("timeout", "vpc-pool")

        assertTrue(message.contains("timeout", ignoreCase = true) ||
            message.contains("exceeded its timeout"),
            "it must say what happened: $message")
        assertTrue(message.contains("vpc-pool"),
            "it must say where, so the reader knows which runner's logs to look in: $message")
        assertTrue(message.contains("inside your network"),
            "it must say WHY there is no more, or the absence reads as a bug: $message")
        assertTrue(message.contains("metadata_plus_errors"),
            "it must say how to change it: $message")
    }

    @Test
    fun `an unrecognised classification still produces a sentence`() {
        listOf(null, "", "something-we-have-never-seen").forEach { c ->
            val message = RunnerReport.explainWithheldFailure(c, null)
            assertTrue(message.length > 40,
                "classification '$c' produced no explanation, which is the blank panel again")
            assertTrue(message.contains("self-hosted runner"))
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // The lease, which is held by a machine we cannot see
    // ─────────────────────────────────────────────────────────────────────────

    @Test
    fun `a runner that stops answering returns its work to the queue`() {
        val p = pool()
        val run = queuedRun(p.id)
        val r = store.registerRunner(p, "r1", null, null, "{}")
        assertNotNull(store.lease(p, r, 60))
        assertEquals("running", statusOf(run))

        /* The customer's VPN drops, a pod is evicted, a laptop closes. None of
           those send a packet, so only the deadline notices. */
        ds.connection.use { c ->
            c.prepareStatement("UPDATE runner_leases SET expires_at = now() - interval '1 minute' " +
                "WHERE run_id = ?").use { it.setObject(1, run); it.executeUpdate() }
        }

        val reclaimed = store.reclaimExpired()
        assertTrue(reclaimed >= 1)
        assertEquals("queued", statusOf(run),
            "a run whose runner vanished must go back on the queue, not sit in `running` " +
                "forever with nothing to explain it")

        /* And be leasable again by the next runner in the pool. */
        val r2 = store.registerRunner(p, "r2", null, null, "{}")
        assertNotNull(store.lease(p, r2, 60))
    }

    @Test
    fun `a heartbeat from a runner that no longer holds the lease is refused`() {
        val p = pool()
        val run = queuedRun(p.id)
        val a = store.registerRunner(p, "a", null, null, "{}")
        store.lease(p, a, 60)
        val b = store.registerRunner(p, "b", null, null, "{}")

        assertTrue(store.heartbeat(run, a, 60))
        assertFalse(store.heartbeat(run, b, 60),
            "a runner that does not hold the lease extended it, so a straggler could keep a " +
                "reclaimed run alive")
    }

    // ─────────────────────────────────────────────────────────────────────────
    // The token, whose blast radius is the point
    // ─────────────────────────────────────────────────────────────────────────

    @Test
    fun `a runner token resolves to exactly one pool`() {
        val p = pool()
        val other = pool()
        val minted = store.mintToken(w.workspaceId, p.id, "t", null, null)

        val auth = store.authenticate(minted.secret)
        assertEquals(p.id, auth.pool.id)
        assertTrue(auth.pool.id != other.id)
    }

    @Test
    fun `a revoked token is refused`() {
        val p = pool()
        val minted = store.mintToken(w.workspaceId, p.id, "t", null, null)
        ds.connection.use { c ->
            c.prepareStatement("UPDATE runner_tokens SET revoked_at = now() WHERE id = ?")
                .use { it.setObject(1, minted.id); it.executeUpdate() }
        }
        val e = runCatching { store.authenticate(minted.secret) }.exceptionOrNull()
        assertTrue(e is ApiError, "a revoked runner token still authenticated")
    }

    @Test
    fun `an expired token is refused in the same query that finds it`() {
        val p = pool()
        val minted = store.mintToken(
            w.workspaceId, p.id, "t", java.time.Instant.now().minusSeconds(60), null)
        val e = runCatching { store.authenticate(minted.secret) }.exceptionOrNull()
        assertTrue(e is ApiError,
            "an expired token authenticated — a two-step check has a window, and this one " +
                "runs on every heartbeat of every run")
    }

    @Test
    fun `only the token's hash is stored`() {
        val p = pool()
        val minted = store.mintToken(w.workspaceId, p.id, "t", null, null)
        val stored = ds.connection.use { c ->
            c.prepareStatement("SELECT token_hash, prefix FROM runner_tokens WHERE id = ?").use {
                it.setObject(1, minted.id)
                it.executeQuery().use { rs -> rs.next(); rs.getString(1) to rs.getString(2) }
            }
        }
        assertFalse(stored.first.contains(minted.secret),
            "the secret is recoverable from the database")
        assertEquals(RunnerStore.hash(minted.secret), stored.first)
        assertTrue(minted.secret.startsWith(stored.second),
            "the prefix must identify the token in a support conversation")
        assertTrue(minted.secret.startsWith("vbr_"),
            "a runner token must be distinguishable from an API key at a glance in a log")
    }

    @Test
    fun `a disabled pool is given no work`() {
        val p = pool()
        val minted = store.mintToken(w.workspaceId, p.id, "t", null, null)
        ds.connection.use { c ->
            c.prepareStatement("UPDATE runner_pools SET enabled = FALSE WHERE id = ?")
                .use { it.setObject(1, p.id); it.executeUpdate() }
        }
        val e = runCatching { store.authenticate(minted.secret) }.exceptionOrNull()
        assertTrue(e is ApiError.Forbidden,
            "a disabled pool still handed out work; disabling it is how an operator stops a " +
                "misbehaving runner fleet")
    }

    @Test
    fun `the pool listing answers why nothing is happening`() {
        val p = pool()
        repeat(3) { queuedRun(p.id) }
        /* No runner registered — the exact situation an operator hits first. */

        val listed = store.listPools(w.workspaceId).first { it["id"] == p.id.toString() }
        assertEquals(0, listed["liveRunners"],
            "with no runner connected, the listing must say zero")
        assertEquals(3, listed["queuedRuns"])
        /* "0 live, 3 queued" is the whole diagnosis, and it is not derivable
           anywhere else in the product. */
    }
}
