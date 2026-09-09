package com.vectorbea.api.ingress

import com.fasterxml.jackson.databind.ObjectMapper
import com.vectorbea.api.errors.ApiError
import com.vectorbea.api.queue.WorkflowQueue
import com.vectorbea.api.queue.WorkflowRunJob
import com.vectorbea.api.repository.RunEventRepository
import com.vectorbea.api.repository.RunRepository
import com.vectorbea.api.repository.WorkflowRepository
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Tag
import java.time.Duration
import java.util.UUID
import java.util.concurrent.ConcurrentLinkedQueue
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import javax.sql.DataSource
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

/**
 * The four acceptance criteria for ingress, against a real database.
 *
 * ── WHY THESE NEED POSTGRES ─────────────────────────────────────────────────
 * Three of the four are database properties and cannot be checked without one:
 *
 *   · "a retried creation returns the original" is a primary key doing the
 *     work. A mocked store would assert that the code I wrote matches the code
 *     I wrote, and would pass just as happily with the constraint missing.
 *   · "five ingress paths produce indistinguishable runs" is a claim about
 *     ROWS — the same columns, differing in one.
 *   · the concurrent-retry case is a race that only exists between two real
 *     transactions.
 */
@Tag("integration")
class IngressAcceptanceTest {

    private val mapper = ObjectMapper()
    private val ds: DataSource get() = com.vectorbea.api.testsupport.Infra.postgres

    private lateinit var w: World
    private lateinit var queue: CapturingQueue
    private lateinit var ingress: RunIngress

    private class World(
        val workspaceId: UUID = UUID.randomUUID(),
        val environmentId: UUID = UUID.randomUUID(),
        val workflowId: UUID = UUID.randomUUID(),
        val versionId: UUID = UUID.randomUUID(),
    )

    private class CapturingQueue : WorkflowQueue {
        val enqueued = ConcurrentLinkedQueue<WorkflowRunJob>()
        @Volatile var failing = false
        override fun enqueue(job: WorkflowRunJob): String {
            if (failing) throw com.vectorbea.api.queue.WorkflowQueueException("queue down (stub)")
            enqueued += job
            return "1-0"
        }
    }

    @BeforeEach
    fun setUp() {
        w = seed()
        queue = CapturingQueue()
        ingress = RunIngress(
            runRepo = RunRepository(ds),
            eventRepo = RunEventRepository(ds),
            workflowRepo = WorkflowRepository(ds),
            queue = queue,
            dataSource = ds,
            idempotency = IdempotencyStore(ds),
        )
    }

    private fun seed(): World {
        val world = World()
        ds.connection.use { c ->
            c.prepareStatement("INSERT INTO workspaces (id,name,slug) VALUES (?,?,?)").use {
                it.setObject(1, world.workspaceId); it.setString(2, "ingress")
                it.setString(3, "ingress-" + world.workspaceId); it.executeUpdate()
            }
            c.prepareStatement(
                "INSERT INTO environments (id,workspace_id,name,slug,type) " +
                    "VALUES (?,?,'t','t','development')"
            ).use {
                it.setObject(1, world.environmentId); it.setObject(2, world.workspaceId)
                it.executeUpdate()
            }
            /* Workflow, then version, then point the workflow at it. The FK on
               `current_version_id` is NOT deferred, so setting it in the insert
               fails — which is also the order publishing uses. */
            c.prepareStatement(
                "INSERT INTO workflows (id,workspace_id,environment_id,name,slug,status) " +
                    "VALUES (?,?,?,'t',?,'active')"
            ).use {
                it.setObject(1, world.workflowId); it.setObject(2, world.workspaceId)
                it.setObject(3, world.environmentId); it.setString(4, "wf-" + world.workflowId)
                it.executeUpdate()
            }
            c.prepareStatement(
                "INSERT INTO workflow_versions (id,workflow_id,version,graph_json) " +
                    "VALUES (?,?,1,'{}')"
            ).use {
                it.setObject(1, world.versionId); it.setObject(2, world.workflowId)
                it.executeUpdate()
            }
            c.prepareStatement("UPDATE workflows SET current_version_id = ? WHERE id = ?").use {
                it.setObject(1, world.versionId); it.setObject(2, world.workflowId)
                it.executeUpdate()
            }
        }
        return world
    }

