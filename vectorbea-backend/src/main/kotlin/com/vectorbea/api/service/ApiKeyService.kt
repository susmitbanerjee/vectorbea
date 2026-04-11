package com.vectorbea.api.service

import com.vectorbea.api.auth.ApiKeyHasher
import com.vectorbea.api.auth.rbac.WorkspaceRole
import com.vectorbea.api.model.ApiKeyView
import com.vectorbea.api.model.CreateApiKeyResponse
import com.vectorbea.api.repository.ApiKeyRepository
import java.util.UUID

class ApiKeyService(private val apiKeyRepository: ApiKeyRepository) {

    fun createApiKey(workspaceId: UUID, name: String?, role: WorkspaceRole = WorkspaceRole.EDITOR): CreateApiKeyResponse {
        val rawKey = ApiKeyHasher.generateRawKey()
        val keyHash = ApiKeyHasher.sha256(rawKey)
        val lastFour = rawKey.takeLast(4)
        val resolvedName = name?.trim().takeUnless { it.isNullOrEmpty() } ?: "default"
        val record = apiKeyRepository.insert(workspaceId, resolvedName, role, keyHash, lastFour)

        return CreateApiKeyResponse(
            id = record.id,
            workspaceId = record.workspaceId,
            name = record.name,
            apiKey = rawKey,
            createdAt = record.createdAt
        )
    }

    fun listApiKeys(workspaceId: UUID): List<ApiKeyView> =
        apiKeyRepository.list(workspaceId).map { record ->
            val suffix = if (record.keyLastFour.isNotEmpty()) record.keyLastFour else record.keyHash.takeLast(4)
            ApiKeyView(
                id = record.id,
                workspaceId = record.workspaceId,
                name = record.name.ifEmpty { "default" },
                maskedKey = "${ApiKeyHasher.KEY_PREFIX}${"•".repeat(12)}$suffix",
                createdAt = record.createdAt
            )
        }

    fun revokeApiKey(id: UUID, workspaceId: UUID): Boolean =
        apiKeyRepository.deleteById(id, workspaceId)
}
