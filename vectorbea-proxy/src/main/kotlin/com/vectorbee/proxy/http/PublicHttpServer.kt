package com.vectorbea.proxy.http

import com.sun.net.httpserver.HttpExchange
import com.sun.net.httpserver.HttpServer
import com.vectorbea.proxy.model.AuditAcceptedResponse
import com.vectorbea.proxy.model.AuditEvent
import com.vectorbea.proxy.model.PromptPayload
import com.vectorbea.proxy.model.TraceMetadataBuilder
import com.vectorbea.proxy.model.WorkflowIngestAcceptedResponse
import com.vectorbea.proxy.model.WorkflowTraceEnvelope
import com.vectorbea.proxy.service.AuditDispatcher
import com.vectorbea.proxy.service.PromptService
import com.vectorbea.proxy.service.WorkflowTelemetryDispatcher
import java.net.InetSocketAddress
import java.net.URLDecoder
import java.nio.charset.StandardCharsets
import java.util.concurrent.Executors
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.builtins.serializer
import kotlinx.serialization.json.Json

class PublicHttpServer(
    private val port: Int,
    private val promptService: PromptService,
    private val auditDispatcher: AuditDispatcher,
    private val workflowDispatcher: WorkflowTelemetryDispatcher,
    private val json: Json,
) {
    private val server = HttpServer.create(InetSocketAddress("0.0.0.0", port), 0).apply {
        createContext("/v1/prompts") { exchange -> handlePrompt(exchange) }
        createContext("/v1/audit") { exchange -> handleAudit(exchange) }
        createContext("/v1/traces") { exchange -> handleWorkflowTrace(exchange) }
        createContext("/v1/events") { exchange -> handleWorkflowTrace(exchange) }
        createContext("/health") { exchange -> handleHealth(exchange) }
        createContext("/metrics") { exchange -> handleMetrics(exchange) }
        executor = Executors.newFixedThreadPool(4)
    }

    fun start() {
        server.start()
    }

    fun stop() {
        server.stop(1)
    }

    private fun handlePrompt(exchange: HttpExchange) {
        if (exchange.requestMethod != "GET") {
            respond(exchange, 405, """{"error":"method not allowed"}""")
            return
        }

        val name = exchange.requestURI.path
            .removePrefix("/v1/prompts/")
            .takeIf { it.isNotBlank() }
            ?.let { URLDecoder.decode(it, StandardCharsets.UTF_8) }

        if (name == null) {
            respond(exchange, 400, """{"error":"missing prompt name"}""")
            return
        }

        runCatching {
            runBlocking { promptService.getPrompt(name) }
        }.onSuccess { prompt ->
            respondJson(exchange, 200, PromptPayload.serializer(), prompt)
        }.onFailure { error ->
            respond(
                exchange,
                500,
                """{"error":${json.encodeToString(String.serializer(), error.message ?: "internal server error")}}""",
            )
        }
    }

    private fun handleAudit(exchange: HttpExchange) {
        if (exchange.requestMethod != "POST") {
            respond(exchange, 405, """{"error":"method not allowed"}""")
            return
        }

        runCatching {
            val body = exchange.requestBody.bufferedReader(StandardCharsets.UTF_8).use { it.readText() }
            val event = json.decodeFromString(AuditEvent.serializer(), body)
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
        }.onSuccess {
            respondJson(exchange, 202, AuditAcceptedResponse.serializer(), AuditAcceptedResponse(accepted = true))
        }.onFailure { error ->
            respond(
                exchange,
                500,
                """{"error":${json.encodeToString(String.serializer(), error.message ?: "internal server error")}}""",
            )
        }
    }

    private fun handleWorkflowTrace(exchange: HttpExchange) {
        if (exchange.requestMethod != "POST") {
            respond(exchange, 405, """{"error":"method not allowed"}""")
            return
        }

        runCatching {
            val body = exchange.requestBody.bufferedReader(StandardCharsets.UTF_8).use { it.readText() }
            val trace = json.decodeFromString(WorkflowTraceEnvelope.serializer(), body)
            workflowDispatcher.tryEnqueue(trace)
        }.onSuccess { accepted ->
            val response = if (accepted) {
                WorkflowIngestAcceptedResponse(accepted = true, queued = true)
            } else {
                WorkflowIngestAcceptedResponse(
                    accepted = false,
                    queued = false,
                    dropped = true,
                    message = "Local sidecar queue is full",
                )
            }
            respondJson(
                exchange,
                if (accepted) 202 else 503,
                WorkflowIngestAcceptedResponse.serializer(),
                response,
            )
        }.onFailure { error ->
            respond(
                exchange,
                500,
                """{"error":${json.encodeToString(String.serializer(), error.message ?: "internal server error")}}""",
            )
        }
    }

    private fun handleHealth(exchange: HttpExchange) {
        if (exchange.requestMethod != "GET") {
            respond(exchange, 405, """{"error":"method not allowed"}""")
            return
        }

        respondJson(exchange, 200, com.vectorbea.proxy.model.WorkflowTelemetryHealth.serializer(), workflowDispatcher.snapshot())
    }

    private fun handleMetrics(exchange: HttpExchange) {
        if (exchange.requestMethod != "GET") {
            respond(exchange, 405, """{"error":"method not allowed"}""")
            return
        }

        val body = workflowDispatcher.prometheusMetrics()
        val bytes = body.toByteArray(StandardCharsets.UTF_8)
        exchange.responseHeaders.add("Content-Type", "text/plain; version=0.0.4; charset=utf-8")
        exchange.sendResponseHeaders(200, bytes.size.toLong())
        exchange.responseBody.use { output -> output.write(bytes) }
    }

    private fun <T> respondJson(
        exchange: HttpExchange,
        status: Int,
        serializer: kotlinx.serialization.KSerializer<T>,
        payload: T,
    ) {
        respond(exchange, status, json.encodeToString(serializer, payload))
    }

    private fun respond(exchange: HttpExchange, status: Int, body: String) {
        val bytes = body.toByteArray(StandardCharsets.UTF_8)
        exchange.responseHeaders.add("Content-Type", "application/json")
        exchange.sendResponseHeaders(status, bytes.size.toLong())
        exchange.responseBody.use { output ->
            output.write(bytes)
        }
    }
}
