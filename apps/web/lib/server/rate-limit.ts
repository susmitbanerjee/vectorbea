type BucketState = {
  count: number;
  resetAt: number;
};

const store = new Map<string, BucketState>();

function now() {
  return Date.now();
}

export function consumeRateLimit(key: string, limit: number, windowMs: number) {
  const ts = now();
  const existing = store.get(key);
  if (!existing || ts >= existing.resetAt) {
    const resetAt = ts + windowMs;
    store.set(key, { count: 1, resetAt });
    return {
      allowed: true,
      remaining: Math.max(limit - 1, 0),
      resetAt,
    };
  }

  if (existing.count >= limit) {
    return {
      allowed: false,
      remaining: 0,
      resetAt: existing.resetAt,
    };
  }

  existing.count += 1;
  store.set(key, existing);
  return {
    allowed: true,
    remaining: Math.max(limit - existing.count, 0),
    resetAt: existing.resetAt,
  };
}
