package com.vectorbee.api.service

import com.vectorbee.api.model.WorkspaceView
import com.vectorbee.api.repository.WorkspaceRepository
import java.util.UUID

class WorkspaceService(private val workspaceRepository: WorkspaceRepository) {
    fun create(organizationId: UUID, name: String): WorkspaceView =
        workspaceRepository.create(organizationId, name)
}
