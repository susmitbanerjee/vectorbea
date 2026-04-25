/**
 * POST /api/evaluations/datasets/[id]/import
 *
 * Accepts a JSON body with pre-parsed rows (client parses the file).
 * Body shape:
 *   { rows: Array<{ input: string; expected_output?: string; notes?: string }> }
 *
 * CSV parsing happens client-side to avoid streaming/multipart complexity.
 * The client sends parsed rows; this route validates and stores them.
 */
import { NextRequest, NextResponse } from "next/server";
import { assertWorkspaceMember } from "@/lib/server/assert-workspace-member";
import {
  addDatasetItems,
  getEvaluationDataset,
} from "@/lib/server/evaluation-datasets";
import { toSafeApiError } from "@/lib/server/safe-api-errors";

export const dynamic = "force-dynamic";

const MAX_IMPORT_ROWS = 500;

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const workspaceId = request.nextUrl.searchParams.get("workspaceId")?.trim();
    if (!workspaceId) return NextResponse.json({ error: "workspaceId required" }, { status: 400 });
    const auth = await assertWorkspaceMember(request, workspaceId);
    if (auth.error) return auth.error;

    const dataset = await getEvaluationDataset(workspaceId, id);
    if (!dataset) return NextResponse.json({ error: "Dataset not found" }, { status: 404 });
    if (dataset.origin === "baseline") {
      return NextResponse.json({ error: "Cannot import items into a legacy baseline dataset." }, { status: 400 });
    }

    const body = await request.json().catch(() => ({})) as {
      rows?: unknown[];
    };

    if (!Array.isArray(body.rows) || body.rows.length === 0) {
      return NextResponse.json({ error: "rows array is required" }, { status: 400 });
    }

    if (body.rows.length > MAX_IMPORT_ROWS) {
      return NextResponse.json(
        { error: `Import limit is ${MAX_IMPORT_ROWS} rows per request.` },
        { status: 400 },
      );
    }

    // Validate + map rows; collect warnings for partial rows
    const valid: Array<{ input: string; expectedOutput?: string | null; notes?: string | null }> = [];
    const warnings: string[] = [];

    body.rows.forEach((row, i) => {
      if (!row || typeof row !== "object") {
        warnings.push(`Row ${i + 1}: skipped (not an object)`);
        return;
      }
      const r = row as Record<string, unknown>;
      const input = typeof r.input === "string" ? r.input.trim() : "";
      if (!input) {
        warnings.push(`Row ${i + 1}: skipped (empty input)`);
        return;
      }
      valid.push({
        input,
        expectedOutput: typeof r.expected_output === "string" ? r.expected_output.trim() || null : null,
        notes: typeof r.notes === "string" ? r.notes.trim() || null : null,
      });
    });

    if (valid.length === 0) {
      return NextResponse.json({ error: "No valid rows found. Ensure rows have a non-empty `input` field.", warnings }, { status: 400 });
    }

    const items = await addDatasetItems({
      workspaceId,
      datasetId: params.id,
      items: valid.map((row) => ({
        sourceType: "imported",
        input: row.input,
        expectedOutput: row.expectedOutput,
        notes: row.notes,
      })),
    });

    return NextResponse.json({ imported: items.length, warnings }, { status: 201 });
  } catch (error) {
    const safe = toSafeApiError(error, "Failed to import dataset items");
    return NextResponse.json({ error: safe.message, code: safe.code }, { status: safe.status });
  }
}
