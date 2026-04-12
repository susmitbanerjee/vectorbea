package com.vectorbea.proxy.service

import com.vectorbea.proxy.cache.PromptCache
import com.vectorbea.proxy.client.HubClient
import com.vectorbea.proxy.model.PromptPayload

class PromptService(
    private val cache: PromptCache,
    private val hubClient: HubClient,
    private val sharedRulesStore: SharedRulesStore
) {
    suspend fun getPrompt(name: String): PromptPayload =
        sharedRulesStore.getPrompt(name)
            ?: cache.getOrLoad(name) { hubClient.fetchPrompt(name) }
}
