"""TraceMetadataV1 helpers for SDK-emitted runtime audit records."""

from __future__ import annotations

from typing import Any, Dict, List, Optional

TRACE_METADATA_SCHEMA_VERSION = "1.0"


def _as_dict(value: Any) -> Dict[str, Any]:
    return value if isinstance(value, dict) else {}


def _as_number(value: Any, fallback: float = 0.0) -> float:
    return value if isinstance(value, (int, float)) else fallback


def _normalize_cost(value: Any) -> Dict[str, Any]:
    cost = _as_dict(value)
    result: Dict[str, Any] = {"currency": cost.get("currency", "USD")}
    for source, target in (
        ("input_cost", "input_cost"),
        ("inputCost", "input_cost"),
        ("output_cost", "output_cost"),
        ("outputCost", "output_cost"),
        ("total_cost", "total_cost"),
        ("totalCost", "total_cost"),
    ):
        if source in cost and isinstance(cost[source], (int, float)):
            result[target] = cost[source]
    return result


def _synthetic_spans(
    *,
    proxy_latency_ms: float,
    llm_latency_ms: int,
    duration_ms: float,
    status: str,
) -> List[Dict[str, Any]]:
    spans: List[Dict[str, Any]] = [
        {
            "span_id": "root",
            "parent_span_id": None,
            "name": "Runtime execution",
            "type": "root",
            "component": "vectorbea-sdk",
            "status": status,
            "start_offset_ms": 0,
            "duration_ms": duration_ms,
        }
    ]
    if proxy_latency_ms > 0:
        spans.append(
            {
                "span_id": "prompt-resolve",
                "parent_span_id": "root",
                "name": "Prompt resolution",
                "type": "prompt_resolve",
                "component": "vectorbea",
                "status": status,
                "start_offset_ms": 0,
                "duration_ms": proxy_latency_ms,
            }
        )
    if llm_latency_ms > 0:
        spans.append(
            {
                "span_id": "llm-call",
                "parent_span_id": "root",
                "name": "LLM completion",
                "type": "llm",
                "component": "llm",
                "status": status,
                "start_offset_ms": max(0, proxy_latency_ms),
                "duration_ms": llm_latency_ms,
            }
        )
    return spans


