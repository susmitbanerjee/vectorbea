import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  PLANS, PLAN_CODES, MATRIX, MATRIX_VALUES, type PlanCode,
} from "@/lib/marketing/plans";

/* ══════════════════════════════════════════════════════════════════════════════
   THE PRICING PAGE, THE FEATURE MATRIX AND THE PLAN RECORDS MUST AGREE.

   ── WHY THIS TEST EXISTS ────────────────────────────────────────────────────
   `plans` and `plan_entitlements` are the authority: `resolve_entitlements()`
   and `EntitlementGuard` read those rows and nothing else. The marketing pricing
   page cannot read them — it is served to people with no session — so its
   numbers are a COPY, and a copy without a test is a copy that is wrong.

   Wrong in a specific and expensive direction, too. The disagreement nobody
   notices is the one where the page promises MORE than the plan grants: the
   customer buys, hits the guard, and the refusal contradicts the page they bought
   from. That is a refund conversation, and it is entirely preventable by parsing
   a file.

   ── WHY IT PARSES SQL RATHER THAN QUERYING ──────────────────────────────────
   There is no database in CI, and adding one to check a pricing page would make
   this test the slowest in the suite and the first to be skipped. The migrations
   are the seed — forward-only, never edited once applied — so the file IS the
   record for every plan that has not been overridden per account.

   What that cannot catch is an operator's `plan_entitlements` UPDATE or a
   per-account override row. Those are deliberate, deliberate is auditable, and
   the honest scope of this test is "the shipped defaults agree".
══════════════════════════════════════════════════════════════════════════════ */

const MIGRATIONS = path.resolve(
  __dirname, "..", "..", "api-kotlin", "src", "main", "resources", "db", "migration",
);

/** The migrations that seed plan rows, in application order. */
const SEED_FILES = [
  "V060__plans_and_entitlements.sql",
  "V061__tiered_retention.sql",
  "V062__shared_workspace_limits.sql",
];

interface SeededEntitlement {
  planCode: string;
  key: string;
  kind: string;
  value: number | boolean | string | null;
}

/**
 * Every `plan_entitlements` row the migrations insert.
 *
 * Deliberately a narrow parser rather than a SQL one: it reads the tuple lists
 * of the INSERT statements this repo actually writes, and THROWS on a statement
 * it does not recognise rather than silently returning fewer rows. A parser that
 * quietly skipped a statement would turn this whole test green by finding
 * nothing to disagree with.
 */
function seededEntitlements(): SeededEntitlement[] {
  const rows: SeededEntitlement[] = [];

  for (const file of SEED_FILES) {
    const sql = stripComments(fs.readFileSync(path.join(MIGRATIONS, file), "utf8"));
    const inserts = statementsInserting(sql, "plan_entitlements");
    if (inserts.length === 0) continue;

    for (const { columnList, rawValues } of inserts) {
      const columns = columnList.split(",").map((c) => c.trim().toLowerCase());
      /* `ON CONFLICT (plan_code, key) DO NOTHING` sits between the last tuple
         and the semicolon, and its column list is parenthesised — so without
         this it is read as one more tuple, with two values. */
      const valuesBlock = trimConflictClause(rawValues);
      for (const tuple of tuplesOf(valuesBlock)) {
        const cells = splitTopLevel(tuple);
        expect(
          cells.length,
          `${file}: a tuple has ${cells.length} values for ${columns.length} columns`,
        ).toBe(columns.length);

        const row: Record<string, string> = {};
        columns.forEach((column, i) => { row[column] = cells[i]; });

        rows.push({
          planCode: unquote(row.plan_code),
          key: unquote(row.key),
          kind: unquote(row.kind),
          value: valueOf(row),
        });
      }
    }
  }

  return rows;
}

/** The one value a row actually carries, chosen by `kind` — as `Entitlement.toMap` does. */
function valueOf(row: Record<string, string>): number | boolean | string | null {
  const kind = unquote(row.kind);
  if (kind === "feature") {
    const raw = (row.bool_value ?? "").trim().toLowerCase();
    return raw === "true" ? true : raw === "false" ? false : null;
  }
  if (kind === "setting") {
    const num = (row.num_value ?? "NULL").trim();
    if (num.toUpperCase() !== "NULL") return Number(num);
    const text = (row.text_value ?? "NULL").trim();
    return text.toUpperCase() === "NULL" ? null : unquote(text);
  }
  const int = (row.int_value ?? "NULL").trim();
  return int.toUpperCase() === "NULL" ? null : Number(int);
}

