"""
Response models returned by the VectorBea SDK.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any, Dict, Optional


@dataclass
class PromptTemplate:
    """
    A resolved, published prompt version fetched from the VectorBea proxy.

    Attributes
    ----------
    prompt_id : str
        Stable UUID of the parent prompt record.
    prompt_version_id : str
        UUID of the specific published version that was resolved.
    organization_id : str
        UUID of the organization that owns this prompt.
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
    >>> message = prompt.format(name="Alice", product="Acme AI")
    >>> print(message)
    Hello Alice, welcome to Acme AI!
    """

    prompt_id: str
    prompt_version_id: str
    organization_id: str
    name: str
    version_tag: str
    template_text: str
    parameters: Dict[str, Any] = field(default_factory=dict)
    description: Optional[str] = None
    created_at: str = ""

    # Matches both {{ name }} and {{name}} style placeholders
    _PLACEHOLDER_RE = re.compile(r"\{\{\s*(\w+)\s*\}\}")

    def format(self, **kwargs: Any) -> str:
        """
        Render the template by substituting ``{{variable}}`` placeholders.

        All ``{{key}}`` occurrences in :attr:`template_text` are replaced
        with the corresponding keyword argument. Whitespace inside the
        braces is ignored, so ``{{ name }}`` and ``{{name}}`` are equivalent.

        Parameters
        ----------
        **kwargs :
            Variable values keyed by their placeholder names.

        Returns
        -------
        str
            Fully rendered prompt string ready to send to an LLM.

        Raises
        ------
        KeyError
            If a placeholder in the template has no matching kwarg.

        Examples
        --------
        >>> prompt.format(name="Bob", product="VectorBea")
        'Hello Bob, welcome to VectorBea!'
        """
        missing = [
            m.group(1)
            for m in self._PLACEHOLDER_RE.finditer(self.template_text)
            if m.group(1) not in kwargs
        ]
        if missing:
            raise KeyError(
                f"Missing template variables: {missing}. "
                f"Provide them as keyword arguments to .format()."
            )

        def replacer(match: re.Match) -> str:  # type: ignore[type-arg]
            return str(kwargs[match.group(1)])

        return self._PLACEHOLDER_RE.sub(replacer, self.template_text)

    @classmethod
    def _from_dict(cls, data: Dict[str, Any]) -> "PromptTemplate":
        """Internal: build a PromptTemplate from the raw API JSON payload."""
        return cls(
            prompt_id=data["promptId"],
            prompt_version_id=data["promptVersionId"],
            organization_id=data["organizationId"],
            name=data["name"],
            version_tag=data["versionTag"],
            template_text=data["templateText"],
            parameters=data.get("parameters") or {},
            description=data.get("description"),
            created_at=data.get("createdAt", ""),
        )
