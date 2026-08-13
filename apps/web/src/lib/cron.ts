import parser from "cron-parser";

/**
 * Cron helpers for <CronInput>.
 *
 * A schedule expression is the single highest-consequence field in the product:
 * a wrong digit is the difference between "every 5 minutes" and "every 5 hours",
 * and the operator will not discover it until the bill or the incident. So the
 * input never shows the raw expression alone — it always shows what the
 * expression MEANS and when it will actually fire.
 *
 * `cron-parser` supplies the occurrences (it handles DST, ranges, steps and
 * day-of-week/day-of-month interaction correctly, which hand-rolled cron maths
 * reliably does not). The prose is ours, because cron-parser has no humaniser.
 */

export interface CronEvaluation {
  valid: boolean;
  /** Plain-English description. Always present, even for exotic expressions. */
  description: string;
  /** Next occurrences, in the given timezone. Empty when invalid. */
  next: Date[];
  error?: string;
}

const ALIASES: Record<string, string> = {
  "@yearly": "0 0 1 1 *",
  "@annually": "0 0 1 1 *",
  "@monthly": "0 0 1 * *",
  "@weekly": "0 0 * * 0",
  "@daily": "0 0 * * *",
  "@midnight": "0 0 * * *",
  "@hourly": "0 * * * *",
};

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTH_NAMES = ["January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"];

function clock(minute: string, hour: string): string {
  const h = Number(hour);
  const m = Number(minute);
  if (Number.isNaN(h) || Number.isNaN(m)) return "";
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function ordinal(n: number): string {
  const suffix = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return `${n}${suffix[(v - 20) % 10] ?? suffix[v] ?? suffix[0]}`;
}

/** Human-readable prose for the common shapes; a safe fallback for the rest. */
export function describeCron(expression: string): string {
  const raw = expression.trim();
  if (!raw) return "No schedule set.";

  const expr = ALIASES[raw.toLowerCase()] ?? raw;
  const parts = expr.split(/\s+/);
  if (parts.length < 5) return `Runs on schedule: ${raw}`;

  const [min, hour, dom, mon, dow] = parts;
  const everyMinute = min === "*";
  const everyHour = hour === "*";

  const stepMin = /^\*\/(\d+)$/.exec(min);
  const stepHour = /^\*\/(\d+)$/.exec(hour);

  if (stepMin && everyHour && dom === "*" && mon === "*" && dow === "*") {
    return `Every ${stepMin[1]} minutes.`;
  }
  if (everyMinute && everyHour && dom === "*" && mon === "*" && dow === "*") {
    return "Every minute.";
  }
  if (!everyMinute && stepHour && dom === "*" && mon === "*" && dow === "*") {
    return `Every ${stepHour[1]} hours, at ${min} minutes past.`;
  }
  if (!everyMinute && everyHour && dom === "*" && mon === "*" && dow === "*") {
    return `Hourly, at ${min} minutes past.`;
  }

  const time = clock(min, hour);
  if (!time) return `Runs on schedule: ${raw}`;

  if (dow === "1-5" && dom === "*" && mon === "*") return `Every weekday at ${time}.`;
  if (dow !== "*" && dom === "*" && mon === "*") {
    const days = dow.split(",").map((d) => DAY_NAMES[Number(d) % 7]).filter(Boolean);
    if (days.length) return `Every ${days.join(", ")} at ${time}.`;
  }
  if (dom !== "*" && mon === "*" && dow === "*") {
    const day = Number(dom);
    if (!Number.isNaN(day)) return `Monthly on the ${ordinal(day)} at ${time}.`;
  }
  if (dom !== "*" && mon !== "*") {
    const monthName = MONTH_NAMES[Number(mon) - 1];
    const day = Number(dom);
    if (monthName && !Number.isNaN(day)) return `Yearly on ${monthName} ${ordinal(day)} at ${time}.`;
  }
  if (dom === "*" && mon === "*" && dow === "*") return `Daily at ${time}.`;

  return `Runs on schedule: ${raw}`;
}

/** Validate, describe, and compute the next `count` fire times. */
export function evaluateCron(expression: string, timezone?: string, count = 5): CronEvaluation {
  const raw = expression.trim();
  if (!raw) {
    return { valid: false, description: "No schedule set.", next: [], error: "Enter a cron expression." };
  }

  try {
    const interval = parser.parseExpression(raw, {
      currentDate: new Date(),
      tz: timezone,
    });
    const next: Date[] = [];
    for (let i = 0; i < count; i += 1) next.push(interval.next().toDate());
    return { valid: true, description: describeCron(raw), next };
  } catch (e) {
    return {
      valid: false,
      description: describeCron(raw),
      next: [],
      error: e instanceof Error ? e.message : "That is not a valid cron expression.",
    };
  }
}
