package com.vectorbea.api.service

import com.vectorbea.api.model.WorkspaceView
import com.vectorbea.api.repository.WorkspaceRepository
import java.util.UUID

class WorkspaceService(private val workspaceRepository: WorkspaceRepository) {
    fun create(organizationId: UUID, name: String): WorkspaceView =
        workspaceRepository.create(organizationId, name)
}
