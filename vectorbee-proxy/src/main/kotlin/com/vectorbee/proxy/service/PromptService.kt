package com.vectorbee.proxy.service

import com.vectorbee.proxy.cache.PromptCache
import com.vectorbee.proxy.client.HubClient
import com.vectorbee.proxy.model.PromptPayload

class PromptService(
    private val cache: PromptCache,
    private val hubClient: HubClient
) {
    suspend fun getPrompt(name: String): PromptPayload =
        cache.getOrLoad(name) { hubClient.fetchPrompt(name) }
}
