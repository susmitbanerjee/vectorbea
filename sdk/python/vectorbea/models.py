"""
Response models returned by the VectorBea SDK.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any, Dict, Optional


@dataclass
class Prompt:
    """
    A resolved, published prompt version fetched from the VectorBea proxy.

    Attributes
    ----------
    name : str
        Prompt name as registered in the dashboard (e.g. ``"greet-user"``).
    version_tag : str
        Human-readable version label (e.g. ``"v1.2.0"``).
    template_text : str
        Raw template string with ``{{variable}}`` placeholders.
    parameters : Dict[str, Any]
        Parameter schema defined in the dashboard, keyed by variable name.
    description : Optional[str]
        Optional human-readable description of the prompt's purpose.
    created_at : str
        ISO-8601 timestamp of when this version was created.

    Examples
    --------
    >>> prompt = client.prompts.get("greet-user")
    >>> message = prompt.compile({"name": "Alice", "product": "Acme AI"})
    >>> print(message)
    Hello Alice, welcome to Acme AI!
    """

    name: str
    version_tag: str
    template_text: str
    parameters: Dict[str, Any] = field(default_factory=dict)
    description: Optional[str] = None
    created_at: str = ""
    _prompt_version_id: str = field(default="", repr=False)
    _proxy_latency_ms: float = field(default=0.0, repr=False)

    # Matches both {{ name }} and {{name}} style placeholders
    _PLACEHOLDER_RE = re.compile(r"\{\{\s*(\w+)\s*\}\}")

    def compile(self, variables: Dict[str, Any]) -> str:
        """
        Render the template by substituting ``{{variable}}`` placeholders.

        All ``{{key}}`` occurrences in :attr:`template_text` are replaced
        with the corresponding value from *variables*. Whitespace inside
        the braces is ignored, so ``{{ name }}`` and ``{{name}}`` are
        equivalent.

        Parameters
        ----------
        variables : dict
            Mapping of placeholder names to their substitution values.

        Returns
        -------
        str
            Fully rendered prompt string ready to send to an LLM.

        Raises
        ------
        KeyError
            If a placeholder in the template has no matching key in
            *variables*.

        Examples
        --------
        >>> prompt.compile({"name": "Bob", "product": "VectorBea"})
        'Hello Bob, welcome to VectorBea!'
        """
        missing = [
            m.group(1)
            for m in self._PLACEHOLDER_RE.finditer(self.template_text)
            if m.group(1) not in variables
        ]
        if missing:
            raise KeyError(
                f"Missing template variables: {missing}. "
                f"Provide them as keys in the variables dict passed to .compile()."
            )

        def _replacer(match: re.Match) -> str:  # type: ignore[type-arg]
            return str(variables[match.group(1)])

        return self._PLACEHOLDER_RE.sub(_replacer, self.template_text)

    def format(self, **kwargs: Any) -> str:
        """Deprecated alias for :meth:`compile`. Use ``compile(variables)`` instead."""
        return self.compile(dict(kwargs))

    @classmethod
    def _from_dict(cls, data: Dict[str, Any]) -> "Prompt":
        """Internal: build a Prompt from the raw API JSON payload."""
        return cls(
            name=data["name"],
            version_tag=data["versionTag"],
            template_text=data["templateText"],
            parameters=data.get("parameters") or {},
            description=data.get("description"),
            created_at=data.get("createdAt", ""),
            _prompt_version_id=data["promptVersionId"],
        )


# Backward-compatibility alias — remove in v1.0
PromptTemplate = Prompt
