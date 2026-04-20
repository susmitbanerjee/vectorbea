"""
Internal HTTP transport layer.
Not part of the public API — use VectorBeaClient() instead.
"""

from __future__ import annotations

from typing import Any, Dict, Optional

import requests
import requests.exceptions

from vectorbea.errors import (
    APIError,
    AuthenticationError,
    ConnectionError as VectorBeaConnectionError,
    NotFoundError,
    TimeoutError as VectorBeaTimeoutError,
)

_DEFAULT_TIMEOUT = 10  # seconds
_SDK_VERSION = "0.2.0"


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
                "User-Agent": f"vectorbea-python/{_SDK_VERSION}",
            }
        )

    def get(self, path: str) -> Dict[str, Any]:
        url = f"{self._base_url}{path}"
        try:
            resp = self._session.get(url, timeout=self._timeout)
        except requests.exceptions.ConnectionError as exc:
            raise VectorBeaConnectionError(
                f"Could not connect to VectorBea proxy at {self._base_url}. "
                "Is the container running? Verify that Docker is up and port 8080 is mapped."
            ) from exc
        except requests.exceptions.Timeout as exc:
            raise VectorBeaTimeoutError(
                f"Request to {url} timed out after {self._timeout}s. "
                f"Increase the timeout by passing timeout= to VectorBeaClient()."
            ) from exc
        self._raise_for_status(resp)
        return resp.json()  # type: ignore[no-any-return]

    def post(self, path: str, json: Any) -> Dict[str, Any]:
        url = f"{self._base_url}{path}"
        try:
            resp = self._session.post(url, json=json, timeout=self._timeout)
        except requests.exceptions.ConnectionError as exc:
            raise VectorBeaConnectionError(
                f"Could not connect to VectorBea proxy at {self._base_url}. "
                "Is the container running? Verify that Docker is up and port 8080 is mapped."
            ) from exc
        except requests.exceptions.Timeout as exc:
            raise VectorBeaTimeoutError(
                f"Request to {url} timed out after {self._timeout}s. "
                f"Increase the timeout by passing timeout= to VectorBeaClient()."
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
            message: str = body.get("error") or resp.text
        except ValueError:
            message = resp.text

        if resp.status_code == 401:
            raise AuthenticationError(
                f"Invalid or inactive API key. "
                f"Regenerate it from the VectorBea dashboard → API Keys. "
                f"Detail: {message}"
            )
        if resp.status_code == 404:
            raise NotFoundError(
                message
                or (
                    f"Resource not found at {resp.url}. "
                    "Check that the prompt name exists in your workspace "
                    "and has at least one published version."
                )
            )
        raise APIError(
            f"HTTP {resp.status_code}: {message}",
            status_code=resp.status_code,
        )
