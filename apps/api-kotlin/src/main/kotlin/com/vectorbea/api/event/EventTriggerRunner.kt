package com.vectorbea.api.event

import com.fasterxml.jackson.databind.ObjectMapper
import com.vectorbea.api.errors.ApiError
import com.vectorbea.api.ingress.RunIngress
import com.vectorbea.api.ingress.TriggerActor
import com.vectorbea.api.ingress.TriggerSource
import com.vectorbea.api.repository.ConnectionRepository
import com.vectorbea.api.secrets.SecretService
import com.vectorbea.api.webhook.PayloadMapper
import org.slf4j.LoggerFactory
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Consumes from every enabled event trigger, and turns messages into runs.
 *
 * ── ONE THREAD PER TRIGGER, NOT A POOL ──────────────────────────────────────
 * `KafkaConsumer` may only be touched from the thread that created it — a hard
 * requirement of the client, not a preference — so a shared pool would produce
 * `ConcurrentModificationException` under load and nowhere else. Giving every
 * trigger its own thread satisfies that, and it also means one slow or broken
 * broker cannot stall the others, which a shared pool would allow.
 *
 * The cost is a thread per trigger. Bounded by the supervisor's cap, and each
 * one spends nearly all its life blocked on a long poll.
 *
 * ── AND THE DELIVERY GUARANTEE, IN ORDER ────────────────────────────────────
 *   1. poll        the broker hands over a message, at least once
 *   2. claim       a row keyed on (trigger, dedupe key). A duplicate loses here
 *   3. run         through RunIngress, like every other ingress
 *   4. ack         only now, so a crash anywhere above redelivers
 *
 * Step 2 is what makes step 1's "at least once" survivable and step 4's
 * redelivery harmless. Remove either and the other becomes a duplicate-run bug.
 */
