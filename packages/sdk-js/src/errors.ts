/**
 * Exception hierarchy for the VectorBea Node.js SDK.
 *
 * All errors extend `VectorBeaError` so callers can catch everything with a
 * single `catch (err) { if (err instanceof VectorBeaError) ... }`.
 *
 * Hierarchy
 * ---------
 * VectorBeaError
 * ├── APIError               non-2xx HTTP response from the proxy / hub
 * │   ├── AuthenticationError  401 Unauthorized
 * │   └── NotFoundError        404 Not Found
 * ├── ConnectionError        network-level failure (proxy not reachable)
 * └── TimeoutError           request exceeded the configured timeout
 */

// ── Base ─────────────────────────────────────────────────────────────────────

export class VectorBeaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VectorBeaError";
    // Restore prototype chain in transpiled ES5 output
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

// ── HTTP / API errors ─────────────────────────────────────────────────────────

export class APIError extends VectorBeaError {
  /** HTTP status code returned by the server. */
  readonly statusCode: number;

  constructor(message: string, statusCode: number) {
    super(message);
    this.name = "APIError";
    this.statusCode = statusCode;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class AuthenticationError extends APIError {
  /**
   * Raised when the API key is missing, invalid, or inactive (HTTP 401).
   *
   * Re-generate a key from the VectorBea dashboard → Settings → API Keys.
   */
  constructor(message: string) {
    super(message, 401);
    this.name = "AuthenticationError";
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class NotFoundError extends APIError {
  /**
   * Raised when the requested resource does not exist (HTTP 404).
   *
   * Common causes:
   * - Prompt name is misspelled.
   * - The prompt exists but has no published version yet.
   * - The API key belongs to a different workspace than the prompt.
   */
  constructor(message: string) {
    super(message, 404);
    this.name = "NotFoundError";
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

// ── Network errors ────────────────────────────────────────────────────────────

export class ConnectionError extends VectorBeaError {
  /**
   * Raised when a network-level failure prevents the request from reaching
   * the proxy (e.g. container not running, port not mapped).
   */
  constructor(message: string) {
    super(message);
    this.name = "ConnectionError";
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class TimeoutError extends VectorBeaError {
  /**
   * Raised when the request exceeds the configured timeout.
   *
   * Increase the timeout by passing `timeoutMs` to `VectorBeaClient`.
   */
  constructor(message: string) {
    super(message);
    this.name = "TimeoutError";
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
