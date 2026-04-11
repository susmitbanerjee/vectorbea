package com.vectorbea.api.controller

import com.sun.net.httpserver.HttpExchange
import com.vectorbea.api.auth.rbac.WorkspaceRole
import com.vectorbea.api.auth.rbac.requireWorkspaceRole
import com.vectorbea.api.http.HttpException
import com.vectorbea.api.http.Json
import com.vectorbea.api.http.readBody
import com.vectorbea.api.http.requestContext
import com.vectorbea.api.http.writeJson
import com.vectorbea.api.model.CreateWorkspaceRequest
import com.vectorbea.api.service.WorkspaceService

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
