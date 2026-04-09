package com.vectorbee.api.model

import com.fasterxml.jackson.databind.JsonNode
import java.time.OffsetDateTime
import java.util.UUID

data class CreateApiKeyRequest(
    val organizationId: UUID,
    val name: String? = null
)

data class OrganizationView(
    val id: UUID,
    val name: String,
    val createdAt: OffsetDateTime
)

data class CreateOrganizationRequest(
    val name: String
)

data class CreateApiKeyResponse(
    val id: UUID,
    val organizationId: UUID,
    val name: String,
    val apiKey: String,
    val createdAt: OffsetDateTime
)

data class ApiKeyView(
    val id: UUID,
    val organizationId: UUID,
    val name: String,
    val maskedKey: String,
    val createdAt: OffsetDateTime
)

data class CreatePromptRequest(
    val organizationId: UUID?,
    val name: String,
    val description: String?,
    val versionTag: String,
    val templateText: String,
    val parameters: JsonNode?
)

data class CreatePromptResponse(
    val promptId: UUID,
    val promptVersionId: UUID,
    val name: String,
    val versionTag: String
)

data class PromptVersionView(
    val promptId: UUID,
    val promptVersionId: UUID,
    val organizationId: UUID,
    val name: String,
    val description: String?,
    val versionTag: String,
    val templateText: String,
    val parameters: JsonNode,
    val isPublished: Boolean,
    val createdAt: OffsetDateTime
)

data class PromptListItem(
    val id: UUID,
    val name: String,
    val description: String?,
    val latestVersion: String,
    val isPublished: Boolean,
    val updatedAt: OffsetDateTime
)

data class UpdatePromptRequest(
    val description: String?,
    val templateText: String,
    val parameters: JsonNode?,
    val versionTag: String?
)

data class AuditLogInput(
    val promptVersionId: UUID,
    val proxyLatencyMs: Double,
    val llmLatencyMs: Int,
    val tokenCount: Int,
    val metadata: JsonNode?
)

data class AuditBatchRequest(
    val logs: List<AuditLogInput>
)

data class AuditBatchResponse(
    val insertedCount: Int
)

data class AuditLogListItem(
    val timestamp: OffsetDateTime,
    val promptName: String,
    val versionTag: String,
    val proxyLatencyMs: Double,
    val llmLatencyMs: Int,
    val tokenCount: Int,
    val organizationId: UUID,
    val metadata: JsonNode
)

data class DashboardSummary(
    val totalApiCallsLast24h: Long,
    val averageLatencyMs: Int,
    val activeAgents: Int
)

data class DailyRequestPoint(
    val day: String,
    val requests: Long
)

data class ConnectionStatus(
    val connected: Boolean,
    val lastSeenAt: OffsetDateTime?,
    val recentCallCount: Long
)

data class ApiKeyRecord(
    val id: UUID,
    val organizationId: UUID,
    val name: String,
    val keyHash: String,
    val keyLastFour: String,
    val createdAt: OffsetDateTime
)

data class PromptRecord(
    val id: UUID,
    val organizationId: UUID,
    val name: String,
    val description: String?,
    val createdAt: OffsetDateTime
)

data class PromptVersionRecord(
    val id: UUID,
    val promptId: UUID,
    val versionTag: String,
    val templateText: String,
    val parameters: JsonNode,
    val createdAt: OffsetDateTime
)
