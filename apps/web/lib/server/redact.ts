/**
 * Secret Redaction Utilities
 *
 * Strip sensitive values from objects before they reach:
 * - API responses
 * - Run events / logs
 * - Browser console / server logs
 * - Error messages
 *
 * These utilities are SERVER-SIDE ONLY.
 */

// Known secret key patterns (case-insensitive)
const SECRET_KEY_PATTERN =
  /(api[_-]?key|apikey|token|access[_-]?token|refresh[_-]?token|auth(orization)?|auth[_-]?header|password|passwd|pwd|secret|client[_-]?secret|connection[_-]?string|database[_-]?url|db[_-]?url|private[_-]?key|bearer|cookie|set[-_]cookie|x-api-key|x-goog-api-key)/i;

// Connection-string protocols — match up to and including credentials+@
// Captures nothing ($1 must NOT be used in replacements)
const CONN_STRING_PATTERN =
  /(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis):\/\/[^@\s]+:[^@\s]+@/gi;

// Generic URL credential pattern (user:pass@host) — captures nothing
// IMPORTANT: replacement must be "://[REDACTED]@", never "://$1[REDACTED]@"
const URL_CRED_PATTERN = /(:\/\/)[^:@\s]+:[^@\s]+@/gi;

// Authorization header value
const AUTH_HEADER_PATTERN = /^(Bearer|Basic|Digest|Token)\s+\S+/i;

// Generic long token-looking strings (>40 chars of base64/hex/alphanumeric)
const LONG_TOKEN_PATTERN = /\b([A-Za-z0-9_\-+/]{40,}={0,2})\b/g;

const REDACTED = "[REDACTED]";

/** Redact a single string value — removes URL credentials */
export function redactString(value: string): string {
  let out = value;
  // Replace connection strings: postgres://user:pass@host → postgres://[REDACTED]@host
  out = out.replace(CONN_STRING_PATTERN, (match) => {
    const proto = match.match(/^[^:]+/)?.[0] ?? "";
    return `${proto}://[REDACTED]@`;
  });
  // Replace generic URL credentials: ://user:pass@ → ://[REDACTED]@
  out = out.replace(URL_CRED_PATTERN, "://[REDACTED]@");
  return out;
}

/** Redact an Authorization header value */
export function redactAuthHeader(value: string): string {
  return AUTH_HEADER_PATTERN.test(value) ? REDACTED : value;
}

/**
 * Recursively redact known secret keys from an object.
 * Replaces value (not key) with REDACTED.
 */
export function redactObject(
  input: unknown,
  depth = 0,
): unknown {
  if (depth > 10) return input;
  if (input === null || input === undefined) return input;

  if (typeof input === "string") {
    // Redact connection strings / URL credentials at the string level
    return redactString(input);
  }

  if (Array.isArray(input)) {
    return input.map((item) => redactObject(item, depth + 1));
  }

  if (typeof input === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
      if (SECRET_KEY_PATTERN.test(key)) {
        out[key] = REDACTED;
      } else {
        out[key] = redactObject(value, depth + 1);
      }
    }
    return out;
  }

  return input;
}

/** Redact HTTP headers object */
export function redactHeaders(
  headers: Record<string, string | string[] | undefined>,
): Record<string, string | string[] | undefined> {
  const out: Record<string, string | string[] | undefined> = {};
  for (const [key, value] of Object.entries(headers)) {
    const lk = key.toLowerCase();
    if (
      lk === "authorization" ||
      lk === "x-api-key" ||
      lk === "x-goog-api-key" ||
      lk === "cookie" ||
      lk === "set-cookie"
    ) {
      out[key] = REDACTED;
    } else if (typeof value === "string") {
      out[key] = redactAuthHeader(value);
    } else {
      out[key] = value;
    }
  }
  return out;
}

/** Redact a connection string (e.g. postgres://user:pass@host/db) */
export function redactConnectionString(str: string): string {
  return str
    .replace(CONN_STRING_PATTERN, (match) => {
      const proto = match.match(/^[^:]+/)?.[0] ?? "";
      return `${proto}://[REDACTED]@`;
    })
    .replace(URL_CRED_PATTERN, "://[REDACTED]@");
}

/** Sanitize an error message — remove any credentials that may have leaked */
export function redactErrorMessage(msg: string): string {
  return msg
    .replace(CONN_STRING_PATTERN, (match) => {
      const proto = match.match(/^[^:]+/)?.[0] ?? "";
      return `${proto}://[REDACTED]@`;
    })
    .replace(URL_CRED_PATTERN, "://[REDACTED]@")
    .replace(LONG_TOKEN_PATTERN, REDACTED);
}

/** Safe JSON stringify that redacts secrets */
export function safeStringify(value: unknown): string {
  return JSON.stringify(redactObject(value), null, 2);
}
