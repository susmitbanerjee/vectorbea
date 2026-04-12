package com.vectorbea.api

import com.sun.net.httpserver.HttpServer
import com.vectorbea.api.auth.AuthFilter
import com.vectorbea.api.config.AppConfig
import com.vectorbea.api.controller.ApiKeyController
import com.vectorbea.api.controller.AuditController
import com.vectorbea.api.controller.OrganizationController
import com.vectorbea.api.controller.ProjectController
import com.vectorbea.api.controller.PromptController
import com.vectorbea.api.controller.WorkspaceController
import com.vectorbea.api.db.Database
import com.vectorbea.api.db.SchemaMigrator
import com.vectorbea.api.http.Router
import com.vectorbea.api.repository.ApiKeyRepository
import com.vectorbea.api.repository.AuditLogRepository
import com.vectorbea.api.repository.OrganizationRepository
import com.vectorbea.api.repository.ProjectMemberRepository
import com.vectorbea.api.repository.PromptRepository
import com.vectorbea.api.repository.WorkspaceRepository
import com.vectorbea.api.service.ApiKeyService
import com.vectorbea.api.service.AuditService
import com.vectorbea.api.service.AuthService
import com.vectorbea.api.service.OrganizationService
import com.vectorbea.api.service.ProjectService
import com.vectorbea.api.service.PromptService
import com.vectorbea.api.service.WorkspaceService
import java.net.InetSocketAddress
import java.util.concurrent.Executors

fun main() {
    val config = AppConfig.fromEnv()
    val database = Database(config)
    SchemaMigrator(database).migrate()

    val apiKeyRepository = ApiKeyRepository(database)
    val promptRepository = PromptRepository(database)
    val auditLogRepository = AuditLogRepository(database)
    val organizationRepository = OrganizationRepository(database)
    val workspaceRepository = WorkspaceRepository(database)
    val projectMemberRepository = ProjectMemberRepository(database)

    val authService = AuthService(apiKeyRepository, config.environment)
    val apiKeyService = ApiKeyService(apiKeyRepository)
    val promptService = PromptService(promptRepository)
    val auditService = AuditService(auditLogRepository)
    val organizationService = OrganizationService(organizationRepository)
    val workspaceService = WorkspaceService(workspaceRepository)
    val projectService = ProjectService(projectMemberRepository, promptRepository)

    val apiKeyController = ApiKeyController(apiKeyService)
    val promptController = PromptController(promptService)
    val auditController = AuditController(auditService)
    val organizationController = OrganizationController(organizationService)
    val workspaceController = WorkspaceController(workspaceService)
    val projectController = ProjectController(projectService)

    val router = Router().apply {
        post("/api/keys") { exchange -> apiKeyController.create(exchange) }
        get("/api/keys") { exchange -> apiKeyController.list(exchange) }
        delete("/api/keys/:id") { exchange -> apiKeyController.delete(exchange) }
        get("/api/organizations") { exchange -> organizationController.list(exchange) }
        post("/api/organizations") { exchange -> organizationController.create(exchange) }
        post("/api/workspaces") { exchange -> workspaceController.create(exchange) }
        post("/api/projects/:id/members") { exchange -> projectController.inviteMember(exchange) }
        get("/api/projects/:id/prompts") { exchange -> projectController.listPrompts(exchange) }
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
        post("/api/audit/batch") { exchange -> auditController.batchInsert(exchange) }
    }

    val server = HttpServer.create(InetSocketAddress(config.port), 0).apply {
        createContext("/", router).filters.add(
            AuthFilter(
                authService = authService,
                protectedRoutes = listOf(
                    // API key management — ADMIN only (enforced in controller)
                    AuthFilter.RouteDefinition("POST", "/api/keys"),
                    AuthFilter.RouteDefinition("GET", "/api/keys"),
                    AuthFilter.RouteDefinition("DELETE", "/api/keys/:id"),
                    // Organization management — authenticated
                    AuthFilter.RouteDefinition("GET", "/api/organizations"),
                    AuthFilter.RouteDefinition("POST", "/api/organizations"),
                    // Workspace management — ADMIN only (enforced in controller)
                    AuthFilter.RouteDefinition("POST", "/api/workspaces"),
                    AuthFilter.RouteDefinition("POST", "/api/projects/:id/members"),
                    AuthFilter.RouteDefinition("GET", "/api/projects/:id/prompts"),
                    // Prompt operations — authenticated (role enforced in controller)
                    AuthFilter.RouteDefinition("POST", "/api/prompts"),
                    AuthFilter.RouteDefinition("GET", "/api/prompts"),
                    AuthFilter.RouteDefinition("GET", "/api/prompts/:id"),
                    AuthFilter.RouteDefinition("GET", "/api/prompts/:id/versions"),
                    AuthFilter.RouteDefinition("POST", "/api/prompts/:id"),
                    AuthFilter.RouteDefinition("POST", "/api/prompts/:id/publish"),
                    // Audit & dashboard — authenticated
                    AuthFilter.RouteDefinition("GET", "/api/audit"),
                    AuthFilter.RouteDefinition("POST", "/api/audit/batch"),
                    AuthFilter.RouteDefinition("GET", "/api/dashboard/summary"),
                    AuthFilter.RouteDefinition("GET", "/api/dashboard/requests"),
                    AuthFilter.RouteDefinition("GET", "/api/dashboard/connection-status"),
                )
            )
        )
        executor = Executors.newFixedThreadPool(Runtime.getRuntime().availableProcessors().coerceAtLeast(4))
    }

    server.start()
    println("vectorbea Central Hub API listening on port ${config.port} [env=${config.environment}]")
    if (config.environment.isLocal) {
        println("  ⚠  LOCAL mode: Bearer ${com.vectorbea.api.service.AuthService.LOCAL_BYPASS_TOKEN} accepted without DB lookup")
    }
}
