package com.vectorbea.worker.net

import com.vectorbea.worker.logging.logger
import io.lettuce.core.ScriptOutputType
import io.lettuce.core.api.sync.RedisCommands
import java.util.UUID

/**
 * A distributed token bucket in front of every provider call. §12.4.
 *
 * ── THE PROBLEM THE CIRCUIT BREAKER DOES NOT SOLVE ──────────────────────────
 * `ConnectionCircuit` opens after a provider has already started refusing, and
 * `ProviderThrottle` decides what to do once a 429 has arrived. Both are
 * reactive, and both are correct at what they do. Neither prevents two hundred
 * workers, each individually well-behaved, from collectively exceeding a
 * per-minute limit — nobody is over their own budget, because nobody has one.
 *
 * ── KEYED ON WHAT THE PROVIDER COUNTS ───────────────────────────────────────
 * The ceiling is per CREDENTIAL, not per workspace. The first version keyed
 * `(provider, model, workspace_id)` on the reasoning that a provider limit is
 * per API key and a key is per workspace. Nothing enforces the second half:
 * `connections` has no uniqueness constraint on the credential, and one customer
 * running several workspaces against one provider account is ordinary. When that
 * happens a per-workspace bucket cannot bound the aggregate — N workspaces each
 * at 90% of their own limit is 90N% of the account's, and each one believes it is
 * behaving.
 *
 * So: `capacity:{acct:<fingerprint>}:<provider>:<model>`, where the fingerprint
 * is a salted hash of the API key itself ([CredentialKey]). Workspace fairness
 * becomes a second layer INSIDE that ceiling — see [fairness]. When every
 * workspace has its own credential the two layers collapse: each account bucket
 * has one workspace in it, the guaranteed share is the whole depth, and nothing
 * needs configuring or disabling for that case.
 *
 * ── BOTH LIMITS, BECAUSE PROVIDERS ENFORCE BOTH ─────────────────────────────
 * Providers publish requests-per-minute and tokens-per-minute separately and
 * enforce them separately. Modelling only tokens is how an agent loop — many
 * small requests — exhausts RPM while the token bucket reports healthy. At the
 * old 1,000,000 tokens/minute default, fifty concurrent agent-sized calls fit
 * inside the token depth without the bucket noticing.
 *
 * Every reservation therefore needs headroom in BOTH dimensions and is refused if
 * either is short. `retryAfterMs` is the longer of the two waits, and the refusal
 * says which one bound it, because "raise your RPM" and "raise your TPM" are
 * different actions.
 *
 * ── LEASE AND RETURN ────────────────────────────────────────────────────────
 * A caller cannot know its token spend until the response comes back, and a
 * bucket that only counts after the fact does not limit anything. So the caller
 * RESERVES an estimate before the call and RETURNS the difference after.
 * Requests are exact — one call is one request — so only the token dimension is
 * settled. Over-estimate and the surplus goes back; under-estimate and the
 * shortfall is debited, which can push the bucket negative and make the next
 * caller wait longer. Negative is a legitimate state.
 *
 * ── DEPTH AND RATE ARE NOT THE SAME NUMBER ──────────────────────────────────
 * The obvious bucket — depth == the per-minute limit, refilling at the
 * per-minute limit — admits TWICE the limit in the first minute. So the
 * configured limit is SPLIT: a fraction ([burstFraction]) becomes depth and the
 * remainder becomes the refill rate, so the most any 60-second window admits is
 * `depth + refill` — exactly the limit, whatever the arrival pattern. Applies to
 * both dimensions identically.
 *
 * ── EXHAUSTION IS A YIELD, NOT AN ERROR ─────────────────────────────────────
 * A refusal returns the milliseconds until there will be room, which the caller
 * turns into [com.vectorbea.worker.runtime.executor.NodeResult.Throttled] — the
 * permit is released and the run is parked on a timer. Nothing failed.
 *
 * ── EVERY FAILURE MODE FAILS OPEN ───────────────────────────────────────────
 * Redis being unreachable must not stop provider calls. If the bucket cannot be
 * consulted, the reactive 429 path that predates it is exactly what happens.
 */
