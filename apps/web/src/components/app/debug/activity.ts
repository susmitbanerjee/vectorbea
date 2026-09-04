import type { ActivationDetail, Iteration, StepBaseline } from "~/lib/api/trace";

/* ══════════════════════════════════════════════════════════════════════════════
   THE ACTIVITY MODEL — what the agent did, as prose.

   Split from the view because this is the part that has to be right and the part
   that is worth testing: which steps are consequential, which collapse, and what
   each row says. The component only lays these out.

   ── THE PROBLEM THIS SOLVES ─────────────────────────────────────────────────
   The inspector shows "Iteration 4 · CALL_TOOL · 2.4s". That is the ReAct loop's
   internal counter, and nobody outside the runtime team has a reason to care
   about it. Everything needed to say what actually happened was already being
   collected and thrown away: `reasoningSummary` is the agent's own statement of
   why it is taking a step, and it was stored, read, and then not rendered.

   ── WHAT IS NEVER DONE HERE ─────────────────────────────────────────────────
   No JSON is parsed. `observation` arrives as prose from the runtime — a result
   contract's summary, or an error contract's sentence — and prose is what gets
   rendered. Reconstructing meaning from a structure the runtime already
   summarised is how the two drift apart.
══════════════════════════════════════════════════════════════════════════════ */

/**
 * How much a step matters to somebody reading the run.
 *
 * Drives collapsing, and nothing else drives collapsing — so the rule that
 * failures always render expanded lives in exactly one place.
 */
export type Significance = "failure" | "milestone" | "routine";

export interface ActivityStep {
  kind: "step";
  iteration: Iteration;
  significance: Significance;
  /** What the agent did, in its own words when it left any. */
  headline: string;
  /** What came back. Null when there is nothing honest to say. */
  outcome: string | null;
  /** True when `headline` was generated rather than the agent's own summary. */
  generated: boolean;
}

export interface ActivityGroup {
  kind: "group";
  /**
   * The sentence, WITHOUT the step count.
   *
   * The view prefixes [range], and "Steps 1-7 · 7 steps, all successful" says
   * seven twice. The range carries the count; this carries the meaning.
   */
  headline: string;
  /** The first and last step numbers this group folds, for orientation. */
  range: [number, number];
  /** The tools involved, in order of first use. Empty for pure deliberation. */
  tools: string[];
  steps: ActivityStep[];
  /** Every step in this group came back from the transcript on resume. */
  recalled: boolean;
}

export type ActivityRow = ActivityStep | ActivityGroup;

/**
 * Two consecutive THINKs are already noise, at any length.
 *
 * An agent that deliberated twice without acting is one fact, not two, and it
 * reads as one whether the activation is four steps or forty.
 */
const MIN_THINK_GROUP = 2;

/** Below this, a group hides more than it saves. */
const MIN_GROUP = 3;

/**
 * Successful stretches fold only in an activation LONGER than this.
 *
 * Found by looking at the four-step case: "Read the ticket · Looked up account
 * A-8891 · Searched related tickets, found none · Replied with the renewal date"
 * folded to "Steps 1-3 · all successful" plus the reply — which removed exactly
 * the sentences the view exists to show. Collapsing is a cure for a 40-step wall
 * of text; applied to a short run it is a cure with no disease.
 */
const FOLD_ABOVE = 8;

/* ── 1. Significance ─────────────────────────────────────────────────────── */

/**
 * Whether a step renders expanded.
 *
 * Every clause is a case where a reader who scrolled past the row would draw the
 * wrong conclusion:
 *
 *   failed / unsuccessful  the thing that went wrong
 *   repaired               the model's response would not parse and the runtime
 *                          invented a THINK — collapsed, the run looks like
 *                          deliberation and the reader debugs the prompt
 *   truncated context      the agent never saw part of its own instructions,
 *                          which is the hardest agent failure to diagnose
 *   FAIL                   the agent gave up, deliberately
 *
 * A cached result is NOT a failure and does not force expansion — it is marked
 * on the row instead. It is unusual, not wrong, and treating "unusual" as
 * "failure" refills the view with exactly the noise this removes.
 */
export function significanceOf(it: Iteration): Significance {
  if (
    it.status === "failed" ||
    it.observationSuccess === false ||
    it.actionRepaired === true ||
    it.context?.truncated === true ||
    it.context?.overBudget === true ||
    it.actionType === "FAIL"
  ) {
    return "failure";
  }
  if (
    it.actionType === "FINAL" ||
    it.actionType === "DELEGATE" ||
    it.actionType === "ASK_APPROVAL"
  ) {
    return "milestone";
  }
  return "routine";
}

/* ── 2. The sentence ─────────────────────────────────────────────────────── */

/**
 * What the agent said it was doing, or the best true sentence without it.
 *
 * The fallback deliberately does not pretend to know intent. "Called Salesforce
 * lookup" is what we can see; "Looked up the account in Salesforce" is what the
 * agent would have said, and inventing it would put words in the agent's mouth
 * that a reader would later quote back at us.
 */
