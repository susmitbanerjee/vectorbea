package com.vectorbea.sdk

/**
 * Exception hierarchy for the VectorBea JVM SDK.
 *
 * All exceptions extend [VectorBeaException] so callers can catch every SDK
 * error with a single `catch (e: VectorBeaException)`.
 *
 * ```
 * VectorBeaException
 * ├── APIException               non-2xx HTTP response
 * │   ├── AuthenticationException  401 Unauthorized
 * │   └── NotFoundException        404 Not Found
 * ├── ConnectionException        network-level failure
 * └── TimeoutException           request exceeded the timeout
 * ```
 */

// ── Base ─────────────────────────────────────────────────────────────────────

open class VectorBeaException(message: String, cause: Throwable? = null) :
    RuntimeException(message, cause)

// ── HTTP / API exceptions ─────────────────────────────────────────────────────

/**
 * Raised when the proxy or hub returns a non-2xx HTTP status code.
 *
 * @property statusCode The HTTP status code returned by the server.
 */
open class APIException(
    message: String,
    val statusCode: Int,
    cause: Throwable? = null,
) : VectorBeaException(message, cause)

/**
 * Raised when the API key is missing, invalid, or inactive (HTTP 401).
 *
 * Re-generate a key from the VectorBea dashboard → Settings → API Keys.
 */
class AuthenticationException(message: String, cause: Throwable? = null) :
    APIException(message, statusCode = 401, cause)

/**
 * Raised when the requested resource does not exist (HTTP 404).
 *
 * Common causes:
 * - Prompt name is misspelled.
 * - The prompt exists but has no published version yet.
 * - The API key belongs to a different workspace than the prompt.
 */
class NotFoundException(message: String, cause: Throwable? = null) :
    APIException(message, statusCode = 404, cause)

// ── Network exceptions ────────────────────────────────────────────────────────

/**
 * Raised when a network-level failure prevents the request from reaching
 * the proxy (e.g. the container is not running, port not mapped).
 */
class ConnectionException(message: String, cause: Throwable? = null) :
    VectorBeaException(message, cause)

/**
 * Raised when the request exceeds the configured timeout.
 *
 * Increase the timeout via [VectorBeaClient.Builder.timeoutSeconds].
 */
class TimeoutException(message: String, cause: Throwable? = null) :
    VectorBeaException(message, cause)