/**
 * Every `INSERT INTO <table> (cols) VALUES …;` statement, split at the RIGHT
 * semicolon.
 *
 * ── WHY THIS IS NOT ONE REGULAR EXPRESSION ──────────────────────────────────
 * It was, and it was wrong. `[\s\S]*?;` stops at the first semicolon, and V060's
 * plan grid contains one INSIDE a string literal:
 *
 *     'pro is a single-seat plan; buy Team for more'
 *
 * so the statement was truncated mid-grid and the parser returned the handful of
 * rows before it. Every comparison against a key seeded after that point then
 * failed with "no row", which is at least loud — but the same bug on a row
 * BEFORE the semicolon would have passed silently, which is the failure mode
 * this whole file exists to avoid.
 *
 * So the terminator is found by scanning, with the same string-awareness the
 * tuple splitter already needed.
 */
function statementsInserting(sql: string, table: string): { columnList: string; rawValues: string }[] {
  const out: { columnList: string; rawValues: string }[] = [];
  const head = new RegExp(`INSERT\\s+INTO\\s+${table}\\s*\\(([^)]*)\\)\\s*VALUES`, "gi");

  for (const match of sql.matchAll(head)) {
    const from = (match.index ?? 0) + match[0].length;
    const end = endOfStatement(sql, from);
    out.push({ columnList: match[1], rawValues: sql.slice(from, end) });
  }
  return out;
}

/** The index of the terminating `;`, ignoring semicolons inside string literals. */
function endOfStatement(sql: string, from: number): number {
  let inString = false;
  for (let i = from; i < sql.length; i += 1) {
    const ch = sql[i];
    if (inString) {
      if (ch === "'") {
        if (sql[i + 1] === "'") i += 1; else inString = false;
      }
      continue;
    }
    if (ch === "'") { inString = true; continue; }
    if (ch === ";") return i;
  }
  return sql.length;
}

/** Everything before an `ON CONFLICT`, which is not part of the VALUES list. */
function trimConflictClause(block: string): string {
  const at = block.search(/ON\s+CONFLICT/i);
  return at === -1 ? block : block.slice(0, at);
}

function stripComments(sql: string): string {
  return sql.replace(/--[^\n]*/g, "");
}

/** The `(...)` tuples of a VALUES block, ignoring parentheses inside strings. */
function tuplesOf(block: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = -1;
  let inString = false;

  for (let i = 0; i < block.length; i += 1) {
    const ch = block[i];
    if (inString) {
      if (ch === "'") inString = block[i + 1] === "'" ? (i += 1, true) : false;
      continue;
    }
    if (ch === "'") { inString = true; continue; }
    if (ch === "(") { if (depth === 0) start = i + 1; depth += 1; }
    else if (ch === ")") {
      depth -= 1;
      if (depth === 0 && start >= 0) { out.push(block.slice(start, i)); start = -1; }
    }
  }
  return out;
}

/** Commas at depth zero and outside a string literal. */
function splitTopLevel(tuple: string): string[] {
  const out: string[] = [];
  let current = "";
  let depth = 0;
  let inString = false;

  for (let i = 0; i < tuple.length; i += 1) {
    const ch = tuple[i];
    if (inString) {
      current += ch;
      if (ch === "'") {
        if (tuple[i + 1] === "'") { current += "'"; i += 1; } else inString = false;
      }
      continue;
    }
    if (ch === "'") { inString = true; current += ch; continue; }
    if (ch === "(") depth += 1;
    if (ch === ")") depth -= 1;
    if (ch === "," && depth === 0) { out.push(current.trim()); current = ""; continue; }
    current += ch;
  }
  if (current.trim() !== "") out.push(current.trim());
  return out;
}

function unquote(raw: string | undefined): string {
  const value = (raw ?? "").trim();
  return value.startsWith("'") && value.endsWith("'")
    ? value.slice(1, -1).replace(/''/g, "'")
    : value;
}

/* ── The plan catalogue itself ─────────────────────────────────────────────── */

function seededPlans(): { code: string; name: string; description: string; priceCents: number | null }[] {
  const sql = stripComments(fs.readFileSync(path.join(MIGRATIONS, SEED_FILES[0]), "utf8"));
  /* `plans` and not `plan_entitlements`: the table name regex is anchored on a
     word boundary so the longer name does not match the shorter pattern. */
  const inserts = statementsInserting(sql, "plans\\b");
  expect(inserts.length, "V060 no longer seeds `plans` — this test is reading the wrong file").toBe(1);

  const columns = inserts[0].columnList.split(",").map((c) => c.trim().toLowerCase());
  return tuplesOf(trimConflictClause(inserts[0].rawValues)).map((tuple) => {
    const cells = splitTopLevel(tuple);
    const row: Record<string, string> = {};
    columns.forEach((column, i) => { row[column] = cells[i]; });
    const price = (row.price_cents ?? "NULL").trim();
    return {
      code: unquote(row.code),
      name: unquote(row.name),
      description: unquote(row.description),
      priceCents: price.toUpperCase() === "NULL" ? null : Number(price),
    };
  });
}

