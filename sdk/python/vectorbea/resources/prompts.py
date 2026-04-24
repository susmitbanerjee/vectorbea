"""
Prompts resource — wraps the /v1/prompts/:name and /v1/audit endpoints.
"""

from __future__ import annotations

import time
import warnings
from contextlib import contextmanager
from typing import TYPE_CHECKING, Any, Dict, Generator, Optional

from vectorbea.models import Prompt
from vectorbea.trace_metadata import build_trace_metadata_v1

if TYPE_CHECKING:
    from vectorbea._http import HttpClient

# Cost per token (USD) for common models.
# Override by passing cost_per_input_token / cost_per_output_token to trace().
_MODEL_COSTS: Dict[str, Dict[str, float]] = {
    "gpt-4o":               {"input": 5.00 / 1_000_000,  "output": 15.00 / 1_000_000},
    "gpt-4o-mini":          {"input": 0.15 / 1_000_000,  "output": 0.60  / 1_000_000},
    "gpt-4-turbo":          {"input": 10.00 / 1_000_000, "output": 30.00 / 1_000_000},
    "gpt-3.5-turbo":        {"input": 0.50 / 1_000_000,  "output": 1.50  / 1_000_000},
    "claude-3-5-sonnet-20241022": {"input": 3.00 / 1_000_000, "output": 15.00 / 1_000_000},
    "claude-3-haiku-20240307":    {"input": 0.25 / 1_000_000, "output": 1.25  / 1_000_000},
}

def _cost_for_model(model: str, tokens_in: int, tokens_out: int) -> Dict[str, float]:
    # Normalize: "gpt-4o-2024-11-20" → look up "gpt-4o" as prefix match
    rates = _MODEL_COSTS.get(model)
    if rates is None:
        for key, val in _MODEL_COSTS.items():
            if model.startswith(key):
                rates = val
                break
    if rates is None:
        return {"currency": "USD", "input_cost": 0.0, "output_cost": 0.0, "total_cost": 0.0}
    input_cost  = tokens_in  * rates["input"]
    output_cost = tokens_out * rates["output"]
    return {"currency": "USD", "input_cost": input_cost, "output_cost": output_cost, "total_cost": input_cost + output_cost}


def _extract_openai_response(response: Any) -> Dict[str, Any]:
    """Pull tokens, model, output text from an openai.ChatCompletion response."""
    try:
        model     = getattr(response, "model", "unknown-model")
        usage     = getattr(response, "usage", None)
        tokens_in  = getattr(usage, "prompt_tokens",     0) if usage else 0
        tokens_out = getattr(usage, "completion_tokens", 0) if usage else 0
        choices   = getattr(response, "choices", [])
        output    = ""
        if choices:
            msg = getattr(choices[0], "message", None)
            output = getattr(msg, "content", "") or ""
        cost = _cost_for_model(model, tokens_in, tokens_out)
        return {
            "model": model, "provider": "openai",
            "tokens_in": tokens_in, "tokens_out": tokens_out,
            "total_tokens": getattr(usage, "total_tokens", tokens_in + tokens_out) if usage else tokens_in + tokens_out,
            "output": output, "cost": cost,
            "finish_reason": getattr(choices[0], "finish_reason", None) if choices else None,
        }
    except Exception:
        return {}


def _extract_anthropic_response(response: Any) -> Dict[str, Any]:
    """Pull tokens, model, output text from an anthropic.Message response."""
    try:
        model      = getattr(response, "model", "unknown-model")
        usage      = getattr(response, "usage", None)
        tokens_in  = getattr(usage, "input_tokens",  0) if usage else 0
        tokens_out = getattr(usage, "output_tokens", 0) if usage else 0
        content    = getattr(response, "content", [])
        output     = ""
        if content:
            output = getattr(content[0], "text", "") or ""
        cost = _cost_for_model(model, tokens_in, tokens_out)
        return {
            "model": model, "provider": "anthropic",
            "tokens_in": tokens_in, "tokens_out": tokens_out,
            "total_tokens": tokens_in + tokens_out,
            "output": output, "cost": cost,
            "finish_reason": getattr(response, "stop_reason", None),
        }
    except Exception:
        return {}


