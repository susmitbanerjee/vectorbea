package com.vectorbea.api.model

import com.fasterxml.jackson.databind.JsonNode
import com.vectorbea.api.auth.rbac.WorkspaceRole
import java.time.OffsetDateTime
import java.util.UUID

/**
 * Resolved identity returned after a successful Bearer token authentication.
 * Lives in model so both AuthService (service) and ApiKeyRepository (repository)
 * can import it without creating a circular dependency.
 */
data class AuthResult(
    val workspaceId: UUID,
    val organizationId: UUID,
    val workspaceRole: WorkspaceRole,
)

data class CreateApiKeyRequest(
    val name: String? = null,
    /** Optional role for the new key; defaults to "editor" if omitted. */
    val role: String? = null
)

data class OrganizationView(
    val id: UUID,
    val name: String,
    val createdAt: OffsetDateTime
)

data class CreateOrganizationRequest(
    val name: String
)

data class WorkspaceView(
    val id: UUID,
    val organizationId: UUID,
    val name: String,
    val createdAt: OffsetDateTime
)

data class CreateWorkspaceRequest(
    val name: String
)

data class CreateApiKeyResponse(
    val id: UUID,
    val workspaceId: UUID,
    val name: String,
    val apiKey: String,
    val createdAt: OffsetDateTime
)

data class ApiKeyView(
    val id: UUID,
    val workspaceId: UUID,
    val name: String,
    val maskedKey: String,
    val createdAt: OffsetDateTime
)

data class CreatePromptRequest(
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
    val workspaceId: UUID,
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
    val workspaceId: UUID,
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
    val workspaceId: UUID,
    val name: String,
    val keyHash: String,
    val keyLastFour: String,
    val createdAt: OffsetDateTime
)

data class PromptRecord(
    val id: UUID,
    val workspaceId: UUID,
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
