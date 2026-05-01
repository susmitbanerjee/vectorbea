import "server-only";

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import type { RedactionRule } from "@/lib/api";

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
const EMAIL_RE = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const PHONE_RE = /\b(?:\+?\d{1,3}[-.\s]?)?(?:\(?\d{3}\)?[-.\s]?)\d{3}[-.\s]?\d{4}\b/g;
const CREDIT_CARD_RE = /\b(?:\d[ -]*?){13,19}\b/g;
const TOKEN_RE = /\b(?:AIza[0-9A-Za-z\-_]{20,}|sk-[A-Za-z0-9]{10,}|ghp_[A-Za-z0-9]{10,}|xox[baprs]-[A-Za-z0-9-]{10,})\b/g;

function applyBuiltInMask(text: string, pattern: string, replacement: string) {
  switch (pattern) {
    case "email":
      return text.replace(EMAIL_RE, replacement);
    case "phone":
      return text.replace(PHONE_RE, replacement);
    case "credit_card":
    case "pan_like_number":
      return text.replace(CREDIT_CARD_RE, replacement);
    case "api_key":
    case "authorization_header":
    case "password":
    case "secret":
    case "token":
      return text.replace(TOKEN_RE, replacement).replace(BEARER_RE, `Bearer ${replacement}`);
    default:
      return text;
  }
}

export function createBuiltInRedactionRules(): RedactionRule[] {
  const builtIns: Array<Pick<RedactionRule, "name" | "pattern" | "scope">> = [
    { name: "Mask email", pattern: "email", scope: "all" },
    { name: "Mask phone", pattern: "phone", scope: "all" },
    { name: "Mask credit card", pattern: "credit_card", scope: "all" },
    { name: "Mask auth header", pattern: "authorization_header", scope: "all" },
    { name: "Mask API key", pattern: "api_key", scope: "all" },
    { name: "Mask password", pattern: "password", scope: "all" },
    { name: "Mask token", pattern: "token", scope: "all" },
  ];
  return builtIns.map((item, index) => ({
    id: `built-in-${index + 1}`,
    workspaceId: "system",
    name: item.name,
    ruleType: "built_in",
    pattern: item.pattern,
    replacement: "[REDACTED]",
    enabled: true,
    scope: item.scope,
    createdBy: null,
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
  }));
}

export function redactStringWithRules(input: string | null | undefined, rules: RedactionRule[]) {
  if (!input) return input ?? null;
  let next = input.replace(BEARER_RE, "Bearer [REDACTED]");
  for (const rule of rules) {
    if (!rule.enabled) continue;
    if (rule.ruleType === "built_in") {
      next = applyBuiltInMask(next, rule.pattern, rule.replacement || "[REDACTED]");
      continue;
    }
    if (rule.ruleType === "regex") {
      try {
        next = next.replace(new RegExp(rule.pattern, "gi"), rule.replacement || "[REDACTED]");
      } catch {
        // Ignore invalid tenant-provided regex at write time.
      }
      continue;
    }
    if (rule.ruleType === "field_name") {
      next = next.replace(new RegExp(String.raw`\b${rule.pattern}\b`, "gi"), rule.replacement || "[REDACTED]");
    }
  }
  return next;
}

function redactValue(value: unknown): unknown {
  if (typeof value === "string") {
    return redactStringWithRules(value, createBuiltInRedactionRules());
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

export function redactObjectWithRules(
  payload: Record<string, unknown>,
  rules: RedactionRule[],
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(payload)) {
    const normalized = key.toLowerCase().replaceAll("-", "_");
    const fieldRule = rules.find(
      (rule) => rule.enabled && rule.ruleType === "field_name" && rule.pattern.toLowerCase() === normalized,
    );
    if (SENSITIVE_KEYS.has(normalized) || fieldRule) {
      out[key] = fieldRule?.replacement || "[REDACTED]";
      continue;
    }
    if (typeof val === "string") {
      out[key] = redactStringWithRules(val, rules);
      continue;
    }
    if (Array.isArray(val)) {
      out[key] = val.map((entry) => {
        if (typeof entry === "string") return redactStringWithRules(entry, rules);
        if (entry && typeof entry === "object" && !Array.isArray(entry)) {
          return redactObjectWithRules(entry as Record<string, unknown>, rules);
        }
        return entry;
      });
      continue;
    }
    if (val && typeof val === "object") {
      out[key] = redactObjectWithRules(val as Record<string, unknown>, rules);
      continue;
    }
    out[key] = val;
  }
  return out;
}
