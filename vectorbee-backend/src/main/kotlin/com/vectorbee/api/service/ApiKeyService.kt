package com.vectorbee.api.service

import com.vectorbee.api.auth.ApiKeyHasher
import com.vectorbee.api.model.ApiKeyView
import com.vectorbee.api.model.CreateApiKeyResponse
import com.vectorbee.api.repository.ApiKeyRepository
import java.util.UUID

class ApiKeyService(private val apiKeyRepository: ApiKeyRepository) {
    fun createApiKey(organizationId: UUID, name: String?): CreateApiKeyResponse {
        val rawKey = ApiKeyHasher.generateRawKey()
        val keyHash = ApiKeyHasher.sha256(rawKey)
        val lastFour = rawKey.takeLast(4)
        val resolvedName = name?.trim().takeUnless { it.isNullOrEmpty() } ?: "default"
        val record = apiKeyRepository.insert(organizationId, resolvedName, keyHash, lastFour)

        return CreateApiKeyResponse(
            id = record.id,
            organizationId = record.organizationId,
            name = record.name,
            apiKey = rawKey,
            createdAt = record.createdAt
        )
    }

    fun listApiKeys(organizationId: UUID?): List<ApiKeyView> =
        apiKeyRepository.list(organizationId).map { record ->
            val suffix = if (record.keyLastFour.isNotEmpty()) record.keyLastFour else record.keyHash.takeLast(4)
            ApiKeyView(
                id = record.id,
                organizationId = record.organizationId,
                name = record.name.ifEmpty { "default" },
                maskedKey = "${ApiKeyHasher.KEY_PREFIX}${"•".repeat(12)}$suffix",
                createdAt = record.createdAt
            )
        }

    fun revokeApiKey(id: UUID): Boolean = apiKeyRepository.deleteById(id)
}
