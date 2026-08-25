import { describe, expect, it } from "vitest";
import {
  generateSql,
  EMPTY_BUILDER,
  type SqlBuilderValue,
  type FilterOp,
} from "~/components/app/registry/sql-builder";
import type { SchemaTable } from "~/lib/api/client";

/**
 * The generated statement is the whole product of the guided builder: the
 * operator never types SQL, so if this function is wrong there is nothing
 * between the mistake and a live database.
 *
 * Two properties matter more than the exact text, and are asserted throughout:
 *
 *   1. NO VALUE IS EVER INTERPOLATED. Every operand is a `$n` placeholder, and
 *      the count of placeholders equals the count of declared parameters in the
 *      same order. Binding the right values to the wrong placeholders is the
 *      failure this ordering exists to prevent.
 *   2. NO WRITE IS UNQUALIFIED. An UPDATE or DELETE without a WHERE clause is
 *      refused rather than generated.
 */

const customers: SchemaTable = {
  schema: "public",
  table: "customers",
  tableType: "TABLE",
  rowCountEstimate: 12480,
  columns: [
    { name: "id", dataType: "uuid", nullable: false, isPrimaryKey: true, defaultValue: "gen_random_uuid()", maxLength: null },
    { name: "email", dataType: "text", nullable: false, isPrimaryKey: false, defaultValue: null, maxLength: null },
    { name: "full_name", dataType: "text", nullable: true, isPrimaryKey: false, defaultValue: null, maxLength: null },
    { name: "tier", dataType: "character varying", nullable: false, isPrimaryKey: false, defaultValue: "'free'", maxLength: 32 },
    { name: "signup_count", dataType: "integer", nullable: false, isPrimaryKey: false, defaultValue: "0", maxLength: null },
  ],
};

function build(patch: Partial<SqlBuilderValue>): SqlBuilderValue {
  return { ...EMPTY_BUILDER, table: "public.customers", ...patch };
}

function filter(column: string, op: FilterOp = "eq") {
  return { id: `f-${column}-${op}`, column, op };
}

/** Every `$n` in the statement, in order of appearance. */
function placeholders(sql: string): number[] {
  return [...sql.matchAll(/\$(\d+)/g)].map((m) => Number(m[1]));
}

describe("read", () => {
  it("projects the chosen columns and quotes every identifier", () => {
    const out = generateSql(build({ columns: ["id", "email"] }), customers);
    expect(out.problem).toBeNull();
    expect(out.sql).toContain('SELECT "id", "email"');
    expect(out.sql).toContain('FROM "public"."customers"');
    expect(out.sql).toContain("LIMIT 100");
    expect(out.writes).toBe(false);
  });

  it("refuses to read nothing", () => {
    expect(generateSql(build({ columns: [] }), customers).problem)
      .toMatch(/at least one field/i);
  });

  it("derives the output schema from the projected columns and their types", () => {
    const out = generateSql(build({ columns: ["email", "signup_count"] }), customers);
    const rows = (out.outputSchema as { properties: { rows: { items: { properties: Record<string, { type: string }> } } } })
      .properties.rows.items.properties;
    expect(rows.email.type).toBe("string");
    // integer, not "number" and not "string" — the column is an `integer`.
    expect(rows.signup_count.type).toBe("integer");
  });

  it("binds a filter rather than inlining it", () => {
    const out = generateSql(build({ columns: ["id"], filters: [filter("email")] }), customers);
    expect(out.sql).toContain('WHERE "email" = $1');
    expect(out.parameters).toEqual(["email"]);
    expect(placeholders(out.sql)).toEqual([1]);
  });

  it("numbers multiple filters in the order they appear", () => {
    const out = generateSql(
      build({ columns: ["id"], filters: [filter("email"), filter("tier"), filter("signup_count", "gte")] }),
      customers,
    );
    expect(placeholders(out.sql)).toEqual([1, 2, 3]);
    expect(out.parameters).toEqual(["email", "tier", "signup_count"]);
    expect(out.sql).toContain('"signup_count" >= $3');
  });

  it("keeps value-free comparisons out of the parameter list", () => {
    const out = generateSql(
      build({ columns: ["id"], filters: [filter("full_name", "is_null"), filter("email")] }),
      customers,
    );
    expect(out.sql).toContain('"full_name" IS NULL');
    // Only `email` binds, and it is $1 — `IS NULL` must not consume a slot.
    expect(out.parameters).toEqual(["email"]);
    expect(placeholders(out.sql)).toEqual([1]);
  });

  it("binds the operand of a contains match instead of building a literal", () => {
    const out = generateSql(build({ columns: ["id"], filters: [filter("email", "like")] }), customers);
    expect(out.sql).toContain("ILIKE '%' || $1 || '%'");
    expect(out.parameters).toEqual(["email"]);
  });

  it("rejects a non-numeric row limit", () => {
    expect(generateSql(build({ columns: ["id"], limit: "lots" }), customers).problem)
      .toMatch(/whole number/i);
  });
});

