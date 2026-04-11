package com.vectorbee.api.controller

import com.sun.net.httpserver.HttpExchange
import com.vectorbee.api.auth.rbac.WorkspaceRole
import com.vectorbee.api.auth.rbac.requireWorkspaceRole
import com.vectorbee.api.http.HttpException
import com.vectorbee.api.http.Json
import com.vectorbee.api.http.readBody
import com.vectorbee.api.http.requestContext
import com.vectorbee.api.http.writeJson
import com.vectorbee.api.model.CreateWorkspaceRequest
import com.vectorbee.api.service.WorkspaceService

class WorkspaceController(private val workspaceService: WorkspaceService) {
    fun create(exchange: HttpExchange) {
        exchange.requireWorkspaceRole(WorkspaceRole.ADMIN)
        val organizationId = exchange.requestContext().organizationId
            ?: throw HttpException(401, "Unauthorized")
        val request = try {
            Json.decode<CreateWorkspaceRequest>(exchange.readBody())
        } catch (_: Exception) {
            throw HttpException(400, "Invalid JSON body")
        }
        if (request.name.isBlank()) throw HttpException(400, "name must not be blank")

        exchange.writeJson(201, workspaceService.create(organizationId, request.name.trim()))
    }
}
