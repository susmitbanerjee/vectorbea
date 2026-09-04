package com.vectorbea.crypto

/*
 * COMPILED BY BOTH SERVICES, and that is the point.
 *
 * The API writes these tokens; the worker reads them at run time. While each had
 * its own implementation the two could disagree about the wire format, and the
 * failure mode of disagreeing is total: every credential in the product becomes
 * undecryptable at the moment a workflow needs it, with the connection page
 * still reporting them healthy because the API can read its own output perfectly
 * well. The worker's copy stripped the `v1:` prefix with `indexOf(':')` and
 * decrypted the remainder, which happened to work for exactly one format and
 * silently broke the moment a second one existed.
 *
 * `api-kotlin/build.gradle.kts` adds this directory as a source root, as it does
 * for the contract language and the database catalogue.
 */

import java.security.SecureRandom
import java.util.Base64
import javax.crypto.Cipher
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec

/**
 * AES-256-GCM authenticated encryption.
 *
 * Wire formats (Base64-URL-no-pad encoded):
 *   v{keyVersion}:{blob}        format 1 — legacy, no associated data
 *   v{keyVersion}:a:{blob}      format 2 — blob is BOUND to associated data
 *   where blob = base64url(iv || ciphertext || authTag)
 *
 * IV:       12 bytes (96-bit) randomly generated per encryption
 * Key:      32 bytes (256-bit) — supplied externally, never stored here
 * Auth tag: 128-bit (GCM default)
 *
 * WHY ASSOCIATED DATA — THE ATTACK IT CLOSES.
 *
 * GCM's tag proves the ciphertext was not altered. It says NOTHING about where
 * that ciphertext is supposed to live. Format 1 blobs are therefore portable:
 * anybody who can write a row — a SQL-injection foothold, a restore from the
 * wrong backup, an operator with a psql prompt, a bug in a migration — can copy
 * tenant A's encrypted OpenAI key into tenant B's `encrypted_secrets` row, and
 * it decrypts perfectly, because it IS a valid ciphertext under the one master
 * key the whole table shares.
 *
 * `findByIdScoped` already stops tenant B ASKING for tenant A's secret by id.
 * It cannot stop a blob that has been moved into tenant B's own row, because at
 * that point every check the application performs is satisfied.
 *
 * Binding the workspace id as associated data makes the row a part of what the
 * tag covers. A transplanted blob then fails to authenticate — the same
 * `AEADBadTagException` as tampered ciphertext — and never becomes plaintext.
 * The AAD is not secret and is not stored: it is re-derived from the row the
 * ciphertext was read out of, so it can never disagree with where the blob
 * actually sits.
 *
 * Format 1 is still READ, because refusing to would make every credential saved
 * before this change undecryptable. It is never WRITTEN. A secret rotated or
 * re-saved is upgraded to format 2 as a side effect.
 *
 * SECURITY:
 * - A fresh random IV is generated for EVERY encrypt call.
 * - The key itself is never logged, stored to disk, or held in a String.
 * - Callers are responsible for zeroing ByteArrays after use where possible.
 */
object Encryption {

    private const val ALGORITHM = "AES/GCM/NoPadding"
    private const val KEY_ALGORITHM = "AES"
    private const val GCM_IV_LENGTH = 12          // 96-bit IV — recommended for GCM
    private const val GCM_TAG_BITS = 128          // 128-bit auth tag
    private val random = SecureRandom()

    /** Marks a token whose tag covers associated data as well as the ciphertext. */
    private const val AAD_MARKER = "a"

