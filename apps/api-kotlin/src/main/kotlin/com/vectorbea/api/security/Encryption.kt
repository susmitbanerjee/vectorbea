package com.vectorbea.api.security

import java.security.SecureRandom
import java.util.Base64
import javax.crypto.Cipher
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec

/**
 * AES-256-GCM authenticated encryption.
 *
 * Wire format (Base64-URL-no-pad encoded):
 *   v{keyVersion}:{base64url(iv || ciphertext || authTag)}
 *
 * IV:       12 bytes (96-bit) randomly generated per encryption
 * Key:      32 bytes (256-bit) — supplied externally, never stored here
 * Auth tag: 128-bit (GCM default)
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

    /**
     * Encrypt [plaintext] with [keyBytes] (must be 32 bytes for AES-256).
     * Returns an opaque token: `v{keyVersion}:{base64url(iv||ciphertext||tag)}`
     *
     * NEVER log the return value — it contains ciphertext whose decryption
     * requires only the key.
     */
    fun encrypt(plaintext: String, keyBytes: ByteArray, keyVersion: String): String {
        require(keyBytes.size == 32) { "AES-256 requires a 32-byte key" }

        val iv = ByteArray(GCM_IV_LENGTH).also { random.nextBytes(it) }
        val key = SecretKeySpec(keyBytes, KEY_ALGORITHM)
        val cipher = Cipher.getInstance(ALGORITHM)
        cipher.init(Cipher.ENCRYPT_MODE, key, GCMParameterSpec(GCM_TAG_BITS, iv))

        val ciphertextAndTag = cipher.doFinal(plaintext.toByteArray(Charsets.UTF_8))

        // Concatenate iv + ciphertext+tag in one buffer
        val blob = ByteArray(iv.size + ciphertextAndTag.size)
        System.arraycopy(iv, 0, blob, 0, iv.size)
        System.arraycopy(ciphertextAndTag, 0, blob, iv.size, ciphertextAndTag.size)

        val encoded = Base64.getUrlEncoder().withoutPadding().encodeToString(blob)
        return "v${keyVersion}:${encoded}"
    }

    /**
     * Decrypt a token produced by [encrypt].
     * Returns the original plaintext string.
     *
     * Throws [IllegalArgumentException] for malformed tokens.
     * Throws [javax.crypto.AEADBadTagException] on tampered ciphertext.
     *
     * NEVER log the returned plaintext.
     */
    fun decrypt(token: String, keyBytes: ByteArray): String {
        require(keyBytes.size == 32) { "AES-256 requires a 32-byte key" }

        val colonIdx = token.indexOf(':')
        require(colonIdx > 0) { "Malformed ciphertext token: missing version prefix" }
        // version prefix consumed but not strictly validated here; callers may
        // add key-rotation logic on top by checking the prefix.

        val encoded = token.substring(colonIdx + 1)
        val blob = Base64.getUrlDecoder().decode(encoded)

        require(blob.size > GCM_IV_LENGTH) { "Ciphertext blob too short" }

        val iv = blob.copyOfRange(0, GCM_IV_LENGTH)
        val ciphertextAndTag = blob.copyOfRange(GCM_IV_LENGTH, blob.size)

        val key = SecretKeySpec(keyBytes, KEY_ALGORITHM)
        val cipher = Cipher.getInstance(ALGORITHM)
        cipher.init(Cipher.DECRYPT_MODE, key, GCMParameterSpec(GCM_TAG_BITS, iv))

        val plainBytes = cipher.doFinal(ciphertextAndTag)
        return String(plainBytes, Charsets.UTF_8)
    }

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
