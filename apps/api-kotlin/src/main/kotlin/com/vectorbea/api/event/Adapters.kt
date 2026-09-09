package com.vectorbea.api.event

import org.slf4j.LoggerFactory
import java.time.Duration

/**
 * The three brokers, each behind [EventConsumer].
 *
 * ── EVERY ADAPTER TURNS AUTO-ACK OFF ────────────────────────────────────────
 * All three default to some form of "you have it, we are done" — Kafka's
 * `enable.auto.commit`, SQS's short visibility timeout, Pub/Sub's streaming
 * pull with automatic lease extension. Every one of those acknowledges a
 * message before the run exists, so a crash in between loses the event with no
 * trace that it ever arrived.
 *
 * Turning it off is what makes the guarantee in [EventConsumer] true, and it is
 * the first thing to check if events start disappearing.
 */
object Adapters {

    private val log = LoggerFactory.getLogger(Adapters::class.java)

    /**
     * Kafka.
     *
     * ── THE CONSUMER IS NOT THREAD-SAFE, AND THAT IS LOAD-BEARING ───────────
     * `KafkaConsumer` may only be used from the thread that created it. The
     * runner gives each trigger its own thread for exactly this reason; sharing
     * one across triggers would be a `ConcurrentModificationException` under
     * load, which is to say in production and not in testing.
     */
    class Kafka(
        bootstrapServers: String,
        topic: String,
        groupId: String,
        properties: Map<String, String>,
    ) : EventConsumer {
        private val topicName = topic
        private val consumer = org.apache.kafka.clients.consumer.KafkaConsumer<String, String>(
            java.util.Properties().apply {
                put("bootstrap.servers", bootstrapServers)
                put("group.id", groupId)
                put("key.deserializer", "org.apache.kafka.common.serialization.StringDeserializer")
                put("value.deserializer", "org.apache.kafka.common.serialization.StringDeserializer")
                /* The point of the whole exercise. With auto-commit on, Kafka
                   advances the offset on a timer regardless of whether we did
                   anything with the message. */
                put("enable.auto.commit", "false")
                /* `latest` would silently skip everything produced while a trigger
                   was disabled, which is the opposite of what somebody enabling a
                   trigger expects. `earliest` replays from the group's committed
                   offset, and a brand-new group starts at the beginning — bounded
                   by `max.poll.records` and by the trigger's own in-flight cap. */
                put("auto.offset.reset", "earliest")
                /* Customer-supplied last, so a deployment can set TLS, SASL and
                   whatever else its cluster needs without this class knowing. */
                properties.forEach { (k, v) -> put(k, v) }
            }
        ).also { it.subscribe(listOf(topic)) }

        /**
         * Offsets seen but not yet committed.
         *
         * Kafka acks by advancing an offset per partition, not per message, so a
         * handle has to be resolved back to (partition, offset) — and only the
         * HIGHEST contiguous offset may be committed. Committing a higher one
         * because a later message finished first would skip the ones in between.
         */
        private val pending = mutableMapOf<String, Long>()

        override fun poll(max: Int): List<EventConsumer.Message> {
            val records = consumer.poll(Duration.ofMillis(500))
            return records.take(max).map { r ->
                EventConsumer.Message(
                    handle = "${r.topic()}|${r.partition()}|${r.offset()}",
                    body = r.value() ?: "",
                    messageId = r.key(),
                    attributes = r.headers().associate {
                        it.key() to String(it.value() ?: ByteArray(0))
                    },
                )
            }
        }

        override fun ack(handles: List<String>) {
            if (handles.isEmpty()) return
            val offsets = mutableMapOf<
                org.apache.kafka.common.TopicPartition,
                org.apache.kafka.clients.consumer.OffsetAndMetadata>()
            for (handle in handles) {
                val parts = handle.split("|")
                if (parts.size != 3) continue
                val tp = org.apache.kafka.common.TopicPartition(parts[0], parts[1].toInt())
                val offset = parts[2].toLong()
                /* +1: Kafka's committed offset is the NEXT message to read, not
                   the last one handled. Committing the message's own offset
                   redelivers it forever. */
                val next = offset + 1
                val existing = offsets[tp]?.offset() ?: -1
                if (next > existing) {
                    offsets[tp] = org.apache.kafka.clients.consumer.OffsetAndMetadata(next)
                }
            }
            if (offsets.isNotEmpty()) consumer.commitSync(offsets)
            pending.clear()
        }

        override fun nack(handles: List<String>) {
            /*
             * Kafka has no per-message nack. Not committing IS the nack: the next
             * poll after a rebalance or a restart re-reads from the last committed
             * offset. Seeking backwards here instead would re-read messages the
             * runner has already accepted, since offsets are per partition and a
             * batch can contain both.
             */
        }

        override fun describe(): String = "kafka topic '$topicName'"

        override fun close() {
            runCatching { consumer.close(Duration.ofSeconds(5)) }
        }
    }

