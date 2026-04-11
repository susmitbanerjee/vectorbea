package com.vectorbee.api.controller

import com.sun.net.httpserver.HttpExchange
import com.vectorbee.api.auth.rbac.requireWorkspaceId
import com.vectorbee.api.http.Json
import com.vectorbee.api.http.HttpException
import com.vectorbee.api.http.readBody
import com.vectorbee.api.http.writeJson
import com.vectorbee.api.model.AuditBatchRequest
import com.vectorbee.api.model.AuditLogInput
import com.vectorbee.api.service.AuditService

class AuditController(private val auditService: AuditService) {
    fun list(exchange: HttpExchange) {
        val workspaceId = exchange.requireWorkspaceId()
        exchange.writeJson(200, auditService.listRecent(workspaceId = workspaceId))
    }

    fun summary(exchange: HttpExchange) {
        val workspaceId = exchange.requireWorkspaceId()
        exchange.writeJson(200, auditService.getDashboardSummary(workspaceId))
    }

    fun requests(exchange: HttpExchange) {
        val workspaceId = exchange.requireWorkspaceId()
        exchange.writeJson(200, auditService.getRequestsLast7Days(workspaceId))
    }

    fun connectionStatus(exchange: HttpExchange) {
        val workspaceId = exchange.requireWorkspaceId()
        exchange.writeJson(200, auditService.getConnectionStatus(workspaceId))
    }

    fun batchInsert(exchange: HttpExchange) {
        val workspaceId = exchange.requireWorkspaceId()
        val body = exchange.readBody()
        val request = try {
            val root = Json.decodeJsonNode(body)
            if (root.isArray) {
                AuditBatchRequest(
                    logs = Json.mapper.convertValue(root, Json.mapper.typeFactory.constructCollectionType(List::class.java, AuditLogInput::class.java))
                )
            } else {
                Json.decode<AuditBatchRequest>(body)
            }
        } catch (_: Exception) {
            throw HttpException(400, "Invalid JSON body")
        }

        val response = auditService.insertBatch(workspaceId, request)
        exchange.writeJson(201, response)
    }
}
