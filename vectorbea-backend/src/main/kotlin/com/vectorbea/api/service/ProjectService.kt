package com.vectorbea.api.service

import com.vectorbea.api.auth.rbac.WorkspaceRole
import com.vectorbea.api.http.HttpException
import com.vectorbea.api.model.CreateProjectMemberRequest
import com.vectorbea.api.model.ProjectMemberView
import com.vectorbea.api.model.PromptListItem
import com.vectorbea.api.repository.ProjectMemberRepository
import com.vectorbea.api.repository.PromptRepository
import java.util.UUID

class ProjectService(
    private val projectMemberRepository: ProjectMemberRepository,
    private val promptRepository: PromptRepository,
) {
    fun inviteMember(projectId: UUID, actorUserId: UUID, request: CreateProjectMemberRequest): ProjectMemberView {
        val email = request.email.trim().lowercase()
        if (email.isBlank()) {
            throw HttpException(400, "email is required")
        }

        val role = request.role
            ?.trim()
            ?.takeIf { it.isNotEmpty() }
            ?.let { WorkspaceRole.fromString(it) }
            ?: WorkspaceRole.VIEWER

        if (!projectMemberRepository.isProjectAdmin(projectId, actorUserId)) {
            throw HttpException(403, "Forbidden: only project admins can invite members")
        }

        val seatPolicy = projectMemberRepository.getProjectSeatPolicy(projectId)
            ?: throw HttpException(404, "Project not found")

        val existingUserId = projectMemberRepository.findUserIdByEmail(seatPolicy.organizationId, email)
        val alreadyConsumesSeat = existingUserId != null &&
            projectMemberRepository.userOccupiesSeatInOrganization(seatPolicy.organizationId, existingUserId)

        if (!alreadyConsumesSeat) {
            val currentTotalUsers = projectMemberRepository.countDistinctUsersInOrganization(seatPolicy.organizationId)
            if (currentTotalUsers >= seatPolicy.maxSeats) {
                throw HttpException(402, "Seat limit reached. Please upgrade your plan.")
            }
        }

        return projectMemberRepository.inviteMember(
            projectId = projectId,
            organizationId = seatPolicy.organizationId,
            email = email,
            role = role.name.lowercase(),
        )
    }

    fun listPrompts(projectId: UUID, userId: UUID): List<PromptListItem> {
        if (!projectMemberRepository.isProjectMember(projectId, userId)) {
            throw HttpException(403, "Forbidden: you are not a member of this project")
        }

        return promptRepository.listPrompts(projectId)
    }
}
