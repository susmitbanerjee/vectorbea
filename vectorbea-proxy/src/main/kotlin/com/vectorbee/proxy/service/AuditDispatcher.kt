package com.vectorbea.proxy.service

import com.vectorbea.proxy.client.HubClient
import com.vectorbea.proxy.config.AppConfig
import com.vectorbea.proxy.model.AuditEvent
import java.lang.management.ManagementFactory
import java.util.ArrayDeque
import java.util.concurrent.atomic.AtomicLong
import java.util.concurrent.atomic.DoubleAdder

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
    // Audit fan-out runs on Dispatchers.IO so batch POSTs don't steal CPU
    // from the gRPC request threads on Dispatchers.Default.
    private val scope: CoroutineScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
) {
    private val logger = LoggerFactory.getLogger(AuditDispatcher::class.java)

    // Unbounded channel with CONFLATED-like semantics: enqueue is a single
    // CAS on Channel's tail pointer (~20 ns). Fire-and-forget from the gRPC
    // request thread — the critical path *never* blocks on hub I/O.
    private val channel = Channel<AuditEvent>(Channel.UNLIMITED)

    // ── Lock-free rolling-latency accumulator ──────────────────────────────
    // Previous impl. took a `synchronized(latencyLock)` on every enqueue —
    // that's 30–60 ns of uncontended overhead and pathological contention
    // under load. DoubleAdder + AtomicLong are cache-line striped and free
    // of mutual exclusion on the write path. The heartbeat reader trades
    // a touch of precision (non-atomic sum+count read) for zero impact on
    // the hot path, which is the correct trade for SRE metrics.
    private val latencySumMs = DoubleAdder()
    private val latencyCount = AtomicLong(0)

    // ── Heartbeat interval (30 s) ─────────────────────────────────────────
    private val heartbeatIntervalMs = 30_000L

    fun tryEnqueue(event: AuditEvent): Boolean {
        // Hot path, called from every gRPC / REST request. Lock-free.
        latencySumMs.add(event.proxyLatencyMs)
        latencyCount.incrementAndGet()
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
                    cpuUsagePercent = jvmCpuPercent(),
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
        // Drain the accumulator: sumThenReset + getAndSet so each heartbeat
        // reports the window since the last heartbeat, not a since-boot avg.
        val count = latencyCount.getAndSet(0)
        val sum = latencySumMs.sumThenReset()
        return if (count == 0L) 0.0 else sum / count
    }

    private fun jvmHeapUsedMb(): Double {
        val rt = Runtime.getRuntime()
        val usedBytes = rt.totalMemory() - rt.freeMemory()
        return usedBytes.toDouble() / (1024 * 1024)
    }

    private fun jvmCpuPercent(): Double {
        return try {
            val bean = ManagementFactory.getOperatingSystemMXBean()
            if (bean is com.sun.management.OperatingSystemMXBean) {
                val processLoad = bean.processCpuLoad
                if (processLoad > 0.0) {
                    processLoad * 100.0
                } else {
                    val systemLoad = bean.systemCpuLoad
                    if (systemLoad > 0.0) systemLoad * 100.0 else 0.0
                }
            } else {
                val systemLoadAverage = bean.systemLoadAverage
                if (systemLoadAverage > 0.0) {
                    (systemLoadAverage / Runtime.getRuntime().availableProcessors()) * 100.0
                } else {
                    0.0
                }
            }
        } catch (_: Exception) {
            0.0
        }
    }
}
