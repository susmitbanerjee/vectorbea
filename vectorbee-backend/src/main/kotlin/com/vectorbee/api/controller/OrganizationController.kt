package com.vectorbee.api.controller

import com.sun.net.httpserver.HttpExchange
import com.vectorbee.api.http.HttpException
import com.vectorbee.api.http.Json
import com.vectorbee.api.http.readBody
import com.vectorbee.api.http.writeJson
import com.vectorbee.api.model.CreateOrganizationRequest
import com.vectorbee.api.service.OrganizationService

class OrganizationController(private val organizationService: OrganizationService) {
    fun list(exchange: HttpExchange) {
        exchange.writeJson(200, organizationService.list())
    }

    fun create(exchange: HttpExchange) {
        val request = try {
            Json.decode<CreateOrganizationRequest>(exchange.readBody())
        } catch (_: Exception) {
            throw HttpException(400, "Invalid JSON body")
        }

        exchange.writeJson(201, organizationService.create(request))
    }
}
