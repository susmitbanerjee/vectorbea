package com.vectorbea.api.controller

import com.sun.net.httpserver.HttpExchange
import com.vectorbea.api.auth.rbac.requireWorkspaceId
import com.vectorbea.api.auth.rbac.requireWorkspaceRole
import com.vectorbea.api.auth.rbac.WorkspaceRole
import com.vectorbea.api.http.HttpException
import com.vectorbea.api.http.Json
import com.vectorbea.api.http.pathParam
import com.vectorbea.api.http.readBody
import com.vectorbea.api.http.writeEmpty
import com.vectorbea.api.http.writeJson
import com.vectorbea.api.model.CreateApiKeyRequest
import com.vectorbea.api.service.ApiKeyService
import java.util.UUID

class ApiKeyController(private val apiKeyService: ApiKeyService) {
    fun create(exchange: HttpExchange) {
        exchange.requireWorkspaceRole(WorkspaceRole.ADMIN)
        val workspaceId = exchange.requireWorkspaceId()

        val request = try {
            Json.decode<CreateApiKeyRequest>(exchange.readBody())
        } catch (_: Exception) {
            throw HttpException(400, "Invalid JSON body")
        }

        val role = request.role
            ?.let { runCatching { WorkspaceRole.fromString(it) }.getOrElse { throw HttpException(400, "Invalid role: $it") } }
            ?: WorkspaceRole.EDITOR

        val response = apiKeyService.createApiKey(workspaceId, request.name, role)
        exchange.writeJson(201, response)
    }

    fun list(exchange: HttpExchange) {
        val workspaceId = exchange.requireWorkspaceId()
        exchange.writeJson(200, apiKeyService.listApiKeys(workspaceId))
    }

    fun delete(exchange: HttpExchange) {
        exchange.requireWorkspaceRole(WorkspaceRole.ADMIN)
        val workspaceId = exchange.requireWorkspaceId()
        val raw = exchange.pathParam("id", "/api/keys/:id")
        val id = try {
            UUID.fromString(raw)
        } catch (_: IllegalArgumentException) {
            throw HttpException(400, "API key id must be a valid UUID")
        }
        if (!apiKeyService.revokeApiKey(id, workspaceId)) {
            throw HttpException(404, "API key not found")
        }
        exchange.writeEmpty(204)
    }
}
