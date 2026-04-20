"""
VectorBea — top-level client.
"""

from __future__ import annotations

import os
from typing import Optional

from vectorbea._http import HttpClient
from vectorbea.resources.prompts import Prompts

_DEFAULT_BASE_URL = "https://app.vectorbea.com"


class VectorBeaClient:
    """
    The VectorBea SDK client.

    Instantiate once and reuse across your application. The client is
    thread-safe; the underlying ``requests.Session`` is shared across all
    resource calls.

    Parameters
    ----------
    api_key : str, optional
        Your workspace API key (starts with ``vb_`` or ``vbagent_``). If
        omitted the SDK looks for the ``VECTORBEA_API_KEY`` environment
        variable.
    base_url : str, optional
        Base URL of the VectorBea proxy or hub. Defaults to the hosted
        cloud endpoint. Override to ``http://localhost:8080`` when running
        the proxy container locally, or to your self-hosted hub URL.
    timeout : int, optional
        Request timeout in seconds. Defaults to 10.

    Examples
    --------
    **Cloud (production)**

    .. code-block:: python

        from vectorbea import VectorBeaClient

        client = VectorBeaClient(api_key="vb_live_...")
        prompt = client.prompts.get("customer-support-reply")
        message = prompt.compile({"customer_name": "Alice", "issue": "billing"})

    **Local proxy (development)**

    .. code-block:: python

        from vectorbea import VectorBeaClient

        client = VectorBeaClient(
            api_key="vbagent_...",
            base_url="http://localhost:8080",
        )
    """

    def __init__(
        self,
        api_key: Optional[str] = None,
        base_url: Optional[str] = None,
        timeout: int = 10,
    ) -> None:
        resolved_key = api_key or os.environ.get("VECTORBEA_API_KEY")
        if not resolved_key:
            raise ValueError(
                "No API key provided. Pass api_key= or set the "
                "VECTORBEA_API_KEY environment variable."
            )

        resolved_url = (base_url or os.environ.get("VECTORBEA_BASE_URL") or _DEFAULT_BASE_URL).rstrip("/")

        self._http = HttpClient(
            base_url=resolved_url,
            api_key=resolved_key,
            timeout=timeout,
        )

        self.prompts = Prompts(self._http)
