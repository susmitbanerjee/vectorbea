package com.vectorbea.api.service

import com.vectorbea.api.http.HttpException
import com.vectorbea.api.model.CreateOrganizationRequest
import com.vectorbea.api.model.OrganizationView
import com.vectorbea.api.repository.OrganizationRepository
import java.util.UUID

class OrganizationService(private val organizationRepository: OrganizationRepository) {
    fun list(organizationId: UUID): List<OrganizationView> = organizationRepository.list(organizationId)

    fun create(request: CreateOrganizationRequest, ownerUserId: UUID): OrganizationView {
        val name = request.name.trim()
        if (name.isBlank()) {
            throw HttpException(400, "name is required")
        }

        val ownedFreeOrganizations = organizationRepository.countOwnedOrganizations(ownerUserId, planTier = "free")
        if (ownedFreeOrganizations >= 1) {
            throw HttpException(403, "Free tier is limited to 1 Organization")
        }

        return organizationRepository.createForOwner(name, ownerUserId)
    }
}
