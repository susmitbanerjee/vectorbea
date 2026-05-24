/**
 * Cache Abstraction — Server-side only
 *
 * Thin wrapper around Redis (ioredis) with graceful fallback when Redis is
 * unavailable. Non-critical caches degrade silently; lock operations emit
 * a warning and return false (caller decides whether to proceed).
 *
 * Secrets are NEVER stored in cache.
 */

import "server-only";

// Lazy Redis import — avoids breaking builds when ioredis is not installed
let redis: import("ioredis").Redis | null = null;

async function getRedis(): Promise<import("ioredis").Redis | null> {
  if (redis !== null) return redis;
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) {
    return null;
  }
  try {
    const { default: Redis } = await import("ioredis");
    const client = new Redis(redisUrl, {
      maxRetriesPerRequest: 1,
      connectTimeout: 3000,
      lazyConnect: true,
      enableOfflineQueue: false,
    });
    client.on("error", (err: Error) => {
      // Only log operational errors, not every failed command
      if (process.env.NODE_ENV !== "test") {
        console.warn("[cache] Redis error:", err.message);
      }
    });
    await client.connect();
    redis = client;
    return redis;
  } catch (e) {
    console.warn("[cache] Redis unavailable:", (e as Error).message, "— cache disabled.");
    return null;
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Get a cached value. Returns null on miss or Redis unavailability.
 */
export async function cacheGet<T>(key: string): Promise<T | null> {
  try {
    const r = await getRedis();
    if (!r) return null;
    const raw = await r.get(key);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

/**
 * Set a cached value with a TTL in seconds.
 */
export async function cacheSet(key: string, value: unknown, ttlSeconds: number): Promise<void> {
  try {
    const r = await getRedis();
    if (!r) return;
    await r.set(key, JSON.stringify(value), "EX", ttlSeconds);
  } catch {
    // Non-critical — fail silently
  }
}

/**
 * Delete a cached value.
 */
export async function cacheDel(key: string): Promise<void> {
  try {
    const r = await getRedis();
    if (!r) return;
    await r.del(key);
  } catch {
    // Non-critical
  }
}

/**
 * Get or compute a cached value.
 * If the key is missing (or Redis is down), calls loader() and caches the result.
 */
export async function cacheGetOrSet<T>(
  key: string,
  ttlSeconds: number,
  loader: () => Promise<T>,
): Promise<T> {
  const cached = await cacheGet<T>(key);
  if (cached !== null) return cached;
  const value = await loader();
  await cacheSet(key, value, ttlSeconds);
  return value;
}

/**
 * Acquire a distributed lock. Returns true if acquired, false if not.
 * The caller must handle the case where the lock is not acquired.
 *
 * On Redis unavailability, emits a warning and returns false (conservative).
 */
export async function cacheLock(key: string, ttlSeconds: number): Promise<boolean> {
  try {
    const r = await getRedis();
    if (!r) {
      console.warn(`[cache] Lock '${key}' not acquired: Redis unavailable.`);
      return false;
    }
    const result = await r.set(key, "1", "EX", ttlSeconds, "NX");
    return result === "OK";
  } catch {
    return false;
  }
}

/**
 * Release a distributed lock.
 */
export async function cacheUnlock(key: string): Promise<void> {
  await cacheDel(key);
}

/**
 * Delete all keys matching a pattern (use sparingly).
 */
export async function cacheDelPattern(pattern: string): Promise<void> {
  try {
    const r = await getRedis();
    if (!r) return;
    const keys = await r.keys(pattern);
    if (keys.length > 0) {
      await r.del(...keys);
    }
  } catch {
    // Non-critical
  }
}

// ─── Cache key helpers ────────────────────────────────────────────────────────

export const CacheKeys = {
  connections:     (wsId: string) => `workspace:${wsId}:connections:list`,
  connection:      (id: string)   => `connection:${id}:meta`,
  connectionTest:  (id: string)   => `connection:${id}:test-result`,
  workflowGraph:   (wfId: string) => `workflow:${wfId}:graph`,
  workflowList:    (wsId: string) => `workspace:${wsId}:workflows:list`,
  agentList:       (wsId: string) => `workspace:${wsId}:agents:list`,
  toolList:        (wsId: string) => `workspace:${wsId}:tools:list`,
  runSummary:      (runId: string) => `run:${runId}:summary`,
  runEvents:       (runId: string) => `run:${runId}:events:latest`,
  idempotency:     (wsId: string, key: string) => `idempotency:${wsId}:${key}`,
  rateLimitWindow: (wsId: string, provider: string, window: string) =>
    `rate-limit:${wsId}:${provider}:${window}`,
  schedulerLock:   (schedId: string) => `lock:scheduler:${schedId}`,
  runLock:         (runId: string)  => `lock:run:${runId}`,
} as const;

// ─── TTL constants (seconds) ──────────────────────────────────────────────────

export const TTL = {
  CONNECTION_TEST:   5 * 60,   // 5 min
  WORKFLOW_GRAPH:   10 * 60,   // 10 min
  LIST:              5 * 60,   // 5 min
  RUN_SUMMARY_LIVE:       30,  // 30 sec (active run)
  RUN_SUMMARY_TERMINAL: 5 * 60, // 5 min (completed run)
  IDEMPOTENCY:      24 * 60 * 60, // 24 hours
  RATE_LIMIT_WINDOW: 60,       // 1 min window
  LOCK_DEFAULT:     30,        // 30 sec
} as const;
