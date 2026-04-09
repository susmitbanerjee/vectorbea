package com.vectorbee.proxy

import com.vectorbee.proxy.cache.PromptCache
import com.vectorbee.proxy.client.HubClient
import com.vectorbee.proxy.config.AppConfig
import com.vectorbee.proxy.grpc.GrpcServer
import com.vectorbee.proxy.grpc.VectorBeeGrpcService
import com.vectorbee.proxy.http.SocketPermissions
import com.vectorbee.proxy.model.AuditAcceptedResponse
import com.vectorbee.proxy.model.AuditEvent
import com.vectorbee.proxy.service.AuditDispatcher
import com.vectorbee.proxy.service.PromptService
import io.ktor.http.HttpStatusCode
import io.ktor.serialization.kotlinx.json.json
import io.ktor.server.application.Application
import io.ktor.server.application.install
import io.ktor.server.cio.CIO
import io.ktor.server.cio.unixConnector
import io.ktor.server.engine.embeddedServer
import io.ktor.server.plugins.calllogging.CallLogging
import io.ktor.server.plugins.contentnegotiation.ContentNegotiation
import io.ktor.server.plugins.statuspages.StatusPages
import io.ktor.server.request.receive
import io.ktor.server.response.respond
import io.ktor.server.routing.get
import io.ktor.server.routing.post
import io.ktor.server.routing.routing
import kotlinx.coroutines.awaitCancellation
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json

fun main() {
    val config = AppConfig.fromEnv()
    val json = Json {
        ignoreUnknownKeys = true
        explicitNulls = false
    }
    val promptCache = PromptCache()
    val hubClient = HubClient(config)
    val promptService = PromptService(promptCache, hubClient)
    val auditDispatcher = AuditDispatcher(config, hubClient)

    auditDispatcher.start()

    // ── Ktor REST server (control plane) on its own UDS ────────────────────
    SocketPermissions.prepareSocketPath(config.restSocketPath)
    val restServer = embeddedServer(CIO, configure = {
        unixConnector(config.restSocketPath)
    }) {
        vectorbeeModule(promptService, auditDispatcher, json)
    }
    restServer.start(wait = false)

    // ── gRPC data-plane server (hot path) on its own UDS ──────────────────
    val grpcService = VectorBeeGrpcService(promptService, auditDispatcher, json)
    val grpcServer = GrpcServer(config.grpcSocketPath, grpcService)
    grpcServer.start()

    Runtime.getRuntime().addShutdownHook(Thread {
        grpcServer.stop()
        restServer.stop(1_000, 5_000)
        auditDispatcher.stop()
    })

    runBlocking {
        SocketPermissions.waitForSocketAndSetPermissions(config.restSocketPath)
    }

    println(
        "vectorbee proxy ready — REST unix:${config.restSocketPath}, " +
            "gRPC unix:${config.grpcSocketPath}"
    )
    runBlocking {
        awaitCancellation()
    }
}

private fun Application.vectorbeeModule(
    promptService: PromptService,
    auditDispatcher: AuditDispatcher,
    json: Json
) {
    install(CallLogging)
    install(ContentNegotiation) {
        json(json)
    }
    install(StatusPages) {
        exception<Throwable> { call, cause ->
            call.respond(
                HttpStatusCode.InternalServerError,
                mapOf("error" to (cause.message ?: "internal server error"))
            )
        }
    }

    routing {
        get("/v1/prompts/{name}") {
            val name = call.parameters["name"]
                ?: return@get call.respond(HttpStatusCode.BadRequest, mapOf("error" to "missing prompt name"))
            val prompt = promptService.getPrompt(name)
            call.respond(HttpStatusCode.OK, prompt)
        }

        post("/v1/audit") {
            val event = call.receive<AuditEvent>()
            auditDispatcher.tryEnqueue(event)
            call.respond(HttpStatusCode.Accepted, AuditAcceptedResponse(accepted = true))
        }
    }
}