/* ── The assertions ───────────────────────────────────────────────────────── */

const seeded = seededEntitlements();
const byPlanAndKey = new Map(seeded.map((r) => [`${r.planCode}:${r.key}`, r]));

describe("the parser actually read the migrations", () => {
  it("found the plan rows", () => {
    // If the parser silently found nothing, every comparison below would pass
    // by vacuity. Pin the shape before pinning the contents.
    expect(seededPlans().length).toBe(4);
    expect(seeded.length).toBeGreaterThan(80);
  });
});

describe("the pricing page matches the plan records", () => {
  const plans = seededPlans();

  it("sells exactly the plans that exist, in the same order", () => {
    expect(PLANS.map((p) => p.code)).toEqual(plans.map((p) => p.code));
    expect([...PLAN_CODES]).toEqual(plans.map((p) => p.code));
  });

  it.each(PLANS)("$code: name, description and price are the seeded ones", (plan) => {
    const seededPlan = plans.find((p) => p.code === plan.code)!;
    expect(plan.name).toBe(seededPlan.name);
    // The description is what a customer sees on an invoice and on the page.
    // Two wordings of the same plan is the smallest possible version of the
    // disagreement this test exists to catch.
    expect(plan.description).toBe(seededPlan.description);
    expect(plan.priceCents).toBe(seededPlan.priceCents);
  });
});

describe("the feature matrix matches the plan records", () => {
  it("has a value for every plan on every row", () => {
    for (const row of MATRIX) {
      for (const code of PLAN_CODES) {
        expect(
          MATRIX_VALUES[row.key]?.[code],
          `${row.key} has no value for ${code}`,
        ).toBeDefined();
      }
    }
  });

  it("describes only keys the API actually enforces", () => {
    // A row whose key nothing resolves is a promise with no mechanism behind it.
    for (const row of MATRIX) {
      expect(
        byPlanAndKey.has(`free:${row.key}`),
        `the matrix has a row for "${row.key}", which no plan is seeded with`,
      ).toBe(true);
    }
  });

  it.each(MATRIX)("$key matches the seeded value on every plan", (row) => {
    for (const code of PLAN_CODES as readonly PlanCode[]) {
      const seededRow = byPlanAndKey.get(`${code}:${row.key}`);
      expect(seededRow, `${code} has no ${row.key} row`).toBeDefined();
      expect(
        MATRIX_VALUES[row.key][code],
        `${row.key} on ${code}: the page says ${String(MATRIX_VALUES[row.key][code])}, the plan record says ${String(seededRow!.value)}`,
      ).toBe(seededRow!.value);
      // The kind decides how the cell is rendered AND which column the API
      // reads. A limit rendered as a feature would show "Included" for a
      // ceiling of zero.
      expect(row.kind, `${row.key} kind`).toBe(seededRow!.kind);
    }
  });
});

describe("nothing is sold that is not switched on", () => {
  /**
   * The rule that decides most of the audit: a feature behind a default-off flag
   * is not shipped. It may still appear — hidden features do not sell — but it
   * must be QUALIFIED, and the qualification has to name the switch so a buyer
   * can ask whether it is on for them.
   */
  const FLAGGED_OFF_BY_DEFAULT: Record<string, string> = {
    teams: "AGENT_TEAMS_ENABLED",
    delegation: "AGENT_ACTIVATIONS_ENABLED",
    otel_export: "OTEL_TRACE_EXPORT_ENABLED",
  };

  it.each(Object.entries(FLAGGED_OFF_BY_DEFAULT))(
    "%s is qualified on the feature matrix, and names its switch",
    (key, envVar) => {
      const row = MATRIX.find((r) => r.key === key);
      expect(row, `${key} is not on the matrix at all`).toBeDefined();
      expect(row!.caveat, `${key} is sold without a caveat`).toBeTruthy();
      expect(row!.caveat).toContain(envVar);
    },
  );

  it("does not qualify anything that IS shipped", () => {
    // A caveat on a working feature is its own kind of lie — it talks somebody
    // out of something they already have.
    for (const row of MATRIX) {
      if (row.caveat && !(row.key in FLAGGED_OFF_BY_DEFAULT)) {
        throw new Error(
          `"${row.key}" carries a caveat but is not behind a default-off flag. `
          + "Remove the caveat, or add the flag to FLAGGED_OFF_BY_DEFAULT with its env var.",
        );
      }
    }
  });
});
