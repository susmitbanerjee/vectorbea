package com.vectorbea.worker.queue

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class AdaptiveReadBatchTest {

    @Test
    fun `starts at the configured maximum`() {
        assertEquals(8, AdaptiveReadBatch(8).next(available = 100))
    }

    @Test
    fun `never requests more than the available placements`() {
        val b = AdaptiveReadBatch(8)
        assertEquals(3, b.next(available = 3))
    }

    @Test
    fun `requests nothing when there is nowhere to put it`() {
        // The old code coerced this to 1, pulling a message straight into the PEL.
        assertEquals(0, AdaptiveReadBatch(8).next(available = 0))
        assertEquals(0, AdaptiveReadBatch(8).next(available = -1))
    }

    @Test
    fun `halves on park and floors at one`() {
        val b = AdaptiveReadBatch(8)
        b.onParked(); assertEquals(4, b.currentBatch)
        b.onParked(); assertEquals(2, b.currentBatch)
        b.onParked(); assertEquals(1, b.currentBatch)
        b.onParked(); assertEquals(1, b.currentBatch)
    }

    @Test
    fun `grows by one when everything is placed and stops at the maximum`() {
        val b = AdaptiveReadBatch(4)
        repeat(5) { b.onParked() }
        assertEquals(1, b.currentBatch)
        b.onAllPlaced(); assertEquals(2, b.currentBatch)
        b.onAllPlaced(); assertEquals(3, b.currentBatch)
        b.onAllPlaced(); assertEquals(4, b.currentBatch)
        b.onAllPlaced(); assertEquals(4, b.currentBatch)
    }

    @Test
    fun `a sustained skewed mix converges to one rather than hoarding`() {
        // Every poll parks something — the worker should stop pulling work it
        // cannot start, quickly.
        val b = AdaptiveReadBatch(16)
        repeat(4) { b.onParked() }
        assertEquals(1, b.currentBatch)
    }

    @Test
    fun `recovers to full throughput once placements succeed again`() {
        val b = AdaptiveReadBatch(8)
        repeat(4) { b.onParked() }
        repeat(20) { b.onAllPlaced() }
        assertEquals(8, b.currentBatch)
        assertTrue(b.next(available = 100) == 8)
    }
}
