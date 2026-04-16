"""
Internal HTTP transport layer.
Not part of the public API — use VectorBea() instead.
"""

from __future__ import annotations

from typing import Any, Dict, Optional

import requests

from vectorbea.errors import AuthenticationError, NotFoundError, VectorBeaError

_DEFAULT_TIMEOUT = 10  # seconds


class HttpClient:
    """Thin wrapper around ``requests.Session`` with auth and error handling."""

    def __init__(
        self,
        base_url: str,
        api_key: Optional[str],
        timeout: int = _DEFAULT_TIMEOUT,
    ) -> None:
        self._base_url = base_url.rstrip("/")
        self._timeout = timeout
        self._session = requests.Session()
        if api_key:
            self._session.headers.update({"Authorization": f"Bearer {api_key}"})
        self._session.headers.update(
            {
                "Accept": "application/json",
                "Content-Type": "application/json",
                "User-Agent": "vectorbea/0.1.0",
            }
        )

    def get(self, path: str) -> Dict[str, Any]:
        url = f"{self._base_url}{path}"
        try:
            resp = self._session.get(url, timeout=self._timeout)
        except requests.ConnectionError as exc:
            raise VectorBeaError(
                f"Could not connect to VectorBea proxy at {self._base_url}. "
                "Is the container running? Check that Docker is up and the port is mapped."
            ) from exc
        except requests.Timeout as exc:
            raise VectorBeaError(
                f"Request to {url} timed out after {self._timeout}s."
            ) from exc

        self._raise_for_status(resp)
        return resp.json()  # type: ignore[no-any-return]

    # ── Internal helpers ──────────────────────────────────────────────────────

    @staticmethod
    def _raise_for_status(resp: requests.Response) -> None:
        if resp.ok:
            return
        try:
            body = resp.json()
            message = body.get("error") or resp.text
        except ValueError:
            message = resp.text

        if resp.status_code == 401:
            raise AuthenticationError(
                f"Invalid or inactive API key. "
                f"Regenerate it from the VectorBea dashboard → API Keys. "
                f"Detail: {message}"
            )
        if resp.status_code == 404:
            raise NotFoundError(message)
        raise VectorBeaError(f"HTTP {resp.status_code}: {message}")
