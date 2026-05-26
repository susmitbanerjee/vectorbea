package com.vectorbea.api.secrets

import com.vectorbea.api.security.Encryption
import com.vectorbea.api.security.Redactor
import org.slf4j.LoggerFactory
import java.util.UUID

/**
 * Production [SecretService] — AES-256-GCM encryption backed by the
 * `encrypted_secrets` Postgres table.
 *
 * SECURITY:
 * - [keyBytes] is the raw 32-byte AES key — never logged, never serialized.
 * - Only ciphertext is persisted.
 * - Plaintext is held in memory only for the duration of [resolveSecretForRuntime].
 * - [maskedPreview] is the only display-safe representation ever stored.
 * - [maskSecret] delegates to [Redactor.maskedPreview] for consistent masking.
 */
class EncryptedSecretService(
    private val repo: SecretRepository,
    /** Raw 32-byte AES-256 key — must never be logged */
    private val keyBytes: ByteArray,
    private val keyVersion: String = "1",
) : SecretService {

    private val log = LoggerFactory.getLogger(EncryptedSecretService::class.java)

    override fun createSecret(
        workspaceId: UUID,
        connectionId: UUID?,
        plaintext: String,
    ): SecretRef {
        require(plaintext.isNotBlank()) { "Secret plaintext must not be blank" }

        // SECURITY: never log plaintext
        val ciphertext = Encryption.encrypt(plaintext, keyBytes, keyVersion)
        val preview = Redactor.maskedPreview(plaintext)

        val id = repo.insert(
            workspaceId = workspaceId,
            connectionId = connectionId,
            ciphertext = ciphertext,
            keyVersion = keyVersion,
            maskedPreview = preview,
        )

        log.info("Created encrypted secret [id={}, workspaceId={}, connectionId={}]",
            id, workspaceId, connectionId)

        return SecretRef(ref = id.toString(), maskedPreview = preview)
    }

    override fun updateSecret(secretRef: String, plaintext: String) {
        require(plaintext.isNotBlank()) { "Secret plaintext must not be blank" }

        val id = parseRef(secretRef)
        // SECURITY: never log plaintext
        val ciphertext = Encryption.encrypt(plaintext, keyBytes, keyVersion)
        val preview = Redactor.maskedPreview(plaintext)

        repo.updateCiphertext(id, ciphertext, keyVersion, preview)

        log.info("Updated encrypted secret [id={}]", id)
    }

    override fun resolveSecretForRuntime(secretRef: String): String {
        val id = parseRef(secretRef)
        val row = repo.findById(id)
            ?: throw SecretNotFoundException(secretRef)

        return try {
            // SECURITY: return value must NOT be logged by caller
            Encryption.decrypt(row.secretCiphertext, keyBytes)
        } catch (e: Exception) {
            // Do not include ciphertext or key details in the exception
            log.warn("Failed to decrypt secret [id={}]: {}", id, e.javaClass.simpleName)
            throw SecretDecryptionException(e)
        }
    }

    override fun deleteSecret(secretRef: String) {
        val id = parseRef(secretRef)
        repo.delete(id)
        log.info("Deleted encrypted secret [id={}]", id)
    }

    override fun maskSecret(plaintext: String): String =
        Redactor.maskedPreview(plaintext)

    private fun parseRef(secretRef: String): UUID = try {
        UUID.fromString(secretRef.trim())
    } catch (_: IllegalArgumentException) {
        throw SecretNotFoundException(secretRef)
    }
}

/**
 * No-op [SecretService] used when SECRET_ENCRYPTION_KEY is absent (local dev).
 * All write operations throw; all read operations throw [SecretServiceUnavailableException].
 */
class NoOpSecretService : SecretService {
    private val log = LoggerFactory.getLogger(NoOpSecretService::class.java)

    override fun createSecret(workspaceId: UUID, connectionId: UUID?, plaintext: String): SecretRef {
        throw SecretServiceUnavailableException()
    }

    override fun updateSecret(secretRef: String, plaintext: String) {
        throw SecretServiceUnavailableException()
    }

    override fun resolveSecretForRuntime(secretRef: String): String {
        throw SecretServiceUnavailableException()
    }

    override fun deleteSecret(secretRef: String) {
        log.warn("NoOpSecretService: deleteSecret called (no-op) [ref={}]", secretRef)
    }

    override fun maskSecret(plaintext: String): String =
        Redactor.maskedPreview(plaintext)
}
