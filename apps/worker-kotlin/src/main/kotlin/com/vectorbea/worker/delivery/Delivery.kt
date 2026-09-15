package com.vectorbea.worker.delivery

import java.security.MessageDigest
import java.time.Duration
import java.time.Instant
import java.util.UUID
import kotlin.math.min
import kotlin.random.Random

/**
 * Where a result goes, and how.
 *
 * ── THREE SHAPES, AND ONLY TWO OF THEM ARE ROWS ─────────────────────────────
 * A caller blocked on a sync or streamed run is NOT a delivery target. It has
 * no retry policy, no dead-letter queue and no redelivery button, because the
 * connection it would redeliver to closed the moment it got its answer. Giving
 * it a row here would produce a permanently-failing delivery for every
 * synchronous call. See docs/INGRESS.md §4 for that path.
 *
 * What is left is: we call them ([Kind.CALLBACK]), or we push it somewhere
 * ([Kind.DESTINATION]).
 */
data class DeliveryTarget(
    val id: UUID,
    val workspaceId: UUID,
    val environmentId: UUID,
    /** Null means every workflow in the environment. */
    val workflowId: UUID?,
    val name: String,
    val kind: Kind,

    // Callback
    val callbackUrl: String?,
    val signingSecretRef: String?,
    val headers: Map<String, String>,

    // Destination
    /**
     * The tool that does the pushing.
     *
     * ── WHY A DESTINATION IS A TOOL ─────────────────────────────────────────
     * A Slack destination is the Slack HTTP tool. It arrives with a connection,
     * an encrypted credential, an approval policy, an audit trail and a result
     * contract — all of which a parallel "destinations" implementation would
     * have to grow its own version of, and would get the credential handling
     * wrong first.
     */
    val toolId: UUID?,
    val connectionId: UUID?,
    val inputMapping: Map<String, String>,

    val onStatuses: List<String>,
    val payloadMode: PayloadMode,
    val maxPayloadBytes: Int,
    val streamPartials: Boolean,
    val streamNodes: List<String>,
    val maxAttempts: Int,
    val timeoutMs: Int,
    val enabled: Boolean,
) {
    enum class Kind(val wire: String) {
        /** We call their endpoint. */
        CALLBACK("callback"),

        /** We push the result through a tool. */
        DESTINATION("destination");

        companion object {
            fun of(value: String?): Kind =
                entries.firstOrNull { it.wire == value } ?: CALLBACK
        }
    }

    /** Whether this target wants the run that just ended in [status]. */
    fun wants(status: String): Boolean = enabled && status in onStatuses
}

/**
 * How big a result travels.
 *
 * `AUTO` is the default and the only generally-correct one. Forcing `FULL` at a
 * receiver with a body limit turns a large result into a permanent delivery
 * failure; forcing `URL` makes every small result an extra round trip for a
 * receiver who only wanted the answer.
 */
enum class PayloadMode(val wire: String) {
    FULL("full"),
    URL("url"),
    AUTO("auto");

    companion object {
        fun of(value: String?): PayloadMode =
            entries.firstOrNull { it.wire == value } ?: AUTO
    }
}