    /**
     * SQS.
     *
     * ── THE VISIBILITY TIMEOUT IS THE ACK DEADLINE ──────────────────────────
     * A message is invisible to other consumers for the queue's visibility
     * timeout and then comes back. If a run takes longer than that to create,
     * the message is redelivered while the first attempt is still working — and
     * the dedup ledger is what stops that becoming two runs. Set generously on
     * the queue; the ledger is the backstop, not the plan.
     */
    class Sqs(
        private val queueUrl: String,
        region: String?,
        accessKeyId: String?,
        secretAccessKey: String?,
    ) : EventConsumer {

        private val client: software.amazon.awssdk.services.sqs.SqsClient =
            software.amazon.awssdk.services.sqs.SqsClient.builder()
                .apply {
                    region?.let { region(software.amazon.awssdk.regions.Region.of(it)) }
                    /* Explicit credentials when the connection carries them;
                       otherwise the default chain, so a deployment on EC2 or EKS
                       uses its instance role and stores no secret at all — which
                       is the configuration worth encouraging. */
                    if (!accessKeyId.isNullOrBlank() && !secretAccessKey.isNullOrBlank()) {
                        credentialsProvider(
                            software.amazon.awssdk.auth.credentials.StaticCredentialsProvider.create(
                                software.amazon.awssdk.auth.credentials.AwsBasicCredentials
                                    .create(accessKeyId, secretAccessKey)))
                    }
                }
                .build()

        override fun poll(max: Int): List<EventConsumer.Message> {
            val response = client.receiveMessage { b ->
                b.queueUrl(queueUrl)
                    .maxNumberOfMessages(max.coerceIn(1, 10))
                    /* Long polling. Short polling returns empty immediately and
                       turns an idle queue into a billed request every loop. */
                    .waitTimeSeconds(5)
                    .messageAttributeNames("All")
            }
            return response.messages().map { m ->
                EventConsumer.Message(
                    handle = m.receiptHandle(),
                    body = m.body() ?: "",
                    messageId = m.messageId(),
                    attributes = m.messageAttributes()
                        .mapValues { (_, v) -> v.stringValue() ?: "" },
                )
            }
        }

        override fun ack(handles: List<String>) {
            /* Deleting is acking, in SQS. Batched at ten, which is the API's own
               ceiling — a larger batch is rejected whole. */
            handles.chunked(10).forEach { chunk ->
                runCatching {
                    client.deleteMessageBatch { b ->
                        b.queueUrl(queueUrl).entries(chunk.mapIndexed { i, handle ->
                            software.amazon.awssdk.services.sqs.model
                                .DeleteMessageBatchRequestEntry.builder()
                                .id(i.toString()).receiptHandle(handle).build()
                        })
                    }
                }.onFailure { log.warn("[sqs] delete batch failed: {}", it.message) }
            }
        }

        override fun nack(handles: List<String>) {
            /* Visibility timeout to zero: the message becomes available again
               immediately rather than after the queue's timeout. Used only for a
               retryable refusal, so "immediately" is what is wanted. */
            handles.chunked(10).forEach { chunk ->
                runCatching {
                    client.changeMessageVisibilityBatch { b ->
                        b.queueUrl(queueUrl).entries(chunk.mapIndexed { i, handle ->
                            software.amazon.awssdk.services.sqs.model
                                .ChangeMessageVisibilityBatchRequestEntry.builder()
                                .id(i.toString()).receiptHandle(handle)
                                .visibilityTimeout(0).build()
                        })
                    }
                }.onFailure { log.warn("[sqs] visibility reset failed: {}", it.message) }
            }
        }

        override fun describe(): String = "sqs queue '${queueUrl.substringAfterLast('/')}'"

        override fun close() { runCatching { client.close() } }
    }

