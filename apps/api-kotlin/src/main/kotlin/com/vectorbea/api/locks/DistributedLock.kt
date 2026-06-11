package com.vectorbea.api.locks

/**
 * Distributed lock abstraction for Redis-backed mutual exclusion.
 *
 * Uses SET NX PX (set if not exists, with millisecond TTL) and a
 * random token for safe release — only the holder can release its own lock.
 *
 * Use for:
 *   - Idempotency: prevent double-enqueueing the same run
 *   - Schedule firing: ensure only one worker fires a scheduled trigger
 *   - Concurrent run prevention: single-instance workflows
 *
 * Key naming: callers should use descriptive, workspace-scoped keys, e.g.:
 *   "run-enqueue:{workspaceId}:{workflowId}"
 *   "schedule-fire:{scheduleId}"
 */
interface DistributedLock {

    /**
     * Acquire the lock for [key], execute [block], then release the lock.
     *
     * @param key       Lock key (will be namespaced automatically).
     * @param ttlSeconds Lock TTL — lock auto-expires after this many seconds
     *                  even if the holder crashes.  Must be > 0.
     * @param block     The critical section to execute while holding the lock.
     * @return The result of [block].
     *
     * @throws LockNotAcquiredException if the lock is held by another holder.
     * @throws IllegalArgumentException if [ttlSeconds] < 1.
     */
    fun <T> withLock(key: String, ttlSeconds: Long, block: () -> T): T

    /**
     * Try to acquire the lock without executing a block.
     *
     * @return A [LockHandle] if acquired, null if the lock is already held.
     *         Caller MUST call [LockHandle.release] in a try/finally.
     */
    fun tryAcquire(key: String, ttlSeconds: Long): LockHandle?
}

/**
 * Represents an acquired lock.  The holder MUST release it when done.
 *
 * Usage:
 * ```kotlin
 * val handle = lock.tryAcquire("my-key", 30) ?: throw LockNotAcquiredException("my-key")
 * try {
 *     doWork()
 * } finally {
 *     handle.release()
 * }
 * ```
 */
interface LockHandle {
    val key: String
    fun release()
}

/**
 * Thrown when [DistributedLock.withLock] cannot acquire the lock because
 * another process holds it.
 */
class LockNotAcquiredException(key: String) :
    RuntimeException("Lock '$key' is held by another process")