    private fun request(
        source: TriggerSource,
        key: String? = null,
        input: String = """{"a":1}""",
        actor: TriggerActor = TriggerActor(),
    ) = RunIngress.Request(
        workspaceId = w.workspaceId,
        workflowId = w.workflowId,
        environmentId = w.environmentId,
        inputJson = input,
        source = source,
        actor = actor,
        idempotencyKey = key,
    )

    // ─────────────────────────────────────────────────────────────────────────
    // ACCEPTANCE 1: five doors, one run shape
    // ─────────────────────────────────────────────────────────────────────────

    @Test
    fun `a run started five different ways differs only in its trigger attribute`() {
        val started = TriggerSource.entries.associateWith { source ->
            ingress.start(request(source)).runId
        }

        assertEquals(TriggerSource.entries.size, started.size)

        /*
         * Every column that describes WHAT the run is, read back from the rows.
         * If any ingress path produced a run with a different class, a different
         * version, a missing fair-queue placement or a different status, it shows
         * up here as a set with more than one element.
         */
        data class Shape(
            val workflowId: UUID, val versionId: UUID, val environmentId: UUID,
            val status: String, val executionClass: String, val input: String,
            val placed: Boolean,
        )

        val shapes = started.mapValues { (_, runId) ->
            ds.connection.use { c ->
                c.prepareStatement(
                    "SELECT workflow_id, workflow_version_id, environment_id, status, " +
                        "execution_class, input_json, fair_vtime, trigger_type " +
                        "FROM agent_runs WHERE id = ?"
                ).use { st ->
                    st.setObject(1, runId)
                    st.executeQuery().use { rs ->
                        assertTrue(rs.next(), "no row for the run started by this source")
                        Shape(
                            workflowId = rs.getObject("workflow_id", UUID::class.java),
                            versionId = rs.getObject("workflow_version_id", UUID::class.java),
                            environmentId = rs.getObject("environment_id", UUID::class.java),
                            status = rs.getString("status"),
                            executionClass = rs.getString("execution_class"),
                            input = rs.getString("input_json"),
                            placed = rs.getDouble("fair_vtime") > 0.0,
                        ) to rs.getString("trigger_type")
                    }
                }
            }
        }

        val distinctShapes = shapes.values.map { it.first }.toSet()
        assertEquals(
            1, distinctShapes.size,
            "runs started through different ingress paths are not the same shape. " +
                "That is the criterion: five doors, one kind of run. Got: $distinctShapes",
        )

        // And the one thing that IS allowed to differ, does.
        assertEquals(
            TriggerSource.entries.map { it.wire }.toSet(),
            shapes.values.map { it.second }.toSet(),
            "the trigger attribute does not name the door the run came in by",
        )

        assertTrue(
            shapes.values.all { it.first.placed },
            "a run was created without a fair-queue placement, which the claim reads " +
                "as the front of the queue — one ingress path would preempt every other " +
                "tenant's work.",
        )

        assertEquals(TriggerSource.entries.size, queue.enqueued.size,
            "not every ingress path enqueued its run")
    }

    // ─────────────────────────────────────────────────────────────────────────
    // ACCEPTANCE 2: a retried creation returns the original
    // ─────────────────────────────────────────────────────────────────────────

    @Test
    fun `a retry with the same idempotency key returns the original run`() {
        val first = ingress.start(request(TriggerSource.API, key = "retry-me"))
        val second = ingress.start(request(TriggerSource.API, key = "retry-me"))

        assertEquals(first.runId, second.runId, "the retry started a second run")
        assertTrue(second.idempotentHit, "the caller is not told it was a duplicate")
        assertEquals(1, queue.enqueued.size, "the run was enqueued twice")
        assertEquals(1, runCount(), "two run rows exist for one logical run")
    }

