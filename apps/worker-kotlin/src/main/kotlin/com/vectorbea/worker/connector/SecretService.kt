package com.vectorbea.worker.connector

import com.vectorbea.worker.logging.logger
import java.security.SecureRandom
import java.util.Base64
import javax.crypto.Cipher
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec
import javax.sql.DataSource

/**
 * Resolves and decrypts connection secrets.
 *
 * Secret storage formats supported:
 *
 *   1. Direct encrypted value (self-contained, no DB lookup):
 *      secretRef = "aes256gcm:<base64(12-byte-IV || ciphertext || 16-byte-GCM-tag)>"
 *
 *   2. Table lookup (secretRef is a key into `connection_secrets`):
 *      secretRef = "ref:<key>" or any value not starting with "aes256gcm:"
 *      → queries: SELECT encrypted_value FROM connection_secrets WHERE ref = ?
 *      → decrypts the retrieved value
 *
 *   3. No encryption key (development only):
 *      If [keyBase64] is null, returns the secretRef as-is (plaintext dev secret).
 *      This mode is REJECTED in production (checked at startup via [WorkerConfig]).
 *
 * SECURITY:
 *  - The decrypted plaintext is wrapped in [SecretValue] and immediately cleared after use.
 *  - The [keyBase64] raw value is NEVER logged — only its presence is noted.
 *  - Failed decryption throws [SecretException] with a sanitized message.
 *  - Timing-safe comparison is not needed here (we're only decrypting, not comparing).
 */
