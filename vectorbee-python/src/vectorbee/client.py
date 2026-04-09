"""Synchronous UDS client for the local vectorbee proxy."""

from __future__ import annotations

import threading
from typing import Any
from urllib.parse import quote

import httpx

from .models import PromptResponse


class VectorBeeClient:
    """Client for communicating with the local vectorbee proxy over a Unix domain socket.

    The SDK uses a dummy `localhost` hostname because HTTPX still expects a valid
    HTTP URL even when the request is routed through a Unix domain socket transport.
    """

    def __init__(self, sock_path: str = "/tmp/vectorbee.sock") -> None:
        """Create a new vectorbee client bound to a Unix domain socket.

        Args:
            sock_path: Filesystem path to the vectorbee proxy Unix domain socket.
        """

        self.sock_path = sock_path
        self._transport = httpx.HTTPTransport(uds=sock_path)
        self._client = httpx.Client(
            transport=self._transport,
            base_url="http://localhost",
            timeout=httpx.Timeout(5.0),
        )

    def get_prompt(self, name: str) -> PromptResponse:
        """Fetch a prompt from the local vectorbee proxy.

        Args:
            name: Prompt name to resolve.

        Returns:
            A normalized prompt model containing `template_text` and `parameters`.

        Raises:
            httpx.HTTPError: If the request fails or the proxy returns an error.
        """

        encoded_name = quote(name, safe="")
        response = self._client.get(f"/v1/prompts/{encoded_name}")
        response.raise_for_status()
        return PromptResponse.model_validate(response.json())

    def log_audit(self, prompt_name: str, latency_ms: int, tokens: int) -> None:
        """Send an audit event to the local proxy without blocking the caller.

        The POST is dispatched on a daemon thread and any network exception is
        intentionally swallowed so the main agent flow is never blocked by audit
        delivery failures.

        Args:
            prompt_name: Human-readable prompt name for the audit event metadata.
            latency_ms: End-to-end latency in milliseconds.
            tokens: Token count associated with the invocation.
        """

        payload = {
            "promptVersionId": prompt_name,
            "latencyMs": latency_ms,
            "tokenCount": tokens,
            "metadata": {
                "prompt_name": prompt_name,
            },
        }

        thread = threading.Thread(
            target=self._post_audit_background,
            args=(payload,),
            daemon=True,
            name="vectorbee-audit",
        )
        thread.start()

    def close(self) -> None:
        """Close the underlying HTTPX client and release socket resources."""

        self._client.close()

    def __enter__(self) -> "VectorBeeClient":
        """Support context-manager usage."""

        return self

    def __exit__(self, exc_type: Any, exc: Any, tb: Any) -> None:
        """Close the client when leaving a context manager."""

        self.close()

    def _post_audit_background(self, payload: dict[str, Any]) -> None:
        """Best-effort background POST used by `log_audit`."""

        try:
            self._client.post("/v1/audit", json=payload)
        except httpx.HTTPError:
            pass
