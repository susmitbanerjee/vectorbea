package com.vectorbee.proxy.service

import com.vectorbee.proxy.client.HubClient
import com.vectorbee.proxy.config.AppConfig
import com.vectorbee.proxy.model.AuditEvent
import java.util.ArrayDeque
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeoutOrNull
import org.slf4j.LoggerFactory

class AuditDispatcher(
    private val config: AppConfig,
    private val hubClient: HubClient,
    private val scope: CoroutineScope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
) {
    private val logger = LoggerFactory.getLogger(AuditDispatcher::class.java)
    private val channel = Channel<AuditEvent>(Channel.UNLIMITED)

    fun tryEnqueue(event: AuditEvent): Boolean = channel.trySend(event).isSuccess

    fun start() {
        scope.launch {
            runWorker()
        }
    }

    fun stop() {
        channel.close()
        hubClient.close()
    }

    private suspend fun runWorker() {
        val buffer = ArrayDeque<AuditEvent>(config.flushBatchSize)

        while (scope.isActive) {
            val first = channel.receiveCatching().getOrNull() ?: break
            buffer.addLast(first)
            val deadline = System.currentTimeMillis() + config.flushIntervalMillis

            while (buffer.size < config.flushBatchSize) {
                val remaining = deadline - System.currentTimeMillis()
                if (remaining <= 0) {
                    break
                }

                val next = withTimeoutOrNull(remaining) {
                    channel.receiveCatching().getOrNull()
                } ?: break

                buffer.addLast(next)
            }

            flushWithRetry(buffer)
        }

        if (buffer.isNotEmpty()) {
            flushWithRetry(buffer)
        }
    }

    private suspend fun flushWithRetry(buffer: ArrayDeque<AuditEvent>) {
        while (buffer.isNotEmpty()) {
            val batch = buildList(capacity = config.flushBatchSize) {
                repeat(minOf(buffer.size, config.flushBatchSize)) {
                    add(buffer.removeFirst())
                }
            }

            try {
                hubClient.flushAuditBatch(batch)
            } catch (ex: Exception) {
                logger.warn("Audit flush failed for {} items, retrying", batch.size, ex)
                for (event in batch.asReversed()) {
                    buffer.addFirst(event)
                }
                delay(1_000)
            }
        }
    }
}
