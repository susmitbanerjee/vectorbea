"""
Exception hierarchy for the VectorBea SDK.

All exceptions inherit from VectorBeaError so callers can catch everything
with a single ``except vectorbea.VectorBeaError``.
"""


class VectorBeaError(Exception):
    """Base class for all VectorBea SDK errors."""


class AuthenticationError(VectorBeaError):
    """
    Raised when the API key is missing, invalid, or inactive.

    Re-generate a key from the VectorBea dashboard → Settings → API Keys.
    """


class NotFoundError(VectorBeaError):
    """
    Raised when the requested resource does not exist in the workspace.

    Common causes:
    - Prompt name is misspelled.
    - The prompt exists but has no published version yet.
    - The API key belongs to a different workspace than the prompt.
    """
