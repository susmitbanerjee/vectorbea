package com.vectorbea.proxy.service

import com.vectorbea.proxy.model.PromptPayload
import java.nio.file.Files
import java.nio.file.Path
import java.nio.file.Paths
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.decodeFromJsonElement

class SharedRulesStore(
    sharedRulesPath: String,
    private val json: Json
) {
    private val rulesPath: Path = Paths.get(sharedRulesPath)

    fun getPrompt(name: String): PromptPayload? {
        if (!Files.exists(rulesPath)) {
            return null
        }

        return runCatching {
            val root = json.parseToJsonElement(Files.readString(rulesPath))
            extractPrompts(root).firstOrNull { prompt -> prompt.name == name }
        }.getOrNull()
    }

    private fun extractPrompts(element: JsonElement): List<PromptPayload> =
        when (element) {
            is JsonArray -> element.mapNotNull(::decodePrompt)
            is JsonObject -> {
                when {
                    element["prompts"] is JsonArray ->
                        (element["prompts"] as JsonArray).mapNotNull(::decodePrompt)
                    element["rules"] is JsonArray ->
                        (element["rules"] as JsonArray).mapNotNull(::decodePrompt)
                    element["name"] != null ->
                        listOfNotNull(decodePrompt(element))
                    else -> emptyList()
                }
            }
            else -> emptyList()
        }

    private fun decodePrompt(element: JsonElement): PromptPayload? =
        runCatching { json.decodeFromJsonElement<PromptPayload>(element) }.getOrNull()
}
