package com.vectorbea.worker.delivery

import com.fasterxml.jackson.databind.ObjectMapper
import com.sun.net.httpserver.HttpExchange
import com.sun.net.httpserver.HttpServer
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Tag
import java.net.InetSocketAddress
import java.time.Instant
import java.util.UUID
import java.util.concurrent.ConcurrentLinkedQueue
import javax.sql.DataSource
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * The acceptance criteria for result delivery, against a real database and a
 * real socket.
 *
 * ── WHY A REAL RECEIVER ─────────────────────────────────────────────────────
 * Every claim here is about what the RECEIVER sees: the same idempotency key on
 * a redelivery, a signature they can verify, a retry that actually backs off. A
 * stubbed HTTP client would assert that the code I wrote matches the code I
 * wrote. A socket records what was actually sent.
 *
 * And a real database because "visibly distinct" is a column, "lands in a DLQ"
 * is a status, and both are read by queries that must agree with the dispatcher.
 */
@Tag("integration")
class DeliveryAcceptanceTest {

    private val mapper = ObjectMapper()
    private val ds: DataSource get() = com.vectorbea.worker.testsupport.Infra.postgres

    private lateinit var server: HttpServer
    private lateinit var baseUrl: String
    private lateinit var store: DeliveryStore
    private lateinit var dispatcher: DeliveryDispatcher

    /** Everything the receiver got, in order. */
    private val received = ConcurrentLinkedQueue<Captured>()

    data class Captured(val headers: Map<String, String>, val body: String)

    /** What the receiver answers next. Replaced per test. */
    private var respond: (Int) -> Pair<Int, String> = { _ -> 200 to """{"ok":true}""" }

    @BeforeEach
    fun start() {
        received.clear()
        respond = { _ -> 200 to """{"ok":true}""" }
        server = HttpServer.create(InetSocketAddress(TEST_HOST, 0), 0)
        server.createContext("/") { exchange -> handle(exchange) }
        server.executor = java.util.concurrent.Executors.newFixedThreadPool(2)
        server.start()
        baseUrl = "http://$TEST_HOST:${server.address.port}"

        store = DeliveryStore(ds)
        dispatcher = DeliveryDispatcher(
            dataSource = ds, store = store, secrets = null,
            /* Not started: every test drives `tick()` itself, because a
               background loop would make "did it retry" a race. */
        )
    }

    @AfterEach
    fun stop() = server.stop(0)

    private fun handle(exchange: HttpExchange) {
        val body = exchange.requestBody.readBytes().toString(Charsets.UTF_8)
        received += Captured(
            headers = exchange.requestHeaders.entries.associate {
                it.key.lowercase() to (it.value.firstOrNull() ?: "")
            },
            body = body,
        )
        val (status, payload) = respond(received.size - 1)
        val bytes = payload.toByteArray()
        exchange.responseHeaders.add("Content-Type", "application/json")
        exchange.sendResponseHeaders(status, bytes.size.toLong())
        exchange.responseBody.use { it.write(bytes) }
    }

    // ── The world ────────────────────────────────────────────────────────────

    private class World(
        val workspaceId: UUID = UUID.randomUUID(),
        val environmentId: UUID = UUID.randomUUID(),
        val workflowId: UUID = UUID.randomUUID(),
        val versionId: UUID = UUID.randomUUID(),
        val runId: UUID = UUID.randomUUID(),
    )