class ProviderCapacityBucket(
    private val backend: CapacityBackend?,
    private val limits: CapacityLimits = CapacityLimits.fromEnv(),
    private val enabled: Boolean =
        System.getenv("PROVIDER_CAPACITY_ENABLED")?.lowercase() == "true",
    /**
     * Fraction of a bucket that only interactive lanes may draw.
     *
     * 0.2 by default: enough that an interactive run arriving into a saturated
     * batch workload still gets served, small enough that it does not idle a
     * fifth of a paid-for rate limit when nothing interactive is running.
     */
    private val interactiveFloor: Double =
        System.getenv("PROVIDER_CAPACITY_INTERACTIVE_FLOOR")?.toDoubleOrNull()?.coerceIn(0.0, 0.9)
            ?: 0.2,
    /**
     * Floor a workspace must leave when BORROWING beyond its guaranteed share.
     *
     * The fairness layer, in one number. A workspace inside its share draws
     * freely; one that has exceeded it may still use spare capacity — that is the
     * point of borrowing — but only down to here, so a workspace that has not yet
     * used its share always finds room. 0.25 of depth by default.
     *
     * Zero disables borrowing limits entirely, which is correct for a deployment
     * where every workspace has its own credential and the fair share is the
     * whole bucket anyway.
     */
    private val borrowFloor: Double =
        System.getenv("PROVIDER_CAPACITY_BORROW_FLOOR")?.toDoubleOrNull()?.coerceIn(0.0, 0.9)
            ?: 0.25,
    /** How much of the configured limit is bucket DEPTH rather than refill rate. */
    private val burstFraction: Double =
        System.getenv("PROVIDER_CAPACITY_BURST")?.toDoubleOrNull()?.coerceIn(0.05, 1.0) ?: 0.2,
    /**
     * How long a reservation may stay outstanding before it returns itself.
     *
     * Release is the FAST path and expiry is the BACKSTOP. `LlmNodeExecutor`
     * settles every lease in a `finally` under `NonCancellable`, which covers
     * every path the process survives — and none of the ones it does not. SIGKILL
     * during a rolling deploy, an OOM, a lost lease: the tokens are drawn and the
     * JVM that owed them is gone. Without a TTL the bucket ratchets down until it
     * refills past the loss.
     *
     * Two minutes: longer than any provider call this worker will make, short
     * enough that a crash costs one window rather than an afternoon.
     */
    private val leaseTtlMs: Long =
        System.getenv("PROVIDER_CAPACITY_LEASE_TTL_MS")?.toLongOrNull()?.coerceIn(1_000, 3_600_000)
            ?: 120_000L,
) {
    private val log = logger()

    /** Redis when there is one, in-process when there is not. */
    constructor(
        redis: RedisCommands<String, String>?,
        limits: CapacityLimits = CapacityLimits.fromEnv(),
        enabled: Boolean = System.getenv("PROVIDER_CAPACITY_ENABLED")?.lowercase() == "true",
    ) : this(
        backend = if (redis != null) RedisCapacityBackend(redis) else InProcessCapacityBackend(),
        limits = limits,
        enabled = enabled,
    )

    /**
     * Per-minute limits for one `(provider, model)`, in both dimensions.
     *
     * Configured per model because providers publish them per model, and by an
     * order of magnitude: a flagship model's RPM is often a tenth of a small
     * model's on the same account.
     */
    data class Limit(val requestsPerMinute: Long, val tokensPerMinute: Long)

    class CapacityLimits(
        private val default: Limit,
        /** `provider:model` → limit. Longest match wins over [default]. */
        private val overrides: Map<String, Limit>,
    ) {
        fun forModel(provider: String, model: String): Limit =
            overrides["$provider:$model"] ?: overrides[provider] ?: default

        companion object {
            /**
             * `PROVIDER_RPM_DEFAULT` / `PROVIDER_TPM_DEFAULT`, plus
             * `PROVIDER_LIMIT_OVERRIDES` as a comma-separated list of
             * `provider[:model]=rpm/tpm`.
             *
             * One variable rather than one per model: providers add models
             * constantly, and a scheme that needs a deploy to rate-limit a new
             * model is a scheme that will not be used.
             *
             * `PROVIDER_TPM_OVERRIDES` is still read, for the deployments that
             * already set it — entries there supply tokens only and inherit the
             * default RPM. Removing it silently would have turned a configured
             * token limit into an unconfigured one on the deploy that shipped
             * this.
             */
            fun fromEnv(): CapacityLimits {
                val rpm = System.getenv("PROVIDER_RPM_DEFAULT")?.toLongOrNull() ?: 3_000L
                val tpm = System.getenv("PROVIDER_TPM_DEFAULT")?.toLongOrNull() ?: 1_000_000L
                val default = Limit(rpm, tpm)

                val out = LinkedHashMap<String, Limit>()
                System.getenv("PROVIDER_TPM_OVERRIDES")?.split(',')?.forEach { entry ->
                    val (k, v) = entry.split('=', limit = 2).let {
                        if (it.size == 2) it[0].trim() to it[1].trim() else return@forEach
                    }
                    v.toLongOrNull()?.let { out[k] = Limit(rpm, it) }
                }
                System.getenv("PROVIDER_LIMIT_OVERRIDES")?.split(',')?.forEach { entry ->
                    val (k, v) = entry.split('=', limit = 2).let {
                        if (it.size == 2) it[0].trim() to it[1].trim() else return@forEach
                    }
                    val parts = v.split('/', limit = 2)
                    val r = parts.getOrNull(0)?.trim()?.toLongOrNull()
                    val t = parts.getOrNull(1)?.trim()?.toLongOrNull()
                    if (r != null && t != null) out[k] = Limit(r, t)
                }
                return CapacityLimits(default, out)
            }
        }
    }

    /** Which dimension refused a reservation. Named, because the fixes differ. */
    enum class Dimension { REQUESTS, TOKENS }

    /**
     * A granted reservation. Must be settled, or its tokens stay drawn until the
     * bucket refills past them.
     */
    data class Lease(
        val key: String,
        val workspaceId: UUID,
        val reservedTokens: Long,
        val tokenCapacity: Long,
        /**
         * Identifies this reservation among the outstanding ones, so expiry can
         * reclaim a SPECIFIC amount. A bucket that only tracked a total could not
         * tell which part of it was abandoned.
         */
        val id: String = UUID.randomUUID().toString(),
    )

    sealed class Outcome {
        data class Granted(val lease: Lease) : Outcome()

        /** No headroom. [retryAfterMs] is when there will be; [dimension] is which ran out. */
        data class Exhausted(
            val retryAfterMs: Long,
            val dimension: Dimension,
            val limit: Limit,
        ) : Outcome()

        /** Bucket off, or unreachable. Proceed exactly as before this class existed. */
        object NotApplicable : Outcome()
    }

    /**
     * Reserve headroom for one provider call.
     *
     * [credentialFingerprint] identifies the account — see [CredentialKey]. It is
     * what makes the ceiling bound the thing the provider actually counts.
     *
     * [interactive] callers may draw below the reserved floor. It is the lane, not
     * the caller's opinion of its own importance.
     */
    fun reserve(
        provider: String,
        model: String,
        credentialFingerprint: String,
        workspaceId: UUID,
        estimatedTokens: Long,
        interactive: Boolean,
    ): Outcome {
        val b = backend
        if (!enabled || b == null) return Outcome.NotApplicable

        val limit = limits.forModel(provider, model)
        if (limit.tokensPerMinute <= 0 || limit.requestsPerMinute <= 0) return Outcome.NotApplicable

        val key = key(provider, model, credentialFingerprint)
        val wantTokens = estimatedTokens.coerceAtLeast(1L)
        val tokenDepth = depthOf(limit.tokensPerMinute)
        val requestDepth = depthOf(limit.requestsPerMinute)

        /* Floors in absolute units, computed here so the backends stay arithmetic
           and the policy stays in Kotlin where it can be read. A fraction of the
           DEPTH, not of the per-minute limit — depth is what a caller can draw at
           any instant. */
        val lane = if (interactive) 0.0 else interactiveFloor

        return try {
            val lease = Lease(key, workspaceId, wantTokens, tokenDepth)
            val r = b.reserve(CapacityBackend.Request(
                key = key,
                workspaceId = workspaceId.toString(),
                tokenDepth = tokenDepth,
                tokenRefillPerMinute = refillPerMinuteOf(limit.tokensPerMinute),
                requestDepth = requestDepth,
                requestRefillPerMinute = refillPerMinuteOf(limit.requestsPerMinute),
                wantTokens = wantTokens,
                laneFloorFraction = lane,
                borrowFloorFraction = borrowFloor,
                nowMs = System.currentTimeMillis(),
                leaseId = lease.id,
                leaseTtlMs = leaseTtlMs,
            ))
            if (r.granted) Outcome.Granted(lease)
            else Outcome.Exhausted(
                retryAfterMs = r.retryAfterMs.coerceAtLeast(1L),
                dimension = if (r.boundBy == 0L) Dimension.REQUESTS else Dimension.TOKENS,
                limit = limit,
            )
        } catch (e: Exception) {
            /* FAIL OPEN. A bucket that cannot be reached must not stop the fleet
               calling providers — the 429 path that predates this class is still
               there and still correct. */
            log.warn("[capacity] bucket unavailable for {}:{} — proceeding unmetered: {}",
                provider, model, e.message)
            Outcome.NotApplicable
        }
    }

    /**
     * Settle a lease against what the call actually cost.
     *
     * Returns the surplus (positive) or the shortfall (negative), for the metric.
     * Never throws: a settle that fails leaves the reservation drawn, which
     * over-limits rather than under-limits, and over-limiting is the safe error.
     *
     * Only tokens are settled. A request is exactly one request whatever the
     * response says, so the request dimension has nothing to correct.
     */
    fun settle(lease: Lease, actualTokens: Long): Long {
        val b = backend ?: return 0
        val delta = lease.reservedTokens - actualTokens.coerceAtLeast(0L)
        return try {
            /* Called even when delta is zero, because settling also RETIRES the
               lease. Skipping the call would leave it outstanding for the reaper
               to return a second time — the bucket would grow past its depth on
               every perfectly-estimated call. */
            b.settle(lease.key, lease.workspaceId.toString(), lease.id, delta, lease.tokenCapacity)
            delta
        } catch (e: Exception) {
            log.warn("[capacity] settle failed for {} — {} token(s) stay drawn: {}",
                lease.key, lease.reservedTokens, e.message)
            0
        }
    }

    /** Release a reservation whole, for a call that never happened. */
    fun release(lease: Lease) {
        settle(lease, 0L)
    }

    /**
     * Is there room for [count] calls of [perCallTokens] right now?
     *
     * The preflight, and it RESERVES NOTHING. A fan-out asks before it creates
     * children so that N children do not each discover the limit independently —
     * the same reasoning as `BudgetLedger.preflightFanOut`, applied to a rate
     * rather than a total. A budget preflight cannot answer this: twenty children
     * can be entirely affordable in total tokens and still be twenty simultaneous
     * requests in one second.
     *
     * Returns how many of the [count] would fit. The caller staggers the rest
     * rather than being refused outright, because half a fan-out arriving a second
     * later is a far better outcome than N-1 of them yielding.
     */
    fun headroomFor(
        provider: String,
        model: String,
        credentialFingerprint: String,
        count: Int,
        perCallTokens: Long,
    ): Int {
        val b = backend
        if (!enabled || b == null || count <= 0) return count
        val limit = limits.forModel(provider, model)
        if (limit.tokensPerMinute <= 0 || limit.requestsPerMinute <= 0) return count
        return try {
            val s = b.peek(key(provider, model, credentialFingerprint),
                depthOf(limit.tokensPerMinute), refillPerMinuteOf(limit.tokensPerMinute),
                depthOf(limit.requestsPerMinute), refillPerMinuteOf(limit.requestsPerMinute),
                System.currentTimeMillis())
            val byTokens = if (perCallTokens <= 0) count
                           else (s.tokens / perCallTokens).toInt()
            val byRequests = s.requests.toInt()
            minOf(count, maxOf(0, byTokens), maxOf(0, byRequests))
        } catch (e: Exception) {
            /* Fail open, like everything else here: an unanswerable preflight must
               not stop a fan-out that the reservations themselves will police. */
            count
        }
    }

    /** Tokens (or requests) drawable at one instant. */
    internal fun depthOf(limitPerMinute: Long): Long =
        (limitPerMinute * burstFraction).toLong().coerceAtLeast(1L)

    /** Added per minute. Depth plus this is the most any 60s window admits. */
    internal fun refillPerMinuteOf(limitPerMinute: Long): Long =
        (limitPerMinute * (1.0 - burstFraction)).toLong().coerceAtLeast(1L)

    /**
     * `capacity:{acct:<fingerprint>}:<provider>:<model>`.
     *
     * The hash tag is the ACCOUNT, so every key belonging to one credential lands
     * in one Redis cluster slot — which is what lets the bucket, its lease set and
     * its workspace usage be read and written by one script.
     */
    private fun key(provider: String, model: String, fingerprint: String) =
        "capacity:{acct:$fingerprint}:$provider:$model"

    internal companion object {
        /**
         * TTL on a Redis bucket key.
         *
         * Refill is computed from a stored timestamp, so an expired key is
         * indistinguishable from a full one — which is correct, because a bucket
         * untouched for an hour IS full.
         */
        const val TTL_SECONDS = 3_600L

        /**
         * Refill both dimensions, then reserve if BOTH have room.
         *
         * KEYS: bucket hash, lease ZSET, workspace usage hash
         * ARGV: tokenDepth, tokenRefill, requestDepth, requestRefill, wantTokens,
         *       laneFloorFraction, borrowFloorFraction, nowMs, keyTtlSeconds,
         *       leaseId, leaseTtlMs, workspaceId
         * Returns: {granted 0|1, retryAfterMs, boundBy 0=requests 1=tokens}
         *
         * Atomic by virtue of being one script: the read-modify-write cannot
         * interleave with another worker's. That is the whole reason this is Lua.
         *
         * ── KEEP IN STEP WITH [BucketMath] ─────────────────────────────────
         * The same arithmetic expressed twice, because one copy has to run inside
         * Redis and the other has to run without it. `ProviderCapacityBucketTest`
         * asserts they agree, and that test is the only thing keeping them honest.
         */
        val RESERVE_LUA = """
            local tDepth   = tonumber(ARGV[1])
            local tRefill  = tonumber(ARGV[2])
            local rDepth   = tonumber(ARGV[3])
            local rRefill  = tonumber(ARGV[4])
            local want     = tonumber(ARGV[5])
            local laneF    = tonumber(ARGV[6])
            local borrowF  = tonumber(ARGV[7])
            local now      = tonumber(ARGV[8])
            local ttl      = tonumber(ARGV[9])
            local leaseId  = ARGV[10]
            local leaseTtl = tonumber(ARGV[11])
            local wsId     = ARGV[12]

            local tokens = tonumber(redis.call('HGET', KEYS[1], 'tokens'))
            local reqs   = tonumber(redis.call('HGET', KEYS[1], 'reqs'))
            local ts     = tonumber(redis.call('HGET', KEYS[1], 'ts'))
            if tokens == nil or ts == nil then tokens = tDepth; ts = now end
            if reqs == nil then reqs = rDepth end

            -- ── THE CRASH BACKSTOP ────────────────────────────────────────
            -- Return every lease whose deadline has passed. A worker killed
            -- mid-call never settles, and without this its tokens stay drawn for
            -- the life of the key. Swept lazily, on the next caller's reserve,
            -- because the next caller is exactly who benefits from them.
            --
            -- The member encodes the amount and the workspace (`id:amount:ws`) so
            -- one ZSET is enough and the workspace's usage can be credited back
            -- too — otherwise a crashed worker would leave its workspace looking
            -- permanently over its share.
            local dead = redis.call('ZRANGEBYSCORE', KEYS[2], '-inf', now)
            for i = 1, #dead do
              local amount, who = string.match(dead[i], ':(%d+):(.+)$')
              if amount then
                tokens = tokens + tonumber(amount)
                reqs = reqs + 1
                local u = tonumber(redis.call('HGET', KEYS[3], who))
                if u then redis.call('HSET', KEYS[3], who, math.max(0, u - tonumber(amount))) end
              end
            end
            if #dead > 0 then redis.call('ZREMRANGEBYSCORE', KEYS[2], '-inf', now) end

            -- Continuous refill of both dimensions, each capped at its own DEPTH.
            -- Never above: a bucket that accumulated while idle would let a burst
            -- exceed the provider's window, which is the thing being prevented.
            local elapsed = now - ts
            if elapsed > 0 then
              tokens = math.min(tDepth, tokens + (tRefill * elapsed / 60000.0))
              reqs   = math.min(rDepth, reqs + (rRefill * elapsed / 60000.0))
              ts = now
              -- Workspace usage decays at the same rate the bucket refills, so a
              -- share is a rate and not a lifetime quota.
              local names = redis.call('HKEYS', KEYS[3])
              for i = 1, #names do
                local u = tonumber(redis.call('HGET', KEYS[3], names[i])) or 0
                u = u - (tRefill * elapsed / 60000.0)
                if u <= 0 then redis.call('HDEL', KEYS[3], names[i])
                else redis.call('HSET', KEYS[3], names[i], u) end
              end
            end

            -- ── THE FAIRNESS LAYER ────────────────────────────────────────
            -- A workspace inside its guaranteed share draws freely. One that has
            -- exceeded it is BORROWING, and may only draw down to the borrow
            -- floor, so a workspace that has not yet used its share always finds
            -- room. The share is the depth divided by however many workspaces are
            -- currently active on this credential — no configuration, and it
            -- collapses to the whole depth when there is only one.
            local active = #redis.call('HKEYS', KEYS[3])
            if active < 1 then active = 1 end
            local share = tDepth / active
            local used = tonumber(redis.call('HGET', KEYS[3], wsId)) or 0

            local floorFrac = laneF
            if (used + want) > share and borrowF > floorFrac then floorFrac = borrowF end
            local tFloor = tDepth * floorFrac
            local rFloor = rDepth * floorFrac

            local granted = 0
            local retry = 0
            local boundBy = 1
            local okTokens = (tokens - want) >= tFloor
            local okReqs   = (reqs - 1) >= rFloor

            if okTokens and okReqs then
              tokens = tokens - want
              reqs = reqs - 1
              redis.call('HSET', KEYS[3], wsId, used + want)
              redis.call('ZADD', KEYS[2], now + leaseTtl, leaseId .. ':' .. want .. ':' .. wsId)
              granted = 1
            else
              -- The longer of the two waits, and which one bound it. "Raise your
              -- RPM" and "raise your TPM" are different actions.
              local tWait = 0
              local rWait = 0
              if not okTokens then
                tWait = math.ceil(((tFloor + want) - tokens) * 60000.0 / tRefill)
              end
              if not okReqs then
                rWait = math.ceil(((rFloor + 1) - reqs) * 60000.0 / rRefill)
              end
              if rWait > tWait then retry = rWait; boundBy = 0 else retry = tWait; boundBy = 1 end
              if retry < 1 then retry = 1 end
            end

            redis.call('HSET', KEYS[1], 'tokens', tokens, 'reqs', reqs, 'ts', ts)
            redis.call('EXPIRE', KEYS[1], ttl)
            redis.call('EXPIRE', KEYS[2], ttl)
            redis.call('EXPIRE', KEYS[3], ttl)
            return { granted, retry, boundBy }
        """.trimIndent()

        /**
         * Give back `delta` tokens (or take more, when negative), and one request.
         *
         * Clamped at the depth ceiling for the same reason the refill is: a settle
         * that returned more than was reserved must not create capacity the
         * provider will not honour. No floor — a bucket driven negative by a bad
         * estimate is real information, and the next caller should wait for it.
         */
        val SETTLE_LUA = """
            local delta   = tonumber(ARGV[1])
            local depth   = tonumber(ARGV[2])
            local leaseId = ARGV[3]
            local wsId    = ARGV[4]

            -- Retire the lease FIRST, and only apply the settlement if it was
            -- still outstanding. Without that check a settle racing its own
            -- expiry returns the tokens twice and the bucket drifts above depth.
            local removed = 0
            local members = redis.call('ZRANGEBYSCORE', KEYS[2], '-inf', '+inf')
            for i = 1, #members do
              if string.sub(members[i], 1, #leaseId + 1) == leaseId .. ':' then
                redis.call('ZREM', KEYS[2], members[i])
                removed = 1
                break
              end
            end
            if removed == 0 then return 0 end

            local tokens = tonumber(redis.call('HGET', KEYS[1], 'tokens'))
            if tokens == nil then return 0 end
            redis.call('HSET', KEYS[1], 'tokens', math.min(depth, tokens + delta))

            -- The workspace's usage moves with the settlement, so a workspace that
            -- consistently over-estimates is not charged share it never used.
            local u = tonumber(redis.call('HGET', KEYS[3], wsId))
            if u then redis.call('HSET', KEYS[3], wsId, math.max(0, u - delta)) end
            return 1
        """.trimIndent()

        /** Refill and report, reserving nothing. Backs [headroomFor]. */
        val PEEK_LUA = """
            local tDepth  = tonumber(ARGV[1])
            local tRefill = tonumber(ARGV[2])
            local rDepth  = tonumber(ARGV[3])
            local rRefill = tonumber(ARGV[4])
            local now     = tonumber(ARGV[5])

            local tokens = tonumber(redis.call('HGET', KEYS[1], 'tokens'))
            local reqs   = tonumber(redis.call('HGET', KEYS[1], 'reqs'))
            local ts     = tonumber(redis.call('HGET', KEYS[1], 'ts'))
            if tokens == nil or ts == nil then return { tDepth, rDepth } end
            if reqs == nil then reqs = rDepth end

            local elapsed = now - ts
            if elapsed > 0 then
              tokens = math.min(tDepth, tokens + (tRefill * elapsed / 60000.0))
              reqs   = math.min(rDepth, reqs + (rRefill * elapsed / 60000.0))
            end
            return { math.floor(tokens), math.floor(reqs) }
        """.trimIndent()
    }
}

