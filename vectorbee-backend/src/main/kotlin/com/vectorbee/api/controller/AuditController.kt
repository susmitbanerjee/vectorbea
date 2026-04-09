package com.vectorbee.api.controller

import com.sun.net.httpserver.HttpExchange
import com.vectorbee.api.http.Json
import com.vectorbee.api.http.HttpException
import com.vectorbee.api.http.readBody
import com.vectorbee.api.http.requestContext
import com.vectorbee.api.http.uuidQueryParam
import com.vectorbee.api.http.writeJson
import com.vectorbee.api.model.AuditBatchRequest
import com.vectorbee.api.model.AuditLogInput
import com.vectorbee.api.service.AuditService

class AuditController(private val auditService: AuditService) {
    fun list(exchange: HttpExchange) {
        val organizationId = exchange.uuidQueryParam("organizationId")
        exchange.writeJson(200, auditService.listRecent(organizationId = organizationId))
    }

    fun summary(exchange: HttpExchange) {
        val organizationId = exchange.uuidQueryParam("organizationId")
        exchange.writeJson(200, auditService.getDashboardSummary(organizationId))
    }

    fun requests(exchange: HttpExchange) {
        val organizationId = exchange.uuidQueryParam("organizationId")
        exchange.writeJson(200, auditService.getRequestsLast7Days(organizationId))
    }

    fun connectionStatus(exchange: HttpExchange) {
        val organizationId = exchange.uuidQueryParam("organizationId")
            ?: throw HttpException(400, "organizationId is required")
        exchange.writeJson(200, auditService.getConnectionStatus(organizationId))
    }

    fun batchInsert(exchange: HttpExchange) {
        val organizationId = exchange.requestContext().organizationId
            ?: throw HttpException(401, "Unauthorized")
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

        val response = auditService.insertBatch(organizationId, request)
        exchange.writeJson(201, response)
    }
}
