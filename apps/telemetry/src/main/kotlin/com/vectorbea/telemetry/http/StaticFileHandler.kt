package com.vectorbea.telemetry.http

import com.sun.net.httpserver.HttpExchange
import org.slf4j.LoggerFactory

/**
 * Serves static files from classpath:/static/.
 * Any path not matching an API route falls through to index.html (SPA routing).
 */
object StaticFileHandler {
    private val log = LoggerFactory.getLogger(StaticFileHandler::class.java)

    private val MIME = mapOf(
        "html" to "text/html; charset=utf-8",
        "css"  to "text/css; charset=utf-8",
        "js"   to "application/javascript; charset=utf-8",
        "json" to "application/json; charset=utf-8",
        "png"  to "image/png",
        "ico"  to "image/x-icon",
        "svg"  to "image/svg+xml",
    )

    fun serve(exchange: HttpExchange, resourcePath: String) {
        val ext = resourcePath.substringAfterLast('.', "html")
        val mime = MIME[ext] ?: "application/octet-stream"
        val stream = StaticFileHandler::class.java.getResourceAsStream("/static/$resourcePath")
        if (stream == null) {
            // Fall back to index.html for SPA routing
            serveIndex(exchange)
            return
        }
        val bytes = stream.readBytes()
        exchange.responseHeaders.set("Content-Type", mime)
        exchange.responseHeaders.set("Cache-Control", if (ext == "html") "no-cache" else "max-age=3600")
        exchange.sendResponseHeaders(200, bytes.size.toLong())
        exchange.responseBody.use { it.write(bytes) }
    }

    fun serveIndex(exchange: HttpExchange) {
        val stream = StaticFileHandler::class.java.getResourceAsStream("/static/index.html")
        if (stream == null) {
            Response.notFound(exchange, "Dashboard UI not found")
            return
        }
        val bytes = stream.readBytes()
        exchange.responseHeaders.set("Content-Type", "text/html; charset=utf-8")
        exchange.responseHeaders.set("Cache-Control", "no-cache")
        exchange.sendResponseHeaders(200, bytes.size.toLong())
        exchange.responseBody.use { it.write(bytes) }
    }

    fun register(router: Router) {
        // Static assets
        router.get("/styles.css")   { req -> serve(req.exchange, "styles.css") }
        router.get("/app.js")       { req -> serve(req.exchange, "app.js") }
        router.get("/favicon.ico")  { req -> serve(req.exchange, "favicon.ico") }

        // SPA shell — all UI routes serve index.html
        listOf("/", "/dashboard", "/dashboard/business", "/dashboard/engineering",
               "/dashboard/users", "/dashboard/revenue", "/dashboard/architect",
               "/dashboard/workflows", "/dashboard/environments"
        ).forEach { path ->
            router.get(path) { req -> serveIndex(req.exchange) }
        }
    }
}
