package com.vectorbea.telemetry.http

import com.sun.net.httpserver.HttpExchange

object Response {
    fun json(exchange: HttpExchange, status: Int, body: Any) {
        val bytes = body.toJson().toByteArray(Charsets.UTF_8)
        exchange.responseHeaders.set("Content-Type", "application/json; charset=utf-8")
        exchange.sendResponseHeaders(status, bytes.size.toLong())
        exchange.responseBody.use { it.write(bytes) }
    }

    fun ok(exchange: HttpExchange, body: Any) = json(exchange, 200, body)

    fun created(exchange: HttpExchange, body: Any) = json(exchange, 201, body)

    fun noContent(exchange: HttpExchange) {
        exchange.sendResponseHeaders(204, -1)
        exchange.responseBody.close()
    }

    fun error(exchange: HttpExchange, status: Int, message: String) =
        json(exchange, status, mapOf("error" to message, "status" to status))

    fun badRequest(exchange: HttpExchange, message: String) = error(exchange, 400, message)

    fun unauthorized(exchange: HttpExchange, message: String = "Unauthorized") =
        error(exchange, 401, message)

    fun forbidden(exchange: HttpExchange, message: String = "Forbidden") =
        error(exchange, 403, message)

    fun notFound(exchange: HttpExchange, message: String = "Not found") =
        error(exchange, 404, message)

    fun serverError(exchange: HttpExchange, message: String = "Internal server error") =
        error(exchange, 500, message)
}
