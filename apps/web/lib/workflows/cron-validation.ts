/**
 * Client-side cron validation.
 *
 * Mirrors the API's parser (apps/api-kotlin …/schedule/CronExpression.kt):
 * standard 5-field cron — minute hour day-of-month month day-of-week —
 * with lists (a,b), ranges (a-b), steps (x/n), and * per field. The API
 * refuses to schedule anything its parser rejects, so keep the two in sync.
 */

const FIELDS = [
  { name: "minute", min: 0, max: 59 },
  { name: "hour", min: 0, max: 23 },
  { name: "day of month", min: 1, max: 31 },
  { name: "month", min: 1, max: 12 },
  // 7 is accepted as Sunday, same as the API
  { name: "day of week", min: 0, max: 7 },
] as const;

/** Returns null when the expression is valid, otherwise a human-readable error. */
export function validateCronExpression(expr: string): string | null {
  const parts = expr.trim().split(/\s+/).filter(Boolean);
  if (parts.length !== 5) {
    const hint =
      parts.length === 6
        ? ' Multiple values in one field are separated by commas, e.g. "1,5" for Mon & Fri — not spaces.'
        : "";
    return `Cron needs exactly 5 fields (minute hour day month weekday), got ${parts.length}.${hint}`;
  }
  for (let i = 0; i < FIELDS.length; i++) {
    const err = validateField(parts[i]!, FIELDS[i]!);
    if (err) return err;
  }
  return null;
}

function validateField(
  spec: string,
  { name, min, max }: { name: string; min: number; max: number },
): string | null {
  for (const token of spec.split(",")) {
    const slashParts = token.split("/");
    if (slashParts.length > 2) return `Bad step syntax "${token}" in ${name}.`;
    const [rangePart, stepPart] = slashParts;
    if (stepPart !== undefined) {
      const step = parseNum(stepPart);
      if (step === null || step < 1) return `Bad step "${token}" in ${name}.`;
    }
    let lo: number | null;
    let hi: number | null;
    if (rangePart === "*") {
      lo = min;
      hi = max;
    } else if (rangePart!.includes("-")) {
      const [a, b] = rangePart!.split("-", 2);
      lo = parseNum(a ?? "");
      hi = parseNum(b ?? "");
    } else {
      lo = parseNum(rangePart ?? "");
      hi = lo;
    }
    if (lo === null || hi === null) {
      return `"${token}" is not a number, range, or * in ${name}.`;
    }
    if (lo < min || hi > max || lo > hi) {
      return `"${token}" is out of range for ${name} (${min}–${max}).`;
    }
  }
  return null;
}

function parseNum(s: string): number | null {
  return /^\d+$/.test(s.trim()) ? parseInt(s.trim(), 10) : null;
}
