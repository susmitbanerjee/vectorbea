package com.vectorbea.api.webhook

import org.slf4j.LoggerFactory
import java.security.MessageDigest
import java.time.Instant
import java.util.Base64
import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec

/**
 * Proving a webhook delivery came from who it says it did.
 *
 * ── WHY THIS IS NOT ONE HMAC FUNCTION ───────────────────────────────────────
 * Every major sender signs differently, and the differences are not cosmetic —
 * they decide what an attacker can do:
 *
 *   GitHub    `sha256=<hex>` over the raw body. No timestamp, so a captured
 *             delivery is replayable forever; the delivery id is the only
 *             defence and it is ours to enforce, not theirs.
 *   Stripe    `t=<unix>,v1=<hex>` over `"$t.$body"`. The timestamp is INSIDE
 *             the signed material, which is what makes the freshness check
 *             meaningful — a forged `t` invalidates the signature.
 *   Slack     `v0=<hex>` over `"v0:$t:$body"`. Same idea, different spelling.
 *   Shopify   Base64, not hex. A hex comparison against it fails every time
 *             and looks like a wrong secret.
 *   Svix      `v1,<base64>` over `"$id.$t.$body"`, and the header may carry
 *             SEVERAL space-separated signatures during a secret rotation.
 *             Accepting only the first breaks every rotation.
 *
 * A single "generic HMAC" would therefore reject four of these five while
 * looking correct, and the failure reads as "wrong secret" to whoever is
 * setting it up. So each scheme is its own arm, named after the sender, and the
 * error says which scheme was applied.
 *
 * ── AND EVERY COMPARISON IS CONSTANT-TIME ───────────────────────────────────
 * `==` on strings returns as soon as it finds a differing byte. Over enough
 * requests that timing difference recovers a signature byte by byte, and this
 * endpoint is unauthenticated and rate-limited per token, not per attempt.
 */
object SignatureVerifier {

    private val log = LoggerFactory.getLogger(SignatureVerifier::class.java)

    /** The verdict, in the words the delivery log stores. */
    sealed interface Result {
        data object Valid : Result

        /** The signature did not match. The message is deliberately vague to the sender. */
        data class Invalid(val reason: String) : Result

        /** Correctly signed, but too old — a replay of a real delivery. */
        data class Stale(val ageSeconds: Long, val toleranceSeconds: Int) : Result
    }

    /**
     * @param rawBody the body EXACTLY as received. Re-serializing a parsed body
     *   changes whitespace and key order and breaks every signature; the caller
     *   must pass the bytes off the wire.
     */
    fun verify(
        scheme: String,
        rawBody: String,
        headers: Map<String, String>,
        secret: String?,
        signatureHeader: String?,
        timestampHeader: String?,
        toleranceSeconds: Int,
        now: Instant = Instant.now(),
    ): Result {
        if (scheme == "none") return Result.Valid

        if (secret.isNullOrBlank()) {
            /*
             * Configured to verify, with nothing to verify against. This is a
             * refusal, not a pass: an endpoint that silently stops checking when
             * its secret goes missing is worse than one that never checked, because
             * the UI still says it is protected.
             */
            return Result.Invalid("no signing secret is configured for this webhook")
        }

        return when (scheme) {
            "github" -> github(rawBody, headers, secret)
            "stripe" -> stripe(rawBody, headers, secret, toleranceSeconds, now)
            "slack" -> slack(rawBody, headers, secret, toleranceSeconds, now)
            "shopify" -> shopify(rawBody, headers, secret)
            "svix" -> svix(rawBody, headers, secret, toleranceSeconds, now)
            "hmac_sha256" -> generic(
                rawBody, headers, secret, signatureHeader, timestampHeader, toleranceSeconds, now)
            else -> Result.Invalid("unknown signature scheme '$scheme'")
        }
    }

    // ── Per-sender schemes ───────────────────────────────────────────────────

