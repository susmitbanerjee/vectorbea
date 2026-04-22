"""
Prompts resource — wraps the /v1/prompts/:name and /v1/audit endpoints.
"""

from __future__ import annotations

import time
import warnings
from typing import TYPE_CHECKING, Any, Dict, Optional

from vectorbea.models import Prompt

if TYPE_CHECKING:
    from vectorbea._http import HttpClient


class Prompts:
    """
    Access published prompts from your VectorBea workspace.

    Obtain an instance via :attr:`VectorBea.prompts`:

    .. code-block:: python

        import vectorbea

        client = vectorbea.VectorBea(api_key="vb_...")
        prompt = client.prompts.get("greet-user")
    """

    def __init__(self, http: "HttpClient") -> None:
        self._http = http

    def get(self, name: str) -> Prompt:
        """
        Fetch the latest published version of a prompt by name.

        The proxy latency is measured automatically and reported as an audit
        event so every call appears in the VectorBea dashboard without any
        extra instrumentation. Audit failures are silently swallowed so they
        never break your application.

        Parameters
        ----------
        name : str
            The prompt name as defined in the VectorBea dashboard
            (e.g. ``"greet-user"`` or ``"summarise-ticket"``).

        Returns
        -------
        Prompt
            Resolved prompt with a ``.format(**kwargs)`` method for
            variable substitution.

        Raises
        ------
        vectorbea.NotFoundError
            If the prompt does not exist in the connected workspace or has
            no published version.
        vectorbea.AuthenticationError
            If the configured API key is invalid or inactive.
        vectorbea.VectorBeaError
            For any other non-2xx response from the proxy.

        Examples
        --------
        >>> prompt = client.prompts.get("greet-user")
        >>> print(prompt.version_tag)
        v1.2.0
        >>> print(prompt.format(name="Alice", product="Acme AI"))
        Hello Alice, welcome to Acme AI!
        """
        t0 = time.monotonic()
        data = self._http.get(f"/v1/prompts/{name}")
        proxy_latency_ms = (time.monotonic() - t0) * 1000.0

        prompt = Prompt._from_dict(data)

        # Auto-report the proxy fetch latency so the dashboard reflects every
        # get() call without requiring a separate log_audit() call.
        # Errors are demoted to warnings — audit must never break the caller.
        try:
            self._report_audit(prompt, proxy_latency_ms=proxy_latency_ms)
        except Exception as exc:
            warnings.warn(
                f"[vectorbea] audit report failed (non-fatal): {exc}",
                RuntimeWarning,
                stacklevel=2,
            )

        return prompt

    def log_audit(
        self,
        prompt: Prompt,
        *,
        proxy_latency_ms: float = 0.0,
        llm_latency_ms: int = 0,
        token_count: int = 0,
        metadata: Optional[Dict[str, Any]] = None,
    ) -> None:
        """
        Report a full audit event including LLM latency and token count.

        ``get()`` already reports the proxy fetch latency automatically.
        Call this *after* your LLM responds to add the LLM latency and
        token usage to the same audit record in the dashboard.

        Parameters
        ----------
        prompt : PromptTemplate
            The prompt returned by ``client.prompts.get()``.
        proxy_latency_ms : float
            Proxy fetch latency in ms. Pass the value measured around
            ``get()`` if you want to override the auto-reported one.
        llm_latency_ms : int
            Round-trip latency of your LLM call in milliseconds.
        token_count : int
            Total tokens consumed (prompt + completion).
        metadata : dict, optional
            Extra key/value pairs attached to the audit record
            (e.g. ``{"user_id": "u_123", "model": "gpt-4o"}``).

        Examples
        --------
        >>> prompt = client.prompts.get("greet-user")
        >>> message = prompt.format(name="Alice", product="Acme AI")
        >>> # ... call your LLM ...
        >>> client.prompts.log_audit(
        ...     prompt,
        ...     llm_latency_ms=432,
        ...     token_count=87,
        ...     metadata={"model": "gpt-4o"},
        ... )
        """
        self._report_audit(
            prompt,
            proxy_latency_ms=proxy_latency_ms,
            llm_latency_ms=llm_latency_ms,
            token_count=token_count,
            metadata=metadata,
        )

    # ── Internal ──────────────────────────────────────────────────────────────

    def _report_audit(
        self,
        prompt: Prompt,
        *,
        proxy_latency_ms: float = 0.0,
        llm_latency_ms: int = 0,
        token_count: int = 0,
        metadata: Optional[Dict[str, Any]] = None,
    ) -> None:
        payload = {
            "promptVersionId": prompt._prompt_version_id,
            "promptName": prompt.name,
            "versionTag": prompt.version_tag,
            "proxyLatencyMs": float(proxy_latency_ms),
            "llmLatencyMs": int(llm_latency_ms),
            "tokenCount": int(token_count),
            "metadata": metadata or {},
        }
        self._http.post("/v1/audit", json=payload)