/**
 * Where a bucket's counters actually live.
 *
 * Two implementations, and the second is NOT a test double. A worker deployed
 * without Redis — a single-node install, a developer machine — should still limit
 * its own provider spend, because "no Redis" is not a reason to be unmetered. It
 * is a weaker guarantee (this process only) and it is honestly weaker.
 */
interface CapacityBackend {
    data class Request(
        val key: String,
        val workspaceId: String,
        val tokenDepth: Long,
        val tokenRefillPerMinute: Long,
        val requestDepth: Long,
        val requestRefillPerMinute: Long,
        val wantTokens: Long,
        val laneFloorFraction: Double,
        val borrowFloorFraction: Double,
        val nowMs: Long,
        val leaseId: String,
        val leaseTtlMs: Long,
    )

    /** [boundBy] is 0 for requests, 1 for tokens. Meaningless when granted. */
    data class Result(val granted: Boolean, val retryAfterMs: Long, val boundBy: Long)

    /** Current headroom in both dimensions, reserving nothing. */
    data class Available(val tokens: Long, val requests: Long)

    fun reserve(req: Request): Result

    /** Retire [leaseId] and return (positive) or take (negative) tokens. */
    fun settle(key: String, workspaceId: String, leaseId: String, delta: Long, depth: Long)

