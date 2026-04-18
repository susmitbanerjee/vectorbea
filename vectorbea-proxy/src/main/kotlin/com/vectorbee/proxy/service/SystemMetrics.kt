package com.vectorbea.proxy.service

import java.nio.file.Files
import java.nio.file.Path
import java.util.concurrent.atomic.AtomicReference

internal object SystemMetrics {
    private data class CpuSnapshot(
        val idle: Long,
        val total: Long,
    )

    private val previousCpuSnapshot = AtomicReference<CpuSnapshot?>()

    fun cpuPercent(): Double {
        val current = readCpuSnapshot() ?: return 0.0
        val previous = previousCpuSnapshot.getAndSet(current) ?: return 0.0

        val idleDelta = current.idle - previous.idle
        val totalDelta = current.total - previous.total
        if (totalDelta <= 0) return 0.0

        val usage = 100.0 * (1.0 - idleDelta.toDouble() / totalDelta.toDouble())
        return usage.coerceIn(0.0, 100.0)
    }

    private fun readCpuSnapshot(): CpuSnapshot? {
        return runCatching {
            val line = Files.readAllLines(Path.of("/proc/stat")).firstOrNull()
                ?.takeIf { it.startsWith("cpu ") }
                ?: return null

            val parts = line.trim().split(Regex("\\s+")).drop(1)
            if (parts.size < 4) return null

            val values = parts.mapNotNull { it.toLongOrNull() }
            if (values.size < 4) return null

            val idle = values[3] + values.getOrElse(4) { 0L }
            val total = values.sum()

            CpuSnapshot(idle = idle, total = total)
        }.getOrNull()
    }
}
