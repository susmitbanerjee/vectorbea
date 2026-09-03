package com.vectorbea.worker.net

import java.security.MessageDigest

/**
 * The identity of the thing a provider actually rate-limits.
 *
 * ── WHY THE BUCKET WAS KEYED WRONG ──────────────────────────────────────────
 * It was keyed `(provider, model, workspace_id)`, on the reasoning that "a
 * provider limit is usually per API key and a key is usually per workspace".
 * The second half of that is an assumption, not a fact, and nothing enforces it:
 * `connections` has no uniqueness constraint on the credential, and a customer
 * running several workspaces against one provider account is the ordinary case.
 *
 * When it does not hold, a per-workspace bucket cannot bound the aggregate. N
 * workspaces each sitting at 90% of their own limit is 90N% of the account's, and
 * every one of them believes it is behaving.
 *
 * So the ceiling is keyed on the CREDENTIAL — the thing the provider counts
 * against — and workspace fairness moves inside it as a second layer.
 *
 * ── WHEN THE TWO LAYERS COLLAPSE ────────────────────────────────────────────
 * If every workspace genuinely has its own credential, every fingerprint is
 * distinct, each account bucket has exactly one workspace in it, and the account
 * ceiling and the workspace share are the same number. The second layer is then
 * free — it is not a layer that does nothing, it is a layer whose input happens
 * to be one. Nothing needs configuring for that case and nothing needs disabling.
 *
 * ── WHY A HASH AND NOT THE CONNECTION ID ────────────────────────────────────
 * Two workspaces sharing one API key have two `connections` rows with two ids.
 * The id identifies our record of the credential; the hash identifies the
 * credential. Only the second is what the provider sees.
 *
 * ── THE KEY MATERIAL NEVER LEAVES THIS FUNCTION ─────────────────────────────
 * The plaintext is already in memory at the call site — it has to be, it is about
 * to become an Authorization header — and it is handled here as a `CharArray`
 * that is never copied into a String, never logged and never stored. What leaves
 * is 12 hex characters of a salted SHA-256, which is enough to separate accounts
 * and not enough to confirm a guessed key: the salt is per-process and random, so
 * the same credential fingerprints differently in every worker.
 *
 * That last property is deliberate and has a cost worth stating: fingerprints are
 * NOT comparable across processes, so the Redis bucket for one account is shared
 * only among workers that agree on the salt. See [Salt].
 */
object CredentialKey {

    /**
     * The salt.
     *
     * ── WHY THIS IS CONFIGURED AND NOT RANDOM ───────────────────────────────
     * A per-process random salt would make the fingerprint unguessable and the
     * bucket useless: every worker would compute a different key for the same
     * account and the shared ceiling would silently become a per-worker one —
     * the exact bug this class exists to fix, reintroduced by a security measure.
     *
     * So it is deployment-wide (`PROVIDER_CAPACITY_SALT`), which makes the
     * fingerprint stable across the fleet and still not reversible without it.
     * Defaulting to a fixed string rather than refusing to start: an operator who
     * has not set it gets correct rate limiting with a weaker fingerprint, which
     * is the right trade for a value that never leaves our own Redis. The log
     * line says so once, at startup, rather than per call.
     */
    private val salt: ByteArray by lazy {
        val configured = System.getenv("PROVIDER_CAPACITY_SALT")?.takeIf { it.isNotBlank() }
        (configured ?: DEFAULT_SALT).toByteArray(Charsets.UTF_8)
    }

    /** True when the salt is the built-in default, for the startup log line. */
    val usingDefaultSalt: Boolean
        get() = System.getenv("PROVIDER_CAPACITY_SALT").isNullOrBlank()

    private const val DEFAULT_SALT = "vectorbea-provider-capacity-v1"

    /**
     * Fingerprint of an API key. 12 hex characters.
     *
     * Twelve is 48 bits — collision-free for any realistic number of distinct
     * credentials, and short enough that the Redis key stays readable when
     * somebody is looking at it during an incident.
     */
    fun fingerprint(apiKey: CharArray): String {
        val md = MessageDigest.getInstance("SHA-256")
        md.update(salt)
        /*
         * Encode the chars WITHOUT going through a String. A String would be
         * interned in the constant pool's memory for an unbounded time and is not
         * clearable; the byte array here is wiped before returning.
         */
        val bytes = ByteArray(apiKey.size * 2)
        for (i in apiKey.indices) {
            bytes[i * 2] = (apiKey[i].code shr 8).toByte()
            bytes[i * 2 + 1] = apiKey[i].code.toByte()
        }
        md.update(bytes)
        java.util.Arrays.fill(bytes, 0)
        return md.digest().take(6).joinToString("") { "%02x".format(it) }
    }

    /**
     * The fingerprint for a connection with no resolvable credential.
     *
     * Not a random value and not an exception: a connection whose secret could
     * not be read is about to fail its call anyway, and giving every such call the
     * same bucket keeps them from each creating a key of their own.
     */
    const val UNKNOWN = "no-credential"
}
