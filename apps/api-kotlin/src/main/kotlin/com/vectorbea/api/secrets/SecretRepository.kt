package com.vectorbea.api.secrets

import com.vectorbea.api.repository.BaseRepository
import org.slf4j.LoggerFactory
import java.util.UUID
import javax.sql.DataSource

/**
 * JDBC access to the `encrypted_secrets` table.
 *
 * SECURITY:
 * - Only ciphertext is stored/returned — plaintext never touches this class.
 * - [maskedPreview] is the only human-readable value stored alongside ciphertext.
 * - All reads return [SecretRow]; callers decrypt in [EncryptedSecretService].
 */
open class SecretRepository(dataSource: DataSource) : BaseRepository(dataSource) {
    override val log = LoggerFactory.getLogger(SecretRepository::class.java)

    data class SecretRow(
        val id: UUID,
        val workspaceId: UUID,
        val connectionId: UUID?,
        val secretCiphertext: String,  // never log this
        val keyVersion: String,
        val maskedPreview: String?,
    )

    open fun insert(
        workspaceId: UUID,
        connectionId: UUID?,
        ciphertext: String,
        keyVersion: String,
        maskedPreview: String?,
    ): UUID = dataSource.connection.use { conn ->
        conn.prepareStatement(
            """
            INSERT INTO encrypted_secrets
                (workspace_id, connection_id, secret_ciphertext, key_version, masked_preview)
            VALUES (?, ?, ?, ?, ?)
            RETURNING id
            """.trimIndent()
        ).use { stmt ->
            stmt.setObject(1, workspaceId)
            stmt.setObject(2, connectionId)
            stmt.setString(3, ciphertext)
            stmt.setString(4, keyVersion)
            stmt.setString(5, maskedPreview)
            stmt.executeQuery().use { rs ->
                if (rs.next()) UUID.fromString(rs.getString(1))
                else throw IllegalStateException("INSERT encrypted_secrets returned no row")
            }
        }
    }

    open fun updateCiphertext(id: UUID, ciphertext: String, keyVersion: String, maskedPreview: String?) {
        dataSource.connection.use { conn ->
            conn.prepareStatement(
                """
                UPDATE encrypted_secrets
                SET secret_ciphertext = ?, key_version = ?, masked_preview = ?, updated_at = now()
                WHERE id = ?
                """.trimIndent()
            ).use { stmt ->
                stmt.setString(1, ciphertext)
                stmt.setString(2, keyVersion)
                stmt.setString(3, maskedPreview)
                stmt.setObject(4, id)
                stmt.executeUpdate()
            }
        }
    }

    open fun findById(id: UUID): SecretRow? = queryOne(
        "SELECT id, workspace_id, connection_id, secret_ciphertext, key_version, masked_preview FROM encrypted_secrets WHERE id = ?",
        { setObject(1, id) },
        ::mapRow,
    )

    /**
     * Workspace-scoped lookup — PREFERRED for all runtime secret resolution.
     * Returns null (not-found, not an error) if the secret exists but belongs
     * to a different workspace, preventing cross-tenant secret leakage.
     */
    open fun findByIdScoped(id: UUID, workspaceId: UUID): SecretRow? = queryOne(
        "SELECT id, workspace_id, connection_id, secret_ciphertext, key_version, masked_preview " +
        "FROM encrypted_secrets WHERE id = ? AND workspace_id = ?",
        { setObject(1, id); setObject(2, workspaceId) },
        ::mapRow,
    )

    open fun delete(id: UUID) {
        execute("DELETE FROM encrypted_secrets WHERE id = ?") { setObject(1, id) }
    }

    private fun mapRow(rs: java.sql.ResultSet) = SecretRow(
        id = UUID.fromString(rs.getString("id")),
        workspaceId = UUID.fromString(rs.getString("workspace_id")),
        connectionId = rs.getString("connection_id")?.let { UUID.fromString(it) },
        secretCiphertext = rs.getString("secret_ciphertext"),
        keyVersion = rs.getString("key_version"),
        maskedPreview = rs.getString("masked_preview"),
    )
}