    private fun seed(status: String = "succeeded", output: String = """{"answer":42}"""): World {
        val w = World()
        ds.connection.use { c ->
            c.prepareStatement("INSERT INTO workspaces (id,name,slug) VALUES (?,?,?)").use {
                it.setObject(1, w.workspaceId); it.setString(2, "delivery")
                it.setString(3, "delivery-" + w.workspaceId); it.executeUpdate()
            }
            c.prepareStatement(
                "INSERT INTO environments (id,workspace_id,name,slug,type) " +
                    "VALUES (?,?,'t','t','development')"
            ).use { it.setObject(1, w.environmentId); it.setObject(2, w.workspaceId); it.executeUpdate() }
            c.prepareStatement(
                "INSERT INTO workflows (id,workspace_id,environment_id,name,slug,status) " +
                    "VALUES (?,?,?,'t',?,'active')"
            ).use {
                it.setObject(1, w.workflowId); it.setObject(2, w.workspaceId)
                it.setObject(3, w.environmentId); it.setString(4, "wf-" + w.workflowId)
                it.executeUpdate()
            }
            c.prepareStatement(
                "INSERT INTO workflow_versions (id,workflow_id,version,graph_json) VALUES (?,?,1,'{}')"
            ).use { it.setObject(1, w.versionId); it.setObject(2, w.workflowId); it.executeUpdate() }
            c.prepareStatement(
                "INSERT INTO agent_runs (id,workspace_id,environment_id,workflow_id," +
                    " workflow_version_id,status,output_json,completed_at,duration_ms) " +
                    "VALUES (?,?,?,?,?,?,?::jsonb, now(), 1234)"
            ).use {
                it.setObject(1, w.runId); it.setObject(2, w.workspaceId)
                it.setObject(3, w.environmentId); it.setObject(4, w.workflowId)
                it.setObject(5, w.versionId); it.setString(6, status); it.setString(7, output)
                it.executeUpdate()
            }
        }
        return w
    }

    private fun cleanup(w: World) = runCatching {
        ds.connection.use { c ->
            c.prepareStatement("DELETE FROM workspaces WHERE id=?")
                .use { it.setObject(1, w.workspaceId); it.executeUpdate() }
        }
    }

    private fun addTarget(
        w: World,
        path: String = "/hook",
        maxAttempts: Int = 3,
        onStatuses: List<String> = listOf("succeeded", "completed"),
        payloadMode: String = "auto",
        maxPayloadBytes: Int = 262_144,
    ): UUID = ds.connection.use { c ->
        c.prepareStatement(
            """INSERT INTO delivery_targets
                 (workspace_id, environment_id, workflow_id, name, kind, callback_url,
                  on_statuses, max_attempts, timeout_ms, payload_mode, max_payload_bytes)
               VALUES (?,?,?,'Test callback','callback',?,?,?,5000,?,?)
               RETURNING id"""
        ).use { st ->
            st.setObject(1, w.workspaceId); st.setObject(2, w.environmentId)
            st.setObject(3, w.workflowId); st.setString(4, baseUrl + path)
            st.setArray(5, c.createArrayOf("text", onStatuses.toTypedArray()))
            st.setInt(6, maxAttempts)
            st.setString(7, payloadMode); st.setInt(8, maxPayloadBytes)
            st.executeQuery().use { rs -> rs.next(); rs.getObject("id", UUID::class.java) }
        }
    }

    private fun runDeliveryStatus(w: World): String? = ds.connection.use { c ->
        c.prepareStatement("SELECT delivery_status FROM agent_runs WHERE id = ?").use { st ->
            st.setObject(1, w.runId)
            st.executeQuery().use { rs -> if (rs.next()) rs.getString(1) else null }
        }
    }