export function headlineOf(it: Iteration): { text: string; generated: boolean } {
  const thought = it.thought?.trim();
  if (thought) return { text: thought, generated: false };

  const tool = it.toolName?.trim();
  switch (it.actionType) {
    case "CALL_TOOL":
      return { text: tool ? `Called ${tool}.` : "Called a tool.", generated: true };
    case "THINK":
      return { text: "Planned its next move.", generated: true };
    case "FINAL":
      return { text: "Produced the final answer.", generated: true };
    case "DELEGATE":
      return { text: "Handed part of the task to another agent.", generated: true };
    case "ASK_APPROVAL":
      return { text: "Asked for approval before going further.", generated: true };
    case "FAIL":
      return { text: "Stopped and reported that it could not finish.", generated: true };
    default:
      /* Still running, or an action type this build has not heard of. Both are
         real; neither is a reason to render an empty row. */
      return { text: it.completedAt ? "Took a step." : "Working…", generated: true };
  }
}

/**
 * What came back, as the runtime described it.
 *
 * Returned verbatim: on a failure this is the error contract's sentence, which
 * already says what happened and how to fix it, and paraphrasing it here would
 * be a second copy of that wording to keep in step with the first.
 */
export function outcomeOf(it: Iteration): string | null {
  const o = it.observation?.trim();
  if (!o) return null;
  /* The pre-contract shape summary. It describes the envelope, not the answer —
     "Tool returned 3 field(s): status, body, headers" tells a reader nothing they
     wanted to know, and a row is better with one honest line than two. */
  if (/^Tool returned \d+ field\(s\)/.test(o)) return null;
  return o;
}

export function toStep(it: Iteration): ActivityStep {
  const h = headlineOf(it);
  return {
    kind: "step",
    iteration: it,
    significance: significanceOf(it),
    headline: h.text,
    outcome: outcomeOf(it),
    generated: h.generated,
  };
}

/* ── 3. Collapsing ───────────────────────────────────────────────────────── */

/**
 * The narrative, with the uneventful stretches folded up.
 *
 * Only `routine` steps ever fold, and only into a run of their own kind —
 * recalled steps never join executed ones, because "the agent did this" and "the
 * runtime replayed this from the transcript" are different claims and a group
 * header can only make one of them.
 */
export function buildActivity(iterations: Iteration[]): ActivityRow[] {
  const steps = iterations.map(toStep);
  const rows: ActivityRow[] = [];
  const long = iterations.length > FOLD_ABOVE;
  let run: ActivityStep[] = [];

  const flush = () => {
    if (run.length === 0) return;
    const allThink = run.every((s) => s.iteration.actionType === "THINK");
    /* `Infinity` rather than a branch around the push: a short activation folds
       nothing but deliberation, and saying so as a floor keeps one code path. */
    const floor = allThink ? MIN_THINK_GROUP : long ? MIN_GROUP : Infinity;
    if (run.length >= floor) rows.push(groupOf(run, allThink));
    else rows.push(...run);
    run = [];
  };

  for (const s of steps) {
    if (s.significance !== "routine") {
      flush();
      rows.push(s);
      continue;
    }
    /*
     * A routine step that cannot join the open run STARTS THE NEXT ONE. It used
     * to be emitted on its own, which meant a recalled stretch followed by an
     * executed one folded the first and scattered the second across six rows —
     * caught by the test, not by reading the code.
     */
    if (run.length > 0 && run[0].iteration.recalled !== s.iteration.recalled) flush();
    run.push(s);
  }
  flush();
  return rows;
}

function groupOf(steps: ActivityStep[], allThink: boolean): ActivityGroup {
  const tools: string[] = [];
  for (const s of steps) {
    const n = s.iteration.toolName;
    if (n && !tools.includes(n)) tools.push(n);
  }
  const n = steps.length;
  /* The range, not just the count. A folded group is a gap in a numbered
     sequence, and without its endpoints the reader cannot tell whether the row
     below it is the next step or the thirtieth. */
  const range: [number, number] = [
    steps[0].iteration.number,
    steps[steps.length - 1].iteration.number,
  ];
  const headline = allThink
    ? `planned its next move ${n} times.`
    : "all successful.";
  return { kind: "group", headline, range, tools, steps, recalled: steps[0].iteration.recalled };
}

/* ── 4. Is this many steps? ──────────────────────────────────────────────── */

export interface StepHealth {
  steps: number;
  level: "typical" | "high" | "unknown";
  /** One sentence, already written. Null when there is nothing to say. */
  text: string | null;
}

/**
 * A step count is only a signal against what this agent usually takes.
 *
 * ── WHY TWO THRESHOLDS ──────────────────────────────────────────────────────
 * A ratio alone flags 1 → 2, which is twice as many steps and means nothing. An
 * absolute margin alone flags 20 → 24 on an agent that legitimately varies. Both
 * together flag 3 → 14, which is the case worth looking at.
 *
 * ── WHY THIS FIRES ON SUCCESSFUL RUNS ───────────────────────────────────────
 * That is the entire point. A run that succeeded in 14 steps against a typical 3
 * cost four times what it should have, and nothing else in the product will ever
 * mention it — it is a green run on every other screen.
 */
export function stepHealth(steps: number, baseline: StepBaseline | null): StepHealth {
  if (!baseline || baseline.typicalSteps <= 0) {
    return { steps, level: "unknown", text: null };
  }
  const t = baseline.typicalSteps;
  const high = steps >= t * 2 && steps >= t + 3;
  return {
    steps,
    level: high ? "high" : "typical",
    text: `${steps} steps — typical for this agent is ${t}.`,
  };
}

/** The activation a reader should land on: the one that went wrong, if any. */
export function defaultActivation(
  activations: ActivationDetail[],
): ActivationDetail | null {
  if (activations.length === 0) return null;
  return (
    activations.find((a) => a.iterations.some((i) => significanceOf(i) === "failure")) ??
    activations[0]
  );
}
