package com.vectorbea.api.controller

import com.sun.net.httpserver.HttpExchange
import com.vectorbea.api.auth.rbac.WorkspaceRole
import com.vectorbea.api.auth.rbac.requireWorkspaceRole
import com.vectorbea.api.http.HttpException
import com.vectorbea.api.http.Json
import com.vectorbea.api.http.readBody
import com.vectorbea.api.http.requestContext
import com.vectorbea.api.http.writeJson
import com.vectorbea.api.model.CreateOrganizationRequest
import com.vectorbea.api.service.OrganizationService

class OrganizationController(private val organizationService: OrganizationService) {
    fun list(exchange: HttpExchange) {
        val organizationId = exchange.requestContext().organizationId
            ?: throw HttpException(401, "Unauthorized")
        exchange.writeJson(200, organizationService.list(organizationId))
    }

    fun create(exchange: HttpExchange) {
        exchange.requireWorkspaceRole(WorkspaceRole.ADMIN)
        val request = try {
            Json.decode<CreateOrganizationRequest>(exchange.readBody())
        } catch (_: Exception) {
            throw HttpException(400, "Invalid JSON body")
        }

        exchange.writeJson(201, organizationService.create(request))
    }
}
