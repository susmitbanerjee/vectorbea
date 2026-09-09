package com.vectorbea.api.webhook

import java.time.Instant
import java.util.Base64
import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec
import kotlin.test.Test
import kotlin.test.assertContains
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertIs
import kotlin.test.assertTrue

/**
 * The five signature schemes, each against a signature built the way its sender
 * builds one.
 *
 * ── WHY EACH ARM NEEDS ITS OWN TEST ─────────────────────────────────────────
 * The failure this guards against is not "the HMAC is wrong". It is a single
 * generic implementation that looks right and rejects four of the five senders
 * — hex where Shopify sends base64, the body alone where Stripe signs
 * `"$timestamp.$body"`, the first signature where Svix sends several during a
 * rotation. Every one of those reads to whoever is wiring it up as "wrong
 * secret", and every one of them is a long afternoon.
 *
 * So each test signs the way the vendor documents, and the assertion is that we
 * accept THAT.
 */
class SignatureVerifierTest {

    private val secret = "whsec_test_secret_value_0123456789"
    private val body = """{"id":"evt_1","type":"charge.succeeded","data":{"amount":2500}}"""
    private val now = Instant.parse("2026-01-01T12:00:00Z")

    private fun hmacHex(key: String, material: String): String =
        hmacBytes(key.toByteArray(), material).joinToString("") { "%02x".format(it) }

    private fun hmacBytes(key: ByteArray, material: String): ByteArray =
        Mac.getInstance("HmacSHA256").apply { init(SecretKeySpec(key, "HmacSHA256")) }
            .doFinal(material.toByteArray())

    private fun verify(
        scheme: String,
        headers: Map<String, String>,
        tolerance: Int = 300,
        at: Instant = now,
        secretOverride: String? = null,
    ) = SignatureVerifier.verify(
        scheme = scheme, rawBody = body, headers = headers,
        secret = secretOverride ?: secret,
        signatureHeader = null, timestampHeader = null,
        toleranceSeconds = tolerance, now = at,
    )

    // ── GitHub ───────────────────────────────────────────────────────────────

    @Test
    fun `github signs the raw body with a sha256 prefix`() {
        val result = verify("github", mapOf(
            "x-hub-signature-256" to "sha256=" + hmacHex(secret, body)))
        assertIs<SignatureVerifier.Result.Valid>(result)
    }

    @Test
    fun `github rejects a signature over a different body`() {
        val result = verify("github", mapOf(
            "x-hub-signature-256" to "sha256=" + hmacHex(secret, body + " ")))
        assertIs<SignatureVerifier.Result.Invalid>(result,
            "a signature over a modified body was accepted, which is the whole point " +
                "of signing rather than sharing a token")
    }

    @Test
    fun `github has no timestamp, so a replay is not caught here`() {
        /*
         * Documented, not accidental. GitHub sends no timestamp, so there is
         * nothing to bound freshness against and no amount of tolerance
         * configuration changes that. The defence is the delivery id and the
         * dedup index on it — which is why `dedupeHeader` matters more for GitHub
         * than for any other sender.
         */
        val old = verify("github",
            mapOf("x-hub-signature-256" to "sha256=" + hmacHex(secret, body)),
            at = now.plusSeconds(86_400))
        assertIs<SignatureVerifier.Result.Valid>(old)
    }

    // ── Stripe ───────────────────────────────────────────────────────────────

    @Test
    fun `stripe signs the timestamp and the body together`() {
        val t = now.epochSecond
        val result = verify("stripe", mapOf(
            "stripe-signature" to "t=$t,v1=" + hmacHex(secret, "$t.$body")))
        assertIs<SignatureVerifier.Result.Valid>(result)
    }

    @Test
    fun `a stripe signature over the body alone is refused`() {
        /* The mistake a generic implementation makes. It produces a valid-looking
           HMAC that Stripe would never send, and accepting it would mean a
           forged timestamp changes nothing. */
        val t = now.epochSecond
        val result = verify("stripe", mapOf(
            "stripe-signature" to "t=$t,v1=" + hmacHex(secret, body)))
        assertIs<SignatureVerifier.Result.Invalid>(result)
    }