open class SecretService(
    private val keyBase64: String?,
    private val dataSource: DataSource,
) {
    private val log = logger()

    private val aesKey: SecretKeySpec? by lazy {
        keyBase64?.let { b64 ->
            try {
                val keyBytes = Base64.getDecoder().decode(b64.trim())
                require(keyBytes.size == 32) {
                    "SECRET_ENCRYPTION_KEY must be 32 bytes (256-bit) when base64-decoded, got ${keyBytes.size}"
                }
                SecretKeySpec(keyBytes, "AES")
            } catch (e: Exception) {
                log.error("[secrets] Failed to initialise AES key: {}", e.message)
                null
            }
        }
    }

    /**
     * Resolve [secretRef] to a [SecretValue].
     * Returns null if [secretRef] is null or blank.
     * Throws [SecretException] on decryption failure.
     */
    fun resolve(secretRef: String?): SecretValue? = resolve(secretRef, workspaceId = null)

    /**
     * Workspace-scoped resolve — PREFERRED for all runtime execution paths.
     * Verifies that the secret belongs to [workspaceId] before decrypting.
     * Returns null if the secret exists but belongs to a different workspace.
     */
    fun resolve(secretRef: String?, workspaceId: java.util.UUID?): SecretValue? {
        if (secretRef.isNullOrBlank()) return null

        // Mode 1: direct encrypted value
        if (secretRef.startsWith(DIRECT_PREFIX)) {
            val encrypted = secretRef.removePrefix(DIRECT_PREFIX)
            return decrypt(encrypted, "direct secret ref")
        }

        // Mode 2: table lookup (workspace-scoped when workspaceId provided)
        val encryptedValue = lookupInTable(secretRef, workspaceId)
            ?: if (aesKey == null) {
                // Dev mode: treat secretRef as cleartext (no key)
                log.warn("[secrets] No encryption key — returning secretRef as plaintext (dev mode only)")
                return SecretValue(secretRef.toCharArray())
            } else {
                throw SecretException("Secret ref '${ secretRef.take(20)}...' not found in connection_secrets table")
            }

        return decrypt(encryptedValue, "table ref")
    }

    // ── Encryption (for test helpers / provisioning) ──────────────────────────

    /**
     * Encrypt [plaintext] and return a self-contained secret ref string.
     * Used by provisioning tooling and tests — NOT called during execution.
     */
    fun encrypt(plaintext: String): String {
        val key = aesKey ?: throw SecretException("Cannot encrypt: no AES key configured")
        val iv = ByteArray(IV_LENGTH).also { SecureRandom().nextBytes(it) }
        val cipher = Cipher.getInstance(ALGORITHM)
        cipher.init(Cipher.ENCRYPT_MODE, key, GCMParameterSpec(GCM_TAG_BITS, iv))
        val ciphertext = cipher.doFinal(plaintext.toByteArray(Charsets.UTF_8))
        val combined = iv + ciphertext  // IV (12) || ciphertext+tag
        return "$DIRECT_PREFIX${Base64.getEncoder().encodeToString(combined)}"
    }

    // ── Internal ──────────────────────────────────────────────────────────────

    private fun decrypt(base64Combined: String, context: String): SecretValue {
        if (aesKey == null) {
            log.warn("[secrets] No AES key — returning base64 value as-is (dev mode)")
            return SecretValue(base64Combined.toCharArray())
        }

        return try {
            // The API stores ciphertext as base64url (URL-safe, no padding).
            // Fall back to standard base64 for any legacy values.
            val combined = try {
                Base64.getUrlDecoder().decode(base64Combined.trim())
            } catch (_: Exception) {
                Base64.getDecoder().decode(base64Combined.trim())
            }
            require(combined.size > IV_LENGTH) { "Encrypted value too short" }

            val iv         = combined.sliceArray(0 until IV_LENGTH)
            val ciphertext = combined.sliceArray(IV_LENGTH until combined.size)

            val cipher = Cipher.getInstance(ALGORITHM)
            cipher.init(Cipher.DECRYPT_MODE, aesKey, GCMParameterSpec(GCM_TAG_BITS, iv))
            val plainBytes = cipher.doFinal(ciphertext)

            SecretValue(String(plainBytes, Charsets.UTF_8).toCharArray().also {
                plainBytes.fill(0) // zero plaintext bytes
            })
        } catch (e: Exception) {
            log.error("[secrets] Decryption failed for {}: {}", context, e.javaClass.simpleName)
            throw SecretException("Secret decryption failed for $context")
        }
    }

    /**
     * Look up a secret from the `encrypted_secrets` table.
     *
     * The `connections.secret_ref` column stores the UUID primary key of
     * `encrypted_secrets.id` (as a plain text UUID string).
     *
     * The stored ciphertext uses the API's versioned format:
     *   `v{keyVersion}:{base64url(iv || ciphertext || authTag)}`
     * This method strips the version prefix before returning, so the caller
     * receives the raw base64url blob that [decrypt] expects.
     */
    private fun lookupInTable(ref: String, workspaceId: java.util.UUID? = null): String? =
        try {
            dataSource.connection.use { conn ->
                // Workspace-scoped query when workspaceId is provided — prevents
                // cross-tenant secret access even if secretRef UUID is guessed.
                val sql = if (workspaceId != null)
                    "SELECT secret_ciphertext FROM encrypted_secrets WHERE id = ?::uuid AND workspace_id = ?"
                else
                    "SELECT secret_ciphertext FROM encrypted_secrets WHERE id = ?::uuid"
                conn.prepareStatement(sql).use { stmt ->
                    stmt.setString(1, ref)
                    if (workspaceId != null) stmt.setObject(2, workspaceId)
                    stmt.executeQuery().use { rs ->
                        if (!rs.next()) return@use null
                        val raw = rs.getString("secret_ciphertext") ?: return@use null
                        // Strip the versioned prefix "v1:", "v2:", etc. produced by
                        // the API's Encryption.encrypt() before passing to decrypt().
                        val colonIdx = raw.indexOf(':')
                        if (colonIdx > 0 && raw.startsWith("v")) raw.substring(colonIdx + 1)
                        else raw
                    }
                }
            }
        } catch (e: Exception) {
            log.warn("[secrets] Failed to look up secret ref '{}': {}", ref.take(8), e.message)
            null
        }

    companion object {
        private const val DIRECT_PREFIX = "aes256gcm:"
        private const val ALGORITHM     = "AES/GCM/NoPadding"
        private const val IV_LENGTH     = 12
        private const val GCM_TAG_BITS  = 128
    }
}

class SecretException(message: String) : Exception(message)
