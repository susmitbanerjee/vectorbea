package com.vectorbea.api.http

import com.fasterxml.jackson.core.type.TypeReference
import com.fasterxml.jackson.databind.DeserializationFeature
import com.fasterxml.jackson.databind.JsonNode
import com.fasterxml.jackson.databind.ObjectMapper
import com.fasterxml.jackson.databind.SerializationFeature
import com.fasterxml.jackson.datatype.jsr310.JavaTimeModule
import com.fasterxml.jackson.module.kotlin.jacksonObjectMapper
import com.fasterxml.jackson.module.kotlin.readValue

object Json {
    val mapper: ObjectMapper = jacksonObjectMapper()
        .configure(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, false)
        .registerModule(JavaTimeModule())
        .disable(SerializationFeature.WRITE_DATES_AS_TIMESTAMPS)

    inline fun <reified T> decode(body: String): T = mapper.readValue(body)

    fun decodeJsonNode(body: String): JsonNode = mapper.readTree(body)

    fun encode(value: Any): String = mapper.writeValueAsString(value)

    fun mapFromNode(node: JsonNode): Map<String, Any?> =
        mapper.convertValue(node, object : TypeReference<Map<String, Any?>>() {})
}
