/**
 * Helpers for presenting approval-gate context in the UI.
 *
 * Approval gates carry a free-form `context` object captured from the run. That
 * object can include environment-variable-like config, connection hints, or other
 * low-level plumbing that is noise (and a potential leak) for a human approver.
 *
 * We never dump the raw object. Instead we surface a small set of human-relevant
 * key/value rows, dropping anything that looks like a secret or an environment
 * variable, and summarising nested structures instead of printing them.
 */

/** Keys whose names look like secrets / env config — never shown to approvers. */
const SENSITIVE_KEY_RE =
  /(secret|token|password|passwd|credential|api[_-]?key|private[_-]?key|access[_-]?key|webhook|authorization|bearer|signing|salt|env|environment|conn(ection)?[_-]?string|dsn)/i;

/** Env-var naming convention: ALL_CAPS_WITH_UNDERSCORES (e.g. AWS_REGION). */
const ENV_VAR_KEY_RE = /^[A-Z][A-Z0-9]*(_[A-Z0-9]+)+$/;

const MAX_VALUE_LEN = 140;

export interface ApprovalContextEntry {
  key: string;
  label: string;
  value: string;
}

function humanizeKey(key: string): string {
  const spaced = key
    .replace(/[_-]+/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > MAX_VALUE_LEN ? `${trimmed.slice(0, MAX_VALUE_LEN)}…` : trimmed;
  }
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.length === 0 ? "Empty list" : `${value.length} item${value.length === 1 ? "" : "s"}`;
  if (typeof value === "object") {
    const count = Object.keys(value as Record<string, unknown>).length;
    return count === 0 ? "Empty" : `${count} field${count === 1 ? "" : "s"}`;
  }
  return String(value);
}

/**
 * Turn an approval-gate context object into a short list of safe, readable rows.
 * Returns an empty array when there is nothing presentable.
 */
export function toApprovalContextEntries(raw: unknown): ApprovalContextEntry[] {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return [];
  const entries: ApprovalContextEntry[] = [];
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (SENSITIVE_KEY_RE.test(key)) continue;
    if (ENV_VAR_KEY_RE.test(key)) continue;
    const formatted = formatValue(value);
    if (formatted === "—" || formatted === "") continue;
    entries.push({ key, label: humanizeKey(key), value: formatted });
  }
  return entries;
}