    fun peek(
        key: String, tokenDepth: Long, tokenRefill: Long,
        requestDepth: Long, requestRefill: Long, nowMs: Long,
    ): Available
}

/**
 * The arithmetic, in one place.
 *
 * The Lua is a transcription of this, and the two are pinned together by a parity
 * test. Written here rather than only in Lua so the behaviour is expressible,
 * testable and readable without a Redis to run it in.
 */
internal object BucketMath {
    /** `leases` maps lease id to (amount, workspace, deadline). */
    data class State(
        var tokens: Double,
        var requests: Double,
        var ts: Long,
        val leases: MutableMap<String, Triple<Long, String, Long>> = LinkedHashMap(),
        /** Per-workspace token usage, decaying at the refill rate. The fairness layer. */
        val usage: MutableMap<String, Double> = LinkedHashMap(),
    )

    /** Return every lease whose deadline has passed. The crash backstop. */
    fun expire(st: State, nowMs: Long): Long {
        var reclaimed = 0L
        val it = st.leases.entries.iterator()
        while (it.hasNext()) {
            val (amount, who, deadline) = it.next().value
            if (deadline <= nowMs) {
                reclaimed += amount
                st.requests += 1
                st.usage[who]?.let { u -> st.usage[who] = maxOf(0.0, u - amount) }
                it.remove()
            }
        }
        st.tokens += reclaimed
        return reclaimed
    }

