"""
VectorBea Python SDK
~~~~~~~~~~~~~~~~~~~~

Official client library for the VectorBea prompt management platform.

    >>> import vectorbea
    >>> client = vectorbea.VectorBea(api_key="vb_...")
    >>> prompt = client.prompts.get("greet-user")
    >>> print(prompt.format(name="Alice", product="Acme AI"))
    Hello Alice, welcome to Acme AI!

Full documentation: https://vectorbea.com/docs
"""

from vectorbea.client import VectorBea
from vectorbea.errors import AuthenticationError, NotFoundError, VectorBeaError
from vectorbea.models import PromptTemplate

__all__ = [
    "VectorBea",
    "PromptTemplate",
    "VectorBeaError",
    "AuthenticationError",
    "NotFoundError",
]

__version__ = "0.1.5"
