package com.vectorbee.api.service

import com.vectorbee.api.http.HttpException
import com.vectorbee.api.model.CreateOrganizationRequest
import com.vectorbee.api.model.OrganizationView
import com.vectorbee.api.repository.OrganizationRepository
import java.util.UUID

class OrganizationService(private val organizationRepository: OrganizationRepository) {
    fun list(organizationId: UUID): List<OrganizationView> = organizationRepository.list(organizationId)

    fun create(request: CreateOrganizationRequest): OrganizationView {
        val name = request.name.trim()
        if (name.isBlank()) {
            throw HttpException(400, "name is required")
        }
        return organizationRepository.create(name)
    }
}
