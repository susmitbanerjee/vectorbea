package com.vectorbea.telemetry.http

import com.sun.net.httpserver.HttpExchange

class TelemetryRequest(val exchange: HttpExchange) {
    val method: String get() = exchange.requestMethod.uppercase()
    val path: String get() = exchange.requestURI.path
    val query: String? get() = exchange.requestURI.query

    fun queryParam(name: String): String? =
        query?.split("&")?.firstOrNull { it.startsWith("$name=") }?.substringAfter("$name=")

    fun header(name: String): String? = exchange.requestHeaders.getFirst(name)

    fun bodyAsString(): String = exchange.requestBody.bufferedReader().readText()

    inline fun <reified T> bodyAs(): T = bodyAsString().fromJson<T>()

    fun bearerToken(): String? = header("Authorization")
        ?.takeIf { it.startsWith("Bearer ", ignoreCase = true) }
        ?.substring(7)

    fun internalToken(): String? = header("X-Telemetry-Token")
}
