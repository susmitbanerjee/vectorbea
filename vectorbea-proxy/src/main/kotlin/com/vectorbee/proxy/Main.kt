package com.vectorbea.proxy

import com.vectorbea.proxy.cache.PromptCache
import com.vectorbea.proxy.client.HubClient
import com.vectorbea.proxy.config.AppConfig
import com.vectorbea.proxy.grpc.GrpcServer
import com.vectorbea.proxy.grpc.VectorBeaGrpcService
import com.vectorbea.proxy.http.SocketPermissions
import com.vectorbea.proxy.model.AuditAcceptedResponse
import com.vectorbea.proxy.model.AuditEvent
import com.vectorbea.proxy.service.AuditDispatcher
import com.vectorbea.proxy.service.PromptService
import com.vectorbea.proxy.service.SharedRulesStore
import com.vectorbea.proxy.service.TelemetryDispatcher
import io.ktor.http.HttpStatusCode
import io.ktor.serialization.kotlinx.json.json
import io.ktor.server.application.Application
import io.ktor.server.application.install
import io.ktor.server.cio.CIO
import io.ktor.server.cio.CIOApplicationEngine
import io.ktor.server.cio.unixConnector
import io.ktor.server.engine.EmbeddedServer
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
    val sharedRulesStore = SharedRulesStore(config.sharedRulesPath, json)
    val promptService = PromptService(promptCache, hubClient, sharedRulesStore)
    val auditDispatcher = AuditDispatcher(config, hubClient)
    val telemetryDispatcher = TelemetryDispatcher(config)

    auditDispatcher.start()
    telemetryDispatcher.start()

    runBlocking {
        warmup(hubClient, promptCache)
    }

    val httpServer = embeddedServer(CIO, port = config.httpPort, host = "0.0.0.0") {
        vectorbeaModule(promptService, auditDispatcher, json)
    }
    httpServer.start(wait = false)

    val restServer = startRestSocketServer(config, promptService, auditDispatcher, json)

    val grpcService = VectorBeaGrpcService(
        promptService = promptService,
        auditDispatcher = auditDispatcher,
        json = json,
        telemetryDispatcher = telemetryDispatcher,
    )
    val grpcServer = config.grpcSocketPath?.let { socketPath ->
        GrpcServer(socketPath, grpcService).also { it.start() }
    }

    Runtime.getRuntime().addShutdownHook(Thread {
        grpcServer?.stop()
        httpServer.stop(1_000, 5_000)
        restServer?.stop(1_000, 5_000)
        auditDispatcher.stop()
        telemetryDispatcher.stop()
    })

    config.restSocketPath?.let { socketPath ->
        runBlocking {
            SocketPermissions.waitForSocketAndSetPermissions(socketPath)
        }
    }

    val readyTargets = buildList {
        add("HTTP :${config.httpPort}")
        config.restSocketPath?.let { add("REST unix:$it") }
        config.grpcSocketPath?.let { add("gRPC unix:$it") }
    }
    println("vectorbea proxy ready - ${readyTargets.joinToString(", ")}")

    runBlocking {
        awaitCancellation()
    }
}

private fun startRestSocketServer(
    config: AppConfig,
    promptService: PromptService,
    auditDispatcher: AuditDispatcher,
    json: Json,
): EmbeddedServer<CIOApplicationEngine, CIOApplicationEngine.Configuration>? {
    val socketPath = config.restSocketPath ?: return null

    SocketPermissions.prepareSocketPath(socketPath)
    return embeddedServer(CIO, configure = {
        unixConnector(socketPath)
    }) {
        vectorbeaModule(promptService, auditDispatcher, json)
    }.also { it.start(wait = false) }
}

private suspend fun warmup(hubClient: HubClient, promptCache: PromptCache) {
    val started = System.currentTimeMillis()

    hubClient.warmup()

    runCatching {
        promptCache.getOrLoad("__warmup__") {
            error("warmup sentinel - never actually fetched")
        }
    }
    promptCache.invalidate("__warmup__")

    val elapsed = System.currentTimeMillis() - started
    println("vectorbea warmup complete in ${elapsed} ms")
}

private fun Application.vectorbeaModule(
    promptService: PromptService,
    auditDispatcher: AuditDispatcher,
    json: Json,
) {
    install(CallLogging)
    install(ContentNegotiation) {
        json(json)
    }
    install(StatusPages) {
        exception<Throwable> { call, cause ->
            call.respond(
                HttpStatusCode.InternalServerError,
                mapOf("error" to (cause.message ?: "internal server error")),
            )
        }
    }

    routing {
        get("/v1/prompts/{name}") {
            val name = call.parameters["name"]
                ?: return@get call.respond(
                    HttpStatusCode.BadRequest,
                    mapOf("error" to "missing prompt name"),
                )
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
