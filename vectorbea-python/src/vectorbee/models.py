"""Pydantic models used by the vectorbea SDK."""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class PromptResponse(BaseModel):
    """Normalized prompt payload returned from the local vectorbea proxy."""

    model_config = ConfigDict(populate_by_name=True)

    prompt_id: str = ""
    prompt_version_id: str = ""
    organization_id: str = ""
    name: str = ""
    description: str | None = None
    version_tag: str = ""
    template_text: str = ""
    parameters: dict[str, Any] = Field(default_factory=dict)
    created_at: str = ""

    def to_openai(self) -> dict[str, Any]:
        """Convenience helper that maps the prompt to OpenAI chat-completion kwargs.

        Spreads ``parameters`` (e.g. ``model``, ``temperature``) and prepends
        the ``template_text`` as the system message. Caller is expected to
        append user/assistant turns afterwards if desired.
        """

        return {
            "messages": [{"role": "system", "content": self.template_text}],
            **self.parameters,
        }
