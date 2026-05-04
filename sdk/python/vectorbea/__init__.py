"""
VectorBea Python SDK
~~~~~~~~~~~~~~~~~~~~

Official client library for the VectorBea prompt management platform.

    >>> from vectorbea import VectorBeaClient
    >>> client = VectorBeaClient(api_key="vbagent_...")
    >>> prompt = client.prompts.get("greet-user")
    >>> print(prompt.compile({"name": "Alice", "product": "Acme AI"}))
    Hello Alice, welcome to Acme AI!

Full documentation: https://vectorbea.com/docs
"""

from vectorbea.client import VectorBeaClient
from vectorbea.errors import (
    APIError,
    AuthenticationError,
    ConnectionError as VectorBeaConnectionError,
    NotFoundError,
    TimeoutError as VectorBeaTimeoutError,
    VectorBeaError,
)
from vectorbea.models import Prompt, PromptTemplate  # PromptTemplate = backward-compat alias
from vectorbea.trace_metadata import TRACE_METADATA_SCHEMA_VERSION, build_trace_metadata_v1

# ---------------------------------------------------------------------------
# Governance instrumentation API
# ---------------------------------------------------------------------------
from vectorbea.governance import (
    Run,
    Step,
    current_run,
    init,
    run,
    trace,
    wrap_mcp_client,
)

# ---------------------------------------------------------------------------
# Deprecated alias — will be removed in v1.0
# ---------------------------------------------------------------------------
VectorBea = VectorBeaClient

__all__ = [
    # Client
    "VectorBeaClient",
    # Models
    "Prompt",
    # Errors
    "VectorBeaError",
    "APIError",
    "AuthenticationError",
    "NotFoundError",
    "VectorBeaConnectionError",
    "VectorBeaTimeoutError",
    # Governance instrumentation
    "init",
    "run",
    "trace",
    "current_run",
    "wrap_mcp_client",
    "Run",
    "Step",
    # Deprecated
    "VectorBea",
    "PromptTemplate",
    "TRACE_METADATA_SCHEMA_VERSION",
    "build_trace_metadata_v1",
]

__version__ = "0.3.0"