    /** Refill both dimensions in place, and decay workspace usage with them. */
    fun refill(st: State, req: CapacityBackend.Request) {
        val elapsed = req.nowMs - st.ts
        if (elapsed <= 0) return
        st.tokens = minOf(st.tokens + req.tokenRefillPerMinute * elapsed / 60_000.0,
            req.tokenDepth.toDouble())
        st.requests = minOf(st.requests + req.requestRefillPerMinute * elapsed / 60_000.0,
            req.requestDepth.toDouble())
        st.ts = req.nowMs
        val decay = req.tokenRefillPerMinute * elapsed / 60_000.0
        val it = st.usage.entries.iterator()
        while (it.hasNext()) {
            val e = it.next()
            val v = e.value - decay
            if (v <= 0) it.remove() else e.setValue(v)
        }
    }

    /**
     * Retire a lease and apply its settlement — but only if it was still
     * outstanding. A settle racing its own expiry would otherwise return the
     * tokens twice and drift the bucket above its depth.
     */
    fun settle(st: State, workspaceId: String, leaseId: String, delta: Long, depth: Long) {
        if (st.leases.remove(leaseId) == null) return
        st.tokens = minOf(depth.toDouble(), st.tokens + delta)
        st.usage[workspaceId]?.let { st.usage[workspaceId] = maxOf(0.0, it - delta) }
    }

