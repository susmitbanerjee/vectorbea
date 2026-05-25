package com.vectorbea.api.http

import com.fasterxml.jackson.annotation.JsonInclude
import com.fasterxml.jackson.databind.DeserializationFeature
import com.fasterxml.jackson.databind.ObjectMapper
import com.fasterxml.jackson.databind.SerializationFeature
import com.fasterxml.jackson.datatype.jsr310.JavaTimeModule
import com.fasterxml.jackson.module.kotlin.jacksonObjectMapper
import com.fasterxml.jackson.module.kotlin.readValue

/**
 * Shared Jackson ObjectMapper — configure once, use everywhere.
 *
 * Properties:
 *  - snake_case output (consistent with Postgres column names and frontend expectations)
 *  - ISO-8601 dates (not epoch millis)
 *  - nulls excluded from output
 *  - unknown JSON fields tolerated on deserialization (forward-compatible)
 */
val mapper: ObjectMapper = jacksonObjectMapper().apply {
    registerModule(JavaTimeModule())
    // Dates as ISO-8601 strings, not epoch millis
    disable(SerializationFeature.WRITE_DATES_AS_TIMESTAMPS)
    // Don't fail on unknown fields — forward-compat
    disable(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES)
    // Omit null fields from output
    setSerializationInclusion(JsonInclude.Include.NON_NULL)
}

/** Serialize any value to a JSON string. */
fun toJson(value: Any): String = mapper.writeValueAsString(value)

/** Deserialize a JSON string to the reified type T. */
inline fun <reified T> fromJson(json: String): T = mapper.readValue(json)

/** Deserialize safely, returning null on any parse error. */
inline fun <reified T> fromJsonOrNull(json: String): T? = try {
    fromJson<T>(json)
} catch (_: Exception) {
    null
}