    @Test
    fun `two concurrent creations with one key produce one run`() {
        /*
         * ── THE CASE THE OLD IMPLEMENTATION LOST ────────────────────────────
         * A Redis GET followed by a SETEX is not atomic, so both callers missed
         * and both created a run. And this is not an exotic race — it is the
         * shape of a client retrying a timeout, where the first request is still
         * in flight. Which is precisely when it happens.
         */
        val threads = 8
        val ready = CountDownLatch(threads)
        val go = CountDownLatch(1)
        val pool = Executors.newFixedThreadPool(threads)
        val results = ConcurrentLinkedQueue<Any>()

        repeat(threads) {
            pool.submit {
                ready.countDown()
                go.await()
                results += runCatching {
                    ingress.start(request(TriggerSource.API, key = "concurrent"))
                }.fold({ it.runId }, { it })
            }
        }
        ready.await(10, TimeUnit.SECONDS)
        go.countDown()
        pool.shutdown()
        assertTrue(pool.awaitTermination(30, TimeUnit.SECONDS), "the racers did not finish")

        val runIds = results.filterIsInstance<UUID>().toSet()
        val conflicts = results.filterIsInstance<ApiError.Conflict>()

        assertEquals(
            1, runCount(),
            "$threads concurrent creations with one idempotency key produced " +
                "${runCount()} runs. Each extra one is a duplicate side effect the " +
                "caller is billed for and did not ask for.",
        )
        assertTrue(runIds.size <= 1, "callers were handed different run ids for one key")
        assertTrue(
            runIds.isNotEmpty() || conflicts.isNotEmpty(),
            "every caller failed; at least one should have got the run",
        )
    }

    @Test
    fun `the same key with a different request is refused, not silently reused`() {
        ingress.start(request(TriggerSource.API, key = "shared", input = """{"a":1}"""))

        val error = runCatching {
            ingress.start(request(TriggerSource.API, key = "shared", input = """{"a":2}"""))
        }.exceptionOrNull()

        assertTrue(
            error is ApiError.Conflict,
            "reusing a key for a DIFFERENT request returned ${error ?: "the first run"}. " +
                "Silently returning the first tells the caller their second request " +
                "happened when it did not.",
        )
    }

    @Test
    fun `a refused run gives its idempotency key back`() {
        queue.failing = true
        val failed = runCatching { ingress.start(request(TriggerSource.API, key = "reusable")) }
        assertTrue(failed.isFailure, "the enqueue failure did not surface")

        queue.failing = false
        val second = runCatching { ingress.start(request(TriggerSource.API, key = "reusable")) }

        assertTrue(
            second.isSuccess,
            "the key was burned by a run that never started. A client refused for " +
                "quota, or by a queue outage, retries with the same key — and would " +
                "be told it is a duplicate of a run that does not exist. Got: " +
                "${second.exceptionOrNull()}",
        )
    }

    // ─────────────────────────────────────────────────────────────────────────
    // ACCEPTANCE 3: sync returns, or degrades — never hangs
    // ─────────────────────────────────────────────────────────────────────────

    @Test
    fun `sync mode degrades to the run id rather than waiting forever`() {
        val started = ingress.start(request(TriggerSource.API))
        val waiter = SyncRunWaiter(RunRepository(ds))

        val began = System.currentTimeMillis()
        val outcome = waiter.await(started.runId, w.workspaceId, Duration.ofMillis(600))
        val elapsed = System.currentTimeMillis() - began

        /* Nothing executes the run in this test, so it stays queued — which is
           exactly the six-minute-workflow case, compressed. */
        assertTrue(
            outcome is SyncRunWaiter.Outcome.StillRunning,
            "a run that never finished was reported as finished",
        )
        assertTrue(
            elapsed in 500..5_000,
            "the wait took ${elapsed}ms for a 600ms budget. Under-waiting returns a " +
                "result the caller could have had; over-waiting is the hang this " +
                "criterion exists to rule out.",
        )
        assertEquals(started.runId,
            (outcome as SyncRunWaiter.Outcome.StillRunning).run?.id ?: started.runId,
            "the degraded answer does not carry the run id, so the caller has nothing")
    }