    /** Draw one request and [Request.wantTokens], if both dimensions have room. */
    fun reserve(st: State, req: CapacityBackend.Request): CapacityBackend.Result {
        /* Reclaim before refilling, so tokens returned by an expired lease are
           subject to the same depth cap as everything else. */
        expire(st, req.nowMs)
        refill(st, req)

        val active = maxOf(1, st.usage.size)
        val share = req.tokenDepth.toDouble() / active
        val used = st.usage[req.workspaceId] ?: 0.0
        var floorFrac = req.laneFloorFraction
        if (used + req.wantTokens > share && req.borrowFloorFraction > floorFrac) {
            floorFrac = req.borrowFloorFraction
        }
        val tFloor = req.tokenDepth * floorFrac
        val rFloor = req.requestDepth * floorFrac

        val okTokens = (st.tokens - req.wantTokens) >= tFloor
        val okReqs = (st.requests - 1) >= rFloor

        if (okTokens && okReqs) {
            st.tokens -= req.wantTokens
            st.requests -= 1
            st.usage[req.workspaceId] = used + req.wantTokens
            st.leases[req.leaseId] = Triple(req.wantTokens, req.workspaceId, req.nowMs + req.leaseTtlMs)
            return CapacityBackend.Result(true, 0L, 1L)
        }
        val tWait = if (okTokens) 0L else
            Math.ceil((tFloor + req.wantTokens - st.tokens) * 60_000.0 / req.tokenRefillPerMinute).toLong()
        val rWait = if (okReqs) 0L else
            Math.ceil((rFloor + 1 - st.requests) * 60_000.0 / req.requestRefillPerMinute).toLong()
        return if (rWait > tWait) CapacityBackend.Result(false, rWait.coerceAtLeast(1L), 0L)
               else CapacityBackend.Result(false, tWait.coerceAtLeast(1L), 1L)
    }
}

