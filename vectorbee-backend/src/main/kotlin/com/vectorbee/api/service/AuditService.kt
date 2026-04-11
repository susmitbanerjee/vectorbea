package com.vectorbee.api.service

import com.vectorbee.api.http.HttpException
import com.vectorbee.api.model.AuditBatchRequest
import com.vectorbee.api.model.AuditBatchResponse
import com.vectorbee.api.model.AuditLogListItem
import com.vectorbee.api.model.DailyRequestPoint
import com.vectorbee.api.model.DashboardSummary
import com.vectorbee.api.repository.AuditLogRepository
import java.util.UUID

class AuditService(private val auditLogRepository: AuditLogRepository) {
    fun insertBatch(workspaceId: UUID, request: AuditBatchRequest): AuditBatchResponse {
        if (request.logs.isEmpty()) {
            throw HttpException(400, "logs must not be empty")
        }

        request.logs.forEachIndexed { index, log ->
            if (log.proxyLatencyMs < 0) {
                throw HttpException(400, "logs[$index].proxyLatencyMs must be non-negative")
            }
            if (log.llmLatencyMs < 0) {
                throw HttpException(400, "logs[$index].llmLatencyMs must be non-negative")
            }
            if (log.tokenCount < 0) {
                throw HttpException(400, "logs[$index].tokenCount must be non-negative")
            }
            if (log.metadata != null && !log.metadata.isObject) {
                throw HttpException(400, "logs[$index].metadata must be a JSON object")
            }
        }

        val count = auditLogRepository.insertBatch(workspaceId, request.logs)
        return AuditBatchResponse(insertedCount = count)
    }

    fun listRecent(limit: Int = 20, workspaceId: UUID): List<AuditLogListItem> =
        auditLogRepository.listRecent(limit, workspaceId)

    fun getDashboardSummary(workspaceId: UUID): DashboardSummary =
        auditLogRepository.getDashboardSummary(workspaceId)

    fun getRequestsLast7Days(workspaceId: UUID): List<DailyRequestPoint> =
        auditLogRepository.getRequestsLast7Days(workspaceId)

    fun getConnectionStatus(workspaceId: UUID) =
        auditLogRepository.getConnectionStatus(workspaceId)
}
