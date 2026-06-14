package com.vectorbea.worker.queue

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import kotlin.random.Random

class PollBackoffTest {

    // Deterministic: zero jitter so delays equal currentMs.
    private fun backoff(base: Long = 200, max: Long = 2000, mult: Double = 1.5) =
        PollBackoff(base, max, mult, jitterMs = 0, rng = Random(0))

    @Test
    fun `backoff increases geometrically on consecutive idle iterations`() {
        val b = backoff()
        assertEquals(200, b.currentMs)
        b.next(); assertEquals(300, b.currentMs)   // 200 * 1.5
        b.next(); assertEquals(450, b.currentMs)   // 300 * 1.5
        b.next(); assertEquals(675, b.currentMs)
    }

    @Test
    fun `backoff is capped at max`() {
        val b = backoff(base = 200, max = 1000)
        repeat(20) { b.next() }
        assertTrue(b.currentMs <= 1000, "backoff must not exceed max")
        assertEquals(1000, b.currentMs)
    }

    @Test
    fun `reset returns backoff to the floor after progress`() {
        val b = backoff()
        repeat(5) { b.next() }
        assertTrue(b.currentMs > 200)
        b.reset()
        assertEquals(200, b.currentMs, "reset (successful submit) returns to the base floor")
    }

    @Test
    fun `jitter stays within bounds`() {
        val b = PollBackoff(200, 2000, 1.5, jitterMs = 100, rng = Random(1))
        val delay = b.next()
        assertTrue(delay in 200..300, "delay should be base + [0,jitter]; was $delay")
    }
}
