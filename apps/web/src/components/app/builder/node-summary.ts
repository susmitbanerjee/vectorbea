/* ══════════════════════════════════════════════════════════════════════════════
   THE LINE UNDER A STEP'S NAME ON THE CANVAS

   Steps without a bound agent or tool used to show their ICON'S design note —
   "A struck arc" under a schedule, "A filled cell" under a checkpoint — because
   the fallback read `NODE_MARKS[].meaning`, which documents the glyph. This says
   what the step does with the settings it has.
══════════════════════════════════════════════════════════════════════════════ */

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function clock(minute: string, hour: string): string | null {
  if (!/^\d{1,2}$/.test(minute) || !/^\d{1,2}$/.test(hour)) return null;
  return `${hour.padStart(2, "0")}:${minute.padStart(2, "0")}`;
}

/** The common cron shapes in words; anything else as the expression itself. */
export function describeCron(cron: string): string {
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) return cron.trim() ? `Runs on ${cron.trim()}` : "No schedule set";
  const [minute, hour, dom, month, dow] = parts;

  const every = /^\*\/(\d+)$/.exec(minute);
  if (every && hour === "*" && dom === "*" && month === "*" && dow === "*") return `Every ${every[1]} minutes`;
  if (minute === "0" && hour === "*" && dom === "*" && month === "*" && dow === "*") return "Every hour";

  const at = clock(minute, hour);
  if (at && dom === "*" && month === "*") {
    if (dow === "*") return `Every day at ${at}`;
    if (dow === "1-5") return `Weekdays at ${at}`;
    if (dow === "0,6" || dow === "6,0") return `Weekends at ${at}`;
    if (/^[0-6]$/.test(dow)) return `Every ${DAYS[Number(dow)]} at ${at}`;
  }
  if (at && /^\d{1,2}$/.test(dom) && month === "*" && dow === "*") return `Monthly on day ${dom} at ${at}`;
  return `Runs on ${cron.trim()}`;
}

export function nodeSummary(node: { kind: string; config: Record<string, unknown> }): string {
  const c = node.config;
  switch (node.kind) {
    case "trigger": {
      const cron = typeof c.cron === "string" ? c.cron : typeof c.cronExpression === "string" ? c.cronExpression : "";
      return cron ? describeCron(cron) : "Starts the run";
    }
    case "agent": return "No agent picked";
    case "agent_team": return "Agent team";
    case "llm": return "Model call";
    case "tool": return "No tool picked";
    case "branch": return c.condition ? "Chooses a path" : "No condition set";
    case "parallel": return "Runs in parallel";
    case "merge": return "Joins the paths";
    case "wait": {
      const seconds = Number(c.forMs ?? 0) / 1000;
      if (String(c.mode ?? "duration") === "duration" && seconds > 0) {
        return seconds >= 3600 ? `Waits ${Math.round(seconds / 360) / 10} h`
          : seconds >= 60 ? `Waits ${Math.round(seconds / 6) / 10} min`
            : `Waits ${seconds} s`;
      }
      return "Waits";
    }
    case "approval": return c.approverGroup ? `Asks ${String(c.approverGroup)}` : "No approver group";
    case "checkpoint": return "Saves progress";
    case "output": return "Returns the result";
    case "end": return "Ends the run";
    default: return node.kind;
  }
}