class EventTriggerRunner(
    private val triggers: EventTriggerRepository,
    private val ingress: RunIngress,
    private val connections: ConnectionRepository?,
    private val secrets: SecretService?,
    private val sweepIntervalMs: Long = 30_000L,
) {
    private val log = LoggerFactory.getLogger(EventTriggerRunner::class.java)
    private val mapper = ObjectMapper()
    private val running = AtomicBoolean(false)

    /** Trigger id → the worker consuming it. */
    private val workers = ConcurrentHashMap<UUID, Worker>()

    private val supervisor = Executors.newSingleThreadScheduledExecutor { r ->
        Thread(r, "event-trigger-supervisor").also { it.isDaemon = true }
    }

    private companion object {
        /**
         * How many triggers one API instance will consume.
         *
         * A thread each, so this is the real bound on the cost. Past it, triggers
         * are left unconsumed and SAID SO in the log — silently running some of a
         * customer's triggers would be the worst possible failure, because the
         * ones that work prove the feature works.
         */
        const val MAX_CONCURRENT_TRIGGERS = 50

        /** After this many consecutive failures, a trigger is disabled with its reason. */
        const val FAILURE_LIMIT = 10
    }

    fun start() {
        if (!running.compareAndSet(false, true)) return
        supervisor.scheduleWithFixedDelay(
            { runCatching { sweep() }.onFailure { log.error("[events] sweep failed: {}", it.message) } },
            5_000L, sweepIntervalMs, TimeUnit.MILLISECONDS)
        log.info("[events] runner started")
    }

    fun stop() {
        running.set(false)
        workers.values.forEach { it.stop() }
        workers.clear()
        supervisor.shutdownNow()
        log.info("[events] runner stopped")
    }

    /**
     * Reconcile the running workers against the enabled triggers.
     *
     * Reads the table every sweep rather than caching: enabling a trigger has to
     * take effect without a restart, and disabling one has to STOP it — which is
     * the direction that matters, because a trigger somebody switched off after
     * an incident must not keep consuming.
     */
    internal fun sweep() {
        if (!running.get()) return
        val wanted = runCatching { triggers.listRunnable() }.getOrElse {
            log.error("[events] could not list triggers: {}", it.message)
            return
        }

        val wantedIds = wanted.map { it.id }.toSet()
        workers.keys.filter { it !in wantedIds }.forEach { id ->
            workers.remove(id)?.stop()
            log.info("[events] stopped consuming trigger {}", id)
        }

        for (trigger in wanted) {
            if (workers.containsKey(trigger.id)) continue
            if (workers.size >= MAX_CONCURRENT_TRIGGERS) {
                log.warn("[events] at the {}-trigger cap; trigger {} ('{}') is NOT being " +
                    "consumed on this instance", MAX_CONCURRENT_TRIGGERS, trigger.id, trigger.name)
                continue
            }
            /*
             * A consumer that cannot even be constructed — bad credentials, a
             * malformed queue URL, a missing region. This will not fix itself, so
             * the trigger is disabled with the reason rather than retried every
             * thirty seconds forever.
             */
            val consumer = try {
                consumerFor(trigger)
            } catch (e: Exception) {
                val reason = "Could not connect: ${e.message?.take(200) ?: e.javaClass.simpleName}"
                log.error("[events] trigger {} disabled — {}", trigger.id, reason)
                triggers.disableWithReason(trigger.id, reason)
                null
            } ?: continue
            val worker = Worker(trigger, consumer)
            workers[trigger.id] = worker
            worker.start()
            log.info("[events] consuming trigger {} from {}", trigger.id, consumer.describe())
        }
    }

    /** Build the broker client for a trigger, from its connection's config. */
    private fun consumerFor(trigger: EventTrigger): EventConsumer {
        val connection = trigger.connectionId?.let { id ->
            connections?.findById(id, trigger.workspaceId)
        }
        /* `configJson` is a raw JSON string on the record — the connections API
           returns it verbatim, and it never contains credentials by contract. */
        @Suppress("UNCHECKED_CAST")
        val config: Map<String, Any?> = connection?.configJson
            ?.let { raw -> runCatching { mapper.readValue(raw, Map::class.java) as Map<String, Any?> }.getOrNull() }
            ?: emptyMap()

        /*
         * The credential, resolved once at construction. Held by the client for
         * the life of the worker and never logged — a broker credential in a log
         * line is the same problem as any other, and this one would be repeated
         * on every reconnect.
         */
        val secret = connection?.secretRef?.let { ref ->
            runCatching { secrets?.resolveSecretForRuntime(ref, trigger.workspaceId) }.getOrNull()
        }

        fun str(key: String): String? = config[key]?.toString()?.takeIf { it.isNotBlank() }

        return when (trigger.broker) {
            "kafka" -> Adapters.Kafka(
                bootstrapServers = str("bootstrapServers")
                    ?: error("The connection has no `bootstrapServers`."),
                topic = trigger.source,
                /* A stable group id, derived from the trigger, so restarting this
                   process resumes from the committed offset instead of replaying
                   the topic — and so two API instances consuming the same trigger
                   share partitions rather than both reading everything. */
                groupId = trigger.consumerGroup ?: "vectorbea-${trigger.id}",
                properties = buildMap<String, String> {
                    @Suppress("UNCHECKED_CAST")
                    (config["properties"] as? Map<String, Any?>)?.forEach { (k, v) ->
                        if (v != null) put(k.toString(), v.toString())
                    }
                    /* SASL credentials come from the secret, never from the config
                       map — the config map is returned by the connections API. */
                    secret?.let { put("sasl.jaas.config", it) }
                },
            )

            "sqs" -> Adapters.Sqs(
                queueUrl = trigger.source,
                region = str("region"),
                accessKeyId = str("accessKeyId"),
                /* The secret access key is the secret; the access key id is not,
                   which is why they come from different places. */
                secretAccessKey = secret,
            )

            "pubsub" -> Adapters.PubSub(
                subscription = trigger.source,
                credentialsJson = secret,
            )

            else -> error("Unknown broker '${trigger.broker}'.")
        }
    }

    /**
     * One trigger's consume loop.
     *
     * Deliberately a plain thread with a `while`: the shape is poll-decide-ack,
     * and every abstraction over that — a reactive stream, a coroutine flow —
     * makes the ack ordering harder to read, which is the one thing here that
     * has to be obviously correct.
     */
    private inner class Worker(
        private val trigger: EventTrigger,
        private val consumer: EventConsumer,
    ) {
        private val alive = AtomicBoolean(true)
        private var consecutiveFailures = 0

        private val thread = Thread({ loop() }, "event-trigger-${trigger.id}").apply {
            isDaemon = true
        }

        fun start() = thread.start()

        fun stop() {
            alive.set(false)
            thread.interrupt()
            runCatching { consumer.close() }
        }

        private fun loop() {
            while (alive.get() && running.get()) {
                try {
                    val batch = consumer.poll(trigger.batchSize)
                    if (batch.isEmpty()) continue

                    val acked = mutableListOf<String>()
                    val nacked = mutableListOf<String>()
                    var accepted = 0

                    for (message in batch) {
                        when (handle(message)) {
                            Verdict.DONE -> { acked += message.handle; accepted++ }
                            Verdict.SKIP -> acked += message.handle
                            Verdict.RETRY -> nacked += message.handle
                        }
                    }

                    /* Ack first, then nack. If the process dies in between, the
                       nacked ones are redelivered — which is what they asked for —
                       and the acked ones are not, which is correct because their
                       runs exist. The other order risks re-delivering work that
                       already ran. */
                    if (acked.isNotEmpty()) consumer.ack(acked)
                    if (nacked.isNotEmpty()) consumer.nack(nacked)

                    triggers.recordActivity(trigger.id, accepted, null)
                    consecutiveFailures = 0
                } catch (_: InterruptedException) {
                    Thread.currentThread().interrupt()
                    return
                } catch (e: Exception) {
                    consecutiveFailures++
                    log.error("[events] trigger {} poll failed ({}/{}): {}",
                        trigger.id, consecutiveFailures, FAILURE_LIMIT, e.message)
                    triggers.recordActivity(trigger.id, 0, e.message)

                    if (consecutiveFailures >= FAILURE_LIMIT) {
                        /*
                         * Ten failures in a row is not a blip. Disabling with the
                         * reason turns "my events stopped arriving" from a mystery
                         * into a sentence on the triggers screen.
                         */
                        triggers.disableWithReason(trigger.id,
                            "Stopped after $FAILURE_LIMIT consecutive failures. " +
                                "Last error: ${e.message?.take(200)}")
                        alive.set(false)
                        return
                    }
                    /* Back off, so a broken broker is not hammered. Capped, so a
                       recovered one is picked up within a minute. */
                    runCatching {
                        Thread.sleep(minOf(1_000L * consecutiveFailures, 30_000L))
                    }.onFailure { Thread.currentThread().interrupt(); return }
                }
            }
        }

        private fun handle(message: EventConsumer.Message): Verdict {
            val body = runCatching { mapper.readTree(message.body.ifBlank { "{}" }) }
                .getOrElse {
                    /* Not JSON. Acked, not retried: it will not become JSON on a
                       second delivery, and leaving it on the queue blocks
                       everything behind it on an ordered topic. */
                    log.warn("[events] trigger {} got a non-JSON message; skipping", trigger.id)
                    return Verdict.SKIP
                }

            // ── Filter ───────────────────────────────────────────────────────
            if (trigger.filterValues.isNotEmpty()) {
                val value = PayloadMapper.stringAt(body, trigger.filterPath)
                    ?: message.attributes[trigger.filterPath]
                if (value == null || value !in trigger.filterValues) return Verdict.SKIP
            }

            // ── Claim ────────────────────────────────────────────────────────
            //
            // The business key when the trigger names one, the broker's id when it
            // does not. The business key is better: a broker id changes when a
            // message takes a dead-letter route, and the same order should not be
            // processed twice because it came back a different way.
            val dedupeKey = PayloadMapper.stringAt(body, trigger.dedupePath)
                ?: message.messageId
                ?: message.handle

            val deliveryId = triggers.claim(
                trigger.id, trigger.workspaceId, dedupeKey, message.body)
            if (deliveryId == null) {
                log.debug("[events] trigger {} duplicate key {}", trigger.id, dedupeKey)
                return Verdict.SKIP
            }

            // ── Map ──────────────────────────────────────────────────────────
            val inputs = when (val mapped = PayloadMapper.map(body, trigger.inputMapping)) {
                is PayloadMapper.Result.Mapped -> mapped.inputs
                is PayloadMapper.Result.Empty -> {
                    triggers.finishDelivery(deliveryId, "rejected_mapping",
                        "None of the mapped paths matched: " +
                            mapped.missingPaths.joinToString(", "), null)
                    /* Acked. The message is fine and the mapping is wrong, so
                       redelivering it changes nothing and blocks the queue. */
                    return Verdict.SKIP
                }
            }

            // ── Run ──────────────────────────────────────────────────────────
            return try {
                val started = ingress.start(RunIngress.Request(
                    workspaceId = trigger.workspaceId,
                    workflowId = trigger.workflowId,
                    environmentId = trigger.environmentId,
                    inputJson = mapper.writeValueAsString(inputs),
                    source = TriggerSource.EVENT,
                    actor = TriggerActor(triggerRef = trigger.id),
                    /* The delivery id, so a redelivery that somehow passes the
                       ledger still cannot produce a second run. */
                    idempotencyKey = "event:$deliveryId",
                    /* The THING, not the message. The ledger above already stops
                       one message running twice; this stops two messages about
                       the same service starting two runs. */
                    dedupKey = PayloadMapper.stringAt(body, trigger.runDedupPath)
                        ?.takeIf { it.isNotBlank() },
                    priority = trigger.runPriority,
                    reason = "Message from ${trigger.name}",
                ))
                triggers.finishDelivery(deliveryId, "accepted", null, started.runId)
                Verdict.DONE
            } catch (e: ApiError) {
                /*
                 * ── RETRYABLE OR NOT, AND WHY IT MATTERS HERE ───────────────
                 * A quota refusal passes: the month rolls over, the plan is
                 * upgraded, the concurrency frees up. Nacking puts the message
                 * back so the event is not lost — which is the whole reason a
                 * customer put it on a durable queue.
                 *
                 * A 4xx that is not 429 will not pass: an archived workflow stays
                 * archived. Nacking that would be an infinite loop against the
                 * broker, so it is acked and recorded.
                 */
                val retryable = e.httpStatus == 429 || e.httpStatus >= 500
                triggers.finishDelivery(deliveryId,
                    if (e.httpStatus == 429) "rejected_quota" else "error", e.message, null)
                if (retryable) {
                    /* The claim has to go too, or the redelivery finds the key
                       taken and is discarded as a duplicate — losing the event
                       exactly when it was meant to be saved. */
                    triggers.releaseClaim(deliveryId)
                    Verdict.RETRY
                } else {
                    Verdict.SKIP
                }
            } catch (e: Exception) {
                log.error("[events] trigger {} run failed: {}", trigger.id, e.message)
                triggers.finishDelivery(deliveryId, "error", e.message, null)
                triggers.releaseClaim(deliveryId)
                Verdict.RETRY
            }
        }
    }

    /** What to tell the broker about one message. */
    private enum class Verdict {
        /** A run exists. Ack. */
        DONE,

        /** Deliberately not run — filtered, duplicate, unmappable. Ack; redelivery would repeat it. */
        SKIP,

        /** Could not run for a reason that will pass. Nack, so the event is not lost. */
        RETRY,
    }
}
