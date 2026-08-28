package com.vectorbea.api.secrets

import com.vectorbea.crypto.Encryption
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
 *
 * EVERY CIPHERTEXT IS BOUND TO ITS WORKSPACE. The AES-GCM tag proves a blob was
 * not altered; on its own it says nothing about which row the blob belongs in.
 * That made ciphertexts portable — anyone able to WRITE the table (an injection
 * foothold, a restore from the wrong backup, a mistaken migration) could move
 * tenant A's encrypted OpenAI key into tenant B's row and it would decrypt
 * cleanly, because it is a valid ciphertext under the single master key the
 * table shares. [SecretRepository.findByIdScoped] stops tenant B ASKING for
 * tenant A's secret; it cannot stop a blob already sitting in tenant B's own row.
 *
 * So the workspace id travels as GCM associated data, re-derived from the row
 * the ciphertext was read out of and never stored. A transplanted blob fails to
 * authenticate and never becomes plaintext. See [Encryption] for the wire format
 * and for why the older unbound format is still readable.
 */
class EncryptedSecretService(
    private val repo: SecretRepository,
    /** Raw 32-byte AES-256 key — must never be logged */
    private val keyBytes: ByteArray,
    private val keyVersion: String = "1",
) : SecretService {

    private val log = LoggerFactory.getLogger(EncryptedSecretService::class.java)

    /**
     * What a ciphertext is bound to.
     *
     * The workspace id, as its canonical string. Chosen over the secret's own id
     * because the id is not known until `INSERT ... RETURNING id` has run, and
     * the tenant boundary is the one that matters: moving a blob WITHIN a
     * workspace exposes it to nobody who could not already read it.
     */
    private fun aadFor(workspaceId: UUID): ByteArray =
        workspaceId.toString().toByteArray(Charsets.UTF_8)

    override fun createSecret(
        workspaceId: UUID,
        connectionId: UUID?,
        plaintext: String,
    ): SecretRef {
        require(plaintext.isNotBlank()) { "Secret plaintext must not be blank" }

        // SECURITY: never log plaintext
        val ciphertext = Encryption.encrypt(plaintext, keyBytes, keyVersion, aadFor(workspaceId))
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
        // The row is read first for its workspace id, which is what the new
        // ciphertext is bound to. Rotating a secret therefore also UPGRADES a
        // legacy unbound row to the bound format, with no migration to run.
        val row = repo.findById(id) ?: throw SecretNotFoundException(secretRef)
        // SECURITY: never log plaintext
        val ciphertext = Encryption.encrypt(plaintext, keyBytes, keyVersion, aadFor(row.workspaceId))
        val preview = Redactor.maskedPreview(plaintext)

        repo.updateCiphertext(id, ciphertext, keyVersion, preview)

        log.info("Updated encrypted secret [id={}]", id)
    }

    override fun resolveSecretForRuntime(secretRef: String): String {
        // Unscoped fallback — prefer the workspace-scoped overload for all new code.
        val id = parseRef(secretRef)
        val row = repo.findById(id) ?: throw SecretNotFoundException(secretRef)
        return decryptCiphertext(row.secretCiphertext, row.id, row.workspaceId)
    }

    override fun resolveSecretForRuntime(secretRef: String, workspaceId: java.util.UUID): String {
        val id = parseRef(secretRef)
        // Workspace-scoped: null if secret exists but belongs to a different workspace.
        // Treats cross-workspace access as not-found — no timing difference to attacker.
        val row = repo.findByIdScoped(id, workspaceId) ?: throw SecretNotFoundException(secretRef)
        return decryptCiphertext(row.secretCiphertext, row.id, row.workspaceId)
    }

    /**
     * [rowWorkspaceId] is the workspace of the ROW the ciphertext was read from,
     * not one supplied by a caller. That is the whole point: the binding has to
     * come from where the blob actually sits, or it proves nothing.
     */
    private fun decryptCiphertext(
        ciphertext: String,
        secretId: java.util.UUID,
        rowWorkspaceId: UUID,
    ): String = try {
        // SECURITY: return value must NOT be logged by caller
        Encryption.decrypt(ciphertext, keyBytes, aadFor(rowWorkspaceId))
    } catch (e: Exception) {
        /* A bad tag here means one of three things: the master key changed, the
           row was tampered with, or the blob was written for a different
           workspace. All three are worth the same alarm and none of them may
           reveal which — the message a caller sees says only that decryption
           failed. */
        log.warn("Failed to decrypt secret [id={}, bound={}]: {}",
            secretId, Encryption.isBound(ciphertext), e.javaClass.simpleName)
        throw SecretDecryptionException(e)
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

    override fun resolveSecretForRuntime(secretRef: String, workspaceId: java.util.UUID): String {
        throw SecretServiceUnavailableException()
    }

    override fun deleteSecret(secretRef: String) {
        log.warn("NoOpSecretService: deleteSecret called (no-op) [ref={}]", secretRef)
    }

    override fun maskSecret(plaintext: String): String =
        Redactor.maskedPreview(plaintext)
}
