import "server-only";

import { normalizeTraceMetadataV1 } from "@/lib/trace-metadata";

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function positiveNumber(...values: unknown[]): number | null {
  for (const value of values) {
    const parsed = asNumber(value);
    if (parsed !== null && parsed > 0) return parsed;
  }
  return null;
}

function spanDuration(metadata: unknown, predicate: (span: Record<string, unknown>) => boolean): number | null {
  const normalized = normalizeTraceMetadataV1(metadata);
  const spans = Array.isArray(normalized.spans) ? normalized.spans : [];
  for (const entry of spans) {
    const span = asRecord(entry);
    if (!predicate(span)) continue;
    const duration = positiveNumber(span.duration_ms, span.durationMs);
    if (duration !== null) return duration;
  }
  return null;
}

export function resolveAuditProxyLatencyMs(rowValue: unknown, metadata: unknown): number {
  const normalized = normalizeTraceMetadataV1(metadata);
  const trace = asRecord(normalized.trace);
  const custom = asRecord(normalized.custom);
  const sidecarSpan = spanDuration(metadata, (span) => {
    const type = String(span.type ?? "").toLowerCase();
    const name = String(span.name ?? "").toLowerCase();
    const component = String(span.component ?? "").toLowerCase();
    return type === "sidecar" || type === "request" || name.includes("proxy") || component.includes("sidecar");
  });

  return positiveNumber(
    trace.proxy_latency_ms,
    trace.proxyLatencyMs,
    custom.proxy_latency_ms,
    custom.proxyLatencyMs,
    custom.sidecar_latency_ms,
    custom.sidecarLatencyMs,
    sidecarSpan,
    rowValue,
  ) ?? 0;
}

export function resolveAuditLlmLatencyMs(rowValue: unknown, metadata: unknown): number {
  const normalized = normalizeTraceMetadataV1(metadata);
  const model = asRecord(normalized.model);
  const custom = asRecord(normalized.custom);
  const llmSpan = spanDuration(metadata, (span) => {
    const type = String(span.type ?? "").toLowerCase();
    const name = String(span.name ?? "").toLowerCase();
    return type === "llm" || type === "llm_completion" || name.includes("llm") || name.includes("model");
  });

  return positiveNumber(
    model.latency_ms,
    model.latencyMs,
    custom.llm_latency_ms,
    custom.llmLatencyMs,
    custom.model_latency_ms,
    custom.modelLatencyMs,
    llmSpan,
    rowValue,
  ) ?? 0;
}

