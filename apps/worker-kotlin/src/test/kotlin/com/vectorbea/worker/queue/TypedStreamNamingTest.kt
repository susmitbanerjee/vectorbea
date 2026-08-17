package com.vectorbea.worker.queue

import kotlin.test.Test
import kotlin.test.assertEquals

/**
 * The API and the worker live in separate Gradle modules and cannot share the
 * enum, so the stream naming scheme is the one thing they must agree on by
 * convention rather than by compiler.
 *
 * A silent disagreement here is the worst possible failure: the API writes to
 * `runs.agent`, the worker consumes `runs.AGENT`, nothing errors, and every run
 * simply never starts. Pinning the exact strings on both sides is what turns
 * that into a failing test instead of a silent outage.
 *
 * The API side is pinned by `GraphClassifierTest` in apps/api-kotlin
 * (`ExecutionClass.AGENT.streamKey == "runs.agent"`). These two tests must be
 * changed together or not at all.
 */
class TypedStreamNamingTest {

    @Test
    fun `stream keys match the API's ExecutionClass streamKey exactly`() {
        assertEquals("runs.short", TypedStreamConsumer.streamKeyFor(WorkerJobType.SHORT))
        assertEquals("runs.long", TypedStreamConsumer.streamKeyFor(WorkerJobType.LONG))
        assertEquals("runs.agent", TypedStreamConsumer.streamKeyFor(WorkerJobType.AGENT))
        assertEquals("runs.system", TypedStreamConsumer.streamKeyFor(WorkerJobType.SYSTEM))
    }

    @Test
    fun `every job type has a distinct stream`() {
        val keys = WorkerJobType.entries.map { TypedStreamConsumer.streamKeyFor(it) }
        assertEquals(keys.size, keys.toSet().size, "two classes sharing a stream would merge their pools")
    }

    @Test
    fun `stream keys are lowercase — Redis keys are case sensitive`() {
        for (type in WorkerJobType.entries) {
            val key = TypedStreamConsumer.streamKeyFor(type)
            assertEquals(key.lowercase(), key, "stream key must be lowercase to match the API")
        }
    }
}
