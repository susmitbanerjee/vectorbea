package com.vectorbea.proxy

import com.vectorbea.proxy.cache.PromptCache
import com.vectorbea.proxy.cache.AuthCache
import com.vectorbea.proxy.client.HubClient
import com.vectorbea.proxy.config.AppConfig
import com.vectorbea.proxy.grpc.GrpcServer
import com.vectorbea.proxy.grpc.VectorBeaGrpcService
import com.vectorbea.proxy.http.PublicHttpServer
import com.vectorbea.proxy.http.SocketPermissions
import com.vectorbea.proxy.model.AuditAcceptedResponse
import com.vectorbea.proxy.model.AuditEvent
import com.vectorbea.proxy.model.PromptPayload
import com.vectorbea.proxy.model.TraceMetadataBuilder
import com.vectorbea.proxy.service.AuditDispatcher
import com.vectorbea.proxy.service.PromptService
import com.vectorbea.proxy.service.SharedRulesStore
import com.vectorbea.proxy.service.SyncDispatcher
import com.vectorbea.proxy.service.TelemetryDispatcher
import io.ktor.http.ContentType
import io.ktor.http.HttpStatusCode
import io.ktor.server.application.Application
import io.ktor.server.application.install
import io.ktor.server.cio.CIO
import io.ktor.server.cio.CIOApplicationEngine
import io.ktor.server.cio.unixConnector
import io.ktor.server.engine.EmbeddedServer
import io.ktor.server.engine.embeddedServer
import io.ktor.server.plugins.calllogging.CallLogging
import io.ktor.server.plugins.statuspages.StatusPages
import io.ktor.server.request.receiveText
import io.ktor.server.response.respondText
import io.ktor.server.routing.get
import io.ktor.server.routing.post
import io.ktor.server.routing.routing
import kotlinx.coroutines.awaitCancellation
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json

fun main() {
    if (System.getProperty("org.slf4j.simpleLogger.defaultLogLevel").isNullOrBlank()) {
        System.setProperty("org.slf4j.simpleLogger.defaultLogLevel", "info")
    }
    if (System.getProperty("org.slf4j.simpleLogger.log.io.netty").isNullOrBlank()) {
        System.setProperty("org.slf4j.simpleLogger.log.io.netty", "warn")
    }
    if (System.getProperty("org.slf4j.simpleLogger.log.io.ktor").isNullOrBlank()) {
        System.setProperty("org.slf4j.simpleLogger.log.io.ktor", "info")
    }

    val config = AppConfig.fromEnv()
    val json = Json {
        ignoreUnknownKeys = true
        explicitNulls = false
    }
    val promptCache = PromptCache()
    val hubClient = HubClient(config)
    val sharedRulesStore = SharedRulesStore(config.sharedRulesPath, json)
    val authCache = AuthCache(validator = { hubClient.validateAgentToken() })
    val promptService = PromptService(promptCache, authCache, config.apiKey, hubClient, sharedRulesStore)
    val auditDispatcher = AuditDispatcher(config, hubClient)
    val telemetryDispatcher = TelemetryDispatcher(config)
    val syncDispatcher = SyncDispatcher(config, hubClient, promptService)

    auditDispatcher.start()
    telemetryDispatcher.start()
    syncDispatcher.start()

    runBlocking {
        warmup(hubClient, promptCache)
    }

    val httpServer = PublicHttpServer(
        port = config.httpPort,
        promptService = promptService,
        auditDispatcher = auditDispatcher,
        json = json,
    )
    httpServer.start()

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
        httpServer.stop()
        restServer?.stop(1_000, 5_000)
        auditDispatcher.stop()
        telemetryDispatcher.stop()
        syncDispatcher.stop()
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
    install(StatusPages) {
        exception<Throwable> { call, cause ->
            // Explicit JSON string — no ContentNegotiation / reflection needed.
            val message = cause.message?.replace("\"", "\\\"") ?: "internal server error"
            call.respondText(
                """{"error":"$message"}""",
                ContentType.Application.Json,
                HttpStatusCode.InternalServerError,
            )
        }
    }

    routing {
        get("/v1/prompts/{name}") {
            val name = call.parameters["name"]
                ?: return@get call.respondText(
                    """{"error":"missing prompt name"}""",
                    ContentType.Application.Json,
                    HttpStatusCode.BadRequest,
                )
            val prompt = promptService.getPrompt(name)
            // Use the compiler-generated serializer explicitly — this avoids
            // Ktor's ContentNegotiation / reflection-based KClass lookup, which
            // breaks under ProGuard obfuscation even when the $serializer class
            // survives. Calling PromptPayload.serializer() directly is resolved
            // at compile time and is always safe after obfuscation.
            call.respondText(
                json.encodeToString(PromptPayload.serializer(), prompt),
                ContentType.Application.Json,
                HttpStatusCode.OK,
            )
        }

        post("/v1/audit") {
            val bodyText = call.receiveText()
            val event = json.decodeFromString(AuditEvent.serializer(), bodyText)
            val normalized = event.copy(
                metadata = TraceMetadataBuilder.normalize(
                    metadata = event.metadata,
                    promptVersionId = event.promptVersionId,
                    promptName = event.promptName,
                    versionTag = event.versionTag,
                    proxyLatencyMs = event.proxyLatencyMs,
                    llmLatencyMs = event.llmLatencyMs,
                    tokenCount = event.tokenCount,
                    useType = "runtime",
                ),
            )
            auditDispatcher.tryEnqueue(normalized)
            call.respondText(
                json.encodeToString(AuditAcceptedResponse.serializer(), AuditAcceptedResponse(accepted = true)),
                ContentType.Application.Json,
                HttpStatusCode.Accepted,
            )
        }
    }
}
