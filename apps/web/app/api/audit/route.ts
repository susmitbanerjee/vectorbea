import { NextRequest, NextResponse } from "next/server";

import { assertWorkspaceMember } from "@/lib/server/assert-workspace-member";
import { resolveAuditLlmLatencyMs, resolveAuditProxyLatencyMs } from "@/lib/server/audit-latency";
import { normalizeTraceMetadataV1 } from "@/lib/trace-metadata";
import { createVectorBeaAdminClient } from "@/lib/supabase-admin";
import { toSafeApiError } from "@/lib/server/safe-api-errors";
import type { AuditLogView } from "@/lib/api";

export const dynamic = "force-dynamic";

/* ══════════════════════════════════════════════════════════════════════════════
   GET /api/audit

   FILTERING AND PAGING HAPPEN IN THE DATABASE, not in the browser.

   This returned the newest 100 rows and nothing else — no range, no type
   filter, no paging — and the screen filtered that fixed 100 with a substring
   match. On any workspace with real traffic that is not an audit log: the
   answer to "what happened at 03:14 last Tuesday" was outside the window and
   unreachable, and "no results" meant "not in the last 100 rows", which reads
   as "it did not happen". For a surface enterprise buyers ask about on the
   first call, that is the difference between a feature and a screenshot.

   `total` is returned alongside the page because a count is itself the answer
   to a compliance question ("how many privileged actions this quarter"), and
   because a pager cannot say "of 12,480" without it.
══════════════════════════════════════════════════════════════════════════════ */

const MAX_PAGE_SIZE = 200;
const DEFAULT_PAGE_SIZE = 50;

function resolveUseType(metadata: Record<string, unknown>): "runtime" | "audit" {
  const normalized = normalizeTraceMetadataV1(metadata);
  const explicit = normalized.tags?.use_type;
  if (explicit === "runtime" || explicit === "audit") return explicit;
  const action = (normalized.custom as Record<string, unknown> | undefined)?.action;
  return typeof action === "string" && action.trim() ? "audit" : "runtime";
}

/** A positive integer from the query string, clamped, or the fallback. */
function intParam(raw: string | null, fallback: number, max: number): number {
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 1) return fallback;
  return Math.min(Math.floor(value), max);
}

/** An ISO instant, or null when absent/unparseable. */
function instantParam(raw: string | null): string | null {
  if (!raw) return null;
  const at = new Date(raw);
  return Number.isNaN(at.getTime()) ? null : at.toISOString();
}

export interface AuditPage {
  items: AuditLogView[];
  page: number;
  pageSize: number;
  total: number;
}

export async function GET(request: NextRequest) {
  try {
    const params = request.nextUrl.searchParams;
    const workspaceId = params.get("workspaceId")?.trim();
    if (!workspaceId) {
      return NextResponse.json({ items: [], page: 1, pageSize: DEFAULT_PAGE_SIZE, total: 0 } satisfies AuditPage);
    }

    // ── P0: Tenant isolation gate ──────────────────────────────────────────
    const auth = await assertWorkspaceMember(request, workspaceId);
    if (auth.error) return auth.error;
    // ──────────────────────────────────────────────────────────────────────

    const page = intParam(params.get("page"), 1, 10_000);
    const pageSize = intParam(params.get("pageSize"), DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);
    const since = instantParam(params.get("since"));
    const until = instantParam(params.get("until"));
    const search = params.get("q")?.trim();

    const supabase = createVectorBeaAdminClient();

    let query = supabase
      .from("audit_logs")
      .select(
        "id, prompt_name, version_tag, proxy_latency_ms, llm_latency_ms, token_count, metadata, created_at",
        { count: "exact" },
      )
      .eq("workspace_id", workspaceId);

    if (since) query = query.gte("created_at", since);
    if (until) query = query.lt("created_at", until);
    // Server-side text match across the two columns that carry a name. The
    // metadata blob is deliberately NOT searched here: it is unindexed jsonb
    // and a LIKE over it turns every query into a full scan of the table.
    if (search) {
      const escaped = search.replace(/[%_,()]/g, (character) => `\\${character}`);
      query = query.or(`prompt_name.ilike.%${escaped}%,version_tag.ilike.%${escaped}%`);
    }

    const from = (page - 1) * pageSize;
    const { data, error, count } = await query
      .order("created_at", { ascending: false })
      .range(from, from + pageSize - 1);

    if (error) throw new Error(error.message);

    const items: AuditLogView[] = (data ?? []).map((row) => ({
      timestamp: row.created_at,
      workspaceId,
      promptName: row.prompt_name ?? "",
      versionTag: row.version_tag ?? "",
      proxyLatencyMs: resolveAuditProxyLatencyMs(row.proxy_latency_ms, row.metadata),
      llmLatencyMs: resolveAuditLlmLatencyMs(row.llm_latency_ms, row.metadata),
      tokenCount: row.token_count ?? 0,
      useType: resolveUseType((row.metadata as Record<string, unknown>) ?? {}),
      metadata: (row.metadata as Record<string, unknown>) ?? {},
    }));

    return NextResponse.json({ items, page, pageSize, total: count ?? items.length } satisfies AuditPage);
  } catch (error) {
    const safe = toSafeApiError(error, "Failed to load audit logs");
    return NextResponse.json({ error: safe.message, code: safe.code }, { status: safe.status });
  }
}
