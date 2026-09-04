import { NextRequest, NextResponse } from "next/server";

import { assertWorkspaceMember } from "@/lib/server/assert-workspace-member";
import {
  listAuditRecords,
  type AuditActorType,
  type AuditRecord,
  type AuditResult,
} from "@/lib/server/audit-records";
import { toSafeApiError } from "@/lib/server/safe-api-errors";
import type { AuditLogView } from "@/lib/api";

export const dynamic = "force-dynamic";

/* ══════════════════════════════════════════════════════════════════════════════
   GET /api/audit

   READS THE AUDIT TABLE THAT IS ACTUALLY WRITTEN.

   This queried Supabase `vectorbea.audit_logs` — the LLM-proxy latency ledger,
   in a project no deployment provisions — so the screen answered "audit records
   are not provisioned in this environment" while the real governance trail sat
   in Postgres `audit_log`, appended to on every login, publish, approval
   decision, connection change, member change and settings change by the Kotlin
   API. The screen was not empty; it was pointed at the wrong database.

   FILTERING AND PAGING HAPPEN IN THE DATABASE. `total` is a COUNT over the same
   predicates as the page, because a count is itself the answer to a compliance
   question ("how many denied actions this quarter") and because a pager cannot
   say "of 12,480" without it.

   THE RESPONSE STAYS SHAPE-COMPATIBLE. `AuditLogView` fields are still present
   and populated so the legacy dashboard table and notifications popover keep
   rendering; the governance fields they do not know about are additive.
══════════════════════════════════════════════════════════════════════════════ */

const MAX_PAGE_SIZE = 200;
const DEFAULT_PAGE_SIZE = 50;

/** The record, plus the legacy fields the older surfaces still read. */
export type AuditItem = AuditRecord & AuditLogView;

export interface AuditPage {
  items: AuditItem[];
  page: number;
  pageSize: number;
  total: number;
  actions: string[];
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

function resultParam(raw: string | null): AuditResult | null {
  return raw === "success" || raw === "denied" || raw === "error" ? raw : null;
}

function actorTypeParam(raw: string | null): AuditActorType | null {
  return raw === "user" || raw === "system" || raw === "api_key" ? raw : null;
}

/**
 * Carry each record into the legacy shape as well as its own.
 *
 * `promptName` and `versionTag` are the two fields the old dashboard table
 * renders, so they get the action and the target type — the closest true
 * statement about a governance record. The latency and token fields are zero
 * because this table does not record them, and inventing a number for a column
 * an operator might read is worse than a visible zero.
 */
function toItem(record: AuditRecord): AuditItem {
  return {
    ...record,
    promptName: record.action,
    versionTag: record.targetType,
    proxyLatencyMs: 0,
    llmLatencyMs: 0,
    tokenCount: 0,
    useType: "audit",
    metadata: {
      actor_type: record.actorType,
      actor_id: record.actorId,
      actor_email: record.actorLabel,
      action: record.action,
      target_type: record.targetType,
      target_id: record.targetId,
      result: record.result,
      environment_id: record.environmentId,
      before: record.before,
      after: record.after,
      user_agent: record.userAgent,
      ip_hash: record.ipHash,
    },
  };
}

const EMPTY: AuditPage = {
  items: [],
  page: 1,
  pageSize: DEFAULT_PAGE_SIZE,
  total: 0,
  actions: [],
};

export async function GET(request: NextRequest) {
  try {
    const params = request.nextUrl.searchParams;
    const workspaceId = params.get("workspaceId")?.trim();
    if (!workspaceId) return NextResponse.json(EMPTY satisfies AuditPage);

    // ── P0: Tenant isolation gate ──────────────────────────────────────────
    const auth = await assertWorkspaceMember(request, workspaceId);
    if (auth.error) return auth.error;
    // ──────────────────────────────────────────────────────────────────────

    const page = await listAuditRecords({
      workspaceId,
      page: intParam(params.get("page"), 1, 10_000),
      pageSize: intParam(params.get("pageSize"), DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE),
      since: instantParam(params.get("since")),
      until: instantParam(params.get("until")),
      search: params.get("q")?.trim() || null,
      action: params.get("action")?.trim() || null,
      result: resultParam(params.get("result")),
      actorType: actorTypeParam(params.get("actorType")),
    });

    return NextResponse.json({
      items: page.items.map(toItem),
      page: page.page,
      pageSize: page.pageSize,
      total: page.total,
      actions: page.actions,
    } satisfies AuditPage);
  } catch (error) {
    const safe = toSafeApiError(error, "Failed to load audit logs");
    return NextResponse.json({ error: safe.message, code: safe.code }, { status: safe.status });
  }
}