describe("insert", () => {
  it("binds one placeholder per written column and returns the key", () => {
    const out = generateSql(
      build({ operation: "insert", columns: ["email", "tier"] }),
      customers,
    );
    expect(out.problem).toBeNull();
    expect(out.sql).toContain('INSERT INTO "public"."customers" ("email", "tier")');
    expect(out.sql).toContain("VALUES ($1, $2)");
    expect(out.sql).toContain('RETURNING "id"');
    expect(out.parameters).toEqual(["email", "tier"]);
    expect(out.writes).toBe(true);
  });

  it("refuses to insert nothing", () => {
    expect(generateSql(build({ operation: "insert", columns: [] }), customers).problem)
      .toMatch(/which fields/i);
  });
});

describe("update", () => {
  it("numbers SET before WHERE, which is the order the driver binds them", () => {
    const out = generateSql(
      build({ operation: "update", columns: ["tier"], filters: [filter("id")] }),
      customers,
    );
    expect(out.problem).toBeNull();
    expect(out.sql).toContain('SET "tier" = $1');
    expect(out.sql).toContain('WHERE "id" = $2');
    // The declared order must match the statement's order exactly.
    expect(out.parameters).toEqual(["tier", "id"]);
    expect(placeholders(out.sql)).toEqual([1, 2]);
  });

  it("REFUSES an update with no filter", () => {
    const out = generateSql(build({ operation: "update", columns: ["tier"], filters: [] }), customers);
    expect(out.sql).toBe("");
    expect(out.problem).toMatch(/every row/i);
  });
});

describe("delete", () => {
  it("qualifies the delete with the filter", () => {
    const out = generateSql(build({ operation: "delete", filters: [filter("id")] }), customers);
    expect(out.problem).toBeNull();
    expect(out.sql).toBe('DELETE FROM "public"."customers" WHERE "id" = $1');
    expect(out.parameters).toEqual(["id"]);
  });

  it("REFUSES a delete with no filter", () => {
    const out = generateSql(build({ operation: "delete", filters: [] }), customers);
    expect(out.sql).toBe("");
    expect(out.problem).toMatch(/every row/i);
  });
});

describe("create table", () => {
  const base = build({
    operation: "create_table",
    newTableName: "orders",
    newColumns: [
      { id: "a", name: "id", type: "uuid", nullable: false, primaryKey: true },
      { id: "b", name: "total", type: "integer", nullable: true, primaryKey: false },
    ],
  });

  it("emits a definition with the key and the null constraints", () => {
    const out = generateSql(base, customers);
    expect(out.problem).toBeNull();
    expect(out.sql).toContain('CREATE TABLE IF NOT EXISTS "public"."orders"');
    expect(out.sql).toContain('"id" uuid NOT NULL');
    expect(out.sql).toContain('"total" integer');
    expect(out.sql).toContain('PRIMARY KEY ("id")');
    expect(out.parameters).toEqual([]);
  });

  it("refuses a table name that is not an identifier", () => {
    // The one place free text could reach the statement. `DROP TABLE` in the
    // name must not become `DROP TABLE` in the SQL.
    const out = generateSql({ ...base, newTableName: "orders; DROP TABLE customers" }, customers);
    expect(out.sql).toBe("");
    expect(out.problem).toMatch(/table name/i);
  });

  it("refuses a column name that is not an identifier", () => {
    const out = generateSql(
      { ...base, newColumns: [{ id: "a", name: "a b", type: "text", nullable: true, primaryKey: false }] },
      customers,
    );
    expect(out.sql).toBe("");
    expect(out.problem).toMatch(/not a valid column name/i);
  });

  it("catches a column defined twice", () => {
    const out = generateSql(
      {
        ...base,
        newColumns: [
          { id: "a", name: "id", type: "uuid", nullable: false, primaryKey: true },
          { id: "b", name: "ID", type: "text", nullable: true, primaryKey: false },
        ],
      },
      customers,
    );
    expect(out.problem).toMatch(/defined twice/i);
  });
});

describe("identifier quoting", () => {
  it("escapes a double quote inside a column name", () => {
    const hostile: SchemaTable = {
      ...customers,
      columns: [
        { name: 'we"ird', dataType: "text", nullable: true, isPrimaryKey: false, defaultValue: null, maxLength: null },
      ],
    };
    const out = generateSql(build({ columns: ['we"ird'] }), hostile);
    // Doubling is the Postgres escape; a single quote would end the identifier.
    expect(out.sql).toContain('"we""ird"');
  });

  it("names a parameter safely even when the column cannot be one", () => {
    const hostile: SchemaTable = {
      ...customers,
      columns: [
        { name: "user-id", dataType: "uuid", nullable: false, isPrimaryKey: false, defaultValue: null, maxLength: null },
      ],
    };
    const out = generateSql(build({ columns: ["user-id"], filters: [filter("user-id")] }), hostile);
    expect(out.parameters).toEqual(["user_id"]);
    expect(Object.keys((out.inputSchema as { properties: object }).properties)).toEqual(["user_id"]);
  });
});

describe("no table chosen", () => {
  it("asks for one rather than generating something", () => {
    const out = generateSql({ ...EMPTY_BUILDER, columns: ["id"] }, null);
    expect(out.sql).toBe("");
    expect(out.problem).toMatch(/choose the table/i);
  });
});