    /** Drive the retry schedule without waiting for it. */
    private fun makeDue(w: World) = ds.connection.use { c ->
        c.prepareStatement(
            "UPDATE run_deliveries SET next_attempt_at = now() - interval '1 second' " +
                "WHERE run_id = ? AND status IN ('pending','retrying')"
        ).use { st -> st.setObject(1, w.runId); st.executeUpdate() }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // ACCEPTANCE 1: a failed delivery is visibly distinct from a success
    // ─────────────────────────────────────────────────────────────────────────

    @Test
    fun `a run that delivered and a run that did not are distinguishable without a join`() {
        val good = seed()
        val bad = seed()
        try {
            addTarget(good)
            addTarget(bad, maxAttempts = 1)

            /* One at a time, so each run meets the receiver it is meant to.
               Enqueuing both and ticking once would let whichever responder
               happened to be set answer for both. */
            respond = { _ -> 200 to "{}" }
            store.enqueueForRun(good.runId, "succeeded")
            dispatcher.tick()

            respond = { _ -> 500 to "kaboom" }
            store.enqueueForRun(bad.runId, "succeeded")
            dispatcher.tick()

            /*
             * ── THE CRITERION, AS TWO COLUMN READS ──────────────────────────
             * Both runs are `succeeded`: both produced the right answer and both
             * cost real money. What differs is whether the customer got it, and
             * that has to be answerable from the RUN row, because the question is
             * asked by a list.
             */
            assertEquals("succeeded", statusOf(good), "the good run is not succeeded")
            assertEquals("succeeded", statusOf(bad),
                "a delivery failure changed the RUN's status. It must not: the run's " +
                    "output is correct, and retrying the run would re-execute every " +
                    "side effect it already committed.")

            assertEquals("delivered", runDeliveryStatus(good))
            assertEquals("failed", runDeliveryStatus(bad),
                "a run whose result never arrived is indistinguishable from one whose " +
                    "did. That is the failure this whole feature exists to prevent.")
        } finally { cleanup(good); cleanup(bad) }
    }

    @Test
    fun `a run with one delivered and one dead target is partial, not delivered`() {
        val w = seed()
        try {
            addTarget(w, path = "/ok", maxAttempts = 1)
            addTarget(w, path = "/bad", maxAttempts = 1)
            store.enqueueForRun(w.runId, "succeeded")

            /* One receiver answers, the other does not. */
            respond = { index -> if (index == 0) 200 to "{}" else 500 to "no" }
            dispatcher.tick()

            assertEquals("partial", runDeliveryStatus(w),
                "a run that reached one of two destinations was reported as fully " +
                    "delivered. From the customer's side it did not arrive.")
        } finally { cleanup(w) }
    }

    @Test
    fun `a target that does not want this run's status records why, rather than nothing`() {
        val w = seed(status = "failed")
        try {
            addTarget(w, onStatuses = listOf("succeeded"))
            store.enqueueForRun(w.runId, "failed")

            val deliveries = store.listForRun(w.runId, w.workspaceId)
            val skipped = assertNotNull(deliveries.firstOrNull(),
                "nothing was recorded at all, so 'why did my Slack message not arrive' " +
                    "has no answer in the UI")
            assertEquals(RunDelivery.Status.SKIPPED, skipped.status)
            assertTrue(skipped.lastError?.contains("failed") == true,
                "the skip does not say which status was rejected: ${skipped.lastError}")
            assertEquals("none", runDeliveryStatus(w),
                "a skipped target counted towards the roll-up, so a run nobody asked to " +
                    "deliver reads as undelivered")
        } finally { cleanup(w) }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // ACCEPTANCE 2: a 500 retries with backoff, then lands in the DLQ
    // ─────────────────────────────────────────────────────────────────────────

    @Test
    fun `a receiver returning 500 is retried with backoff and then dead-lettered`() {
        val w = seed()
        try {
            addTarget(w, maxAttempts = 3)
            store.enqueueForRun(w.runId, "succeeded")
            respond = { _ -> 500 to "internal error" }

            dispatcher.tick()
            val afterFirst = store.listForRun(w.runId, w.workspaceId).single()
            assertEquals(RunDelivery.Status.RETRYING, afterFirst.status)
            assertTrue(
                afterFirst.nextAttemptAt.isAfter(Instant.now()),
                "the next attempt was scheduled in the past, so the receiver is hit as " +
                    "fast as the dispatcher loops — which is what the backoff exists to " +
                    "prevent",
            )

            /* A retry that is not yet due must NOT be picked up. That is the
               backoff actually applying rather than being recorded. */
            assertEquals(0, dispatcher.tick(),
                "a delivery whose backoff has not elapsed was attempted anyway")

            makeDue(w); dispatcher.tick()
            makeDue(w); dispatcher.tick()

            val dead = store.listForRun(w.runId, w.workspaceId).single()
            assertEquals(RunDelivery.Status.DEAD, dead.status,
                "after ${dead.attempts} attempts against a 500 the delivery is " +
                    "${dead.status.wire}, so it will keep trying forever")
            assertEquals(3, dead.attempts)
            assertEquals(3, received.size, "the receiver saw ${received.size} attempts, not 3")

            /* The DLQ is a filter over the same rows, so the operator's view and
               the run's view cannot disagree. */
            val dlq = store.listDead(w.workspaceId)
            assertEquals(1, dlq.size, "the dead delivery is not in the dead-letter list")
            assertEquals(dead.id, dlq.single().id)

            /* And the whole history is there, which is what makes a DLQ useful:
               three 500s is their outage, one 400 three times would be ours. */
            val attempts = store.attemptsFor(dead.id, w.workspaceId)
            assertEquals(3, attempts.size)
            assertTrue(attempts.all { it["httpStatus"] == 500 })
        } finally { cleanup(w) }
    }

    @Test
    fun `a 400 is not retried, because it will be a 400 next time too`() {
        val w = seed()
        try {
            addTarget(w, maxAttempts = 8)
            store.enqueueForRun(w.runId, "succeeded")
            respond = { _ -> 400 to """{"error":"unknown field"}""" }

            dispatcher.tick()

            val delivery = store.listForRun(w.runId, w.workspaceId).single()
            assertEquals(RunDelivery.Status.DEAD, delivery.status,
                "a permanent rejection was queued for seven more attempts. That spreads " +
                    "eight identical refusals over an hour and delays the moment somebody " +
                    "learns their payload does not match the contract.")
            assertEquals(1, delivery.attempts)
            assertTrue(delivery.lastError?.contains("permanent") == true,
                "the error does not say the answer was permanent: ${delivery.lastError}")
        } finally { cleanup(w) }
    }

    @Test
    fun `a 429 IS retried, because it explicitly means later`() {
        val w = seed()
        try {
            addTarget(w, maxAttempts = 3)
            store.enqueueForRun(w.runId, "succeeded")
            respond = { _ -> 429 to "slow down" }

            dispatcher.tick()
            assertEquals(RunDelivery.Status.RETRYING,
                store.listForRun(w.runId, w.workspaceId).single().status,
                "a receiver asking us to slow down was treated as a permanent refusal")
        } finally { cleanup(w) }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // ACCEPTANCE 3: a redelivery carries the same key
    // ─────────────────────────────────────────────────────────────────────────

    @Test
    fun `every attempt and every redelivery carries the same idempotency key`() {
        val w = seed()
        try {
            addTarget(w, maxAttempts = 2)
            store.enqueueForRun(w.runId, "succeeded")
            respond = { _ -> 500 to "down" }

            dispatcher.tick()
            makeDue(w); dispatcher.tick()

            val dead = store.listForRun(w.runId, w.workspaceId).single()
            assertEquals(RunDelivery.Status.DEAD, dead.status)

            /* The operator fixes the endpoint and presses Redeliver. */
            respond = { _ -> 200 to "{}" }
            assertTrue(store.redeliver(dead.id, w.workspaceId, "operator@example.test"))
            dispatcher.tick()

            assertEquals(3, received.size, "the redelivery did not reach the receiver")

            val keys = received.map { it.headers["vectorbea-idempotency-key"] }.toSet()
            assertEquals(
                1, keys.size,
                "the receiver saw ${keys.size} different idempotency keys across two " +
                    "retries and a manual redelivery: $keys. Each one looks to them like " +
                    "a NEW event, so a receiver that deduplicates correctly would still " +
                    "act three times — and we would have no way to know.",
            )
            assertEquals(dead.idempotencyKey, keys.single(),
                "the key on the wire is not the one our UI shows, so a support " +
                    "conversation cannot match our row to their log line")

            /* And the attempt number DOES change, so a receiver can tell a retry
               from news without inspecting anything else. */
            assertEquals(listOf("1", "2", "1"),
                received.map { it.headers["vectorbea-attempt"] },
                "the attempt counter does not track the attempts")

            assertEquals("delivered", runDeliveryStatus(w),
                "the run still reads as undelivered after a successful redelivery")
        } finally { cleanup(w) }
    }

    @Test
    fun `the delivered payload is the run's output, in a stable envelope`() {
        val w = seed(output = """{"answer":42,"note":"hello"}""")
        try {
            addTarget(w)
            store.enqueueForRun(w.runId, "succeeded")
            dispatcher.tick()

            val body = mapper.readTree(received.single().body)
            assertEquals(w.runId.toString(), body.path("runId").asText())
            assertEquals("succeeded", body.path("status").asText())
            assertEquals(42, body.path("output").path("answer").asInt())
            assertEquals(false, body.path("partial").asBoolean())
            /* Present on EVERY delivery, including the ordinary one. A field that
               only appears in the unusual case is a field nobody handles. */
            assertEquals("full", body.path("payloadMode").asText(),
                "the envelope does not say which shape it took")
        } finally { cleanup(w) }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Large results travel as a link, and say so
    // ─────────────────────────────────────────────────────────────────────────

    @Test
    fun `a result over the target's limit goes as a link, and the envelope says so`() {
        val big = "x".repeat(5_000)
        val w = seed(output = """{"blob":"$big"}""")
        try {
            addTarget(w, maxPayloadBytes = 1_024)
            store.enqueueForRun(w.runId, "succeeded")
            dispatcher.tick()

            val body = mapper.readTree(received.single().body)
            assertEquals("url", body.path("payloadMode").asText(),
                "a result five times the target's limit was sent inline, which is a " +
                    "permanent delivery failure at any receiver with a body cap")
            assertTrue(body.path("outputUrl").asText().contains("/api/delivery-payloads/"),
                "no link was provided, so the receiver has the envelope and no result")
            assertTrue(body.path("output").isMissingNode,
                "the payload was sent BOTH ways, which defeats the size decision")
            assertTrue(body.path("outputUrlExpiresAt").asText().isNotBlank(),
                "the link has no stated expiry, so a receiver cannot tell how long they " +
                    "have to fetch it")

            /* And the link resolves to the real output. */
            val token = body.path("outputUrl").asText().substringAfterLast('/')
            val stored = assertNotNull(store.readLink(token), "the link resolves to nothing")
            assertTrue(mapper.readTree(stored.first).path("blob").asText().length == 5_000)

            val delivery = store.listForRun(w.runId, w.workspaceId).single()
            assertEquals("url", delivery.payloadModeUsed,
                "the row does not record which shape was used, so the UI cannot say")
        } finally { cleanup(w) }
    }

    @Test
    fun `a small result is sent inline, so a receiver is not made to fetch twice`() {
        val w = seed(output = """{"answer":42}""")
        try {
            addTarget(w, maxPayloadBytes = 262_144)
            store.enqueueForRun(w.runId, "succeeded")
            dispatcher.tick()

            val body = mapper.readTree(received.single().body)
            assertEquals("full", body.path("payloadMode").asText())
            assertTrue(body.path("outputUrl").isMissingNode)
        } finally { cleanup(w) }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // The enqueue is exactly-once
    // ─────────────────────────────────────────────────────────────────────────

    @Test
    fun `enqueueing twice for one run produces one delivery`() {
        val w = seed()
        try {
            addTarget(w)
            /* `onTerminalTransition` runs once per run behind the status CAS —
               but "once" is doing a lot of work in a distributed system, and a
               duplicate here is a duplicate callback to a customer's endpoint. */
            store.enqueueForRun(w.runId, "succeeded")
            store.enqueueForRun(w.runId, "succeeded")

            assertEquals(1, store.listForRun(w.runId, w.workspaceId).size,
                "a redelivered queue message would send the customer's callback twice")

            dispatcher.tick()
            assertEquals(1, received.size)
        } finally { cleanup(w) }
    }

    @Test
    fun `a claimed delivery is not taken by a second dispatcher`() {
        val w = seed()
        try {
            addTarget(w)
            store.enqueueForRun(w.runId, "succeeded")

            val first = store.claimDue(10, "dispatcher-a")
            assertEquals(1, first.size)
            val second = store.claimDue(10, "dispatcher-b")
            assertTrue(second.isEmpty(),
                "two dispatchers claimed the same delivery, so the receiver gets two " +
                    "copies inside one attempt — with the same key, but the second is " +
                    "still a request they have to handle")
        } finally { cleanup(w) }
    }

    private fun statusOf(w: World): String? = ds.connection.use { c ->
        c.prepareStatement("SELECT status FROM agent_runs WHERE id = ?").use { st ->
            st.setObject(1, w.runId)
            st.executeQuery().use { rs -> if (rs.next()) rs.getString(1) else null }
        }
    }

    private companion object {
        /**
         * Not 127.0.0.1, for the reason `HttpToolResolverTest` documents: other
         * suites assert that 127.0.0.1 is BLOCKED by the SSRF guard, and
         * exempting it would make them pass while proving nothing.
         */
        const val TEST_HOST = "127.0.0.2"
    }
}
