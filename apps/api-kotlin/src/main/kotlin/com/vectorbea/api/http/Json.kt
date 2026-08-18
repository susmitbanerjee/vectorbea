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

/**
 * A mapper that KEEPS nulls, for stored data payloads.
 *
 * [mapper] omits nulls, which is right for API responses - a DTO with fifteen absent
 * optional fields should not ship fifteen `null`s to the browser.
 *
 * It is wrong for anything we persist as data, because in this product `null` is an
 * answer. When a reviewer corrects a hallucinated field to null they are saying "this
 * value is not in the source", which is a different statement from saying nothing about
 * the field at all. Dropping the key turns an explicit finding into a silent omission:
 * downstream nodes see a missing key rather than a deliberate null, and the eval case
 * captured from the correction records no expectation for the field it was capturing.
 *
 * Found by running the confidence demo, which corrects an invented contact to null and
 * then asserts the null survived the round trip. It did not.
 */
val dataMapper: ObjectMapper = mapper.copy()
    .setSerializationInclusion(JsonInclude.Include.ALWAYS)

/** Serialize a stored data payload, preserving explicit nulls. See [dataMapper]. */
fun toDataJson(value: Any): String = dataMapper.writeValueAsString(value)

/** Deserialize a JSON string to the reified type T. */
inline fun <reified T> fromJson(json: String): T = mapper.readValue(json)

/** Deserialize safely, returning null on any parse error. */
inline fun <reified T> fromJsonOrNull(json: String): T? = try {
    fromJson<T>(json)
} catch (_: Exception) {
    null
}
