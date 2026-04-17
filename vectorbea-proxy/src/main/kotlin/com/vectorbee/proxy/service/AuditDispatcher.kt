package com.vectorbea.proxy.service

import com.vectorbea.proxy.client.HubClient
import com.vectorbea.proxy.config.AppConfig
import com.vectorbea.proxy.model.AuditEvent
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

    // ── Rolling latency tracking (last 100 events) ────────────────────────
    private val latencyWindow = ArrayDeque<Double>(100)
    private val latencyLock = Any()

    // ── Heartbeat interval (30 s) ─────────────────────────────────────────
    private val heartbeatIntervalMs = 30_000L

    fun tryEnqueue(event: AuditEvent): Boolean {
        // Track proxy latency for heartbeat metrics
        synchronized(latencyLock) {
            if (latencyWindow.size >= 100) latencyWindow.removeFirst()
            latencyWindow.addLast(event.proxyLatencyMs)
        }
        return channel.trySend(event).isSuccess
    }

    fun start() {
        scope.launch { runWorker() }
        scope.launch { runHeartbeat() }
    }

    fun stop() {
        channel.close()
        hubClient.close()
    }

    // ── Audit flush worker ────────────────────────────────────────────────

    private suspend fun runWorker() {
        val buffer = ArrayDeque<AuditEvent>(config.flushBatchSize)

        while (scope.isActive) {
            val first = channel.receiveCatching().getOrNull() ?: break
            buffer.addLast(first)
            val deadline = System.currentTimeMillis() + config.flushIntervalMillis

            while (buffer.size < config.flushBatchSize) {
                val remaining = deadline - System.currentTimeMillis()
                if (remaining <= 0) break

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

    // ── Heartbeat worker ──────────────────────────────────────────────────

    private suspend fun runHeartbeat() {
        // Wait a few seconds before the first heartbeat so the proxy is fully started
        delay(5_000)

        while (scope.isActive) {
            try {
                val avgLatency = computeAvgLatency()
                val memMb = jvmHeapUsedMb()
                hubClient.sendHeartbeat(
                    avgLatencyMs = avgLatency,
                    cpuUsagePercent = 0.0, // JVM CPU % requires platform-specific calls; omit for now
                    memoryUsageMb = memMb,
                    activeReplicas = 1,
                )
                logger.debug("Heartbeat sent — avgLatencyMs={} memMb={}", avgLatency, memMb)
            } catch (ex: Exception) {
                logger.warn("Heartbeat failed: {}", ex.message)
            }

            delay(heartbeatIntervalMs)
        }
    }

    private fun computeAvgLatency(): Double {
        val snapshot = synchronized(latencyLock) { latencyWindow.toList() }
        return if (snapshot.isEmpty()) 0.0 else snapshot.average()
    }

    private fun jvmHeapUsedMb(): Double {
        val rt = Runtime.getRuntime()
        val usedBytes = rt.totalMemory() - rt.freeMemory()
        return usedBytes.toDouble() / (1024 * 1024)
    }
}
