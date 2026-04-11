package com.vectorbea.proxy.service

import com.vectorbea.proxy.cache.PromptCache
import com.vectorbea.proxy.client.HubClient
import com.vectorbea.proxy.model.PromptPayload

class PromptService(
    private val cache: PromptCache,
    private val hubClient: HubClient
) {
    suspend fun getPrompt(name: String): PromptPayload =
        cache.getOrLoad(name) { hubClient.fetchPrompt(name) }
}
