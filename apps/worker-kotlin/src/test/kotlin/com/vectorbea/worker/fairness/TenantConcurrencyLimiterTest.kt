package com.vectorbea.worker.fairness

import com.vectorbea.worker.queue.WorkerJobType
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class TenantConcurrencyLimiterTest {

    private fun limiter() = TenantConcurrencyLimiter(
        maxRunsPerTenant = 2,
        maxAgentRunsPerTenant = 1,
        maxLongRunsPerTenant = 1,
        maxShortRunsPerTenant = 4,
    )

    /** Phase 10 / scenario 3: one tenant cannot exceed its per-type cap. */
    @Test
    fun `per-type cap throttles a single tenant`() {
        val l = limiter()
        val first = l.tryAcquire("tenantA", WorkerJobType.AGENT)
        assertTrue(first.acquired)

        val second = l.tryAcquire("tenantA", WorkerJobType.AGENT)
        assertFalse(second.acquired, "agent cap of 1 should block tenantA's second agent run")

        // Releasing the first frees the slot.
        first.release()
        val third = l.tryAcquire("tenantA", WorkerJobType.AGENT)
        assertTrue(third.acquired)
        third.release()
    }

    /** A noisy tenant hitting its total cap must not affect a different tenant. */
    @Test
    fun `one tenant hitting total cap does not block another tenant`() {
        val l = limiter()
        assertTrue(l.tryAcquire("noisy", WorkerJobType.LONG).acquired)
        assertTrue(l.tryAcquire("noisy", WorkerJobType.SHORT).acquired)
        // noisy is now at total cap (2)
        assertFalse(l.tryAcquire("noisy", WorkerJobType.SHORT).acquired)

        // A different tenant is unaffected.
        assertTrue(l.tryAcquire("quiet", WorkerJobType.SHORT).acquired)
    }

    @Test
    fun `system jobs are never throttled`() {
        val l = limiter()
        repeat(50) {
            assertTrue(l.tryAcquire("anyone", WorkerJobType.SYSTEM).acquired)
        }
    }

    @Test
    fun `failed acquire holds no permits`() {
        val l = limiter()
        // Exhaust agent cap, then a failed agent acquire must not consume the total cap.
        assertTrue(l.tryAcquire("t", WorkerJobType.AGENT).acquired)
        assertFalse(l.tryAcquire("t", WorkerJobType.AGENT).acquired)
        // total cap is 2 and only 1 is held, so a LONG run should still be admitted.
        assertTrue(l.tryAcquire("t", WorkerJobType.LONG).acquired)
    }
}