    /**
     * Encrypt [plaintext] with [keyBytes] (must be 32 bytes for AES-256).
     *
     * [aad] binds the ciphertext to where it lives — see the class comment. Pass
     * it for anything stored in a per-tenant row; the result then only decrypts
     * when the same value is supplied again. Null produces a legacy format-1
     * token and exists for callers with nothing meaningful to bind to.
     *
     * NEVER log the return value — it contains ciphertext whose decryption
     * requires only the key.
     */
    fun encrypt(plaintext: String, keyBytes: ByteArray, keyVersion: String, aad: ByteArray? = null): String {
        require(keyBytes.size == 32) { "AES-256 requires a 32-byte key" }

        val iv = ByteArray(GCM_IV_LENGTH).also { random.nextBytes(it) }
        val key = SecretKeySpec(keyBytes, KEY_ALGORITHM)
        val cipher = Cipher.getInstance(ALGORITHM)
        cipher.init(Cipher.ENCRYPT_MODE, key, GCMParameterSpec(GCM_TAG_BITS, iv))
        if (aad != null) cipher.updateAAD(aad)

        val ciphertextAndTag = cipher.doFinal(plaintext.toByteArray(Charsets.UTF_8))

        // Concatenate iv + ciphertext+tag in one buffer
        val blob = ByteArray(iv.size + ciphertextAndTag.size)
        System.arraycopy(iv, 0, blob, 0, iv.size)
        System.arraycopy(ciphertextAndTag, 0, blob, iv.size, ciphertextAndTag.size)

        val encoded = Base64.getUrlEncoder().withoutPadding().encodeToString(blob)
        return if (aad == null) "v${keyVersion}:${encoded}"
        else "v${keyVersion}:${AAD_MARKER}:${encoded}"
    }

    /**
     * Decrypt a token produced by [encrypt].
     * Returns the original plaintext string.
     *
     * [aad] MUST be the same value the token was written with. The token itself
     * says whether it was written with any: a format-2 token supplied a null
     * [aad] is refused outright rather than retried without it, because a
     * decrypt that silently succeeds without the binding is a decrypt that never
     * had the binding.
     *
     * Throws [IllegalArgumentException] for malformed tokens.
     * Throws [javax.crypto.AEADBadTagException] on tampered ciphertext, and on a
     * ciphertext that has been moved to a row it was not written for.
     *
     * NEVER log the returned plaintext.
     */
    fun decrypt(token: String, keyBytes: ByteArray, aad: ByteArray? = null): String {
        require(keyBytes.size == 32) { "AES-256 requires a 32-byte key" }

        val parts = token.split(':', limit = 3)
        require(parts.size >= 2 && parts[0].length > 1) {
            "Malformed ciphertext token: missing version prefix"
        }
        val bound = parts.size == 3 && parts[1] == AAD_MARKER
        require(parts.size == 2 || bound) { "Malformed ciphertext token: unrecognised format" }
        require(!bound || aad != null) {
            "This secret is bound to its workspace and cannot be decrypted without it"
        }

        val blob = Base64.getUrlDecoder().decode(parts.last())

        require(blob.size > GCM_IV_LENGTH) { "Ciphertext blob too short" }

        val iv = blob.copyOfRange(0, GCM_IV_LENGTH)
        val ciphertextAndTag = blob.copyOfRange(GCM_IV_LENGTH, blob.size)

        val key = SecretKeySpec(keyBytes, KEY_ALGORITHM)
        val cipher = Cipher.getInstance(ALGORITHM)
        cipher.init(Cipher.DECRYPT_MODE, key, GCMParameterSpec(GCM_TAG_BITS, iv))
        if (bound) cipher.updateAAD(aad)

        val plainBytes = cipher.doFinal(ciphertextAndTag)
        return String(plainBytes, Charsets.UTF_8)
    }

    /** True when [token] carries the binding — used to spot rows due an upgrade. */
    fun isBound(token: String): Boolean {
        val parts = token.split(':', limit = 3)
        return parts.size == 3 && parts[1] == AAD_MARKER
    }

    /**
     * The key version a token was written under.
     *
     * Read so that a service holding several keys can pick the right one rather
     * than trying them in turn — trying keys is both slower and a way to turn a
     * corrupted row into a silent failure under a key that never wrote it.
     */
    fun keyVersionOf(token: String): String? =
        token.substringBefore(':').removePrefix("v").takeIf { it.isNotEmpty() }

    /**
     * Decode a Base64-encoded key string into raw bytes.
     * Accepts both standard and URL-safe Base64.
     * Throws [IllegalArgumentException] if the decoded length is not 32 bytes.
     *
     * NEVER log the returned ByteArray.
     */
    fun decodeKey(base64Key: String): ByteArray {
        val bytes = try {
            Base64.getUrlDecoder().decode(base64Key.trim())
        } catch (_: Exception) {
            Base64.getDecoder().decode(base64Key.trim())
        }
        require(bytes.size == 32) {
            "SECRET_ENCRYPTION_KEY must decode to exactly 32 bytes (AES-256), got ${bytes.size}"
        }
        return bytes
    }
}