    @Test
    fun `stripe accepts any of several v1 signatures, as sent during a rotation`() {
        val t = now.epochSecond
        val old = hmacHex("old_secret", "$t.$body")
        val current = hmacHex(secret, "$t.$body")
        val result = verify("stripe", mapOf(
            "stripe-signature" to "t=$t,v1=$old,v1=$current"))
        assertIs<SignatureVerifier.Result.Valid>(result,
            "only the first v1 signature was checked, so every secret rotation would " +
                "drop deliveries until the sender finished switching over")
    }

    @Test
    fun `a correctly signed but old stripe delivery is stale, not invalid`() {
        val t = now.minusSeconds(3_600).epochSecond
        val result = verify("stripe", mapOf(
            "stripe-signature" to "t=$t,v1=" + hmacHex(secret, "$t.$body")))
        val stale = assertIs<SignatureVerifier.Result.Stale>(result,
            "a replay of a real, correctly signed delivery was treated the same as a " +
                "forgery — the delivery log then cannot tell an attack from a clock")
        assertEquals(300, stale.toleranceSeconds)
    }

    @Test
    fun `a stripe timestamp far in the future is refused too`() {
        /* As suspicious as one in the past, and it is what a replayer produces
           after guessing at clock skew. Allowing it gives an unbounded window. */
        val t = now.plusSeconds(3_600).epochSecond
        val result = verify("stripe", mapOf(
            "stripe-signature" to "t=$t,v1=" + hmacHex(secret, "$t.$body")))
        assertIs<SignatureVerifier.Result.Stale>(result)
    }

    // ── Slack ────────────────────────────────────────────────────────────────

    @Test
    fun `slack signs v0 colon timestamp colon body`() {
        val t = now.epochSecond
        val result = verify("slack", mapOf(
            "x-slack-signature" to "v0=" + hmacHex(secret, "v0:$t:$body"),
            "x-slack-request-timestamp" to t.toString()))
        assertIs<SignatureVerifier.Result.Valid>(result)
    }

    // ── Shopify ──────────────────────────────────────────────────────────────

    @Test
    fun `shopify signs in base64, not hex`() {
        val expected = Base64.getEncoder().encodeToString(hmacBytes(secret.toByteArray(), body))
        val result = verify("shopify", mapOf("x-shopify-hmac-sha256" to expected))
        assertIs<SignatureVerifier.Result.Valid>(result)
    }

    @Test
    fun `a hex digest is not accepted for shopify`() {
        /* The encoding IS the bug worth catching: a hex comparison against a
           base64 signature fails every delivery and reads as a wrong secret. */
        val result = verify("shopify", mapOf(
            "x-shopify-hmac-sha256" to hmacHex(secret, body)))
        assertIs<SignatureVerifier.Result.Invalid>(result)
    }

    // ── Svix ─────────────────────────────────────────────────────────────────

    @Test
    fun `svix signs id dot timestamp dot body with the decoded secret`() {
        val keyBytes = ByteArray(32) { it.toByte() }
        val whsec = "whsec_" + Base64.getEncoder().encodeToString(keyBytes)
        val id = "msg_2abc"
        val t = now.epochSecond
        val sig = Base64.getEncoder().encodeToString(hmacBytes(keyBytes, "$id.$t.$body"))

        val result = SignatureVerifier.verify(
            scheme = "svix", rawBody = body,
            headers = mapOf(
                "webhook-id" to id,
                "webhook-timestamp" to t.toString(),
                "webhook-signature" to "v1,$sig"),
            secret = whsec, signatureHeader = null, timestampHeader = null,
            toleranceSeconds = 300, now = now)
        assertIs<SignatureVerifier.Result.Valid>(result)
    }