/** The distributed backend. One script per operation, atomic in Redis. */
class RedisCapacityBackend(private val redis: RedisCommands<String, String>) : CapacityBackend {
    override fun reserve(req: CapacityBackend.Request): CapacityBackend.Result {
        @Suppress("UNCHECKED_CAST")
        val res = redis.eval<List<Any>>(
            ProviderCapacityBucket.RESERVE_LUA, ScriptOutputType.MULTI,
            /* THREE keys, so the bucket, its lease set and its workspace usage
               hash to the same slot in a cluster — `{acct:…}` in the key already
               guarantees that, and declaring all three is what makes it
               checkable. */
            arrayOf(req.key, "${req.key}:leases", "${req.key}:ws"),
            req.tokenDepth.toString(), req.tokenRefillPerMinute.toString(),
            req.requestDepth.toString(), req.requestRefillPerMinute.toString(),
            req.wantTokens.toString(),
            req.laneFloorFraction.toString(), req.borrowFloorFraction.toString(),
            req.nowMs.toString(), ProviderCapacityBucket.TTL_SECONDS.toString(),
            req.leaseId, req.leaseTtlMs.toString(), req.workspaceId,
        )
        return CapacityBackend.Result(
            granted = (res[0] as Long) == 1L,
            retryAfterMs = res[1] as Long,
            boundBy = res[2] as Long,
        )
    }

