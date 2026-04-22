import { NextRequest, NextResponse } from "next/server";

import type { TraceListResponse } from "@/lib/api";
import { assertWorkspaceMember } from "@/lib/server/assert-workspace-member";
import { mapAuditRowToTraceSummary, type AuditLogTraceRow } from "@/lib/server/traces";
import { createVectorBeaAdminClient } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";

function parsePositiveInt(value: string | null, fallback: number) {
  const parsed = Number(value ?? "");
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.floor(parsed);
}

export async function GET(request: NextRequest) {
  try {
    const workspaceId = request.nextUrl.searchParams.get("workspaceId")?.trim();
    if (!workspaceId) {
      return NextResponse.json(
        { items: [], page: 1, pageSize: 25, total: 0, totalPages: 0 } satisfies TraceListResponse,
      );
    }

    const auth = await assertWorkspaceMember(request, workspaceId);
    if (auth.error) return auth.error;

    const page = parsePositiveInt(request.nextUrl.searchParams.get("page"), 1);
    const pageSize = Math.min(parsePositiveInt(request.nextUrl.searchParams.get("pageSize"), 25), 100);
    const query = (request.nextUrl.searchParams.get("q") ?? "").trim().toLowerCase();
    const status = (request.nextUrl.searchParams.get("status") ?? "all").trim().toLowerCase();
    const environment = (request.nextUrl.searchParams.get("environment") ?? "all").trim().toLowerCase();
    const useType = (request.nextUrl.searchParams.get("useType") ?? "runtime").trim().toLowerCase();
    const sortBy = (request.nextUrl.searchParams.get("sortBy") ?? "newest").trim().toLowerCase();

    const supabase = createVectorBeaAdminClient();
    const { data, error } = await supabase
      .from("audit_logs")
      .select(
        "id, workspace_id, prompt_version_id, prompt_name, version_tag, proxy_latency_ms, llm_latency_ms, token_count, metadata, created_at",
      )
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false })
      .limit(1000);

    if (error) {
      throw new Error(error.message);
    }

    let items = ((data ?? []) as AuditLogTraceRow[]).map(mapAuditRowToTraceSummary);

    items = items.filter((item) => {
      if (useType !== "all" && item.useType !== useType) return false;
      if (status !== "all" && item.status !== status) return false;
      if (environment !== "all" && item.environment.toLowerCase() !== environment) return false;
      if (!query) return true;

      return (
        item.id.toLowerCase().includes(query) ||
        item.promptName.toLowerCase().includes(query) ||
        item.promptVersion.toLowerCase().includes(query) ||
        (item.model ?? "").toLowerCase().includes(query) ||
        (item.provider ?? "").toLowerCase().includes(query) ||
        (item.sidecarName ?? "").toLowerCase().includes(query)
      );
    });

    if (sortBy === "latency") {
      items = [...items].sort((a, b) => b.durationMs - a.durationMs);
    } else if (sortBy === "cost") {
      items = [...items].sort((a, b) => (b.totalCostUsd ?? 0) - (a.totalCostUsd ?? 0));
    } else if (sortBy === "tokens") {
      items = [...items].sort((a, b) => b.tokenCount - a.tokenCount);
    }

    const total = items.length;
    const totalPages = total > 0 ? Math.ceil(total / pageSize) : 0;
    const safePage = totalPages === 0 ? 1 : Math.min(page, totalPages);
    const start = (safePage - 1) * pageSize;
    const paged = items.slice(start, start + pageSize);

    return NextResponse.json({
      items: paged,
      page: safePage,
      pageSize,
      total,
      totalPages,
    } satisfies TraceListResponse);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load traces" },
      { status: 500 },
    );
  }
}
