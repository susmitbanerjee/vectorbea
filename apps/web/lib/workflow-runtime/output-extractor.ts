/**
 * Output Extractor
 *
 * Takes the raw output from a step execution and extracts a specific value
 * based on the OutputExtractionConfig attached to the node.
 *
 * Supported modes:
 *   full_response   — return entire raw output as-is
 *   body            — return response.body (for HTTP responses)
 *   json_path       — extract using dot-notation path (e.g. "$.data.id")
 *   headers         — return response.headers map, or specific header
 *   status_code     — return response.statusCode
 *   custom_mapping  — map multiple fields from the raw output
 */

import type { OutputExtractionConfig } from "@/types/workflow-graph";

// ─── JSONPath-lite implementation ────────────────────────────────────────────
// Supports dot-notation with optional leading $. and array indices.
// e.g. "$.data.items[0].id"  →  ["data", "items", "0", "id"]

function parseJsonPath(path: string): string[] {
  // Strip leading $. or $
  const stripped = path.replace(/^\$\.?/, "");
  if (!stripped) return [];

  const parts: string[] = [];
  // Split on . but handle [N] array notation
  for (const segment of stripped.split(".")) {
    const bracketMatch = segment.match(/^(\w+)\[(\d+)\]$/);
    if (bracketMatch) {
      parts.push(bracketMatch[1]!);
      parts.push(bracketMatch[2]!);
    } else {
      parts.push(segment);
    }
  }
  return parts.filter(Boolean);
}

function getByPath(obj: unknown, parts: string[]): unknown {
  let cur: unknown = obj;
  for (const part of parts) {
    if (cur === null || cur === undefined) return undefined;
    if (Array.isArray(cur)) {
      const idx = parseInt(part, 10);
      cur = Number.isFinite(idx) ? (cur as unknown[])[idx] : undefined;
    } else if (typeof cur === "object") {
      cur = (cur as Record<string, unknown>)[part];
    } else {
      return undefined;
    }
  }
  return cur;
}

// ─── HTTP-style response shape ────────────────────────────────────────────────

interface HttpLikeResponse {
  statusCode?: number;
  status?: number;
  headers?: Record<string, string>;
  body?: unknown;
  data?: unknown;
}

function isHttpLike(v: unknown): v is HttpLikeResponse {
  if (!v || typeof v !== "object") return false;
  const obj = v as Record<string, unknown>;
  return "statusCode" in obj || "status" in obj || "body" in obj || "headers" in obj;
}

// ─── Main extractor ───────────────────────────────────────────────────────────

/**
 * Extract a meaningful value from raw step output according to the extraction config.
 * If no config is provided, returns the raw output unchanged.
 */
export function extractOutput(
  raw: unknown,
  config?: OutputExtractionConfig,
): unknown {
  if (!config) return raw;

  switch (config.mode) {
    case "full_response":
      return raw;

    case "body": {
      if (isHttpLike(raw)) return raw.body ?? raw.data ?? raw;
      return raw;
    }

    case "json_path": {
      const path = config.jsonPath ?? "$";
      if (path === "$") return raw;
      const parts = parseJsonPath(path);
      return getByPath(raw, parts);
    }

    case "headers": {
      if (!isHttpLike(raw)) return {};
      const headers = raw.headers ?? {};
      if (config.headerName) {
        return headers[config.headerName] ?? headers[config.headerName.toLowerCase()] ?? null;
      }
      return headers;
    }

    case "status_code": {
      if (isHttpLike(raw)) {
        return raw.statusCode ?? raw.status ?? null;
      }
      return null;
    }

    case "custom_mapping": {
      if (!config.fieldMappings) return raw;
      const result: Record<string, unknown> = {};
      for (const [key, path] of Object.entries(config.fieldMappings)) {
        if (!path) continue;
        const parts = parseJsonPath(path);
        result[key] = getByPath(raw, parts);
      }
      return result;
    }

    default:
      return raw;
  }
}

/**
 * Wrap extracted output under the configured output key.
 * If outputKey is set, returns { [outputKey]: extracted }.
 * Otherwise returns extracted directly if it's already an object,
 * or { result: extracted } for primitives.
 */
export function wrapExtracted(
  extracted: unknown,
  config?: OutputExtractionConfig,
): Record<string, unknown> {
  const key = config?.outputKey ?? "result";
  if (key === "__root__" && extracted !== null && typeof extracted === "object" && !Array.isArray(extracted)) {
    return extracted as Record<string, unknown>;
  }
  if (!config?.outputKey && extracted !== null && typeof extracted === "object" && !Array.isArray(extracted)) {
    return extracted as Record<string, unknown>;
  }
  return { [key]: extracted };
}

/**
 * Full pipeline: extract → wrap into output record.
 */
export function processOutput(
  raw: unknown,
  config?: OutputExtractionConfig,
): Record<string, unknown> {
  const extracted = extractOutput(raw, config);
  return wrapExtracted(extracted, config);
}
