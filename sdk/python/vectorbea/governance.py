"""
VectorBea Governance Instrumentation
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

Provides `init`, `run`, `trace`, `current_run`, and `wrap_mcp_client` for
recording AI governance evidence to the VectorBea ingest endpoint.

Usage::

    import vectorbea

    vectorbea.init(
        ingest_url="https://your-instance.com/api/ingest/traces",
        ingest_token="<YOUR_INGEST_TOKEN>",
        workspace_id="<YOUR_WORKSPACE_ID>",
        environment="production",
    )

    @vectorbea.trace(capability_name="my-agent")
    def run_agent(user_input: str) -> str:
        return call_llm(user_input)

    # Or manual context manager
    with vectorbea.run(capability_name="my-agent", user_input=query) as r:
        result = my_logic(query)
        r.set_outcome("success", response=result)
"""

from __future__ import annotations

import contextvars
import functools
import json
import os
import threading
import time
import uuid
from contextlib import contextmanager
from typing import Any, Callable, Generator, Optional
from urllib import request as urllib_request
from urllib.error import URLError

# ---------------------------------------------------------------------------
# Global config
# ---------------------------------------------------------------------------

_config: dict[str, Any] = {}

_current_run_var: contextvars.ContextVar[Optional["Run"]] = contextvars.ContextVar(
    "vectorbea_current_run", default=None
)


def init(
    *,
    ingest_url: str | None = None,
    ingest_token: str | None = None,
    workspace_id: str | None = None,
    environment: str | None = None,
    batch_size: int = 50,
    flush_interval_ms: int = 5000,
    disabled: bool = False,
) -> None:
    """Configure the VectorBea governance SDK.

    All parameters can also be set via environment variables:
    - VECTORBEA_INGEST_URL
    - VECTORBEA_INGEST_TOKEN  (or VECTORBEA_KEY)
    - VECTORBEA_WORKSPACE_ID
    - VECTORBEA_ENVIRONMENT
    """
    _config.update(
        {
            "ingest_url": ingest_url or os.environ.get("VECTORBEA_INGEST_URL", ""),
            "ingest_token": ingest_token
            or os.environ.get("VECTORBEA_INGEST_TOKEN")
            or os.environ.get("VECTORBEA_KEY", ""),
            "workspace_id": workspace_id or os.environ.get("VECTORBEA_WORKSPACE_ID", ""),
            "environment": environment or os.environ.get("VECTORBEA_ENVIRONMENT"),
            "batch_size": batch_size,
            "flush_interval_ms": flush_interval_ms,
            "disabled": disabled,
        }
    )


def _get_config() -> dict[str, Any]:
    """Return config, falling back to env vars if init() was not called."""
    if not _config:
        init()
    return _config


# ---------------------------------------------------------------------------
# Async batch sender
# ---------------------------------------------------------------------------

_batch_lock = threading.Lock()
_pending_batches: list[dict[str, Any]] = []


def _send_batch(payload: dict[str, Any]) -> None:
    """Fire-and-forget: send a trace payload in a background thread."""
    cfg = _get_config()
    if cfg.get("disabled"):
        return
    url = cfg.get("ingest_url", "")
    token = cfg.get("ingest_token", "")
    if not url or not token:
        return

    def _do_send() -> None:
        try:
            data = json.dumps(payload).encode("utf-8")
            req = urllib_request.Request(
                url,
                data=data,
                headers={
                    "Content-Type": "application/json",
                    "x-vectorbea-ingest-token": token,
                },
                method="POST",
            )
            with urllib_request.urlopen(req, timeout=10) as resp:  # noqa: S310
                if resp.status not in (200, 201, 202):
                    pass  # non-blocking — ignore failures
        except (URLError, OSError):
            pass  # non-blocking

    t = threading.Thread(target=_do_send, daemon=True)
    t.start()


# ---------------------------------------------------------------------------
# Step
# ---------------------------------------------------------------------------


