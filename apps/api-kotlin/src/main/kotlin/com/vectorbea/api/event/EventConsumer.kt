package com.vectorbea.api.event

/**
 * A broker, reduced to what an event trigger needs.
 *
 * ── THREE BROKERS, ONE CONTRACT, AND WHY IT IS THIS SMALL ───────────────────
 * Kafka, SQS and Pub/Sub disagree about almost everything — offsets versus
 * receipt handles versus ack ids, partitions versus visibility timeouts versus
 * leases, at-least-once by default versus at-least-once with effort. What they
 * agree on is the only thing above them: a message arrives, we decide what to
 * do with it, and we say when we are done.
 *
 * So the interface is `poll` and `ack`, and every broker-specific concern stays
 * inside its adapter. The alternative — an interface shaped like the union of
 * the three — would push a Kafka offset into the SQS path and a visibility
 * timeout into the Kafka path, and the runner would grow a `when (broker)`
 * inside logic that has nothing to do with brokers.
 *
 * ── ACK IS AFTER THE RUN EXISTS, NOT AFTER THE POLL ─────────────────────────
 * That is the whole of the delivery guarantee. A crash between poll and ack
 * redelivers, which is correct: the run may not have been created. A crash
 * between the run and the ack ALSO redelivers, which would be a duplicate run
 * — and is not, because the dedup key was written in the same statement that
 * claimed the message. At-least-once delivery plus a dedup ledger is
 * effectively-once run creation, and neither half works alone.
 */
interface EventConsumer : AutoCloseable {

    /** One message, in the terms above it. */
    data class Message(
        /**
         * The broker's own identifier, used for [ack].
         *
         * Kafka: `topic-partition-offset`. SQS: the receipt handle. Pub/Sub: the
         * ack id. Opaque to everything above this interface, and deliberately
         * NOT the dedup key — a redelivery through a dead-letter path gets a new
         * one of these, which is exactly when a business key is needed instead.
         */
        val handle: String,

        /** The payload, as it arrived. Parsed above; never here. */
        val body: String,

        /**
         * The broker's message id, when it has one that survives a redelivery.
         *
         * The dedup fallback when the trigger names no path into the body. Weaker
         * than a business key — SQS assigns a new one after a DLQ round trip —
         * which is why the trigger's `dedupe_path` is preferred and why the UI
         * should push people to set it.
         */
        val messageId: String?,

        /** Broker-level attributes, for a filter that reads one instead of the body. */
        val attributes: Map<String, String> = emptyMap(),
    )

    /**
     * Take up to [max] messages, waiting no longer than the adapter's own poll
     * timeout.
     *
     * Returns an empty list on an idle topic rather than blocking, so the runner
     * stays responsive to shutdown and to a trigger being disabled mid-flight.
     */
    fun poll(max: Int): List<Message>

    /**
     * Tell the broker these are done.
     *
     * Batched because all three brokers charge — in requests, in latency, or in
     * rebalance risk — for acking one at a time.
     */
    fun ack(handles: List<String>)

    /**
     * Give a message back for redelivery.
     *
     * Called when the run could NOT be created for a reason that will pass —
     * a quota that resets, a queue that is momentarily unavailable. Not called
     * for a permanent refusal: returning a message that will be refused
     * identically forever is a hot loop against the broker, and the trigger is
     * disabled instead.
     */
    fun nack(handles: List<String>)

    /** A short description for a log line and the triggers screen. */
    fun describe(): String
}