    /**
     * Pub/Sub, over the synchronous pull API.
     *
     * ── PULL, NOT STREAMING PULL ────────────────────────────────────────────
     * `Subscriber` is the library's headline API and it is the wrong shape here:
     * it owns its own threads, extends leases automatically, and delivers through
     * a callback — which means it acknowledges on a schedule this code does not
     * control, and the ack-after-the-run rule cannot be kept. `SubscriberStub`'s
     * synchronous pull gives the same delivery guarantee with the ack in our
     * hands, which is the only difference that matters.
     */
    class PubSub(
        private val subscription: String,
        credentialsJson: String?,
    ) : EventConsumer {

        private val stub: com.google.cloud.pubsub.v1.stub.SubscriberStub =
            com.google.cloud.pubsub.v1.stub.GrpcSubscriberStub.create(
                com.google.cloud.pubsub.v1.stub.SubscriberStubSettings.newBuilder()
                    .apply {
                        if (!credentialsJson.isNullOrBlank()) {
                            setCredentialsProvider(
                                com.google.api.gax.core.FixedCredentialsProvider.create(
                                    com.google.auth.oauth2.GoogleCredentials.fromStream(
                                        credentialsJson.byteInputStream())))
                        }
                        setTransportChannelProvider(
                            com.google.cloud.pubsub.v1.stub.SubscriberStubSettings
                                .defaultGrpcTransportProviderBuilder()
                                .setMaxInboundMessageSize(20 * 1024 * 1024)
                                .build())
                    }
                    .build()
            )

        override fun poll(max: Int): List<EventConsumer.Message> {
            val request = com.google.pubsub.v1.PullRequest.newBuilder()
                .setSubscription(subscription)
                .setMaxMessages(max.coerceIn(1, 100))
                .build()
            val response = stub.pullCallable().call(request)
            return response.receivedMessagesList.map { rm ->
                EventConsumer.Message(
                    handle = rm.ackId,
                    body = rm.message.data.toStringUtf8(),
                    messageId = rm.message.messageId,
                    attributes = rm.message.attributesMap,
                )
            }
        }

        override fun ack(handles: List<String>) {
            if (handles.isEmpty()) return
            runCatching {
                stub.acknowledgeCallable().call(
                    com.google.pubsub.v1.AcknowledgeRequest.newBuilder()
                        .setSubscription(subscription)
                        .addAllAckIds(handles)
                        .build())
            }.onFailure { log.warn("[pubsub] ack failed: {}", it.message) }
        }

        override fun nack(handles: List<String>) {
            if (handles.isEmpty()) return
            /* An ack deadline of zero is Pub/Sub's nack: redeliver now. */
            runCatching {
                stub.modifyAckDeadlineCallable().call(
                    com.google.pubsub.v1.ModifyAckDeadlineRequest.newBuilder()
                        .setSubscription(subscription)
                        .addAllAckIds(handles)
                        .setAckDeadlineSeconds(0)
                        .build())
            }.onFailure { log.warn("[pubsub] nack failed: {}", it.message) }
        }

        override fun describe(): String =
            "pubsub subscription '${subscription.substringAfterLast('/')}'"

        override fun close() {
            runCatching { stub.close() }
        }
    }
}