class _TraceContext:
    """
    Returned by ``Prompts.trace()``.  Holds the in-flight state and is
    finalised (audit logged) when the ``with`` block exits.

    Usage::

        with client.prompts.trace(prompt, input_text=message) as t:
            response = openai.chat.completions.create(...)
            t.record(response)          # auto-extracts everything
            # t.set_cache_status("hit") # optional overrides
    """

    def __init__(
        self,
        prompts_resource: "Prompts",
        prompt: Prompt,
        *,
        input_text: str = "",
        sidecar: str = "",
        environment: str = "prod",
        extra_metadata: Optional[Dict[str, Any]] = None,
        cost_per_input_token: Optional[float] = None,
        cost_per_output_token: Optional[float] = None,
    ) -> None:
        self._prompts    = prompts_resource
        self._prompt     = prompt
        self._input_text = input_text
        self._sidecar    = sidecar
        self._environment = environment
        self._extra      = extra_metadata or {}
        self._override_rates = (
            {"input": cost_per_input_token, "output": cost_per_output_token}
            if cost_per_input_token is not None else None
        )

        # Fields filled by record() or set_*()
        self._model:       str   = ""
        self._provider:    str   = ""
        self._tokens_in:   int   = 0
        self._tokens_out:  int   = 0
        self._total_tokens: int   = 0
        self._output_text: str   = ""
        self._finish_reason: str = ""
        self._cost:        Dict[str, float] = {}
        self._cache_status: str  = "miss"
        self._guardrail:   str   = "passed"
        self._rag:         Optional[Dict[str, Any]] = None
        self._status:      str   = "success"
        self._llm_start:   float = time.monotonic()
        self._llm_ms:      int   = 0

    # ── Public helpers the caller can use inside the with-block ───────────────

    def record(self, response: Any) -> "TraceContext":
        """
        Auto-extract tokens, cost, model and output text from an LLM response.
        Supports openai.ChatCompletion and anthropic.Message out of the box.
        Any other object: pass a dict with keys model/tokens_in/tokens_out/output.
        """
        self._llm_ms = int((time.monotonic() - self._llm_start) * 1000)

        if isinstance(response, dict):
            extracted = response
        else:
            # Detect provider by class name / module
            cls_module = getattr(type(response), "__module__", "") or ""
            if "anthropic" in cls_module:
                extracted = _extract_anthropic_response(response)
            else:
                extracted = _extract_openai_response(response)

        self._model      = extracted.get("model", "")
        self._provider   = extracted.get("provider", "")
        self._tokens_in  = int(extracted.get("tokens_in", extracted.get("tokensIn", 0)))
        self._tokens_out = int(extracted.get("tokens_out", extracted.get("tokensOut", 0)))
        self._total_tokens = int(extracted.get("total_tokens", extracted.get("totalTokens", self._tokens_in + self._tokens_out)))
        self._output_text = str(extracted.get("output", ""))
        self._finish_reason = str(extracted.get("finish_reason") or extracted.get("finishReason") or "")

        if self._override_rates:
            inp = (self._override_rates.get("input") or 0) * self._tokens_in
            out = (self._override_rates.get("output") or 0) * self._tokens_out
            self._cost = {"input_cost": inp, "output_cost": out, "total_cost": inp + out}
        else:
            self._cost = extracted.get("cost") or _cost_for_model(
                self._model, self._tokens_in, self._tokens_out
            )
        return self

    def set_cache_status(self, status: str) -> "TraceContext":
        """Override cache status: 'hit' | 'miss' | 'skipped' | 'stale'."""
        self._cache_status = status
        return self

    def set_guardrail(self, action: str) -> "TraceContext":
        """Override guardrail result: 'passed' | 'flagged'."""
        self._guardrail = action
        return self

    def set_rag(self, query: str, chunks: list, retrieval_ms: int = 0) -> "TraceContext":
        """Attach RAG context to the trace."""
        self._rag = {"query": query, "chunks": chunks,
                     "chunks_used": len(chunks), "retrieval_ms": retrieval_ms}
        return self

    def set_status(self, status: str) -> "TraceContext":
        """Override trace status: 'success' | 'warning' | 'error'."""
        self._status = status
        return self

    # ── Internal ──────────────────────────────────────────────────────────────

    def _build_metadata(self) -> Dict[str, Any]:
        meta: Dict[str, Any] = {
            "cache":    {"status": self._cache_status},
            "guardrail": {
                "triggered": self._guardrail != "passed",
                "action": "allow" if self._guardrail == "passed" else "warn",
            },
            "executor": {
                "type": "direct_provider",
                "ownership": "vectorbea",
                "request_mode": "direct",
                "response_observability": "full",
            },
            "trace":    {"environment": self._environment, "status": self._status},
        }
        if self._sidecar:
            meta["sidecar"] = self._sidecar
        if self._input_text:
            meta["request"] = {"input": {"text": self._input_text}}
        if self._output_text:
            meta["output"] = {
                "raw_text": self._output_text,
                "final_text": self._output_text,
                **({"finish_reason": self._finish_reason} if self._finish_reason else {}),
            }
        if self._model:
            meta["model"] = {
                "model":         self._model,
                "provider":      self._provider,
                "input_tokens":  self._tokens_in,
                "output_tokens": self._tokens_out,
                "total_tokens":  self._total_tokens or self._tokens_in + self._tokens_out,
                "latency_ms":    self._llm_ms,
                "cost":          self._cost,
            }
        if self._rag:
            meta["retrieval"] = self._rag
        meta.update(self._extra)
        return meta

    def _flush(self) -> None:
        try:
            self._prompts.log_audit(
                self._prompt,
                llm_latency_ms=self._llm_ms,
                token_count=self._total_tokens or self._tokens_in + self._tokens_out,
                metadata=self._build_metadata(),
            )
        except Exception as exc:
            warnings.warn(
                f"[vectorbea] trace flush failed (non-fatal): {exc}",
                RuntimeWarning,
                stacklevel=3,
            )

    def __enter__(self) -> "_TraceContext":
        self._llm_start = time.monotonic()
        return self

    def __exit__(self, exc_type: Any, exc_val: Any, exc_tb: Any) -> None:
        if exc_type is not None:
            self._status = "error"
        if self._llm_ms == 0 and self._llm_start:
            self._llm_ms = int((time.monotonic() - self._llm_start) * 1000)
        self._flush()
        return None  # never suppress exceptions


