package com.vectorbee.proxy.model

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonObject

@Serializable
data class PromptPayload(
    val promptId: String,
    val promptVersionId: String,
    val organizationId: String,
    val name: String,
    val description: String? = null,
    val versionTag: String,
    val templateText: String,
    val parameters: JsonObject,
    val createdAt: String
)

@Serializable
data class AuditEvent(
    val promptVersionId: String,
    val proxyLatencyMs: Double,
    val llmLatencyMs: Int,
    val tokenCount: Int,
    val metadata: JsonObject = JsonObject(emptyMap())
)

@Serializable
data class AuditAcceptedResponse(
    val accepted: Boolean
)