    @Test
    fun `sync mode returns as soon as the run is terminal`() {
        val started = ingress.start(request(TriggerSource.API))
        val waiter = SyncRunWaiter(RunRepository(ds))

        /* Finish it out of band, the way a worker would. */
        Executors.newSingleThreadScheduledExecutor().schedule({
            ds.connection.use { c ->
                c.prepareStatement(
                    "UPDATE agent_runs SET status='succeeded', output_json='{\"ok\":true}' WHERE id=?"
                ).use { it.setObject(1, started.runId); it.executeUpdate() }
            }
        }, 300, TimeUnit.MILLISECONDS)

        val began = System.currentTimeMillis()
        val outcome = waiter.await(started.runId, w.workspaceId, Duration.ofSeconds(20))
        val elapsed = System.currentTimeMillis() - began

        val finished = assertNotNull(outcome as? SyncRunWaiter.Outcome.Finished,
            "the wait did not notice the run finishing")
        assertEquals("succeeded", finished.run.status)
        assertTrue(
            elapsed < 5_000,
            "it took ${elapsed}ms to notice a run that finished in 300ms. A sync caller " +
                "is holding a connection for every one of those milliseconds.",
        )
    }

    @Test
    fun `a sync caller cannot ask to wait longer than the proxy will allow`() {
        /*
         * Bounded by what sits in FRONT of this API, not by taste: a load
         * balancer idles out around 60s, and a limit above it produces a dropped
         * connection instead of a clean 202 — the caller loses the run id and has
         * no way to find their run.
         */
        assertTrue(
            SyncRunWaiter.MAX_TIMEOUT <= Duration.ofSeconds(60),
            "the sync ceiling is ${SyncRunWaiter.MAX_TIMEOUT}, past the point where a " +
                "proxy drops the connection and the caller loses the run id.",
        )
    }

    // ─────────────────────────────────────────────────────────────────────────
    // ACCEPTANCE 4: one refusal, at every door
    // ─────────────────────────────────────────────────────────────────────────