    private fun github(body: String, headers: Map<String, String>, secret: String): Result {
        val sent = headers["x-hub-signature-256"]
            ?: return Result.Invalid("X-Hub-Signature-256 is missing")
        val expected = "sha256=" + hmacHex(secret, body)
        return if (constantTimeEquals(sent, expected)) Result.Valid
        else Result.Invalid("the X-Hub-Signature-256 value does not match")
    }

    private fun stripe(
        body: String, headers: Map<String, String>, secret: String,
        tolerance: Int, now: Instant,
    ): Result {
        val header = headers["stripe-signature"]
            ?: return Result.Invalid("Stripe-Signature is missing")
        /* `t=...,v1=...,v1=...` — several v1 entries during a rotation, and the
           delivery is valid if ANY of them matches. */
        val parts = header.split(",").mapNotNull {
            val kv = it.trim().split("=", limit = 2)
            if (kv.size == 2) kv[0] to kv[1] else null
        }
        val timestamp = parts.firstOrNull { it.first == "t" }?.second?.toLongOrNull()
            ?: return Result.Invalid("Stripe-Signature has no timestamp")
        val candidates = parts.filter { it.first == "v1" }.map { it.second }
        if (candidates.isEmpty()) return Result.Invalid("Stripe-Signature has no v1 signature")

        val expected = hmacHex(secret, "$timestamp.$body")
        if (candidates.none { constantTimeEquals(it, expected) }) {
            return Result.Invalid("no v1 signature in Stripe-Signature matches")
        }
        return freshness(timestamp, tolerance, now)
    }

    private fun slack(
        body: String, headers: Map<String, String>, secret: String,
        tolerance: Int, now: Instant,
    ): Result {
        val sent = headers["x-slack-signature"]
            ?: return Result.Invalid("X-Slack-Signature is missing")
        val timestamp = headers["x-slack-request-timestamp"]?.toLongOrNull()
            ?: return Result.Invalid("X-Slack-Request-Timestamp is missing or not a number")
        val expected = "v0=" + hmacHex(secret, "v0:$timestamp:$body")
        if (!constantTimeEquals(sent, expected)) {
            return Result.Invalid("the X-Slack-Signature value does not match")
        }
        return freshness(timestamp, tolerance, now)
    }

    private fun shopify(body: String, headers: Map<String, String>, secret: String): Result {
        val sent = headers["x-shopify-hmac-sha256"]
            ?: return Result.Invalid("X-Shopify-Hmac-Sha256 is missing")
        // Base64, not hex. A hex comparison here fails every delivery and reads
        // as a wrong secret, which is a long afternoon for whoever is wiring it.
        val expected = Base64.getEncoder().encodeToString(hmacBytes(secret, body))
        return if (constantTimeEquals(sent, expected)) Result.Valid
        else Result.Invalid("the X-Shopify-Hmac-Sha256 value does not match")
    }

    private fun svix(
        body: String, headers: Map<String, String>, secret: String,
        tolerance: Int, now: Instant,
    ): Result {
        val id = headers["webhook-id"] ?: return Result.Invalid("webhook-id is missing")
        val timestamp = headers["webhook-timestamp"]?.toLongOrNull()
            ?: return Result.Invalid("webhook-timestamp is missing or not a number")
        val sent = headers["webhook-signature"]
            ?: return Result.Invalid("webhook-signature is missing")

        /* The secret is `whsec_<base64>`; the bytes are what signs, not the
           string. Signing the string produces a stable, wrong answer. */
        val key = secret.removePrefix("whsec_")
        val keyBytes = runCatching { Base64.getDecoder().decode(key) }
            .getOrElse { return Result.Invalid("the signing secret is not valid base64") }

        val expected = Base64.getEncoder().encodeToString(
            hmacBytes(keyBytes, "$id.$timestamp.$body"))

        /* Space-separated `v1,<sig>` entries — more than one during a rotation,
           and rejecting all but the first breaks every rotation. */
        val matched = sent.split(" ").any { entry ->
            val value = entry.substringAfter(",", missingDelimiterValue = "")
            value.isNotEmpty() && constantTimeEquals(value, expected)
        }
        if (!matched) return Result.Invalid("no signature in webhook-signature matches")
        return freshness(timestamp, tolerance, now)
    }

