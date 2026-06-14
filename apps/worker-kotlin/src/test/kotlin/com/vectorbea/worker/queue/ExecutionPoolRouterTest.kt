package com.vectorbea.worker.queue

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

class ExecutionPoolRouterTest {

    /**
     * Phase 10 / scenario 1: long+agent saturation must NOT consume short/system
     * capacity — the core head-of-line-blocking guarantee.
     */
    @Test
    fun `long and agent saturation does not block short or system pools`() {
        val router = ExecutionPoolRouter(
            shortConcurrency = 2, longConcurrency = 1, agentConcurrency = 1, systemConcurrency = 1,
        )
        val release = CountDownLatch(1)
        val started = CountDownLatch(2)
        val blocker = Runnable { started.countDown(); release.await() }

        try {
            // Saturate LONG and AGENT with blocking tasks.
            assertTrue(router.submit(WorkerJobType.LONG, blocker))
            assertTrue(router.submit(WorkerJobType.AGENT, blocker))
            assertTrue(started.await(2, TimeUnit.SECONDS))

            // Those pools are now full and reject further work…
            assertFalse(router.hasCapacity(WorkerJobType.LONG))
            assertFalse(router.hasCapacity(WorkerJobType.AGENT))
            assertFalse(router.submit(WorkerJobType.LONG, Runnable {}))

            // …but SHORT and SYSTEM are untouched and still accept jobs.
            assertTrue(router.hasCapacity(WorkerJobType.SHORT))
            assertTrue(router.hasCapacity(WorkerJobType.SYSTEM))
            val shortRan = CountDownLatch(1)
            assertTrue(router.submit(WorkerJobType.SHORT, Runnable { shortRan.countDown() }))
            assertTrue(shortRan.await(2, TimeUnit.SECONDS), "short job should run while long/agent are saturated")
        } finally {
            release.countDown()
            router.shutdown(2_000)
        }
    }

    @Test
    fun `submit reserves and frees a slot`() {
        val router = ExecutionPoolRouter(2, 1, 1, 1)
        val release = CountDownLatch(1)
        val started = CountDownLatch(1)
        try {
            assertEquals(2, router.availableCapacity(WorkerJobType.SHORT))
            router.submit(WorkerJobType.SHORT, Runnable { started.countDown(); release.await() })
            assertTrue(started.await(2, TimeUnit.SECONDS))
            assertEquals(1, router.availableCapacity(WorkerJobType.SHORT))
        } finally {
            release.countDown()
            router.shutdown(2_000)
        }
    }
}
