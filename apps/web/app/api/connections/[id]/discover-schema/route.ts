/**
 * POST /api/connections/:id/discover-schema
 *
 * Discover the schema of a database connection.
 * Returns tables, columns, and types from the DB's information_schema.
 *
 * SECURITY:
 *   - Connection string is resolved server-side only
 *   - Never returned to the client
 *   - Read-only query — cannot modify data
 */

import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@/lib/generated/prisma";
import { db } from "@/server/db";
import { getSecretForRuntime } from "@/lib/server/secret-service";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const workspaceId = request.nextUrl.searchParams.get("workspaceId");
  if (!workspaceId) return NextResponse.json({ error: "workspaceId required" }, { status: 400 });

  const { id: connectionId } = await params;

  // Load connection record
  const rows = await db.$queryRaw<Record<string, unknown>[]>(Prisma.sql`
    SELECT id, type, config_json, secret_ref, status
    FROM vectorbea.connections
    WHERE id = ${connectionId}::uuid
      AND workspace_id = ${workspaceId}::uuid
    LIMIT 1
  `).catch(() => [] as Record<string, unknown>[]);

  const conn = rows[0];
  if (!conn) return NextResponse.json({ error: "Connection not found" }, { status: 404 });
  if (conn.status !== "active") return NextResponse.json({ error: "Connection is not active" }, { status: 422 });

  const connectionType = String(conn.type ?? "");
  if (!connectionType.startsWith("database")) {
    return NextResponse.json({ error: "Schema discovery is only available for database connections" }, { status: 422 });
  }

  // Resolve connection string server-side
  const secretRef = typeof conn.secret_ref === "string" ? conn.secret_ref : null;
  if (!secretRef) return NextResponse.json({ error: "Connection has no secret configured" }, { status: 422 });

  const connectionString = await getSecretForRuntime(secretRef);
  if (!connectionString) return NextResponse.json({ error: "Failed to resolve connection secret" }, { status: 422 });

  // Connect and discover schema
  const { Client } = await import("pg");
  const client = new Client({ connectionString, connectionTimeoutMillis: 10_000 });

  try {
    await client.connect();

    // Get schemas (exclude system schemas)
    const schemaResult = await client.query(`
      SELECT schema_name
      FROM information_schema.schemata
      WHERE schema_name NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
        AND schema_name NOT LIKE 'pg_%'
      ORDER BY schema_name
    `);

    // Get tables with columns
    const tablesResult = await client.query(`
      SELECT
        t.table_schema,
        t.table_name,
        t.table_type,
        c.column_name,
        c.data_type,
        c.is_nullable,
        c.column_default,
        c.character_maximum_length,
        c.numeric_precision,
        c.ordinal_position
      FROM information_schema.tables t
      JOIN information_schema.columns c
        ON c.table_schema = t.table_schema
        AND c.table_name = t.table_name
      WHERE t.table_schema NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
        AND t.table_schema NOT LIKE 'pg_%'
        AND t.table_type IN ('BASE TABLE', 'VIEW')
      ORDER BY t.table_schema, t.table_name, c.ordinal_position
    `);

    // Group into schema → table → columns
    const schemas: Record<string, {
      tables: Record<string, {
        type: string;
        columns: Array<{
          name: string;
          dataType: string;
          nullable: boolean;
          hasDefault: boolean;
          maxLength?: number;
          precision?: number;
        }>;
      }>;
    }> = {};

    for (const row of tablesResult.rows as Record<string, unknown>[]) {
      const schema = String(row.table_schema);
      const table = String(row.table_name);
      const tableType = String(row.table_type);

      if (!schemas[schema]) schemas[schema] = { tables: {} };
      if (!schemas[schema]!.tables[table]) {
        schemas[schema]!.tables[table] = { type: tableType, columns: [] };
      }

      schemas[schema]!.tables[table]!.columns.push({
        name: String(row.column_name),
        dataType: String(row.data_type),
        nullable: row.is_nullable === "YES",
        hasDefault: row.column_default !== null,
        maxLength: row.character_maximum_length != null ? Number(row.character_maximum_length) : undefined,
        precision: row.numeric_precision != null ? Number(row.numeric_precision) : undefined,
      });
    }

    return NextResponse.json({
      connectionId,
      databaseSchemas: schemaResult.rows.map((r: Record<string, unknown>) => String(r.schema_name)),
      schemas,
    });

  } catch (err) {
    // Sanitize error message — never expose connection string fragments
    const raw = (err instanceof Error) ? err.message : String(err);
    const safe = raw.replace(/postgres(ql)?:\/\/[^@]+@[^\s/]+/gi, "postgres://[REDACTED]");
    return NextResponse.json({ error: `Schema discovery failed: ${safe}` }, { status: 500 });
  } finally {
    await client.end().catch(() => {});
  }
}