def build_trace_metadata_v1(
    *,
    metadata: Optional[Dict[str, Any]],
    prompt_version_id: str,
    prompt_name: str,
    version_tag: str,
    proxy_latency_ms: float,
    llm_latency_ms: int,
    token_count: int,
    use_type: str = "runtime",
) -> Dict[str, Any]:
    """Normalize SDK metadata into the canonical TraceMetadataV1 envelope."""

    existing = _as_dict(metadata)
    trace = _as_dict(existing.get("trace"))
    executor = _as_dict(existing.get("executor"))
    request = _as_dict(existing.get("request"))
    prompt = _as_dict(existing.get("prompt"))
    model = _as_dict(existing.get("model"))
    retrieval = _as_dict(existing.get("retrieval") or existing.get("rag"))
    cache = _as_dict(existing.get("cache"))
    guardrail = _as_dict(existing.get("guardrail"))
    output = _as_dict(existing.get("output"))
    tags = _as_dict(existing.get("tags"))
    custom = dict(_as_dict(existing.get("custom")))

    reserved = {
        "schema_version",
        "trace",
        "executor",
        "request",
        "prompt",
        "model",
        "retrieval",
        "rag",
        "cache",
        "guardrail",
        "output",
        "spans",
        "logs",
        "tags",
        "custom",
    }
    for key, value in existing.items():
        if key not in reserved:
            custom[key] = value

    duration_ms = max(0.0, float(proxy_latency_ms) + float(llm_latency_ms))
    status = trace.get("status") or ("warning" if custom.get("fallbackUsed") else "success")
    legacy_input = _as_dict(existing.get("input"))
    request_input = _as_dict(request.get("input"))
    input_text = request_input.get("text") or legacy_input.get("text")
    variables = _as_dict(prompt.get("variables") or custom.get("variables"))
    model_name = model.get("model") or model.get("name") or custom.get("model")
    input_tokens = model.get("input_tokens") or model.get("tokensIn") or custom.get("tokensIn") or 0
    output_tokens = model.get("output_tokens") or model.get("tokensOut") or custom.get("tokensOut") or 0
    total_tokens = model.get("total_tokens") or custom.get("totalTokens") or token_count

    normalized: Dict[str, Any] = {
        "schema_version": TRACE_METADATA_SCHEMA_VERSION,
        "trace": {
            **trace,
            "duration_ms": _as_number(trace.get("duration_ms"), duration_ms),
            "status": status,
        },
        "executor": {
            **executor,
            "type": executor.get("type", "direct_provider"),
            "name": executor.get("name") or model.get("provider") or "direct-provider",
            "ownership": executor.get("ownership", "vectorbea"),
            "request_mode": executor.get("request_mode", "direct"),
            "endpoint": executor.get("endpoint"),
            "response_observability": executor.get("response_observability")
            or executor.get("observability")
            or "full",
        },
        "request": {
            **request,
            "input": {
                **request_input,
                **({"text": input_text} if isinstance(input_text, str) else {}),
                **({"variables": variables} if variables else {}),
            },
        },
        "prompt": {
            **prompt,
            "prompt_version_id": prompt.get("prompt_version_id") or prompt_version_id,
            "name": prompt.get("name") or prompt_name,
            "version_tag": prompt.get("version_tag") or version_tag,
            "variables": variables,
        },
        "model": {
            **model,
            **({"model": model_name} if isinstance(model_name, str) else {}),
            "input_tokens": int(_as_number(input_tokens)),
            "output_tokens": int(_as_number(output_tokens)),
            "total_tokens": int(_as_number(total_tokens, token_count)),
            "latency_ms": int(_as_number(model.get("latency_ms"), llm_latency_ms)),
            "cost": _normalize_cost(model.get("cost") or custom.get("cost")),
        },
        "retrieval": {
            **retrieval,
            "enabled": bool(
                retrieval.get("enabled")
                or retrieval.get("query")
                or retrieval.get("sources")
                or retrieval.get("chunks")
            ),
        },
        "cache": {
            **cache,
            "enabled": bool(cache.get("enabled") if "enabled" in cache else cache.get("status")),
            **({"status": cache["status"]} if "status" in cache else {}),
        },
        "guardrail": {
            **guardrail,
            "triggered": bool(guardrail.get("triggered") or guardrail.get("action") in ("warn", "block", "flagged")),
            "action": "allow"
            if guardrail.get("action") == "passed"
            else "warn"
            if guardrail.get("action") == "flagged"
            else guardrail.get("action"),
        },
        "output": {
            **output,
            **({"final_text": output.get("final_text") or custom.get("finalOutput")} if output.get("final_text") or custom.get("finalOutput") else {}),
            **({"raw_text": output.get("raw_text") or custom.get("rawOutput")} if output.get("raw_text") or custom.get("rawOutput") else {}),
        },
        "logs": existing.get("logs") if isinstance(existing.get("logs"), list) else [],
        "spans": existing.get("spans")
        if isinstance(existing.get("spans"), list) and existing.get("spans")
        else _synthetic_spans(
            proxy_latency_ms=proxy_latency_ms,
            llm_latency_ms=llm_latency_ms,
            duration_ms=duration_ms,
            status=status,
        ),
        "tags": {
            **{key: value for key, value in tags.items() if isinstance(value, str) and value.strip()},
            "use_type": use_type,
        },
        "custom": custom,
    }

    if "chunks" in retrieval and "sources" not in normalized["retrieval"]:
        normalized["retrieval"]["sources"] = retrieval["chunks"]
    if "retrieval_ms" in retrieval and "latency_ms" not in normalized["retrieval"]:
        normalized["retrieval"]["latency_ms"] = retrieval["retrieval_ms"]
    if output.get("text") and "final_text" not in normalized["output"]:
        normalized["output"]["final_text"] = output["text"]

    return normalized
