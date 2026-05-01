import "server-only";

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

const PRIVATE_IPV4_PATTERNS = [
  /^10\./,
  /^127\./,
  /^169\.254\./,
  /^172\.(1[6-9]|2\d|3[0-1])\./,
  /^192\.168\./,
  /^0\./,
];

export function enforceJsonBodySize(request: NextRequest, maxBytes: number) {
  const rawContentLength = request.headers.get("content-length");
  if (!rawContentLength) return null;
  const parsed = Number(rawContentLength);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  if (parsed > maxBytes) {
    return NextResponse.json(
      { error: `Payload too large. Limit is ${maxBytes} bytes.` },
      { status: 413 },
    );
  }
  return null;
}

function isPrivateHost(hostname: string) {
  const normalized = hostname.toLowerCase().trim();
  if (!normalized) return true;
  if (normalized === "localhost" || normalized.endsWith(".localhost")) return true;
  if (normalized === "metadata.google.internal") return true;
  if (normalized === "169.254.169.254") return true;
  return PRIVATE_IPV4_PATTERNS.some((pattern) => pattern.test(normalized));
}

export function assertSafeGatewayUrl(value: string, allowPrivate = false) {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("Enterprise gateway URL is invalid.");
  }

  if (!["https:", "http:"].includes(parsed.protocol)) {
    throw new Error("Enterprise gateway URL must use http or https.");
  }

  if (!allowPrivate && isPrivateHost(parsed.hostname)) {
    throw new Error(
      "Enterprise gateway URL points to a private/internal host. " +
        "Use a public gateway URL or explicitly enable private gateway mode.",
    );
  }

  return parsed;
}

// ─── Payload redaction ────────────────────────────────────────────────────────
// Redact sensitive fields from JSON payloads before storing in workflow traces.

const SENSITIVE_KEYS = new Set([
  "authorization", "api_key", "apikey", "x_api_key", "x-api-key",
  "password", "secret", "token", "bearer", "access_token", "refresh_token",
  "private_key", "client_secret", "webhook_secret",
]);

const BEARER_RE = /Bearer\s+[A-Za-z0-9\-._~+/]+=*/gi;

function redactValue(value: unknown): unknown {
  if (typeof value === "string") {
    return value.replace(BEARER_RE, "Bearer [REDACTED]");
  }
  if (Array.isArray(value)) return value.map(redactValue);
  if (value !== null && typeof value === "object") return redactObject(value as Record<string, unknown>);
  return value;
}

function redactObject(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(obj)) {
    if (SENSITIVE_KEYS.has(key.toLowerCase().replaceAll("-", "_"))) {
      out[key] = "[REDACTED]";
    } else {
      out[key] = redactValue(val);
    }
  }
  return out;
}

export function redactPayload(payload: Record<string, unknown>): Record<string, unknown> {
  return redactObject(payload);
}

