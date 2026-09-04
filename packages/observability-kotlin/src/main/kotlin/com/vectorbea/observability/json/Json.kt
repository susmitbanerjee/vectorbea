package com.vectorbea.observability.json

import com.fasterxml.jackson.databind.DeserializationFeature
import com.fasterxml.jackson.databind.ObjectMapper
import com.fasterxml.jackson.databind.SerializationFeature
import com.fasterxml.jackson.datatype.jsr310.JavaTimeModule
import com.fasterxml.jackson.module.kotlin.registerKotlinModule

/**
 * The mapper for analytics payloads.
 *
 * Kept separate from each host's own mapper on purpose. The API's mapper is configured
 * `NON_NULL` and snake_case for its HTTP responses; an analytics event is stored data,
 * where a null property is a recorded fact and dropping it silently changes what was
 * observed. That distinction cost a bug once already (D33) and is not worth relearning.
 *
 * Unknown fields are tolerated because events arrive from a browser that may be running
 * a version of the app older or newer than this process, and refusing them would lose
 * the event rather than the field.
 */
val mapper: ObjectMapper = ObjectMapper()
    .registerKotlinModule()
    .registerModule(JavaTimeModule())
    .disable(SerializationFeature.WRITE_DATES_AS_TIMESTAMPS)
    .configure(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, false)

fun Any.toJson(): String = mapper.writeValueAsString(this)

inline fun <reified T> String.fromJson(): T = mapper.readValue(this, T::class.java)
