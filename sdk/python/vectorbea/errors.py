"""
Exception hierarchy for the VectorBea SDK.

All exceptions inherit from VectorBeaError so callers can catch
everything with a single ``except VectorBeaError``.

Hierarchy
---------
VectorBeaError
├── APIError               — non-2xx HTTP response from the proxy/hub
│   ├── AuthenticationError — 401 Unauthorized
│   └── NotFoundError       — 404 Not Found
├── ConnectionError         — network-level failure (proxy not reachable)
└── TimeoutError            — request exceeded the configured timeout
"""


class VectorBeaError(Exception):
    """Base class for all VectorBea SDK errors."""


# ── HTTP / API errors ─────────────────────────────────────────────────────────

class APIError(VectorBeaError):
    """
    Raised when the proxy or hub returns a non-2xx HTTP status code.

    Attributes
    ----------
    status_code : int
        The HTTP status code returned by the server.
    message : str
        Human-readable error detail extracted from the response body.
    """

    def __init__(self, message: str, *, status_code: int) -> None:
        super().__init__(message)
        self.status_code = status_code


class AuthenticationError(APIError):
    """
    Raised when the API key is missing, invalid, or inactive (HTTP 401).

    Re-generate a key from the VectorBea dashboard → Settings → API Keys.
    """

    def __init__(self, message: str) -> None:
        super().__init__(message, status_code=401)


class NotFoundError(APIError):
    """
    Raised when the requested resource does not exist (HTTP 404).

    Common causes
    -------------
    - Prompt name is misspelled.
    - The prompt exists but has no published version yet.
    - The API key belongs to a different workspace than the prompt.
    """

    def __init__(self, message: str) -> None:
        super().__init__(message, status_code=404)


# ── Network errors ────────────────────────────────────────────────────────────

class ConnectionError(VectorBeaError):  # noqa: A001 — intentional shadowing of builtin
    """
    Raised when a network-level failure prevents the request from reaching
    the proxy (e.g. the container is not running, port not mapped).
    """


class TimeoutError(VectorBeaError):  # noqa: A001
    """
    Raised when the request exceeds the configured timeout (default 10 s).

    Increase the timeout by passing ``timeout=30`` to :class:`VectorBeaClient`.
    """