    @Test
    fun `svix accepts the second of several space-separated signatures`() {
        val keyBytes = ByteArray(32) { it.toByte() }
        val whsec = "whsec_" + Base64.getEncoder().encodeToString(keyBytes)
        val id = "msg_2abc"
        val t = now.epochSecond
        val good = Base64.getEncoder().encodeToString(hmacBytes(keyBytes, "$id.$t.$body"))
        val other = Base64.getEncoder().encodeToString(hmacBytes(ByteArray(32), "$id.$t.$body"))

        val result = SignatureVerifier.verify(
            scheme = "svix", rawBody = body,
            headers = mapOf(
                "webhook-id" to id,
                "webhook-timestamp" to t.toString(),
                "webhook-signature" to "v1,$other v1,$good"),
            secret = whsec, signatureHeader = null, timestampHeader = null,
            toleranceSeconds = 300, now = now)
        assertIs<SignatureVerifier.Result.Valid>(result,
            "only the first signature was checked. Svix sends several during a secret " +
                "rotation, so this drops deliveries for the whole rotation window.")
    }

    // ── The generic scheme, and the configuration mistakes around it ─────────

    @Test
    fun `the generic scheme reads the header the webhook names`() {
        val result = SignatureVerifier.verify(
            scheme = "hmac_sha256", rawBody = body,
            headers = mapOf("x-acme-signature" to hmacHex(secret, body)),
            secret = secret, signatureHeader = "X-Acme-Signature",
            timestampHeader = null, toleranceSeconds = 0, now = now)
        assertIs<SignatureVerifier.Result.Valid>(result)
    }

    @Test
    fun `a configured scheme with no secret refuses rather than passing`() {
        /*
         * The most dangerous available failure: an endpoint that quietly stops
         * checking when its secret goes missing, while the UI still says it is
         * protected. Refusing is the only safe reading.
         */
        val result = SignatureVerifier.verify(
            scheme = "github", rawBody = body,
            headers = mapOf("x-hub-signature-256" to "sha256=whatever"),
            secret = null, signatureHeader = null, timestampHeader = null,
            toleranceSeconds = 300, now = now)
        val invalid = assertIs<SignatureVerifier.Result.Invalid>(result)
        assertContains(invalid.reason, "secret")
    }

    @Test
    fun `none accepts anything, which is what it is for`() {
        val result = SignatureVerifier.verify(
            scheme = "none", rawBody = body, headers = emptyMap(), secret = null,
            signatureHeader = null, timestampHeader = null,
            toleranceSeconds = 300, now = now)
        assertIs<SignatureVerifier.Result.Valid>(result)
    }

    // ── Storage ──────────────────────────────────────────────────────────────

    @Test
    fun `the signature header never reaches the delivery log`() {
        /*
         * Invariant 4, applied here. A stored signature is a replayable proof of
         * possession for that exact body, and the delivery log is read in support
         * sessions on shared screens.
         */
        val sanitized = SignatureVerifier.sanitizeHeaders(mapOf(
            "x-hub-signature-256" to "sha256=deadbeef",
            "stripe-signature" to "t=1,v1=deadbeef",
            "authorization" to "Bearer secret",
            "x-github-event" to "pull_request",
            "content-type" to "application/json",
        ))

        assertEquals(setOf("x-github-event", "content-type"), sanitized.keys,
            "a credential-bearing header survived into the delivery log")
        assertEquals("pull_request", sanitized["x-github-event"],
            "the headers worth debugging were dropped along with the credentials")
    }

    @Test
    fun `comparison does not short-circuit on the first differing byte`() {
        /* Not a timing measurement — those are flaky. The assertion is that the
           function is used at all and behaves as an equality, which is what
           `MessageDigest.isEqual` over digests provides. */
        assertTrue(SignatureVerifier.constantTimeEquals("abc", "abc"))
        assertFalse(SignatureVerifier.constantTimeEquals("abc", "abd"))
        assertFalse(SignatureVerifier.constantTimeEquals("abc", "abcd"))
    }
}
