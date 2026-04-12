package com.vectorbea.api.controller

import com.sun.net.httpserver.HttpExchange
import com.vectorbea.api.auth.rbac.requireUserId
import com.vectorbea.api.http.HttpException
import com.vectorbea.api.http.Json
import com.vectorbea.api.http.pathParam
import com.vectorbea.api.http.readBody
import com.vectorbea.api.http.writeJson
import com.vectorbea.api.model.CreateProjectMemberRequest
import com.vectorbea.api.service.ProjectService
import java.util.UUID

class ProjectController(private val projectService: ProjectService) {
    fun inviteMember(exchange: HttpExchange) {
        val userId = exchange.requireUserId()
        val projectId = parseProjectId(exchange.pathParam("id", "/api/projects/:id/members"))
        val request = try {
            Json.decode<CreateProjectMemberRequest>(exchange.readBody())
        } catch (_: Exception) {
            throw HttpException(400, "Invalid JSON body")
        }

        exchange.writeJson(201, projectService.inviteMember(projectId, userId, request))
    }

    fun listPrompts(exchange: HttpExchange) {
        val userId = exchange.requireUserId()
        val projectId = parseProjectId(exchange.pathParam("id", "/api/projects/:id/prompts"))
        exchange.writeJson(200, projectService.listPrompts(projectId, userId))
    }

    private fun parseProjectId(rawValue: String): UUID =
        try {
            UUID.fromString(rawValue)
        } catch (_: IllegalArgumentException) {
            throw HttpException(400, "Project id must be a valid UUID")
        }
}