class Step:
    """Context manager for a single step within a Run."""

    def __init__(
        self,
        run: "Run",
        step_type: str,
        *,
        step_name: str | None = None,
        model: str | None = None,
        provider: str | None = None,
    ) -> None:
        self._run = run
        self._step_type = step_type
        self._step_name = step_name
        self._model = model
        self._provider = provider
        self._start_ts = time.time()
        self._output: dict[str, Any] = {}
        self._tokens_input: int | None = None
        self._tokens_output: int | None = None
        self._status: str = "success"
        self._error: str | None = None

    def set_output(self, output: dict[str, Any]) -> None:
        """Record step output payload."""
        self._output.update(output)

    def set_tokens(self, *, input: int | None = None, output: int | None = None) -> None:
        """Record token counts for LLM steps."""
        if input is not None:
            self._tokens_input = input
        if output is not None:
            self._tokens_output = output

    def set_status(self, status: str, *, error: str | None = None) -> None:
        """Override step status (default: 'success')."""
        self._status = status
        self._error = error

    def fail(self, error: str) -> None:
        """Mark step as failed."""
        self._status = "error"
        self._error = error

    def __enter__(self) -> "Step":
        return self

    def __exit__(self, exc_type: Any, exc_val: Any, exc_tb: Any) -> None:
        if exc_type is not None:
            self._status = "error"
            self._error = str(exc_val)
        end_ts = time.time()
        latency_ms = int((end_ts - self._start_ts) * 1000)
        event: dict[str, Any] = {
            "type": self._step_type,
            "timestamp": _iso(self._start_ts),
            "metadata": {
                "step_name": self._step_name,
                "model": self._model,
                "provider": self._provider,
                "latency_ms": latency_ms,
                "status": self._status,
                "error_message": self._error,
                "tokens_input": self._tokens_input,
                "tokens_output": self._tokens_output,
                **self._output,
            },
        }
        self._run._events.append(event)


# ---------------------------------------------------------------------------
# Run
# ---------------------------------------------------------------------------


