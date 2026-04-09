package com.vectorbee.proxy.client

import com.vectorbee.proxy.config.AppConfig
import com.vectorbee.proxy.model.AuditEvent
import com.vectorbee.proxy.model.PromptPayload
import io.ktor.client.HttpClient
import io.ktor.client.call.body
import io.ktor.client.engine.cio.CIO
import io.ktor.client.plugins.contentnegotiation.ContentNegotiation
import io.ktor.client.plugins.defaultRequest
import io.ktor.client.request.accept
import io.ktor.client.request.get
import io.ktor.client.request.header
import io.ktor.client.request.post
import io.ktor.client.request.setBody
import io.ktor.client.statement.bodyAsText
import io.ktor.http.ContentType
import io.ktor.http.HttpHeaders
import io.ktor.http.encodeURLPathPart
import io.ktor.http.isSuccess
import io.ktor.serialization.kotlinx.json.json
import kotlinx.serialization.json.Json

class HubClient(private val config: AppConfig) {
    private val json = Json {
        ignoreUnknownKeys = true
        explicitNulls = false
    }

    private val client = HttpClient(CIO) {
        install(ContentNegotiation) {
            json(json)
        }
        defaultRequest {
            url(config.hubUrl)
            header(HttpHeaders.Authorization, "Bearer ${config.apiKey}")
            accept(ContentType.Application.Json)
            header(HttpHeaders.ContentType, ContentType.Application.Json.toString())
        }
    }

    suspend fun fetchPrompt(name: String): PromptPayload =
        client.get("${config.hubUrl}/api/prompts/${name.encodeURLPathPart()}").body()

    suspend fun flushAuditBatch(logs: List<AuditEvent>) {
        val response = client.post("${config.hubUrl}/api/audit/batch") {
            setBody(logs)
        }

        if (!response.status.isSuccess()) {
            error("Hub rejected audit batch with ${response.status.value}: ${response.bodyAsText()}")
        }
    }

    fun close() {
        client.close()
    }
}
