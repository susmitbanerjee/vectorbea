package com.vectorbee.api.controller

import com.sun.net.httpserver.HttpExchange
import com.vectorbee.api.auth.rbac.WorkspaceRole
import com.vectorbee.api.auth.rbac.requireWorkspaceRole
import com.vectorbee.api.http.HttpException
import com.vectorbee.api.http.Json
import com.vectorbee.api.http.readBody
import com.vectorbee.api.http.requestContext
import com.vectorbee.api.http.writeJson
import com.vectorbee.api.model.CreateOrganizationRequest
import com.vectorbee.api.service.OrganizationService

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
