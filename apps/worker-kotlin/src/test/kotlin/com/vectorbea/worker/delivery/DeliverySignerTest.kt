package com.vectorbea.worker.delivery

import java.time.Duration
import java.time.Instant
import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/**
 * The signature a receiver verifies, and the retry schedule behind it.
 *
 * ── THE FIXTURE IS SHARED WITH THE SDK ──────────────────────────────────────
 * `apps/web/__tests__/delivery-signature.test.ts` pins the SAME secret, the
 * SAME body and the SAME signed material. Two implementations of one scheme
 * drift silently: the sender keeps working, the receiver keeps rejecting, and
 * it reaches us as "your webhooks are broken" weeks later. With one vector on
 * both sides, a change to either fails a test instead of a customer.
 *
 * The acceptance criterion asks for signature verification documented with a
 * working example in each SDK. This is the half that makes "working" checkable.
 */
class DeliverySignerTest {

    private companion object {
        /** Shared with `delivery-signature.test.ts`. Change both or neither. */
        const val SECRET = "whsec_test_delivery_secret_0123456789"
        const val TIMESTAMP = 1_767_225_600L  // 2026-01-01T00:00:00Z

        /**
         * Byte-identical to the SDK test's `FIXTURE.body`.
         *
         * Written as a literal rather than serialised, because what the two
         * languages must agree on is the exact bytes — and a Jackson version
         * that reorders keys would silently change what is being asserted.
         */
        const val BODY = """{"deliveryId":"11111111-1111-4111-8111-111111111111",""" +
            """"idempotencyKey":"dlv_0123456789abcdef",""" +
            """"runId":"22222222-2222-4222-8222-222222222222",""" +
            """"status":"succeeded","partial":false,"sequence":0,""" +
            """"payloadMode":"full","output":{"answer":42}}"""
    }

    private val at: Instant = Instant.ofEpochSecond(TIMESTAMP)

    private fun hmacHex(secret: String, material: String): String {
        val mac = Mac.getInstance("HmacSHA256")
        mac.init(SecretKeySpec(secret.toByteArray(), "HmacSHA256"))
        return mac.doFinal(material.toByteArray()).joinToString("") { "%02x".format(it) }
    }

    // ── The scheme ───────────────────────────────────────────────────────────

    @Test
    fun `the signature is an hmac over the timestamp and the raw body`() {
        val header = DeliverySigner.signature(BODY, listOf(SECRET), at)
        val expected = hmacHex(SECRET, "$TIMESTAMP.$BODY")

        assertEquals("t=$TIMESTAMP,v1=$expected", header,
            "the header shape changed. `apps/web/__tests__/delivery-signature.test.ts` " +
                "pins the same vector, and a receiver written against either would " +
                "now reject the other.")
    }

    @Test
    fun `the timestamp is inside the signed material, not beside it`() {
        /*
         * The whole reason a freshness check means anything. If the body alone
         * were signed, an attacker replaying a captured delivery could rewrite
         * `t` to now and the signature would still verify — so the check would
         * be rejecting nothing.
         */
        val bodyOnly = hmacHex(SECRET, BODY)
        val header = "t=$TIMESTAMP,v1=$bodyOnly"

        assertFalse(DeliverySigner.verify(BODY, header, SECRET, now = at),
            "a signature over the body alone was accepted, which makes the timestamp " +
                "an attacker-controlled field with no effect")
    }

    @Test
    fun `an altered body fails`() {
        val header = DeliverySigner.signature(BODY, listOf(SECRET), at)
        val tampered = BODY.replace("\"answer\":42", "\"answer\":43")
        assertFalse(DeliverySigner.verify(tampered, header, SECRET, now = at))
    }

    // ── Rotation ─────────────────────────────────────────────────────────────

    @Test
    fun `both secrets sign during a rotation, and either verifies`() {
        /*
         * A rotation is two live secrets, briefly. The receiver has deployed one
         * of them and we do not know which — so both sign, and whichever they
         * hold works. Signing with only the new one drops every delivery until
         * their deploy lands, which is how a signing secret ends up never being
         * rotated at all.
         */
        val header = DeliverySigner.signature(BODY, listOf("old_secret", SECRET), at)

        assertTrue(DeliverySigner.verify(BODY, header, "old_secret", now = at),
            "a receiver still holding the old secret was cut off mid-rotation")
        assertTrue(DeliverySigner.verify(BODY, header, SECRET, now = at),
            "a receiver that has deployed the new secret was cut off")
        assertFalse(DeliverySigner.verify(BODY, header, "never_configured", now = at),
            "an unrelated secret verified, which would mean the signature proves nothing")
    }

    @Test
    fun `one timestamp is shared by every signature in the header`() {
        val header = DeliverySigner.signature(BODY, listOf("a", "b", "c"), at)
        assertEquals(1, header.split(",").count { it.startsWith("t=") },
            "two timestamps would mean two signatures over different material, and a " +
                "receiver with no way to know which one to use")
        assertEquals(3, header.split(",").count { it.startsWith("v1=") })
    }

    // ── Freshness ────────────────────────────────────────────────────────────

