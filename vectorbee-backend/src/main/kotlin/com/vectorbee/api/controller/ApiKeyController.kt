package com.vectorbee.api.controller

import com.sun.net.httpserver.HttpExchange
import com.vectorbee.api.http.HttpException
import com.vectorbee.api.http.Json
import com.vectorbee.api.http.pathParam
import com.vectorbee.api.http.readBody
import com.vectorbee.api.http.uuidQueryParam
import com.vectorbee.api.http.writeEmpty
import com.vectorbee.api.http.writeJson
import com.vectorbee.api.model.CreateApiKeyRequest
import com.vectorbee.api.service.ApiKeyService
import java.util.UUID

class ApiKeyController(private val apiKeyService: ApiKeyService) {
    fun create(exchange: HttpExchange) {
        val request = try {
            Json.decode<CreateApiKeyRequest>(exchange.readBody())
        } catch (_: Exception) {
            throw HttpException(400, "Invalid JSON body")
        }

        val response = apiKeyService.createApiKey(request.organizationId, request.name)
        exchange.writeJson(201, response)
    }

    fun list(exchange: HttpExchange) {
        val organizationId = exchange.uuidQueryParam("organizationId")
        exchange.writeJson(200, apiKeyService.listApiKeys(organizationId))
    }

    fun delete(exchange: HttpExchange) {
        val raw = exchange.pathParam("id", "/api/keys/:id")
        val id = try {
            UUID.fromString(raw)
        } catch (_: IllegalArgumentException) {
            throw HttpException(400, "API key id must be a valid UUID")
        }
        if (!apiKeyService.revokeApiKey(id)) {
            throw HttpException(404, "API key not found")
        }
        exchange.writeEmpty(204)
    }
}
