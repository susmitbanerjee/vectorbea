package com.vectorbee.api.service

import com.vectorbee.api.http.HttpException
import com.vectorbee.api.model.CreatePromptRequest
import com.vectorbee.api.model.CreatePromptResponse
import com.vectorbee.api.model.PromptListItem
import com.vectorbee.api.model.PromptVersionView
import com.vectorbee.api.model.UpdatePromptRequest
import com.vectorbee.api.repository.PromptRepository
import java.util.UUID

class PromptService(private val promptRepository: PromptRepository) {
    fun createPrompt(request: CreatePromptRequest, authenticatedOrganizationId: UUID?): CreatePromptResponse {
        validatePromptRequest(request)
        val organizationId = request.organizationId ?: authenticatedOrganizationId
            ?: throw HttpException(400, "organizationId is required")

        val parametersJson = request.parameters?.toString() ?: "{}"
        val (prompt, version) = promptRepository.createPromptWithInitialVersion(
            organizationId = organizationId,
            name = request.name.trim(),
            description = request.description?.trim()?.takeIf { it.isNotEmpty() },
            versionTag = request.versionTag.trim(),
            templateText = request.templateText,
            parametersJson = parametersJson
        )

        return CreatePromptResponse(
            promptId = prompt.id,
            promptVersionId = version.id,
            name = prompt.name,
            versionTag = version.versionTag
        )
    }

    fun getLatestPrompt(organizationId: UUID, name: String): PromptVersionView =
        promptRepository.findLatestByName(organizationId, name.trim())
            ?: throw HttpException(404, "Prompt not found")

    fun listPrompts(organizationId: UUID? = null): List<PromptListItem> = promptRepository.listPrompts(organizationId)

    fun getPromptById(promptId: UUID): PromptVersionView =
        promptRepository.findById(promptId)
            ?: throw HttpException(404, "Prompt not found")

    fun listVersions(promptId: UUID): List<PromptVersionView> {
        val versions = promptRepository.listVersions(promptId)
        if (versions.isEmpty()) {
            throw HttpException(404, "Prompt not found")
        }
        return versions
    }

    fun updatePrompt(promptId: UUID, request: UpdatePromptRequest): PromptVersionView {
        validateUpdateRequest(request)
        val parametersJson = request.parameters?.toString() ?: "{}"

        return promptRepository.updatePrompt(
            promptId = promptId,
            description = request.description?.trim()?.takeIf { it.isNotEmpty() },
            templateText = request.templateText,
            parametersJson = parametersJson,
            versionTag = request.versionTag?.trim()?.takeIf { it.isNotEmpty() }
        ) ?: throw HttpException(404, "Prompt not found")
    }

    fun publishPrompt(promptId: UUID): PromptVersionView =
        promptRepository.publishPrompt(promptId)
            ?: throw HttpException(404, "Prompt not found")

    private fun validatePromptRequest(request: CreatePromptRequest) {
        if (request.name.isBlank()) {
            throw HttpException(400, "name is required")
        }
        if (request.versionTag.isBlank()) {
            throw HttpException(400, "versionTag is required")
        }
        if (request.templateText.isBlank()) {
            throw HttpException(400, "templateText is required")
        }
        val parameters = request.parameters
        if (parameters != null && !parameters.isObject) {
            throw HttpException(400, "parameters must be a JSON object")
        }
    }

    private fun validateUpdateRequest(request: UpdatePromptRequest) {
        if (request.templateText.isBlank()) {
            throw HttpException(400, "templateText is required")
        }
        val parameters = request.parameters
        if (parameters != null && !parameters.isObject) {
            throw HttpException(400, "parameters must be a JSON object")
        }
    }
}
