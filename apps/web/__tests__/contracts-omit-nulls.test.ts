import { describe, expect, it } from "vitest";
import { z } from "zod";
import { contracts } from "@vectorbea/shared";

/**
 * THE API OMITS NULLS. EVERY CONTRACT MUST SURVIVE THAT.
 *
 * `apps/api-kotlin/.../http/Json.kt` configures the response mapper with
 * `JsonInclude.Include.NON_NULL`. A null column is therefore never sent as
 * `"field": null` — the key is absent. Zod's `.nullable()` permits null but
 * still REQUIRES the key, so every `.nullable()` field is a live fault: the
 * first row with a null in that column fails validation, and because the page
 * envelope validates as a unit, it takes every other row down with it.
 *
 * This has bitten twice. First across the Control page (see the note in
 * `contracts/run.ts`), fixed field-by-field. Then `workflow.currentVersionId`,
 * which is null for every workflow between its creation and its first version —
 * so creating a workflow made `GET /api/workflows` unparseable for the whole
 * list, and the symptom appeared on a screen the author had not touched.
 *
 * Fixing instances is what let it recur. These tests assert the RULE.
 */

/* ── The rule ─────────────────────────────────────────────────────────────── */

/**
 * Walks a schema and reports fields that accept null but reject absence.
 *
 * Unwraps the wrappers a contract actually uses — objects, arrays, the page
 * envelope, and the `ZodEffects` that `maybe()` produces — so a bad field
 * cannot hide one level down inside `items`.
 */
function nullableButRequired(schema: z.ZodTypeAny, path: string[] = [], seen = new Set<unknown>()): string[] {
  if (seen.has(schema)) return [];
  seen.add(schema);

  const def = (schema as { _def?: { typeName?: string } })._def;
  const typeName = def?.typeName;

  if (typeName === "ZodObject") {
    const shape = (schema as unknown as z.ZodObject<z.ZodRawShape>).shape;
    return Object.entries(shape).flatMap(([key, value]) => {
      const field = value as z.ZodTypeAny;
      const at = [...path, key];

      // The actual check: null is accepted, `undefined` is not.
      const acceptsNull = field.safeParse(null).success;
      const acceptsAbsent = field.safeParse(undefined).success;
      const offending = acceptsNull && !acceptsAbsent ? [at.join(".")] : [];

      return [...offending, ...nullableButRequired(field, at, seen)];
    });
  }

  if (typeName === "ZodArray") {
    const element = (schema as unknown as z.ZodArray<z.ZodTypeAny>).element;
    return nullableButRequired(element, [...path, "[]"], seen);
  }

  if (typeName === "ZodOptional" || typeName === "ZodNullable" || typeName === "ZodEffects") {
    const inner = (def as { innerType?: z.ZodTypeAny; schema?: z.ZodTypeAny });
    const unwrapped = inner.innerType ?? inner.schema;
    return unwrapped ? nullableButRequired(unwrapped, path, seen) : [];
  }

  return [];
}

/** Every exported schema, so a new contract is covered without editing this file. */
const ALL_SCHEMAS = Object.entries(contracts).filter(
  (entry): entry is [string, z.ZodTypeAny] =>
    typeof (entry[1] as { safeParse?: unknown })?.safeParse === "function",
);

describe("contracts tolerate omitted nulls", () => {
  it("exports schemas to check", () => {
    expect(ALL_SCHEMAS.length).toBeGreaterThan(10);
  });

  it.each(ALL_SCHEMAS)("%s has no nullable-but-required field", (_name, schema) => {
    // Every offender here is a field that breaks its whole endpoint the moment
    // the column is null. Wrap it in `maybe()` from `contracts/primitives`.
    expect(nullableButRequired(schema)).toEqual([]);
  });
});

/* ── The specific regression ──────────────────────────────────────────────── */

describe("workflow list survives a workflow with no current version", () => {
  /** `WorkflowRoutes.toResponse()` for a row whose `current_version_id` is NULL. */
  const withoutVersion = {
    id: "9d8046c2-1111-4111-8111-111111111111",
    workspaceId: "9d8046c2-2222-4222-8222-222222222222",
    environmentId: "9d8046c2-3333-4333-8333-333333333333",
    name: "Renewal outreach",
    slug: "renewal-outreach",
    status: "draft",
    // description and currentVersionId are ABSENT, not null — that is the point.
    stepCount: 0,
    agentCount: 0,
    toolCount: 0,
    createdAt: "2026-08-20T07:12:33Z",
    updatedAt: "2026-08-20T07:12:33Z",
  };

  it("parses the row a freshly created workflow produces", () => {
    const result = contracts.workflow.safeParse(withoutVersion);
    expect(result.success).toBe(true);
  });

  it("normalises an omitted key to null, so screens keep one case to handle", () => {
    const parsed = contracts.workflow.parse(withoutVersion);
    expect(parsed.currentVersionId).toBeNull();
    expect(parsed.description ?? null).toBeNull();
  });

  it("still rejects a genuinely wrong value rather than waving it through", () => {
    const result = contracts.workflow.safeParse({ ...withoutVersion, currentVersionId: "not-a-uuid" });
    expect(result.success).toBe(false);
  });

  it("parses a page containing both a versioned and an unversioned workflow", () => {
    const versioned = { ...withoutVersion, id: "9d8046c2-4444-4444-8444-444444444444", currentVersionId: "9d8046c2-5555-4555-8555-555555555555" };
    const result = contracts.workflowPage.safeParse({
      items: [withoutVersion, versioned],
      total: 2,
      page: 1,
      pageSize: 100,
    });
    expect(result.success).toBe(true);
  });
});
