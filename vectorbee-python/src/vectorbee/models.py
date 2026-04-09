"""Pydantic models used by the vectorbee SDK."""

from __future__ import annotations

from typing import Any

from pydantic import AliasChoices, BaseModel, ConfigDict, Field


class PromptResponse(BaseModel):
    """Normalized prompt payload returned from the local vectorbee proxy."""

    model_config = ConfigDict(populate_by_name=True)

    template_text: str = Field(
        validation_alias=AliasChoices("template_text", "templateText"),
        serialization_alias="template_text",
    )
    parameters: dict[str, Any] = Field(default_factory=dict)