    @Test
    fun `a replay outside the window is refused, in both directions`() {
        val header = DeliverySigner.signature(BODY, listOf(SECRET), at)

        assertFalse(DeliverySigner.verify(BODY, header, SECRET, now = at.plusSeconds(3_600)),
            "a captured delivery replayed an hour later was accepted")
        assertFalse(DeliverySigner.verify(BODY, header, SECRET, now = at.minusSeconds(3_600)),
            "a timestamp in the future was accepted, which is what a replayer produces " +
                "after guessing at clock skew")
        assertTrue(DeliverySigner.verify(BODY, header, SECRET, now = at.plusSeconds(60)))
    }

    // ── Headers ──────────────────────────────────────────────────────────────

    @Test
    fun `an unsigned target sends no signature header at all`() {
        /*
         * Not an empty one. An empty `Vectorbea-Signature` looks to a receiver
         * like a signature that failed to compute, which sends them debugging our
         * side of a decision that was theirs.
         */
        val headers = DeliverySigner.headersFor(
            BODY, "dlv_x", "delivery-1", 1, secrets = emptyList(), now = at)
        assertFalse(DeliverySigner.SIGNATURE_HEADER in headers)
        assertTrue(DeliverySigner.IDEMPOTENCY_HEADER in headers,
            "the idempotency key is not a security feature and must be sent regardless — " +
                "an unsigned receiver still has to deduplicate")
    }

    @Test
    fun `the attempt number rides along, so a retry is legible to the receiver`() {
        val headers = DeliverySigner.headersFor(
            BODY, "dlv_x", "delivery-1", attempt = 4, secrets = listOf(SECRET), now = at)
        assertEquals("4", headers[DeliverySigner.ATTEMPT_HEADER])
        assertEquals("dlv_x", headers[DeliverySigner.IDEMPOTENCY_HEADER])
    }

    // ── The retry schedule ───────────────────────────────────────────────────

    @Test
    fun `backoff grows, stays under the cap, and is never instant`() {
        val samples = (1..12).map { DeliveryBackoff.nextDelay(it) }

        assertTrue(samples.all { it >= Duration.ofSeconds(1) },
            "a jittered delay reached zero, which would let a receiver returning 500 " +
                "instantly be hit as fast as the dispatcher can loop")
        assertTrue(samples.all { it <= DeliveryBackoff.CAP },
            "a delay exceeded the cap, which turns 'we will keep trying' into 'we will " +
                "try tomorrow'")

        /* Jitter makes any single pair unordered, so the property is about the
           CEILING rising — which is what spreads a fan-out's retries. Sampled,
           because one draw of a random variable proves nothing. */
        val early = (1..50).maxOf { DeliveryBackoff.nextDelay(1).toMillis() }
        val late = (1..50).maxOf { DeliveryBackoff.nextDelay(8).toMillis() }
        assertTrue(late > early,
            "the backoff does not actually grow: attempt 8 draws from the same range " +
                "as attempt 1, so a receiver that is down is hammered at a fixed rate")
    }

    @Test
    fun `the jitter actually spreads a synchronised fan-out`() {
        /*
         * Two hundred runs finishing together create two hundred deliveries in
         * the same second. Without jitter every retry fires simultaneously at
         * every step — which is how a receiver that was recovering goes back
         * down. The spread is the whole point, so it is asserted rather than
         * assumed.
         */
        val draws = (1..200).map { DeliveryBackoff.nextDelay(5).toMillis() }
        assertTrue(draws.toSet().size > 100,
            "the backoff produced ${draws.toSet().size} distinct delays across 200 " +
                "deliveries; they would arrive at the receiver as one thundering herd")
    }

    // ── The idempotency key ──────────────────────────────────────────────────

    @Test
    fun `the key is derived, so a retry and a redelivery carry the same one`() {
        val runId = java.util.UUID.fromString("22222222-2222-4222-8222-222222222222")
        val targetId = java.util.UUID.fromString("33333333-3333-4333-8333-333333333333")

        assertEquals(
            RunDelivery.keyFor(runId, targetId, 0),
            RunDelivery.keyFor(runId, targetId, 0),
            "the key is not stable, so every retry looks like a new event to the " +
                "receiver — which is exactly what the header exists to prevent, and it " +
                "is invisible from our side because our logs would say 'delivered'.")
    }

    @Test
    fun `a different target or sequence gets a different key`() {
        val runId = java.util.UUID.randomUUID()
        val a = java.util.UUID.randomUUID()
        val b = java.util.UUID.randomUUID()

        assertTrue(RunDelivery.keyFor(runId, a, 0) != RunDelivery.keyFor(runId, b, 0),
            "two targets share a key, so a receiver deduping would drop the second " +
                "target's copy of the same run")
        assertTrue(RunDelivery.keyFor(runId, a, 0) != RunDelivery.keyFor(runId, a, 1),
            "a streamed partial shares its key with the final result, so a receiver " +
                "would discard whichever arrived second")
    }

    @Test
    fun `the key contains no timestamp, attempt count or random component`() {
        /*
         * Invariant 2, applied here. The key is computed fresh on every attempt
         * from `(run, target, sequence)` — nothing that changes between them. A
         * counter or a clock in the material would make the fifteenth retry a
         * new event to the receiver.
         */
        val runId = java.util.UUID.randomUUID()
        val targetId = java.util.UUID.randomUUID()
        val first = RunDelivery.keyFor(runId, targetId, 0)
        Thread.sleep(20)
        assertEquals(first, RunDelivery.keyFor(runId, targetId, 0),
            "the key changed between two computations twenty milliseconds apart, so " +
                "something time-varying is in the material")
        assertTrue(first.startsWith("dlv_"), "the key is not recognisable in a log")
    }
}
