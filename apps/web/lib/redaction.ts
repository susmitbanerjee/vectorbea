/**
 * Redacts sensitive fields from payloads before rendering in the UI.
 * Never expose API keys, tokens, passwords, or connection strings.
 */

const SENSITIVE_KEYS = new Set([
  "apikey", "api_key", "apitoken", "api_token",
  "token", "accesstoken", "access_token", "refreshtoken", "refresh_token",
  "authorization", "auth", "password", "passwd", "pwd",
  "secret", "clientsecret", "client_secret",
  "connectionstring", "connection_string", "connstring",
  "privatekey", "private_key", "signing_key",
  "bearer", "credential", "credentials",
]);

export function redactSensitiveData(value: unknown, depth = 0): unknown {
  if (depth > 8) return value;
  if (value === null || value === undefined) return value;
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return value;

  if (Array.isArray(value)) {
    return value.map(item => redactSensitiveData(item, depth + 1));
  }

  if (typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      if (SENSITIVE_KEYS.has(key.toLowerCase())) {
        result[key] = "[REDACTED]";
      } else {
        result[key] = redactSensitiveData(val, depth + 1);
      }
    }
    return result;
  }

  return value;
}

export function maskConnectionString(s: string): string {
  return s
    .replace(/(:\/\/[^:@]+:)[^@]+(@)/g, "$1[REDACTED]$2")
    .replace(/(password=)[^;&\s]+/gi, "$1[REDACTED]")
    .replace(/(apikey=)[^;&\s]+/gi, "$1[REDACTED]");
}
