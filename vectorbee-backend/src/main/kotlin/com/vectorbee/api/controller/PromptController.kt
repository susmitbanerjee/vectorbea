package com.vectorbee.api.controller

import com.sun.net.httpserver.HttpExchange
import com.vectorbee.api.auth.rbac.requireWorkspaceId
import com.vectorbee.api.auth.rbac.requireWorkspaceRole
import com.vectorbee.api.auth.rbac.WorkspaceRole
import com.vectorbee.api.http.HttpException
import com.vectorbee.api.http.Json
import com.vectorbee.api.http.pathParam
import com.vectorbee.api.http.readBody
import com.vectorbee.api.http.writeJson
import com.vectorbee.api.model.CreatePromptRequest
import com.vectorbee.api.model.UpdatePromptRequest
import com.vectorbee.api.service.PromptService
import java.util.UUID

class PromptController(private val promptService: PromptService) {
    fun create(exchange: HttpExchange) {
        exchange.requireWorkspaceRole(WorkspaceRole.EDITOR)
        val workspaceId = exchange.requireWorkspaceId()

        val request = try {
            Json.decode<CreatePromptRequest>(exchange.readBody())
        } catch (_: Exception) {
            throw HttpException(400, "Invalid JSON body")
        }

        val response = promptService.createPrompt(request, workspaceId)
        exchange.writeJson(201, response)
    }

    fun getByReference(exchange: HttpExchange) {
        val workspaceId = exchange.requireWorkspaceId()
        val value = exchange.pathParam("id", "/api/prompts/:id")
        val promptId = value.toUuidOrNull()
        if (promptId != null) {
            exchange.writeJson(200, promptService.getPromptById(promptId, workspaceId))
            return
        }

        val response = promptService.getLatestPrompt(workspaceId, value)
        exchange.writeJson(200, response)
    }

    fun list(exchange: HttpExchange) {
        val workspaceId = exchange.requireWorkspaceId()
        exchange.writeJson(200, promptService.listPrompts(workspaceId))
    }

    fun update(exchange: HttpExchange) {
        exchange.requireWorkspaceRole(WorkspaceRole.EDITOR)
        val workspaceId = exchange.requireWorkspaceId()
        val promptId = parsePromptId(exchange.pathParam("id", "/api/prompts/:id"))
        val request = try {
            Json.decode<UpdatePromptRequest>(exchange.readBody())
        } catch (_: Exception) {
            throw HttpException(400, "Invalid JSON body")
        }

        exchange.writeJson(200, promptService.updatePrompt(promptId, workspaceId, request))
    }

    fun versions(exchange: HttpExchange) {
        val workspaceId = exchange.requireWorkspaceId()
        val promptId = parsePromptId(exchange.pathParam("id", "/api/prompts/:id"))
        exchange.writeJson(200, promptService.listVersions(promptId, workspaceId))
    }

    fun publish(exchange: HttpExchange) {
        exchange.requireWorkspaceRole(WorkspaceRole.EDITOR)
        val workspaceId = exchange.requireWorkspaceId()
        val promptId = parsePromptId(exchange.pathParam("id", "/api/prompts/:id"))
        exchange.writeJson(200, promptService.publishPrompt(promptId, workspaceId))
    }

    private fun parsePromptId(rawValue: String): UUID =
        rawValue.toUuidOrNull() ?: throw HttpException(400, "Prompt id must be a valid UUID")

    private fun String.toUuidOrNull(): UUID? =
        try {
            UUID.fromString(this)
        } catch (_: IllegalArgumentException) {
            null
        }
}