    /**
     * Our own scheme, for a sender that does not have one of the above.
     *
     * The timestamp is optional and only checked when the webhook names a header
     * for it — a sender that does not send one cannot be held to a freshness
     * bound, and pretending otherwise would reject every delivery.
     */
    private fun generic(
        body: String, headers: Map<String, String>, secret: String,
        signatureHeader: String?, timestampHeader: String?,
        tolerance: Int, now: Instant,
    ): Result {
        val headerName = (signatureHeader ?: "x-signature").lowercase()
        val sent = headers[headerName]
            ?: return Result.Invalid("$headerName is missing")

        val timestamp = timestampHeader?.lowercase()?.let { headers[it]?.toLongOrNull() }
        /* Signed material includes the timestamp when there is one, so a forged
           timestamp fails the signature rather than merely the freshness check. */
        val material = if (timestamp != null) "$timestamp.$body" else body
        val expected = hmacHex(secret, material)

        // Accept a bare hex digest or a `sha256=` prefix, because both are common
        // and the difference is not something a sender will change for us.
        val normalised = sent.substringAfter("=", missingDelimiterValue = sent)
        if (!constantTimeEquals(normalised, expected)) {
            return Result.Invalid("the $headerName value does not match")
        }
        return if (timestamp != null) freshness(timestamp, tolerance, now) else Result.Valid
    }

    // ── Shared ───────────────────────────────────────────────────────────────

    /**
     * A correctly-signed delivery that is too old.
     *
     * Both directions are checked. A timestamp far in the FUTURE is as suspicious
     * as one far in the past — it is what a replayer produces after guessing at
     * clock skew — and allowing it would give an attacker an unbounded window.
     */
    private fun freshness(epochSeconds: Long, tolerance: Int, now: Instant): Result {
        if (tolerance <= 0) return Result.Valid
        val age = now.epochSecond - epochSeconds
        return if (kotlin.math.abs(age) <= tolerance) Result.Valid
        else Result.Stale(age, tolerance)
    }

    private fun hmacHex(secret: String, material: String): String =
        hmacBytes(secret, material).joinToString("") { "%02x".format(it) }

    private fun hmacBytes(secret: String, material: String): ByteArray =
        hmacBytes(secret.toByteArray(), material)

    private fun hmacBytes(key: ByteArray, material: String): ByteArray {
        val mac = Mac.getInstance("HmacSHA256")
        mac.init(SecretKeySpec(key, "HmacSHA256"))
        return mac.doFinal(material.toByteArray())
    }

    /**
     * Compare without leaking where the difference is.
     *
     * `MessageDigest.isEqual` is constant-time for equal-length inputs and is the
     * JDK's own answer to this. The lengths are hashed first so that unequal
     * lengths do not short-circuit either — a length oracle is a smaller leak
     * than a content oracle, but it is still one.
     */
    fun constantTimeEquals(a: String, b: String): Boolean {
        val ha = MessageDigest.getInstance("SHA-256").digest(a.toByteArray())
        val hb = MessageDigest.getInstance("SHA-256").digest(b.toByteArray())
        return MessageDigest.isEqual(ha, hb)
    }

    /**
     * Headers safe to store in a delivery log.
     *
     * Invariant 4: sanitization happens once, at the write boundary. A delivery
     * log is read in a support session on a shared screen, and the signature
     * header is the one thing in a webhook request that is a credential — it
     * proves possession of the secret for that exact body, and a stored copy is
     * a replayable token for anyone who can read the table.
     */
    fun sanitizeHeaders(headers: Map<String, String>): Map<String, String> =
        headers.filterKeys { it.lowercase() !in SENSITIVE_HEADERS }
            .mapValues { (_, v) -> v.take(1_000) }

    private val SENSITIVE_HEADERS = setOf(
        "authorization", "proxy-authorization", "cookie", "set-cookie",
        "x-hub-signature", "x-hub-signature-256", "stripe-signature",
        "x-slack-signature", "x-shopify-hmac-sha256", "webhook-signature",
        "x-signature", "x-webhook-signature", "x-api-key",
    )
}
