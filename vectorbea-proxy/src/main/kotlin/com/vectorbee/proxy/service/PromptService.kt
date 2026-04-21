package com.vectorbea.proxy.service

import com.vectorbea.proxy.cache.PromptCache
import com.vectorbea.proxy.cache.AuthCache
import com.vectorbea.proxy.client.HubClient
import com.vectorbea.proxy.model.PromptPayload

class PromptService(
    private val cache: PromptCache,
    private val authCache: AuthCache,
    private val apiKey: String,
    private val hubClient: HubClient,
    private val sharedRulesStore: SharedRulesStore
) {
    suspend fun getPrompt(name: String): PromptPayload =
        sharedRulesStore.getPrompt(name)
            ?: cache.get(name)
            ?: run {
                val tokenValid = authCache.isValid(apiKey)
                if (!tokenValid) {
                    error("Invalid deployment agent token")
                }
                hubClient.fetchPrompt(name).also { fetched ->
                    cache.put(name, fetched)
                }
            }

    fun putPromptInCache(prompt: PromptPayload) {
        cache.put(prompt.name, prompt)
    }
}
