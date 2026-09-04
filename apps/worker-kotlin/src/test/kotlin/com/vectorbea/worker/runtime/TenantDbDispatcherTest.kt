package com.vectorbea.worker.runtime

import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertTrue

class TenantDbDispatcherTest {

    @Test
    fun `runs work and returns its result`() {
        TenantDbDispatcher(maxThreads = 2, queueDepth = 2).use { d ->
            assertEquals(42, d.submit<Int> { 42 }.get(5, TimeUnit.SECONDS))
        }
    }

    /**
     * The containment guarantee: once threads and queue are full, further work is
     * REJECTED. It must not fall back to running on the calling thread, because
     * the caller is a pool thread and that is exactly how a hang would escape the
     * dispatcher and reach the agent/short pools.
     */
    @Test
    fun `rejects instead of running on the calling thread when full`() {
        val block = CountDownLatch(1)
        val started = CountDownLatch(2)
        val dispatcher = TenantDbDispatcher(maxThreads = 2, queueDepth = 1)
        try {
            // Occupy both threads with work that never finishes on its own.
            repeat(2) {
                dispatcher.submit<Unit> {
                    started.countDown()
                    block.await(10, TimeUnit.SECONDS)
                }
            }
            assertTrue(started.await(5, TimeUnit.SECONDS), "workers did not start")

            // Fill the single queue slot.
            dispatcher.submit<Unit> { }

            val callerThread = Thread.currentThread().name
            var ranOnCaller = false
            val ex = assertFailsWith<TenantDbDispatcher.DispatcherFullException> {
                dispatcher.submit<Unit> {
                    if (Thread.currentThread().name == callerThread) ranOnCaller = true
                }
            }
            assertEquals(2, ex.capacity)
            assertTrue(!ranOnCaller, "work must never run on the submitting pool thread")
            assertTrue(
                ex.message!!.contains("Connections"),
                "the message should point the user at something actionable",
            )
        } finally {
            block.countDown()
            dispatcher.close()
        }
    }

    @Test
    fun `close does not hang on threads parked in a blocking read`() {
        val block = CountDownLatch(1)
        val started = CountDownLatch(1)
        val dispatcher = TenantDbDispatcher(maxThreads = 1, queueDepth = 1)
        dispatcher.submit<Unit> {
            started.countDown()
            // Uninterruptible-ish wait, standing in for a socket read that
            // ignores interrupts.
            block.await(30, TimeUnit.SECONDS)
        }
        assertTrue(started.await(5, TimeUnit.SECONDS))

        val startedAt = System.nanoTime()
        dispatcher.close()
        val elapsedMs = (System.nanoTime() - startedAt) / 1_000_000
        block.countDown()

        // close() waits at most ~2s and then proceeds; a wedged tenant database
        // must never be able to block a deploy.
        assertTrue(elapsedMs < 5_000, "close took ${elapsedMs}ms — it should not wait on stuck work")
    }
}