# Alias for type hints in user code
TraceContext = _TraceContext


class Prompts:
    """
    Access published prompts from your VectorBea workspace.
    """

    def __init__(self, http: "HttpClient") -> None:
        self._http = http

    def get(self, name: str) -> Prompt:
        """
        Fetch the latest published version of a prompt by name.
        Proxy latency is auto-reported as an audit event.
        """
        t0 = time.monotonic()
        data = self._http.get(f"/v1/prompts/{name}")
        proxy_latency_ms = (time.monotonic() - t0) * 1000.0

        prompt = Prompt._from_dict(data)

        try:
            self._report_audit(prompt, proxy_latency_ms=proxy_latency_ms)
        except Exception as exc:
            warnings.warn(
                f"[vectorbea] audit report failed (non-fatal): {exc}",
                RuntimeWarning,
                stacklevel=2,
            )

        return prompt

    def trace(
        self,
        prompt: Prompt,
        *,
        input_text: str = "",
        sidecar: str = "",
        environment: str = "prod",
        metadata: Optional[Dict[str, Any]] = None,
        cost_per_input_token: Optional[float] = None,
        cost_per_output_token: Optional[float] = None,
    ) -> _TraceContext:
        """
        Context manager that automatically logs a full audit event when the
        ``with`` block exits — no manual ``log_audit()`` call needed.

        Call ``t.record(llm_response)`` inside the block to capture tokens,
        cost, model and output text automatically from the LLM response object.

        Parameters
        ----------
        prompt : Prompt
            The prompt returned by ``client.prompts.get()``.
        input_text : str, optional
            The rendered prompt string sent to the LLM (for Span details view).
        sidecar : str, optional
            Name of the sidecar shown in the SIDECAR card.
        environment : str, optional
            ``"prod"`` or ``"staging"``. Defaults to ``"prod"``.
        metadata : dict, optional
            Extra key/value pairs merged into the audit metadata.
        cost_per_input_token : float, optional
            Override the built-in per-token input cost (USD).
        cost_per_output_token : float, optional
            Override the built-in per-token output cost (USD).

        Examples
        --------
        **OpenAI**::

            prompt = client.prompts.get("support-agent-2")
            message = prompt.compile({"customer_name": "Alice", "issue": "billing"})

            with client.prompts.trace(prompt, input_text=message) as t:
                response = openai.chat.completions.create(
                    model="gpt-4o",
                    messages=[{"role": "user", "content": message}],
                )
                t.record(response)

        **Anthropic**::

            with client.prompts.trace(prompt, input_text=message) as t:
                response = anthropic_client.messages.create(
                    model="claude-3-5-sonnet-20241022",
                    max_tokens=1024,
                    messages=[{"role": "user", "content": message}],
                )
                t.record(response)
        """
        return _TraceContext(
            self,
            prompt,
            input_text=input_text,
            sidecar=sidecar,
            environment=environment,
            extra_metadata=metadata,
            cost_per_input_token=cost_per_input_token,
            cost_per_output_token=cost_per_output_token,
        )

    def log_audit(
        self,
        prompt: Prompt,
        *,
        proxy_latency_ms: float = 0.0,
        llm_latency_ms: int = 0,
        token_count: int = 0,
        metadata: Optional[Dict[str, Any]] = None,
        provider: Optional[str] = None,
        model: Optional[str] = None,
        input_tokens: Optional[int] = None,
        output_tokens: Optional[int] = None,
        cache_status: Optional[str] = None,
        output_text: Optional[str] = None,
    ) -> None:
        """
        Report a full audit event manually.
        Prefer ``trace()`` for automatic capture.
        """
        self._report_audit(
            prompt,
            proxy_latency_ms=proxy_latency_ms,
            llm_latency_ms=llm_latency_ms,
            token_count=token_count,
            metadata={
                **(metadata or {}),
                **(
                    {
                        "model": {
                            **(metadata.get("model", {}) if isinstance(metadata, dict) and isinstance(metadata.get("model"), dict) else {}),
                            **({"provider": provider} if provider else {}),
                            **({"model": model} if model else {}),
                            **({"input_tokens": input_tokens} if input_tokens is not None else {}),
                            **({"output_tokens": output_tokens} if output_tokens is not None else {}),
                            "total_tokens": token_count
                            or (input_tokens or 0) + (output_tokens or 0),
                            "latency_ms": llm_latency_ms,
                        }
                    }
                    if provider or model or input_tokens is not None or output_tokens is not None
                    else {}
                ),
                **({"cache": {"status": cache_status}} if cache_status else {}),
                **({"output": {"raw_text": output_text, "final_text": output_text}} if output_text else {}),
            },
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
            "promptName":      prompt.name,
            "versionTag":      prompt.version_tag,
            "proxyLatencyMs":  float(proxy_latency_ms),
            "llmLatencyMs":    int(llm_latency_ms),
            "tokenCount":      int(token_count),
            "metadata": build_trace_metadata_v1(
                metadata=metadata or {},
                prompt_version_id=prompt._prompt_version_id,
                prompt_name=prompt.name,
                version_tag=prompt.version_tag,
                proxy_latency_ms=float(proxy_latency_ms),
                llm_latency_ms=int(llm_latency_ms),
                token_count=int(token_count),
                use_type="runtime",
            ),
        }
        self._http.post("/v1/audit", json=payload)
