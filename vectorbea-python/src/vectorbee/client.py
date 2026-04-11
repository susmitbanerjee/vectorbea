"""gRPC-over-UDS client for the local vectorbea proxy.

This SDK talks to the in-pod vectorbea sidecar over a Unix Domain Socket
using gRPC. There is no TCP, no TLS, and no JSON on the hot path — typical
``get_prompt`` round-trips finish in 50–200 microseconds.
"""

from __future__ import annotations

import json
import logging
from concurrent.futures import ThreadPoolExecutor
from typing import Any

import grpc

from ._grpc import vectorbea_pb2, vectorbea_pb2_grpc
from .models import PromptResponse

logger = logging.getLogger(__name__)


class VectorBeaClient:
    """Synchronous gRPC client bound to a Unix Domain Socket.

    Example:
        >>> client = VectorBeaClient()
        >>> prompt = client.get_prompt("welcome-agent")
        >>> client.log_audit("welcome-agent", latency_ms=42, tokens=128)
    """

    def __init__(
        self,
        socket_path: str = "/tmp/vectorbea.sock",
        *,
        audit_workers: int = 2,
    ) -> None:
        """Create a new vectorbea client bound to a Unix Domain Socket.

        Args:
            socket_path: Filesystem path to the vectorbea proxy gRPC socket.
                The proxy must be running and its socket file must already
                exist before any RPC is issued.
            audit_workers: Size of the background thread pool used by
                :meth:`log_audit` to dispatch fire-and-forget audit calls
                without blocking the agent loop.
        """

        self.socket_path = socket_path

        # gRPC's URI scheme for AF_UNIX sockets is "unix:<absolute path>".
        # We use an insecure channel because the kernel namespace + filesystem
        # ACLs are the trust boundary — TLS would be redundant overhead.
        self._channel = grpc.insecure_channel(f"unix:{socket_path}")
        self._stub = vectorbea_pb2_grpc.VectorBeaDataPlaneStub(self._channel)

        # Background dispatcher for audit events. Daemon threads so it does
        # not delay interpreter shutdown.
        self._audit_pool = ThreadPoolExecutor(
            max_workers=audit_workers,
            thread_name_prefix="vectorbea-audit",
        )

    # ── Prompt fetch ────────────────────────────────────────────────────────

    def get_prompt(self, name: str) -> PromptResponse:
        """Fetch a prompt from the local vectorbea proxy.

        Args:
            name: Prompt name to resolve.

        Returns:
            A normalized :class:`PromptResponse` containing the latest
            published version's template text and parameters.

        Raises:
            grpc.RpcError: If the proxy is unreachable or returns an error.
        """

        request = vectorbea_pb2.GetPromptRequest(name=name)
        response = self._stub.GetPrompt(request)

        # ``parameters`` arrives as a JSON string so the proto stays free of
        # struct.proto. Empty string is treated as no parameters.
        parameters: dict[str, Any]
        if response.parameters_json:
            try:
                parameters = json.loads(response.parameters_json)
            except json.JSONDecodeError:
                logger.warning("invalid parameters JSON for prompt %s", name)
                parameters = {}
        else:
            parameters = {}

        return PromptResponse(
            prompt_id=response.prompt_id,
            prompt_version_id=response.prompt_version_id,
            organization_id=response.organization_id,
            name=response.name,
            description=response.description or None,
            version_tag=response.version_tag,
            template_text=response.template_text,
            parameters=parameters,
            created_at=response.created_at,
        )

    # ── Audit dispatch (non-blocking) ──────────────────────────────────────

    def log_audit(
        self,
        prompt_version_id: str,
        *,
        proxy_latency_ms: float = 0.0,
        llm_latency_ms: int = 0,
        tokens: int = 0,
        metadata: dict[str, Any] | None = None,
    ) -> None:
        """Send an audit event without blocking the caller.

        The RPC is dispatched on a background thread so the agent loop is
        never gated on audit delivery. Network errors are logged but never
        re-raised.

        Args:
            prompt_version_id: Prompt-version UUID returned by ``get_prompt``.
            proxy_latency_ms: Time spent inside the vectorbea proxy.
            llm_latency_ms: Wall-clock time spent inside the LLM call.
            tokens: Token count for the invocation.
            metadata: Optional structured metadata; serialised to JSON.
        """

        request = vectorbea_pb2.LogAuditRequest(
            prompt_version_id=prompt_version_id,
            proxy_latency_ms=float(proxy_latency_ms),
            llm_latency_ms=int(llm_latency_ms),
            token_count=int(tokens),
            metadata_json=json.dumps(metadata) if metadata else "",
        )

        # ``submit`` returns a ``concurrent.futures.Future``; we attach a
        # callback so failures are logged without ever propagating to the
        # caller. We do *not* await the future.
        future = self._audit_pool.submit(self._stub.LogAudit, request)
        future.add_done_callback(self._on_audit_done)

    @staticmethod
    def _on_audit_done(future: Any) -> None:
        exc = future.exception()
        if exc is not None:
            logger.warning("vectorbea audit dispatch failed: %s", exc)

    # ── Lifecycle ──────────────────────────────────────────────────────────

    def close(self) -> None:
        """Release the gRPC channel and stop the audit dispatcher."""

        # Drain in-flight audit RPCs first so we don't lose them.
        self._audit_pool.shutdown(wait=True)
        self._channel.close()

    def __enter__(self) -> "VectorBeaClient":
        return self

    def __exit__(self, exc_type: Any, exc: Any, tb: Any) -> None:
        self.close()
