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
    # Deprecated
    "VectorBea",
    "PromptTemplate",
]

__version__ = "0.2.0"
