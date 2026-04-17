"""
Prompts resource — wraps the /v1/prompts/:name and /v1/audit endpoints.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any, Dict, Optional

from vectorbea.models import PromptTemplate

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

    def get(self, name: str) -> PromptTemplate:
        """
        Fetch the latest published version of a prompt by name.

        The proxy resolves the prompt from your workspace and returns the
        active published version. If you update and republish a prompt in
        the dashboard, the next call to ``.get()`` will automatically return
        the new version — no code changes required.

        Parameters
        ----------
        name : str
            The prompt name as defined in the VectorBea dashboard
            (e.g. ``"greet-user"`` or ``"summarise-ticket"``).

        Returns
        -------
        PromptTemplate
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
        data = self._http.get(f"/v1/prompts/{name}")
        return PromptTemplate._from_dict(data)

    def log_audit(
        self,
        prompt: PromptTemplate,
        *,
        proxy_latency_ms: float = 0.0,
        llm_latency_ms: int = 0,
        token_count: int = 0,
        metadata: Optional[Dict[str, Any]] = None,
    ) -> None:
        """
        Report an audit event to the proxy for a prompt execution.

        Call this after your LLM responds so VectorBea can track API call
        counts, latency, and token usage in the dashboard.

        Parameters
        ----------
        prompt : PromptTemplate
            The prompt returned by ``client.prompts.get()``. Provides the
            ``promptVersionId``, ``name``, and ``versionTag`` automatically.
        proxy_latency_ms : float
            Time from when you called ``client.prompts.get()`` until you
            received the rendered prompt, in milliseconds. Pass ``0`` if
            you did not measure it.
        llm_latency_ms : int
            Round-trip latency of your LLM call in milliseconds.
        token_count : int
            Total tokens consumed by the LLM response (prompt + completion).
        metadata : dict, optional
            Any additional key/value pairs to attach to the audit record
            (e.g. ``{"user_id": "u_123", "model": "gpt-4o"}``).

        Examples
        --------
        >>> import time
        >>> t0 = time.time()
        >>> prompt = client.prompts.get("greet-user")
        >>> proxy_ms = (time.time() - t0) * 1000
        >>>
        >>> message = prompt.format(name="Alice", product="Acme AI")
        >>> # ... call your LLM ...
        >>> client.prompts.log_audit(
        ...     prompt,
        ...     proxy_latency_ms=proxy_ms,
        ...     llm_latency_ms=432,
        ...     token_count=87,
        ... )
        """
        payload = {
            "promptVersionId": prompt.prompt_version_id,
            "promptName": prompt.name,
            "versionTag": prompt.version_tag,
            "proxyLatencyMs": float(proxy_latency_ms),
            "llmLatencyMs": int(llm_latency_ms),
            "tokenCount": int(token_count),
            "metadata": metadata or {},
        }
        self._http.post("/v1/audit", json=payload)
