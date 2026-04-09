package com.vectorbee.api.service

import com.vectorbee.api.auth.ApiKeyHasher
import com.vectorbee.api.repository.ApiKeyRepository
import java.util.UUID

class AuthService(private val apiKeyRepository: ApiKeyRepository) {
    private val devTokenEnabled: Boolean =
        System.getenv("VECTORBEE_ALLOW_DEV_TOKEN")?.equals("true", ignoreCase = true) == true

    fun authenticate(rawToken: String): UUID? {
        if (devTokenEnabled && rawToken == "dev_org_123") {
            return apiKeyRepository.findAnyOrganizationId()
        }
        if (rawToken.isBlank()) return null
        val keyHash = ApiKeyHasher.sha256(rawToken)
        return apiKeyRepository.findOrganizationIdByKeyHash(keyHash)
    }
}
