package com.vectorbee.api

import com.sun.net.httpserver.HttpServer
import com.vectorbee.api.auth.AuthFilter
import com.vectorbee.api.config.AppConfig
import com.vectorbee.api.controller.ApiKeyController
import com.vectorbee.api.controller.AuditController
import com.vectorbee.api.controller.OrganizationController
import com.vectorbee.api.controller.PromptController
import com.vectorbee.api.db.Database
import com.vectorbee.api.http.Router
import com.vectorbee.api.repository.ApiKeyRepository
import com.vectorbee.api.repository.AuditLogRepository
import com.vectorbee.api.repository.OrganizationRepository
import com.vectorbee.api.repository.PromptRepository
import com.vectorbee.api.service.ApiKeyService
import com.vectorbee.api.service.AuditService
import com.vectorbee.api.service.AuthService
import com.vectorbee.api.service.OrganizationService
import com.vectorbee.api.service.PromptService
import java.net.InetSocketAddress
import java.util.concurrent.Executors

fun main() {
    val config = AppConfig.fromEnv()
    val database = Database(config)

    val apiKeyRepository = ApiKeyRepository(database)
    val promptRepository = PromptRepository(database)
    val auditLogRepository = AuditLogRepository(database)
    val organizationRepository = OrganizationRepository(database)

    val authService = AuthService(apiKeyRepository)
    val apiKeyService = ApiKeyService(apiKeyRepository)
    val promptService = PromptService(promptRepository)
    val auditService = AuditService(auditLogRepository)
    val organizationService = OrganizationService(organizationRepository)

    val apiKeyController = ApiKeyController(apiKeyService)
    val promptController = PromptController(promptService)
    val auditController = AuditController(auditService)
    val organizationController = OrganizationController(organizationService)

    val router = Router().apply {
        post("/api/keys") { exchange -> apiKeyController.create(exchange) }
        get("/api/keys") { exchange -> apiKeyController.list(exchange) }
        delete("/api/keys/:id") { exchange -> apiKeyController.delete(exchange) }
        get("/api/organizations") { exchange -> organizationController.list(exchange) }
        post("/api/organizations") { exchange -> organizationController.create(exchange) }
        post("/api/prompts") { exchange -> promptController.create(exchange) }
        get("/api/prompts") { exchange -> promptController.list(exchange) }
        get("/api/prompts/:id") { exchange -> promptController.getByReference(exchange) }
        get("/api/prompts/:id/versions") { exchange -> promptController.versions(exchange) }
        post("/api/prompts/:id") { exchange -> promptController.update(exchange) }
        post("/api/prompts/:id/publish") { exchange -> promptController.publish(exchange) }
        get("/api/audit") { exchange -> auditController.list(exchange) }
        get("/api/dashboard/summary") { exchange -> auditController.summary(exchange) }
        get("/api/dashboard/requests") { exchange -> auditController.requests(exchange) }
        get("/api/dashboard/connection-status") { exchange -> auditController.connectionStatus(exchange) }
        post("/api/audit/batch", authRequired = true) { exchange -> auditController.batchInsert(exchange) }
    }

    val server = HttpServer.create(InetSocketAddress(config.port), 0).apply {
        createContext("/", router).filters.add(
            AuthFilter(
                authService = authService,
                protectedRoutes = listOf(
                    AuthFilter.RouteDefinition("POST", "/api/prompts"),
                    AuthFilter.RouteDefinition("GET", "/api/prompts/:id"),
                    AuthFilter.RouteDefinition("GET", "/api/prompts/:id/versions"),
                    AuthFilter.RouteDefinition("POST", "/api/prompts/:id"),
                    AuthFilter.RouteDefinition("POST", "/api/prompts/:id/publish"),
                    AuthFilter.RouteDefinition("POST", "/api/audit/batch")
                )
            )
        )
        executor = Executors.newFixedThreadPool(Runtime.getRuntime().availableProcessors().coerceAtLeast(4))
    }

    server.start()
    println("vectorbee Central Hub API listening on port ${config.port}")
}