class Run:
    """Context manager for a single agent run / capability execution."""

    def __init__(
        self,
        *,
        capability_name: str | None = None,
        capability_id: str | None = None,
        user_input: str | None = None,
        session_id: str | None = None,
        environment: str | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> None:
        cfg = _get_config()
        self._capability_name = capability_name
        self._capability_id = capability_id
        self._user_input = user_input
        self._session_id = session_id
        self._environment = environment or cfg.get("environment")
        self._extra_metadata = metadata or {}
        self._start_ts = time.time()
        self._outcome: str | None = None
        self._response: str | None = None
        self._outcome_reason: str | None = None
        self._events: list[dict[str, Any]] = []
        self._token: contextvars.Token[Optional["Run"]] | None = None

    # ── Step factories ────────────────────────────────────────────────────

    @contextmanager
    def step(
        self,
        step_type: str,
        *,
        step_name: str | None = None,
        model: str | None = None,
        provider: str | None = None,
    ) -> Generator[Step, None, None]:
        """Context manager for a step within this run."""
        s = Step(self, step_type, step_name=step_name, model=model, provider=provider)
        with s:
            yield s

    # ── Outcome ───────────────────────────────────────────────────────────

    def set_outcome(
        self,
        status: str,
        *,
        response: str | None = None,
        reason: str | None = None,
    ) -> None:
        """Set the run outcome. Call before the context manager exits."""
        self._outcome = status
        self._response = response
        self._outcome_reason = reason

    # ── Context manager ───────────────────────────────────────────────────

    def __enter__(self) -> "Run":
        self._token = _current_run_var.set(self)
        cfg = _get_config()
        self._events.append(
            {
                "type": "agent_run_started",
                "timestamp": _iso(self._start_ts),
                "metadata": {
                    "capability_name": self._capability_name,
                    "capability_id": self._capability_id,
                    "user_input": self._user_input,
                    "session_id": self._session_id,
                    "environment": self._environment,
                    "workspace_id": cfg.get("workspace_id"),
                    **self._extra_metadata,
                },
            }
        )
        return self

    def __exit__(self, exc_type: Any, exc_val: Any, exc_tb: Any) -> None:
        if self._token is not None:
            _current_run_var.reset(self._token)

        if exc_type is not None and self._outcome is None:
            self._outcome = "failed"
            self._outcome_reason = str(exc_val)

        end_ts = time.time()
        self._events.append(
            {
                "type": "agent_run_completed",
                "timestamp": _iso(end_ts),
                "metadata": {
                    "outcome_status": self._outcome or "success",
                    "outcome_reason": self._outcome_reason,
                    "response": self._response,
                    "latency_ms": int((end_ts - self._start_ts) * 1000),
                },
            }
        )
        self._flush()

    def _flush(self) -> None:
        cfg = _get_config()
        payload: dict[str, Any] = {
            "workspace_id": cfg.get("workspace_id", ""),
            "source": "sdk",
            "environment": self._environment,
            "events": self._events,
        }
        if self._capability_id:
            payload["capability_id"] = self._capability_id
        _send_batch(payload)


# ---------------------------------------------------------------------------
# Public API helpers
# ---------------------------------------------------------------------------


@contextmanager
def run(
    *,
    capability_name: str | None = None,
    capability_id: str | None = None,
    user_input: str | None = None,
    session_id: str | None = None,
    environment: str | None = None,
    metadata: dict[str, Any] | None = None,
) -> Generator[Run, None, None]:
    """Context manager that records a complete agent run as governance evidence.

    Example::

        with vectorbea.run(capability_name="my-agent", user_input=query) as r:
            result = my_agent_logic(query)
            r.set_outcome("success", response=result)
    """
    r = Run(
        capability_name=capability_name,
        capability_id=capability_id,
        user_input=user_input,
        session_id=session_id,
        environment=environment,
        metadata=metadata,
    )
    with r:
        yield r


def trace(
    capability_name: str | None = None,
    *,
    capability_id: str | None = None,
    environment: str | None = None,
) -> Callable[[Callable[..., Any]], Callable[..., Any]]:
    """Decorator that wraps a function in a VectorBea governance run.

    Example::

        @vectorbea.trace(capability_name="my-agent")
        def run_agent(user_input: str) -> str:
            return call_llm(user_input)
    """

    def decorator(fn: Callable[..., Any]) -> Callable[..., Any]:
        @functools.wraps(fn)
        def wrapper(*args: Any, **kwargs: Any) -> Any:
            # Try to detect user_input from first positional string arg
            user_input: str | None = None
            if args and isinstance(args[0], str):
                user_input = args[0]

            r = Run(
                capability_name=capability_name or fn.__name__,
                capability_id=capability_id,
                user_input=user_input,
                environment=environment,
            )
            with r:
                result = fn(*args, **kwargs)
                if isinstance(result, str):
                    r.set_outcome("success", response=result)
                else:
                    r.set_outcome("success")
                return result

        return wrapper

    return decorator


def current_run() -> Run | None:
    """Return the Run currently active in this context (or None)."""
    return _current_run_var.get()


# ---------------------------------------------------------------------------
# MCP wrapper
# ---------------------------------------------------------------------------


class _McpClientWrapper:
    """Thin proxy around an MCP ClientSession that records tool calls as steps."""

    def __init__(self, session: Any, server_name: str) -> None:
        self._session = session
        self._server_name = server_name

    def call_tool(self, tool_name: str, arguments: dict[str, Any] | None = None, **kwargs: Any) -> Any:
        """Call an MCP tool and record the invocation as an mcp_tool_call evidence step."""
        start = time.time()
        error_msg: str | None = None
        result: Any = None
        try:
            result = self._session.call_tool(tool_name, arguments, **kwargs)
            return result
        except Exception as exc:
            error_msg = str(exc)
            raise
        finally:
            end = time.time()
            latency_ms = int((end - start) * 1000)
            active_run = _current_run_var.get()
            event: dict[str, Any] = {
                "type": "mcp_tool_call",
                "timestamp": _iso(start),
                "metadata": {
                    "mcp.server_name": self._server_name,
                    "mcp.tool_name": tool_name,
                    "mcp.tool_arguments": json.dumps(arguments) if arguments else None,
                    "mcp.tool_result": str(result) if result is not None else None,
                    "latency_ms": latency_ms,
                    "status": "error" if error_msg else "success",
                    "error_message": error_msg,
                },
            }
            if active_run is not None:
                active_run._events.append(event)
            else:
                # No active run — create a one-shot trace
                cfg = _get_config()
                _send_batch(
                    {
                        "workspace_id": cfg.get("workspace_id", ""),
                        "source": "sdk",
                        "events": [
                            {
                                "type": "agent_run_started",
                                "timestamp": _iso(start),
                                "metadata": {"capability_name": self._server_name},
                            },
                            event,
                            {
                                "type": "agent_run_completed",
                                "timestamp": _iso(end),
                                "metadata": {
                                    "outcome_status": "failed" if error_msg else "success",
                                    "latency_ms": latency_ms,
                                },
                            },
                        ],
                    }
                )

    def __getattr__(self, name: str) -> Any:
        return getattr(self._session, name)


def wrap_mcp_client(session: Any, *, server_name: str) -> _McpClientWrapper:
    """Wrap an MCP ClientSession to record tool calls as governance evidence.

    Example::

        from mcp import ClientSession

        mcp_session = ClientSession(...)
        traced_session = vectorbea.wrap_mcp_client(mcp_session, server_name="my-mcp-server")

        # All calls through traced_session are now recorded
        result = traced_session.call_tool("my-tool", {"input": query})
    """
    return _McpClientWrapper(session, server_name)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _iso(ts: float) -> str:
    """Format a Unix timestamp as an ISO 8601 string (UTC, millisecond precision)."""
    from datetime import datetime, timezone

    return datetime.fromtimestamp(ts, tz=timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.") + f"{int((ts % 1) * 1000):03d}Z"
