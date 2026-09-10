package com.vectorbea.worker.delivery

import java.security.MessageDigest
import java.time.Instant
import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec

/**
 * Proving a callback came from us.
 *
 * ── THE INVERSE OF `SignatureVerifier`, AND DELIBERATELY THE SAME SHAPE ─────
 * V066 taught Vectorbea to verify five vendors' incoming signatures. This is the
 * outgoing half, and a receiver has exactly the problem we had: an unauthenticated
 * endpoint that starts work, and a body they need to trust.
 *
 * So the scheme is the one that was easiest to verify correctly when we were on
 * the receiving side — Stripe's — rather than a sixth invention:
 *
 *     Vectorbea-Signature: t=<unix>,v1=<hex hmac-sha256>
 *     signed material:     "<t>.<body>"
 *
 * The timestamp is INSIDE the signed material, which is what makes a freshness
 * check meaningful: a forged `t` invalidates the signature, so a receiver
 * rejecting old timestamps is actually rejecting replays rather than trusting a
 * header an attacker controls.
 *
 * ── AND WHY THE HEADER CAN CARRY SEVERAL SIGNATURES ─────────────────────────
 * `v1=` may appear more than once. That is not decoration: during a secret
 * rotation both the old and the new secret sign, so a receiver that has deployed
 * either one keeps working. A rotation that dropped deliveries for the length of
 * the rollout is a rotation nobody performs twice.
 */
object DeliverySigner {

    /** The header a receiver reads. */
    const val SIGNATURE_HEADER = "Vectorbea-Signature"

    /** The key a receiver dedupes on. Same value on every retry and redelivery. */
    const val IDEMPOTENCY_HEADER = "Vectorbea-Idempotency-Key"

    /** Which delivery this is, so a receiver can correlate with our UI. */
    const val DELIVERY_HEADER = "Vectorbea-Delivery-Id"

    /** How many times we have tried, so a receiver can tell a retry from news. */
    const val ATTEMPT_HEADER = "Vectorbea-Attempt"

    /**
     * The signature scheme version.
     *
     * A receiver pins it. When a second scheme exists, both are sent for a
     * window — the same argument as the rotation above, applied to the algorithm
     * rather than the key.
     */
    const val VERSION = "v1"

    /**
     * The headers that go on a delivery request.
     *
     * @param secrets the signing secrets, current first. More than one during a
     *   rotation; empty when the target is unsigned, in which case no signature
     *   header is produced at all rather than an empty one — an empty
     *   `Vectorbea-Signature` would look to a receiver like a signature that
     *   failed to compute.
     */
    fun headersFor(
        body: String,
        idempotencyKey: String,
        deliveryId: String,
        attempt: Int,
        secrets: List<String>,
        now: Instant = Instant.now(),
    ): Map<String, String> = buildMap {
        put(IDEMPOTENCY_HEADER, idempotencyKey)
        put(DELIVERY_HEADER, deliveryId)
        put(ATTEMPT_HEADER, attempt.toString())
        put("Content-Type", "application/json; charset=utf-8")
        put("User-Agent", "Vectorbea/1.0 (+https://vectorbea.com)")

        val live = secrets.filter { it.isNotBlank() }
        if (live.isNotEmpty()) {
            put(SIGNATURE_HEADER, signature(body, live, now))
        }
    }

    /**
     * `t=<unix>,v1=<hex>[,v1=<hex>…]`
     *
     * The timestamp appears once and is shared by every signature, because it is
     * part of what each one signs — two timestamps would mean two signatures over
     * different material and a receiver with no way to know which `t` to use.
     */
    fun signature(body: String, secrets: List<String>, now: Instant = Instant.now()): String {
        val t = now.epochSecond
        val material = "$t.$body"
        return buildString {
            append("t=").append(t)
            for (secret in secrets) {
                append(",").append(VERSION).append("=").append(hmacHex(secret, material))
            }
        }
    }

    /**
     * Verify a signature we produced.
     *
     * Here so the SDK's implementation has something to be checked against, and
     * so the documented example is executed rather than described — the
     * acceptance criterion is a WORKING example, and an example nobody runs
     * drifts from the code within one release.
     */
    fun verify(
        body: String,
        header: String,
        secret: String,
        toleranceSeconds: Long = 300,
        now: Instant = Instant.now(),
    ): Boolean {
        val parts = header.split(",").mapNotNull {
            val kv = it.trim().split("=", limit = 2)
            if (kv.size == 2) kv[0] to kv[1] else null
        }
        val t = parts.firstOrNull { it.first == "t" }?.second?.toLongOrNull() ?: return false
        if (toleranceSeconds > 0 && kotlin.math.abs(now.epochSecond - t) > toleranceSeconds) {
            return false
        }
        val expected = hmacHex(secret, "$t.$body")
        return parts.filter { it.first == VERSION }
            .any { constantTimeEquals(it.second, expected) }
    }

    private fun hmacHex(secret: String, material: String): String {
        val mac = Mac.getInstance("HmacSHA256")
        mac.init(SecretKeySpec(secret.toByteArray(), "HmacSHA256"))
        return mac.doFinal(material.toByteArray()).joinToString("") { "%02x".format(it) }
    }

    /**
     * Compare without leaking where the difference is.
     *
     * The same reasoning as the inbound verifier: `==` returns at the first
     * differing byte, and over enough requests that recovers a signature. Ours is
     * the reference implementation an SDK is checked against, so it has to be
     * the version worth copying.
     */
    fun constantTimeEquals(a: String, b: String): Boolean = MessageDigest.isEqual(
        MessageDigest.getInstance("SHA-256").digest(a.toByteArray()),
        MessageDigest.getInstance("SHA-256").digest(b.toByteArray()),
    )
}
