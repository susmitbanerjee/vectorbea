package com.vectorbee.api.service

import com.vectorbee.api.http.HttpException
import com.vectorbee.api.model.CreateOrganizationRequest
import com.vectorbee.api.model.OrganizationView
import com.vectorbee.api.repository.OrganizationRepository

class OrganizationService(private val organizationRepository: OrganizationRepository) {
    fun list(): List<OrganizationView> = organizationRepository.list()

    fun create(request: CreateOrganizationRequest): OrganizationView {
        val name = request.name.trim()
        if (name.isBlank()) {
            throw HttpException(400, "name is required")
        }
        return organizationRepository.create(name)
    }
}