    override fun settle(key: String, workspaceId: String, leaseId: String, delta: Long, depth: Long) {
        redis.eval<Long>(
            ProviderCapacityBucket.SETTLE_LUA, ScriptOutputType.INTEGER,
            arrayOf(key, "$key:leases", "$key:ws"),
            delta.toString(), depth.toString(), leaseId, workspaceId,
        )
    }

    override fun peek(
        key: String, tokenDepth: Long, tokenRefill: Long,
        requestDepth: Long, requestRefill: Long, nowMs: Long,
    ): CapacityBackend.Available {
        @Suppress("UNCHECKED_CAST")
        val res = redis.eval<List<Any>>(
            ProviderCapacityBucket.PEEK_LUA, ScriptOutputType.MULTI,
            arrayOf(key),
            tokenDepth.toString(), tokenRefill.toString(),
            requestDepth.toString(), requestRefill.toString(), nowMs.toString(),
        )
        return CapacityBackend.Available(res[0] as Long, res[1] as Long)
    }
}

/**
 * The single-process backend.
 *
 * Synchronised on the state object rather than the map: two different models'
 * buckets have no reason to contend, and a global lock in front of every provider
 * call is a bottleneck introduced by the thing meant to prevent one.
 */
class InProcessCapacityBackend : CapacityBackend {
    private val states = java.util.concurrent.ConcurrentHashMap<String, BucketMath.State>()

    private fun stateFor(key: String, tokenDepth: Long, requestDepth: Long, nowMs: Long) =
        states.computeIfAbsent(key) {
            BucketMath.State(tokenDepth.toDouble(), requestDepth.toDouble(), nowMs)
        }

    override fun reserve(req: CapacityBackend.Request): CapacityBackend.Result {
        val st = stateFor(req.key, req.tokenDepth, req.requestDepth, req.nowMs)
        return synchronized(st) { BucketMath.reserve(st, req) }
    }

    override fun settle(key: String, workspaceId: String, leaseId: String, delta: Long, depth: Long) {
        val st = states[key] ?: return
        synchronized(st) { BucketMath.settle(st, workspaceId, leaseId, delta, depth) }
    }

    override fun peek(
        key: String, tokenDepth: Long, tokenRefill: Long,
        requestDepth: Long, requestRefill: Long, nowMs: Long,
    ): CapacityBackend.Available {
        val st = states[key] ?: return CapacityBackend.Available(tokenDepth, requestDepth)
        return synchronized(st) {
            val elapsed = nowMs - st.ts
            val t = if (elapsed > 0)
                minOf(tokenDepth.toDouble(), st.tokens + tokenRefill * elapsed / 60_000.0) else st.tokens
            val r = if (elapsed > 0)
                minOf(requestDepth.toDouble(), st.requests + requestRefill * elapsed / 60_000.0) else st.requests
            CapacityBackend.Available(t.toLong(), r.toLong())
        }
    }
}
