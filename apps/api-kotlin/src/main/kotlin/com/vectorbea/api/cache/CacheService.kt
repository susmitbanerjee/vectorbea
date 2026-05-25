package com.vectorbea.api.cache

/**
 * Cache abstraction — key/value store with TTL-required writes.
 *
 * Security rules (enforced at call sites):
 *  - NEVER cache secrets, connection strings, or API keys.
 *  - NEVER cache raw [com.vectorbea.api.repository.Connection.secretRef].
 *  - TTL is mandatory on every write — no infinite entries.
 *
 * Canonical cache keys (namespace with the configured prefix):
 *   workflow:list:{workspaceId}:{environmentId}
 *   workflow:{workflowId}
 *   workflow-version:{workflowVersionId}
 *   agents:list:{workspaceId}:{environmentId}
 *   tools:list:{workspaceId}:{environmentId}
 *   connections:list:{workspaceId}:{environmentId}   (secretRef stripped before caching)
 *   connection-test:{connectionId}
 *   run-summary:{runId}
 */
interface CacheService {

    /**
     * Retrieve a cached value by [key].
     * Returns null on cache miss, deserialization failure, or any Redis error.
     */
    fun <T> get(key: String, clazz: Class<T>): T?

    /**
     * Store [value] under [key] with [ttlSeconds] expiry.
     * Failures are logged but not propagated — cache writes are best-effort.
     *
     * @throws IllegalArgumentException if [ttlSeconds] < 1.
     */
    fun set(key: String, value: Any, ttlSeconds: Long)

    /**
     * Delete the entry at [key].
     * No-op if the key does not exist.
     */
    fun del(key: String)

    /**
     * Return the cached value for [key], or call [loader], cache the result,
     * and return it.  Uses a read-then-write pattern (no distributed lock here;
     * occasional double-writes on cold start are acceptable).
     */
    fun <T : Any> getOrSet(key: String, ttlSeconds: Long, clazz: Class<T>, loader: () -> T): T
}

/** Inline helper so callers can write `getOrSet<MyType>(...)` without `.class`. */
inline fun <reified T : Any> CacheService.getOrSet(
    key: String,
    ttlSeconds: Long,
    noinline loader: () -> T,
): T = getOrSet(key, ttlSeconds, T::class.java, loader)

/** Inline helper so callers can write `get<MyType>(...)` without `.class`. */
inline fun <reified T> CacheService.get(key: String): T? = get(key, T::class.java)

/** Well-known key builders — use these to avoid typos in key strings. */
object CacheKeys {
    fun workflowList(workspaceId: String, environmentId: String) =
        "workflow:list:$workspaceId:$environmentId"

    fun workflow(workflowId: String) = "workflow:$workflowId"

    fun workflowVersion(versionId: String) = "workflow-version:$versionId"

    fun agentList(workspaceId: String, environmentId: String) =
        "agents:list:$workspaceId:$environmentId"

    fun toolList(workspaceId: String, environmentId: String) =
        "tools:list:$workspaceId:$environmentId"

    fun connectionList(workspaceId: String, environmentId: String) =
        "connections:list:$workspaceId:$environmentId"

    fun connectionTest(connectionId: String) = "connection-test:$connectionId"

    fun runSummary(runId: String) = "run-summary:$runId"
}
