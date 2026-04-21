package com.vectorbea.proxy.service

import com.vectorbea.proxy.client.HubClient
import com.vectorbea.proxy.config.AppConfig
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import org.slf4j.LoggerFactory

/**
 * Eagerly syncs all published prompts on boot and then refreshes in the
 * background every 5 minutes. This runs on Dispatchers.IO and never blocks
 * request-serving gRPC/HTTP threads.
 */
class SyncDispatcher(
    private val config: AppConfig,
    private val hubClient: HubClient,
    private val promptService: PromptService,
    private val scope: CoroutineScope = CoroutineScope(SupervisorJob() + Dispatchers.IO),
) {
    private val logger = LoggerFactory.getLogger(SyncDispatcher::class.java)
    private var started = false

    fun start() {
        if (started) return
        started = true
        scope.launch { runWorker() }
        logger.info("SyncDispatcher started - eager sync enabled (poll interval: 300000 ms)")
    }

    fun stop() {
        scope.cancel()
    }

    private suspend fun runWorker() {
        syncOnce("startup")

        while (scope.isActive) {
            delay(300_000)
            syncOnce("poll")
        }
    }

    private suspend fun syncOnce(reason: String) {
        runCatching {
            val prompts = hubClient.fetchAllPublishedPrompts()
            prompts.forEach { promptService.putPromptInCache(it) }
            logger.info("[sync] {} sync complete - cached {} prompts", reason, prompts.size)
        }.onFailure { ex ->
            logger.warn("[sync] {} sync failed: {}", reason, ex.message)
        }
    }
}
