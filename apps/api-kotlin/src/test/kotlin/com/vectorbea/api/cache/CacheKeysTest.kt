package com.vectorbea.api.cache

import org.junit.jupiter.api.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class CacheKeysTest {

    @Test
    fun `workflowList key has correct format`() {
        val key = CacheKeys.workflowList("ws-1", "env-1")
        assertEquals("workflow:list:ws-1:env-1", key)
    }

    @Test
    fun `workflow key has correct format`() {
        assertEquals("workflow:wf-abc", CacheKeys.workflow("wf-abc"))
    }

    @Test
    fun `workflowVersion key has correct format`() {
        assertEquals("workflow-version:ver-123", CacheKeys.workflowVersion("ver-123"))
    }

    @Test
    fun `agentList key has correct format`() {
        assertEquals("agents:list:ws-1:env-1", CacheKeys.agentList("ws-1", "env-1"))
    }

    @Test
    fun `toolList key has correct format`() {
        assertEquals("tools:list:ws-1:env-1", CacheKeys.toolList("ws-1", "env-1"))
    }

    @Test
    fun `connectionList key has correct format`() {
        assertEquals("connections:list:ws-1:env-1", CacheKeys.connectionList("ws-1", "env-1"))
    }

    @Test
    fun `connectionTest key has correct format`() {
        assertEquals("connection-test:conn-xyz", CacheKeys.connectionTest("conn-xyz"))
    }

    @Test
    fun `runSummary key has correct format`() {
        assertEquals("run-summary:run-456", CacheKeys.runSummary("run-456"))
    }

    @Test
    fun `all keys are distinct`() {
        val ws = "ws-1"; val env = "env-1"; val id = "id-1"
        val keys = listOf(
            CacheKeys.workflowList(ws, env),
            CacheKeys.workflow(id),
            CacheKeys.workflowVersion(id),
            CacheKeys.agentList(ws, env),
            CacheKeys.toolList(ws, env),
            CacheKeys.connectionList(ws, env),
            CacheKeys.connectionTest(id),
            CacheKeys.runSummary(id),
        )
        assertEquals(keys.size, keys.toSet().size, "All cache keys must be unique")
    }

    @Test
    fun `no key contains secret-like words`() {
        val keys = listOf(
            CacheKeys.connectionList("ws", "env"),
            CacheKeys.connectionTest("conn"),
        )
        val forbidden = listOf("secret", "password", "token", "key", "credential")
        keys.forEach { key ->
            forbidden.forEach { word ->
                assertTrue(
                    !key.contains(word, ignoreCase = true),
                    "Cache key '$key' must not contain '$word'",
                )
            }
        }
    }
}
