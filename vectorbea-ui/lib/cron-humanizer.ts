/**
 * cronToHumanText — converts common cron expressions into friendly English.
 *
 * Handles:
 *   - @hourly / @daily / @weekly / @monthly / @yearly / @midnight
 *   - Every-N-minutes  (*\/N * * * *)
 *   - Every-N-hours    (* *\/N * * *)
 *   - Daily at HH:MM   (M H * * *)
 *   - Weekday-only     (M H * * 1-5)
 *   - Specific weekday (M H * * N)
 *   - Specific day-of-month (M H D * *)
 *
 * Falls back to a safe "Runs on schedule: <expr>" string for anything
 * more complex so the UI never crashes or shows nothing.
 */

const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function formatTime(minute: number, hour: number): string {
  const h = hour % 12 === 0 ? 12 : hour % 12;
  const m = minute.toString().padStart(2, "0");
  const period = hour < 12 ? "AM" : "PM";
  return `${h}:${m} ${period}`;
}

function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] ?? s[v] ?? s[0]);
}

/**
 * Returns a human-readable description of a cron expression.
 *
 * @param cron  Standard 5-field cron string OR @alias
 * @param _timezone  Reserved for future use (e.g. "America/New_York")
 */
export function cronToHumanText(cron: string, _timezone?: string): string {
  if (!cron || typeof cron !== "string") return "Invalid schedule";

  const trimmed = cron.trim();

  // ── @aliases ─────────────────────────────────────────────────────────────
  switch (trimmed.toLowerCase()) {
    case "@yearly":
    case "@annually":
      return "Runs once a year (January 1 at midnight)";
    case "@monthly":
      return "Runs once a month (1st at midnight)";
    case "@weekly":
      return "Runs once a week (Sunday at midnight)";
    case "@daily":
    case "@midnight":
      return "Runs daily at midnight";
    case "@hourly":
      return "Runs every hour";
  }

  const parts = trimmed.split(/\s+/);
  if (parts.length !== 5) {
    return `Runs on schedule: ${trimmed}`;
  }

  const [minField, hourField, domField, monthField, dowField] = parts;

  // ── Every N minutes: */N * * * * ─────────────────────────────────────────
  if (/^\*\/\d+$/.test(minField) && hourField === "*" && domField === "*" && monthField === "*" && dowField === "*") {
    const n = parseInt(minField.slice(2), 10);
    if (n === 1) return "Runs every minute";
    return `Runs every ${n} minutes`;
  }

  // ── Every N hours: 0 */N * * * ──────────────────────────────────────────
  if (/^\*\/\d+$/.test(hourField) && minField === "0" && domField === "*" && monthField === "*" && dowField === "*") {
    const n = parseInt(hourField.slice(2), 10);
    if (n === 1) return "Runs every hour";
    return `Runs every ${n} hours`;
  }

  // Remaining patterns need numeric minute + numeric hour
  const minNum = /^\d+$/.test(minField) ? parseInt(minField, 10) : null;
  const hourNum = /^\d+$/.test(hourField) ? parseInt(hourField, 10) : null;

  if (minNum === null || hourNum === null) {
    return `Runs on schedule: ${trimmed}`;
  }

  const timeStr = formatTime(minNum, hourNum);

  // ── Weekdays only: M H * * 1-5 ──────────────────────────────────────────
  if (domField === "*" && monthField === "*" && dowField === "1-5") {
    return `Runs weekdays at ${timeStr}`;
  }

  // ── Specific weekday: M H * * N ─────────────────────────────────────────
  if (domField === "*" && monthField === "*" && /^\d$/.test(dowField)) {
    const dow = parseInt(dowField, 10);
    if (dow >= 0 && dow <= 6) {
      return `Runs every ${WEEKDAY_NAMES[dow]} at ${timeStr}`;
    }
  }

  // ── Daily: M H * * * ────────────────────────────────────────────────────
  if (domField === "*" && monthField === "*" && dowField === "*") {
    return `Runs daily at ${timeStr}`;
  }

  // ── Specific day of month: M H D * * ────────────────────────────────────
  if (/^\d+$/.test(domField) && monthField === "*" && dowField === "*") {
    const dom = parseInt(domField, 10);
    return `Runs on the ${ordinal(dom)} of each month at ${timeStr}`;
  }

  // ── Specific month + day: M H D Mo * ────────────────────────────────────
  if (/^\d+$/.test(domField) && /^\d+$/.test(monthField) && dowField === "*") {
    const dom = parseInt(domField, 10);
    const mo = parseInt(monthField, 10);
    if (mo >= 1 && mo <= 12) {
      return `Runs on ${MONTH_NAMES[mo - 1]} ${ordinal(dom)} at ${timeStr}`;
    }
  }

  // ── Fallback ─────────────────────────────────────────────────────────────
  return `Runs on schedule: ${trimmed}`;
}

/**
 * Validates whether a string looks like a 5-field cron expression or @alias.
 * Returns null if valid, or an error message string if invalid.
 */
export function validateCron(cron: string): string | null {
  if (!cron || !cron.trim()) return null; // empty is allowed (no schedule)

  const trimmed = cron.trim();
  const aliases = ["@yearly", "@annually", "@monthly", "@weekly", "@daily", "@midnight", "@hourly"];
  if (aliases.includes(trimmed.toLowerCase())) return null;

  const parts = trimmed.split(/\s+/);
  if (parts.length !== 5) {
    return "Cron expression must have exactly 5 fields (minute hour day month weekday)";
  }

  const fieldNames = ["minute", "hour", "day-of-month", "month", "weekday"];
  const ranges: [number, number][] = [[0, 59], [0, 23], [1, 31], [1, 12], [0, 6]];

  for (let i = 0; i < 5; i++) {
    const field = parts[i];
    const [min, max] = ranges[i];

    if (field === "*") continue;
    if (/^\*\/\d+$/.test(field)) {
      const step = parseInt(field.slice(2), 10);
      if (step < 1 || step > max) return `${fieldNames[i]}: step value out of range`;
      continue;
    }
    if (/^\d+$/.test(field)) {
      const val = parseInt(field, 10);
      if (val < min || val > max) return `${fieldNames[i]}: value ${val} out of range (${min}–${max})`;
      continue;
    }
    if (/^\d+-\d+$/.test(field)) {
      const [lo, hi] = field.split("-").map(Number);
      if (lo < min || hi > max || lo > hi) return `${fieldNames[i]}: range ${field} is invalid`;
      continue;
    }
    // Comma-separated lists — basic validation
    if (field.includes(",")) {
      const items = field.split(",");
      for (const item of items) {
        if (!/^\d+$/.test(item)) return `${fieldNames[i]}: invalid value "${item}"`;
        const val = parseInt(item, 10);
        if (val < min || val > max) return `${fieldNames[i]}: value ${val} out of range (${min}–${max})`;
      }
      continue;
    }
    return `${fieldNames[i]}: unrecognized expression "${field}"`;
  }

  return null;
}