/** One delivery, and where it has got to. */
data class RunDelivery(
    val id: UUID,
    val workspaceId: UUID,
    val environmentId: UUID,
    val runId: UUID,
    val targetId: UUID,
    val idempotencyKey: String,
    val sequence: Int,
    val isPartial: Boolean,
    val status: Status,
    val attempts: Int,
    val maxAttempts: Int,
    val nextAttemptAt: Instant,
    val payloadModeUsed: String?,
    val payloadBytes: Int?,
    val payloadUrl: String?,
    val lastError: String?,
    val deliveredAt: Instant?,
    val createdAt: Instant,
) {
    enum class Status(val wire: String) {
        PENDING("pending"),
        DELIVERING("delivering"),
        DELIVERED("delivered"),
        RETRYING("retrying"),

        /**
         * Out of attempts. This IS the dead-letter queue — the row is listed and
         * redeliverable in place.
         *
         * A separate DLQ table would duplicate the target, the payload, the
         * attempt count and the error chain, and redelivery would need a join to
         * put them back together. That is a join somebody eventually gets wrong,
         * and the symptom is a redelivery that sends the wrong payload to the
         * right endpoint.
         */
        DEAD("dead"),

        /** The run was deleted, or the target was. Nothing to deliver. */
        CANCELLED("cancelled"),

        /** The run's status was not one this target wanted. */
        SKIPPED("skipped");

        companion object {
            fun of(value: String?): Status =
                entries.firstOrNull { it.wire == value } ?: PENDING
        }
    }

    val isTerminal: Boolean
        get() = status == Status.DELIVERED || status == Status.DEAD ||
            status == Status.CANCELLED || status == Status.SKIPPED

    companion object {
        /**
         * The key a receiver dedupes on.
         *
         * ── IT IS DERIVED, WHICH IS THE WHOLE POINT ─────────────────────────
         * Same material every time: `(runId, targetId, sequence)`. So the
         * fifteenth retry and an operator's redelivery six hours later carry the
         * key the first attempt carried, and a receiver storing keys it has seen
         * refuses every copy after the first.
         *
         * A key generated per attempt would make every retry look like a new
         * event — which is exactly the failure the header exists to prevent, and
         * it is invisible from our side because our logs would say "delivered".
         *
         * Same derivation discipline as `SideEffectGuard.keyFor` and
         * `RunWait.keyFor`: no timestamps, no attempt counters, no random ids
         * (invariant 2).
         */
        fun keyFor(runId: UUID, targetId: UUID, sequence: Int): String {
            val material = "$runId|$targetId|$sequence"
            val digest = MessageDigest.getInstance("SHA-256").digest(material.toByteArray())
            return "dlv_" + digest.joinToString("") { "%02x".format(it) }.take(40)
        }
    }
}

/**
 * When to try again.
 *
 * ── EXPONENTIAL, JITTERED, AND CAPPED ───────────────────────────────────────
 * Exponential because a receiver that is down stays down for minutes, not
 * milliseconds, and hammering it is both rude and useless. Jittered because
 * every delivery for a fan-out of two hundred runs was created in the same
 * second, so an unjittered backoff synchronises them into two hundred
 * simultaneous requests at every step — which is how a receiver that was
 * recovering goes back down. Capped because doubling past an hour turns "we
 * will keep trying" into "we will try tomorrow".
 *
 * FULL jitter, not equal: `random(0, backoff)`. Equal jitter halves the spread
 * and still leaves a synchronised floor, and the floor is what a recovering
 * receiver feels.
 */
object DeliveryBackoff {

    /** First retry lands ~15s out, which is long enough for a restart. */
    val BASE: Duration = Duration.ofSeconds(15)

    /** Past an hour, the spacing stops being useful information. */
    val CAP: Duration = Duration.ofHours(1)

    fun nextDelay(attempt: Int, random: Random = Random.Default): Duration {
        val exponent = (attempt - 1).coerceIn(0, 12)
        val ceiling = min(BASE.toMillis() shl exponent, CAP.toMillis())
        /* At least a second: a jitter that can return zero would let a receiver
           returning 500 instantly be hit as fast as the dispatcher can loop. */
        return Duration.ofMillis(random.nextLong(1_000, ceiling.coerceAtLeast(2_000)))
    }

    /**
     * Roughly how long [maxAttempts] takes to give up.
     *
     * Shown next to the retry policy in the UI, because "8 attempts" tells
     * nobody whether their endpoint has five minutes or five hours to come back.
     */
    fun horizonFor(maxAttempts: Int): Duration {
        var total = 0L
        for (attempt in 1..maxAttempts) {
            total += min(BASE.toMillis() shl (attempt - 1).coerceIn(0, 12), CAP.toMillis()) / 2
        }
        return Duration.ofMillis(total)
    }
}
