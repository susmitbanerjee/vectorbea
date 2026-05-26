package com.vectorbea.api.secrets

import java.util.UUID

/**
 * Contract for server-side secret storage and retrieval.
 *
 * SECURITY GUARANTEES:
 * - Plaintext secrets are NEVER persisted anywhere.
 * - Only [resolveSecretForRuntime] returns plaintext — restricted to
 *   connection-test and runtime executor paths.
 * - All other return values are opaque [SecretRef] identifiers.
 * - [maskSecret] is the only way to produce a display-safe representation.
 *
 * Implementations must:
 * - Encrypt before write.
 * - Decrypt only in [resolveSecretForRuntime].
 * - Never log plaintext or ciphertext.
 */
interface SecretService {

    /**
     * Encrypt [plaintext] and persist it.
     * Associates the secret with [workspaceId] and optionally [connectionId].
     *
     * @return opaque [SecretRef] referencing the stored ciphertext row.
     */
    fun createSecret(
        workspaceId: UUID,
        connectionId: UUID?,
        plaintext: String,
    ): SecretRef

    /**
     * Replace the ciphertext behind an existing [secretRef].
     * Fails if the ref does not exist.
     */
    fun updateSecret(secretRef: String, plaintext: String)

    /**
     * Decrypt and return the plaintext for use at runtime (connection test / executor).
     *
     * CALLER CONTRACT: the returned String MUST NOT be:
     *   - logged at any level
     *   - serialized into a response body
     *   - stored in config maps or caches
     *   - passed as a URL parameter
     *
     * @throws SecretNotFoundException if [secretRef] does not exist.
     * @throws SecretDecryptionException if decryption fails (bad key, tampered data).
     */
    fun resolveSecretForRuntime(secretRef: String): String

    /**
     * Permanently delete the secret referenced by [secretRef].
     * No-op if the ref does not exist.
     */
    fun deleteSecret(secretRef: String)

    /**
     * Produce a display-safe masked preview of a plaintext secret.
     * E.g. "sk-abc...xyz"
     *
     * NEVER store the result — it is for UI rendering only.
     */
    fun maskSecret(plaintext: String): String
}

/**
 * Returned after successfully storing a secret.
 * [ref] is the UUID string of the `encrypted_secrets` row.
 * [maskedPreview] is safe to store and display.
 */
data class SecretRef(
    val ref: String,
    val maskedPreview: String,
)

class SecretNotFoundException(ref: String) :
    Exception("Secret not found: $ref")

class SecretDecryptionException(cause: Throwable) :
    Exception("Failed to decrypt secret — key may have changed", cause)

class SecretServiceUnavailableException :
    Exception("Secret service is unavailable — SECRET_ENCRYPTION_KEY not configured")
