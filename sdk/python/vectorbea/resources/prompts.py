"""
Prompts resource — wraps the /api/proxy/prompts/:name endpoint.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

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
        data = self._http.get(f"/api/prompts/{name}")
        return PromptTemplate._from_dict(data)