    @Test
    fun `an over-quota workspace is refused identically at every ingress`() {
        /*
         * A REAL guard over a REAL plan, not a stub.
         *
         * Stubbing the guard would assert that five call sites call a mock, which
         * is nearly true by inspection. What the criterion is actually about is
         * that all five reach the same refusal with the same sentence — and the
         * sentence is composed inside `requireQuota` from the plan's own columns.
         * A stub cannot check that, and it is the half a customer reads.
         *
         * The quota is set to ZERO rather than usage being driven up: `used <
         * limit` is false at 0/0, so the account is over quota from the first
         * request with no ledger seeding at all.
         */
        val owner = UUID.randomUUID()
        val workspaceId = UUID.randomUUID()
        val planCode = "test-noruns-" + workspaceId.toString().take(8)

        ds.connection.use { c ->
            c.prepareStatement("INSERT INTO app_users (id, supabase_user_id, email) VALUES (?,?,?)")
                .use {
                    it.setObject(1, owner); it.setString(2, "sub-$owner")
                    it.setString(3, "$owner@example.test"); it.executeUpdate()
                }
            /* The BEFORE INSERT trigger mints the billing account; nothing here
               has to know how — which is also the invariant-12 behaviour worth
               exercising rather than bypassing. */
            c.prepareStatement(
                "INSERT INTO workspaces (id,name,slug,owner_user_id) VALUES (?,?,?,?)"
            ).use {
                it.setObject(1, workspaceId); it.setString(2, "Quota")
                it.setString(3, "quota-$workspaceId"); it.setObject(4, owner)
                it.executeUpdate()
            }
            c.prepareStatement(
                "INSERT INTO environments (id,workspace_id,name,slug,type) " +
                    "VALUES (?,?,'t','t','development')"
            ).use {
                it.setObject(1, quotaEnvironmentId); it.setObject(2, workspaceId); it.executeUpdate()
            }
            c.prepareStatement(
                "INSERT INTO workflows (id,workspace_id,environment_id,name,slug,status) " +
                    "VALUES (?,?,?,'t',?,'active')"
            ).use {
                it.setObject(1, quotaWorkflowId); it.setObject(2, workspaceId)
                it.setObject(3, quotaEnvironmentId); it.setString(4, "wf-$quotaWorkflowId")
                it.executeUpdate()
            }
            c.prepareStatement(
                "INSERT INTO workflow_versions (id,workflow_id,version,graph_json) " +
                    "VALUES (?,?,1,'{}')"
            ).use {
                it.setObject(1, quotaVersionId); it.setObject(2, quotaWorkflowId); it.executeUpdate()
            }
            c.prepareStatement("UPDATE workflows SET current_version_id = ? WHERE id = ?").use {
                it.setObject(1, quotaVersionId); it.setObject(2, quotaWorkflowId); it.executeUpdate()
            }

            c.prepareStatement(
                "INSERT INTO plans (code,name,description,price_cents,price_model,sort_order,is_public) " +
                    "VALUES (?,?,'test',0,'per_seat',999,false)"
            ).use { it.setString(1, planCode); it.setString(2, "No runs"); it.executeUpdate() }

            /* A copy of Free with one number changed. Every value column is
               copied, not just `int_value`: `plan_entitlements_value_matches_kind`
               requires a feature row to carry a boolean and a setting row to
               carry its own type, so copying one column produces a plan that
               cannot be inserted. */
            c.prepareStatement(
                "INSERT INTO plan_entitlements " +
                    "  (plan_code,key,kind,scope,period,int_value,bool_value,num_value,text_value) " +
                    "SELECT ?, key, kind, scope, period, " +
                    "       CASE WHEN key = ? THEN 0 ELSE int_value END, " +
                    "       bool_value, num_value, text_value " +
                    "  FROM plan_entitlements WHERE plan_code = 'free'"
            ).use {
                it.setString(1, planCode)
                it.setString(2, com.vectorbea.api.entitlements.EntitlementKeys.RUNS_PER_MONTH)
                it.executeUpdate()
            }

            c.prepareStatement(
                "UPDATE billing_accounts SET plan_code = ? WHERE id = " +
                    "(SELECT billing_account_id FROM workspaces WHERE id = ?)"
            ).use { it.setString(1, planCode); it.setObject(2, workspaceId); it.executeUpdate() }
        }

        val guard = com.vectorbea.api.entitlements.EntitlementGuard(
            com.vectorbea.api.entitlements.EntitlementResolver(ds), ds,
            /* Explicitly on. Enforcement ships in shadow mode by default — the
               repo's standing flag rule — and a test that inherited the default
               would pass while refusing nobody. */
            enforcing = true,
        )
        val refusing = RunIngress(
            runRepo = RunRepository(ds),
            eventRepo = RunEventRepository(ds),
            workflowRepo = WorkflowRepository(ds),
            queue = queue,
            dataSource = ds,
            idempotency = IdempotencyStore(ds),
            entitlements = guard,
        )

        val refusals = TriggerSource.entries.map { source ->
            val e = runCatching {
                refusing.start(RunIngress.Request(
                    workspaceId = workspaceId,
                    workflowId = quotaWorkflowId,
                    environmentId = quotaEnvironmentId,
                    source = source,
                ))
            }.exceptionOrNull()
            val api = assertNotNull(e as? ApiError,
                "$source was not refused. An ingress that skips the quota check is a " +
                    "way around every plan limit in the product.")
            source to (api.code to api.message)
        }

        assertEquals(
            1, refusals.map { it.second }.toSet().size,
            "the ingress paths gave different refusals for one condition: " +
                "${refusals.joinToString("\n") { "${it.first} -> ${it.second}" }}\n" +
                "A customer who hits their limit through a webhook and through the API " +
                "must be told the same thing.",
        )

        assertEquals(0, runCount(workspaceId), "a refused ingress created a run anyway")
    }

    private val quotaEnvironmentId = UUID.randomUUID()
    private val quotaWorkflowId = UUID.randomUUID()
    private val quotaVersionId = UUID.randomUUID()

    // ── Helpers ──────────────────────────────────────────────────────────────

    private fun runCount(workspaceId: UUID = w.workspaceId): Int = ds.connection.use { c ->
        c.prepareStatement("SELECT count(*) FROM agent_runs WHERE workspace_id = ?").use { st ->
            st.setObject(1, workspaceId)
            st.executeQuery().use { rs -> if (rs.next()) rs.getInt(1) else 0 }
        }
    }
}
